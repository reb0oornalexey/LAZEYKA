import { execFileSync } from 'node:child_process'
import { chmod, mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'

const flowsealVersion = '1.10.3'
const flowsealAsset = `zapret-discord-youtube-${flowsealVersion}.tar.gz`
const dataMarker = '@ZAPRET_DATA@'
const supported = new Set(`
  filter-l3 filter-l7 filter-tcp filter-udp hostlist hostlist-domains hostlist-exclude
  hostlist-exclude-domains ip-id ipset ipset-exclude dpi-desync dpi-desync-any-protocol
  dpi-desync-badseq-increment dpi-desync-cutoff dpi-desync-fake-discord dpi-desync-fake-http
  dpi-desync-fake-quic dpi-desync-fake-stun dpi-desync-fake-tls dpi-desync-fake-tls-mod
  dpi-desync-fake-unknown dpi-desync-fake-unknown-udp dpi-desync-fakedsplit-pattern
  dpi-desync-fooling dpi-desync-hostfakesplit-mod dpi-desync-repeats dpi-desync-split-pos
  dpi-desync-split-seqovl dpi-desync-split-seqovl-pattern
`.trim().split(/\s+/))

function parseBatch(text, name, assets) {
  const command = text.replace(/\^\r?\n/g, ' ').split(/\r?\n/)
    .find((line) => /"%BIN%winws\.exe"\s+--wf-tcp=/.test(line))
  if (!command) throw new Error(`${name}: winws arguments are missing`)
  const raw = command.slice(command.indexOf(' --wf-tcp=') + 1).trim()
  const tokens = raw.match(/--[a-z0-9-]+(?:=(?:"[^"]+"|[^\s"]+))?/g) ?? []
  if (raw.replace(/--[a-z0-9-]+(?:=(?:"[^"]+"|[^\s"]+))?/g, '').trim()) {
    throw new Error(`${name}: unexpected content in winws arguments`)
  }

  if (tokens.shift() !== '--wf-tcp=80,443,2053,2083,2087,2096,8443,%GameFilterTCP%' ||
      tokens.shift() !== '--wf-udp=443,19294-19344,50000-50100,%GameFilterUDP%') {
    throw new Error(`${name}: update the nftables port rules for the new WinDivert filters`)
  }
  const sections = [[]]
  for (const arg of tokens) {
    if (arg === '--new') sections.push([])
    else sections.at(-1).push(arg)
  }
  const args = sections
    .map((section) => section.flatMap((arg) => {
      const match = /^--([a-z0-9-]+)=(.+)$/.exec(arg)
      if (!match || !supported.has(match[1])) throw new Error(`${name}: unsupported option ${arg}`)
      const [, key, value] = match
      if (key === 'filter-tcp' && value === '%GameFilterTCP%') return ['--filter-tcp=@ZAPRET_GAME_TCP@']
      if (key === 'filter-udp' && value === '%GameFilterUDP%') return ['--filter-udp=@ZAPRET_GAME_UDP@']
      const file = /^"%(BIN|LISTS)%([\w.-]+)"$/.exec(value)
      if (file) {
        const [, source, filename] = file
        if (source === 'LISTS' && /^(list-general|list-exclude)-user\.txt$/.test(filename)) {
          return [`--${key}=@ZAPRET_USER@/${filename}`]
        }
        if (source === 'LISTS' && filename === 'ipset-exclude-user.txt') return []
        const folder = source.toLowerCase()
        if (!assets.has(`${folder}/${filename}`)) throw new Error(`${name}: missing ${filename}`)
        return [`--${key}=${dataMarker}/${folder}/${filename}`]
      }
      const native = value === '^!' ? '!' : value
      if (!/^[\w.,!=:+~-]+$/.test(native)) throw new Error(`${name}: unsupported value ${arg}`)
      return [`--${key}=${native}`]
    }))
  if (args.some((section) => section.length === 0)) throw new Error(`${name}: empty profile section`)
  return args.flatMap((section, index) => index ? ['--new', ...section] : section)
}

export async function prepareLinuxZapret({ download, work, output, version, readZapret, checkX64Elf }) {
  const archive = path.join(work, flowsealAsset)
  await writeFile(archive, await download(
    `https://github.com/Flowseal/zapret-discord-youtube/releases/download/${flowsealVersion}/${flowsealAsset}`,
    '12478bc0908c60012daeed177a0a44287fa4f7fd8f86f0d0cff84ed132f67185'
  ), { flag: 'wx' })
  const prefix = `zapret-discord-youtube-${flowsealVersion}/`
  const members = execFileSync('tar', ['-tzf', archive], { encoding: 'utf8' }).trim().split(/\r?\n/)
    .filter((name) => name.startsWith(prefix)).map((name) => name.slice(prefix.length))
  const read = (member) => execFileSync('tar', ['-xOzf', archive, prefix + member], { maxBuffer: 32 * 1024 * 1024 })
  const assets = new Set(members.filter((name) => /^(?:bin\/[\w.-]+\.bin|lists\/[\w.-]+\.txt(?:\.backup)?)$/.test(name)))
  const binaries = readZapret('binaries/linux-x86_64/nfqws')
  checkX64Elf(binaries, 'nfqws')
  const executable = path.join(output, 'nfqws')
  for (const dir of ['bin', 'lists', 'profiles']) await mkdir(path.join(output, dir), { recursive: true })
  await writeFile(executable, binaries)
  await chmod(executable, 0o755)
  await writeFile(path.join(output, 'version.txt'), version + '\n')
  await writeFile(path.join(output, 'LICENSE.txt'), readZapret('docs/LICENSE.txt'))
  for (const member of assets) await writeFile(path.join(output, member), read(member))

  const catalog = members
    .filter((name) => /^general(?: \([A-Z0-9 ]+\))?\.bat$/.test(name))
    .sort((a, b) => a.localeCompare(b, 'en', { numeric: true }))
    .map((name) => {
      const variant = /^general(?: \(([A-Z0-9 ]+)\))?\.bat$/.exec(name)[1]
      return {
        file: variant ? variant.toLowerCase().replace(/ +/g, '-') : 'general',
        title: variant || 'general',
        description: 'Flowseal ' + flowsealVersion,
        args: parseBatch(read(name).toString('utf8'), name, assets)
      }
    })
  if (catalog.length !== 22 || new Set(catalog.map((item) => item.file)).size !== catalog.length) {
    throw new Error(`Expected 22 unique Flowseal profiles, found ${catalog.length}`)
  }
  for (const { file, args } of catalog) {
    // nfqws itself validates each translated profile during the native build.
    if (process.platform === 'linux' && process.arch === 'x64') {
      try {
        const native = args.filter((arg) => !arg.includes('@ZAPRET_USER@'))
          .map((arg) => arg.replace(dataMarker, output).replace(/@ZAPRET_GAME_(?:TCP|UDP)@/, '1024-65535'))
        execFileSync(executable, ['--dry-run', '--qnum=17743', ...native], {
          stdio: ['ignore', 'pipe', 'pipe']
        })
      } catch (error) {
        throw new Error(`nfqws rejected ${file}: ${error.stderr ?? error.message}`)
      }
    }
    await writeFile(path.join(output, 'profiles', file + '.args'), args.join('\n') + '\n')
  }
  await writeFile(path.join(output, 'profiles.json'), JSON.stringify(catalog.map(({ file, title, description }) => ({
    file, title, description
  })), null, 2) + '\n')
  console.log(`Prepared ${catalog.length} Flowseal ${flowsealVersion} profiles for nfqws ${version}`)
}
