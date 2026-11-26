import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { dataDir } from './dirs'

const command = '/usr/bin/gsettings'
const schema = 'org.gnome.system.proxy'
const keys = [
  [schema + '.http', 'host'],
  [schema + '.http', 'port'],
  [schema + '.https', 'host'],
  [schema + '.https', 'port'],
  [schema + '.socks', 'host'],
  [schema + '.socks', 'port'],
  [schema + '.http', 'use-authentication'],
  [schema, 'ignore-hosts'],
  [schema, 'mode']
] as const

interface OwnedProxy {
  before: string[]
  applied: string[]
}

export function hasLinuxSystemProxy(): boolean {
  return process.platform === 'linux' &&
    (process.env.XDG_CURRENT_DESKTOP ?? '').split(':').includes('GNOME') &&
    !!process.env.DBUS_SESSION_BUS_ADDRESS && existsSync(command)
}

function stateFile(): string {
  return path.join(dataDir(), 'linux-system-proxy.json')
}

function call(args: string[]): string {
  const result = spawnSync(command, args, { encoding: 'utf8', timeout: 1200 })
  if (result.status !== 0 || result.error || result.stderr.trim()) {
    throw new Error('Не удалось изменить системный прокси GNOME.')
  }
  return result.stdout.trim()
}

function readOwnership(): OwnedProxy | null {
  const file = stateFile()
  if (!existsSync(file)) return null
  const value = JSON.parse(readFileSync(file, 'utf8')) as OwnedProxy
  if (![value.before, value.applied].every((data) =>
    Array.isArray(data) && data.length === keys.length && data.every((item) => typeof item === 'string'))) {
    throw new Error('Не удалось прочитать сохранённые настройки прокси GNOME.')
  }
  return value
}

function restore(owned: OwnedProxy): void {
  const live = keys.map((key) => call(['get', ...key]))
  const endpointsUnchanged = live.slice(0, 6).every((value, index) => value === owned.applied[index])
  for (const [index, key] of keys.entries()) {
    if (key[1] === 'mode' && !endpointsUnchanged) continue
    if (live[index] === owned.applied[index]) call(['set', ...key, owned.before[index]])
  }
  unlinkSync(stateFile())
}

export function setLinuxSystemProxy(port: number, bypass: string[]): void {
  if (!hasLinuxSystemProxy()) throw new Error('Системный прокси доступен в сеансе GNOME.')
  const saved = readOwnership()
  if (saved) restore(saved)
  const before = keys.map((key) => {
    if (call(['writable', ...key]) !== 'true') throw new Error('Системный прокси заблокирован настройками GNOME.')
    return call(['get', ...key])
  })
  const host = "'127.0.0.1'"
  const ignore = [...new Set(['localhost', '127.0.0.0/8', '::1', ...bypass])]
    .map((value) => "'" + value.replace(/\\/g, '\\\\').replace(/'/g, "\\'") + "'")
  const applied = [host, String(port), host, String(port), "''", '0', 'false', `[${ignore.join(', ')}]`, "'manual'"]
  const file = stateFile()
  mkdirSync(path.dirname(file), { recursive: true })
  writeFileSync(file + '.tmp', JSON.stringify({ before, applied }), { mode: 0o600 })
  renameSync(file + '.tmp', file)
  try {
    for (const [index, key] of keys.entries()) {
      call(['set', ...key, applied[index]])
      if (call(['get', ...key]) !== applied[index]) throw new Error('GNOME не применил настройки системного прокси.')
    }
  } catch (error) {
    restore({ before, applied })
    throw error
  }
}

export function clearLinuxSystemProxy(): void {
  if (!hasLinuxSystemProxy()) return
  const owned = readOwnership()
  if (owned) restore(owned)
}
