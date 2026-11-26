import { execFile } from 'node:child_process'
import { access, readFile } from 'node:fs/promises'
import { constants, readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { promisify } from 'node:util'
import { domainToASCII } from 'node:url'
import { bundledNetworkDir } from '../utils/dirs'
import type { StrategyDescriptor } from './zapret-strategy'

const exec = promisify(execFile)
const unit = 'lazeyka-zapret.service'
const control = '/usr/lib/lazeyka/zapret-control'
const lists = '/var/lib/lazeyka-zapret'

let catalog: StrategyDescriptor[] | undefined

export function listLinuxStrategies(): StrategyDescriptor[] {
  try {
    catalog ??= JSON.parse(readFileSync(path.join(bundledNetworkDir(), 'zapret', 'profiles.json'), 'utf8')) as StrategyDescriptor[]
    return [...catalog, ...getLinuxZapretCustomProfiles()]
  } catch {
    return []
  }
}

interface LinuxZapretCustom extends StrategyDescriptor {
  base: string
  repeats: number
}

export function getLinuxZapretCustomProfiles(): LinuxZapretCustom[] {
  const dir = path.join(lists, 'profiles')
  try {
    return readdirSync(dir).filter((name) => /^own-[a-f0-9]{16}\.json$/.test(name)).flatMap((name) => {
      try {
        return [JSON.parse(readFileSync(path.join(dir, name), 'utf8')) as LinuxZapretCustom]
      } catch { return [] }
    }).sort((a, b) => a.title.localeCompare(b.title))
  } catch { return [] }
}

export function setLinuxZapretCustom(input: unknown): Promise<void> {
  return saveLinuxZapretSettings('profile', input ?? {})
}

export function isLinuxZapretStrategy(name: unknown): boolean {
  return listLinuxStrategies().some((strategy) => strategy.file === name)
}

export function resolveLinuxStrategy(name: string | undefined): string
export function resolveLinuxStrategy(name: string | undefined, fallback: false): string | undefined
export function resolveLinuxStrategy(name: string | undefined, fallback = true): string | undefined {
  if (name && isLinuxZapretStrategy(name)) return name
  const migrated = /^general(?:[ -(]+([a-z0-9 -]+)\)?)?(?:\.bat)?$/i.exec(name ?? '')
  if (migrated) {
    const id = migrated[1]?.trim().toLowerCase().replace(/ +/g, '-') ?? 'general'
    if (isLinuxZapretStrategy(id)) return id
  }
  return fallback ? 'simple-fake' : undefined
}

export async function linuxZapretVersion(): Promise<string | null> {
  try {
    return (await readFile(path.join(bundledNetworkDir(), 'zapret', 'version.txt'), 'utf8')).trim() || null
  } catch {
    return null
  }
}

export async function linuxZapretSystemState(): Promise<{ state: string; pid: number; strategy?: string }> {
  const { stdout } = await exec('/usr/bin/systemctl', ['show', unit, '-p', 'ActiveState', '-p', 'MainPID'], { timeout: 2500 })
  const state = /^ActiveState=(.*)$/m.exec(stdout)?.[1] ?? 'inactive'
  const pid = Number(/^MainPID=(\d+)$/m.exec(stdout)?.[1] ?? 0)
  if (state !== 'active') return { state, pid }
  const strategy = await readFile('/run/lazeyka-zapret-control/strategy', 'utf8').catch(() => '')
  return { state, pid, strategy: strategy.trim() || undefined }
}

async function runControl(args: string[]): Promise<void> {
  try {
    await Promise.all([access(control, constants.X_OK), access('/usr/bin/pkexec', constants.X_OK)])
  } catch {
    throw new Error('Служба Zapret не установлена. Установите пакет LAZEYKA для Linux.')
  }
  try {
    await exec('/usr/bin/pkexec', ['--disable-internal-agent', control, ...args], { timeout: 120_000 })
  } catch (e) {
    const error = e as { code?: number; stderr?: string; killed?: boolean }
    if (error.code === 126) throw new Error('Подтверждение запуска Zapret отменено.')
    if (error.code === 127) throw new Error('Подтвердите управление Zapret в диалоге администратора Linux.')
    if (error.killed) throw new Error('Истекло время ожидания подтверждения Zapret.')
    const details = error.stderr?.trim()
    throw new Error(details ? `Служба Zapret не выполнила команду.\n${details}` : 'Служба Zapret не выполнила команду. Проверьте системный журнал.')
  }
}

export async function applyLinuxZapretStrategy(file: string): Promise<void> {
  if (!isLinuxZapretStrategy(file)) throw new Error('Неизвестная стратегия Zapret для Linux.')
  const current = await linuxZapretSystemState().catch(() => null)
  if (current?.state === 'active' && current.strategy === file) return
  await runControl(['start', file])
  const next = await linuxZapretSystemState()
  if (next.state !== 'active' || next.strategy !== file) throw new Error('Zapret не подтвердил запуск выбранной стратегии.')
}

export async function stopLinuxZapret(): Promise<void> {
  const current = await linuxZapretSystemState().catch(() => null)
  if (current?.state === 'inactive' || current?.state === 'failed') return
  await runControl(['stop'])
}

export async function getLinuxZapretUserLists(): Promise<{ include: string[]; exclude: string[] }> {
  const load = async (name: string): Promise<string[]> => {
    const text = await readFile(path.join(lists, name), 'utf8').catch(() => '')
    return text.split(/\r?\n/).filter(Boolean)
  }
  const [include, exclude] = await Promise.all([load('list-general-user.txt'), load('list-exclude-user.txt')])
  return { include, exclude }
}

export async function setLinuxZapretUserLists(input: { include?: unknown; exclude?: unknown }): Promise<void> {
  if (process.platform !== 'linux') throw new Error('Этот редактор списков доступен в Linux.')
  const normalize = (entries: unknown): string[] => {
    if (!Array.isArray(entries) || entries.length > 4096) throw new Error('Укажите до 4096 доменов в каждом списке.')
    return [...new Set(entries.map((item: unknown) => {
      if (typeof item !== 'string') throw new Error('Домен должен быть строкой.')
      const raw = item.trim().toLowerCase()
      if (/[\s/:?#@\\]/.test(raw)) throw new Error(`Укажите домен без схемы или пути: ${raw.slice(0, 80)}`)
      const host = domainToASCII(raw.startsWith('^') ? raw.slice(1) : raw)
      if (!host) throw new Error(`Некорректный домен: ${raw.slice(0, 80)}`)
      return raw.startsWith('^') ? '^' + host : host
    }))]
  }
  return saveLinuxZapretSettings('lists', { include: normalize(input.include), exclude: normalize(input.exclude) })
}

export async function getLinuxZapretGameFilter(): Promise<{
  mode: 'off' | 'tcp' | 'udp' | 'all'; ipset: 'none' | 'loaded' | 'any'; tcp: string; udp: string
}> {
  try {
    return JSON.parse(await readFile(path.join(lists, 'game-filter.json'), 'utf8'))
  } catch {
    return { mode: 'off', ipset: 'none', tcp: '1024-65535', udp: '1024-65535' }
  }
}

export function setLinuxZapretGameFilter(input: unknown): Promise<void> {
  return saveLinuxZapretSettings('game', input ?? {})
}

function saveLinuxZapretSettings(command: 'lists' | 'game' | 'profile', settings: unknown): Promise<void> {
  if (process.platform !== 'linux') return Promise.reject(new Error('Эти параметры доступны в Linux.'))
  const payload = JSON.stringify(settings)
  return new Promise((resolve, reject) => {
    const child = execFile('/usr/bin/pkexec', ['--disable-internal-agent', control, command],
      { timeout: 120_000 }, (error, _stdout, stderr) => {
        if (!error) return resolve()
        if (error.code === 126 || error.code === 127) {
          reject(new Error('Подтвердите сохранение параметров Zapret в диалоге администратора Linux.'))
        } else {
          reject(new Error(stderr.trim().split('\n').at(-1) || 'Не удалось применить параметры Zapret.'))
        }
      })
    child.stdin?.on('error', () => void 0)
    child.stdin?.end(payload)
  })
}
