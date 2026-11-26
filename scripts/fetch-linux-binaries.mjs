import { createHash } from 'node:crypto'
import { chmod, copyFile, cp, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import AdmZip from 'adm-zip'
import { prepareLinuxZapret } from './fetch-linux-zapret.mjs'

const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const output = path.join(project, 'resources-linux')
const xrayUrl = 'https://github.com/XTLS/Xray-core/releases/download/v26.10.21/Xray-linux-64.zip'
const singBoxRelease = 'https://github.com/Leadaxe/sing-box-lx/releases/download/v1.14.4-lx.36/'
const singBoxAsset = 'sing-box-1.14.4-lx.36-linux-amd64.tar.gz'
const singBoxUrl = new URL(singBoxAsset, singBoxRelease)
const zapretVersion = '72.13'
const zapretAsset = `zapret-v${zapretVersion}.tar.gz`
const zapretUrl = `https://github.com/bol-van/zapret/releases/download/v${zapretVersion}/${zapretAsset}`

async function download(url, sha256) {
  const response = await fetch(url, { signal: AbortSignal.timeout(120_000) })
  if (!response.ok) throw new Error('HTTP ' + response.status + ' ' + url)
  const bytes = Buffer.from(await response.arrayBuffer())
  if (createHash('sha256').update(bytes).digest('hex') !== sha256) {
    throw new Error('SHA-256 mismatch: ' + url)
  }
  return bytes
}

function checkX64Elf(bytes, name) {
  if (bytes.length < 64 || bytes.subarray(0, 4).toString('hex') !== '7f454c46' ||
      bytes[4] !== 2 || bytes[5] !== 1 || bytes.readUInt16LE(18) !== 62) {
    throw new Error(name + ' is not a Linux x86-64 executable')
  }
}

const [singArchive, xrayArchive, zapretArchive] = await Promise.all([
  download(singBoxUrl, '77d9ecce71504063585f88090349fbb863498b2b428ba57dd23d2bfda83a0187'),
  download(xrayUrl, '0eec3ed4163c273d8c8bf821f7d219e257921cf584aa3fb970715e458e631978'),
  download(zapretUrl, '25c74e6c5f48963fa244c2955e76694a07c39447245a0457e2efdc74b3317e68')
])
const work = await mkdtemp(path.join(tmpdir(), 'lazeyka-linux-cores-'))
const archive = path.join(work, singBoxAsset)
try {
  await writeFile(archive, singArchive, { flag: 'wx' })
  const listing = execFileSync('tar', ['-tzf', archive], { encoding: 'utf8' })
  const entry = listing.split(/\r?\n/).find((name) => /^[a-z0-9.-]+\/sing-box$/i.test(name))
  if (!entry) throw new Error('sing-box member is missing')
  const singBox = execFileSync('tar', ['-xOzf', archive, entry], { maxBuffer: 128 * 1024 * 1024 })
  const xray = new AdmZip(xrayArchive).readFile('xray')
  if (!xray) throw new Error('xray member is missing')
  checkX64Elf(singBox, 'sing-box')
  checkX64Elf(xray, 'xray')
  const coreDir = path.join(output, 'incy')
  await mkdir(coreDir, { recursive: true })
  for (const [name, bytes] of [['sing-box', singBox], ['xray', xray]]) {
    const file = path.join(coreDir, name)
    await writeFile(file, bytes, { mode: 0o755 })
    await chmod(file, 0o755)
  }
  const zapretTar = path.join(work, zapretAsset)
  await writeFile(zapretTar, zapretArchive, { flag: 'wx' })
  const readZapret = (member) => execFileSync('tar', [
    '-xOzf', zapretTar, `zapret-v${zapretVersion}/${member}`
  ], { maxBuffer: 16 * 1024 * 1024 })
  const zapretDir = path.join(output, 'zapret')
  await rm(zapretDir, { recursive: true, force: true })
  await prepareLinuxZapret({
    download, work, output: zapretDir, version: zapretVersion, readZapret, checkX64Elf
  })
  for (const name of ['engine.sh', 'firewall.sh', 'user-lists.py', 'launch.py', 'zapret_options.py']) {
    await copyFile(path.join(project, 'build', 'linux', 'zapret', name), path.join(zapretDir, name))
  }
  const control = path.join(output, 'zapret-control')
  await copyFile(path.join(project, 'build', 'linux', 'zapret', 'control.sh'), control)
  await chmod(control, 0o755)
  const tun = path.join(output, 'incy-tun')
  await copyFile(path.join(project, 'build', 'linux', 'incy-tun.py'), tun)
  await chmod(tun, 0o755)
  const dns = path.join(output, 'dns-control')
  await copyFile(path.join(project, 'build', 'linux', 'dns-control.py'), dns)
  await chmod(dns, 0o755)
} finally {
  await rm(work, { recursive: true, force: true })
}

const tgws = path.join(project, 'resources', 'tgws')
const pythonDir = path.join(output, 'tgws', 'python')
await mkdir(pythonDir, { recursive: true })
await copyFile(path.join(tgws, 'python', 'lazeyka_tgws.py'), path.join(pythonDir, 'lazeyka_tgws.py'))
await cp(path.join(tgws, 'app'), path.join(output, 'tgws', 'app'), {
  recursive: true,
  filter: (source) => !/\.(?:exe|dll|pyd|pyc|so)$/i.test(source) && path.basename(source) !== '__pycache__'
})
console.log('Prepared Linux x86-64 cores and TgWsProxy in ' + output)
