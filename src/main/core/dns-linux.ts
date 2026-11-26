import { execFile } from 'node:child_process'
import { lookup } from 'node:dns/promises'
import { existsSync, readFileSync } from 'node:fs'
import { isIP } from 'node:net'
import { promisify } from 'node:util'

const exec = promisify(execFile)
const helper = '/usr/lib/lazeyka/dns-control'
const runtimeStatus = '/var/lib/lazeyka-dns/status.json'
const stub = '127.0.0.59'

export async function readLinuxDnsState(): Promise<{ servers: string[]; changedByApp: boolean; providerId?: string }> {
  const output = await exec('/usr/bin/resolvectl', ['dns'], { timeout: 2500 })
    .then(({ stdout }) => stdout).catch(() => '')
  const servers = [...new Set(output.split(/\r?\n/).flatMap((line) => {
    const separator = line.indexOf(': ')
    return separator < 0 ? [] : line.slice(separator + 2).trim().split(/\s+/)
  }).filter((item) => isIP(item) !== 0))]
  try {
    const { providerId } = JSON.parse(readFileSync(runtimeStatus, 'utf-8')) as { providerId: string }
    if (output.includes(stub + ':5354')) return { servers: [stub], changedByApp: true, providerId }
  } catch { /* DNS is managed by the operating system */ }
  return { servers, changedByApp: false }
}

type Endpoint = { type: 'udp'; address: string } |
  { type: 'https'; address: string; hostname: string; path: string; port: number }

export async function linuxDnsEndpoint(ip: string, doh: string | undefined): Promise<Endpoint> {
  if (!doh) {
    if (!isIP(ip)) throw new Error('Для обычного DNS нужен IP-адрес сервера.')
    return { type: 'udp', address: ip }
  }
  const url = new URL(doh.replace(/\{\?dns\}$/, ''))
  if (url.protocol !== 'https:' || url.username || url.password || url.hash) {
    throw new Error('Нужна ссылка HTTPS на сервер DoH.')
  }
  const name = url.hostname.replace(/^\[|\]$/g, '')
  let timeout: ReturnType<typeof setTimeout> | undefined
  try {
    const address = isIP(name) ? name : await Promise.race([
      lookup(name, { all: true }).then((records) => {
        const record = records.find((item) => item.family === 4) ?? records[0]
        if (!record) throw new Error('Не удалось найти IP сервера DoH.')
        return record.address
      }),
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => reject(new Error('Не удалось найти IP сервера DoH.')), 4500)
      })
    ])
    return { type: 'https', address, hostname: name, path: url.pathname + url.search, port: Number(url.port || 443) }
  } finally {
    clearTimeout(timeout)
  }
}

export async function changeLinuxDns(provider?: { id: string; endpoint: Endpoint }): Promise<void> {
  if (!existsSync(helper)) throw new Error('Установите пакет LAZEYKA для Ubuntu с поддержкой системного DNS.')
  return new Promise((resolve, reject) => {
    const process = execFile('/usr/bin/pkexec', ['--disable-internal-agent', helper, provider ? 'set' : 'reset'],
      { timeout: 120_000 }, (error, _stdout, stderr) => {
        if (!error) return resolve()
        if (error.code === 126 || error.code === 127) {
          reject(new Error('Для изменения системного DNS подтвердите права администратора Linux.'))
        } else {
          reject(new Error(stderr.trim().split('\n').at(-1) || 'Служба системного DNS не выполнила команду.'))
        }
      })
    process.stdin?.on('error', () => void 0)
    process.stdin?.end(provider ? JSON.stringify({ provider: provider.id, endpoint: provider.endpoint }) : '')
  })
}
