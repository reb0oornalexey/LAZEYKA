import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { dataDir } from './dirs'

/**
 * Реестр дочерних процессов LAZEYKA (sing-box, xray, TgWsProxy).
 *
 * Зачем:
 *  1. При выходе раньше выполнялось `taskkill /IM sing-box.exe` и т.п. — это
 *     убивало и ЧУЖИЕ процессы с тем же именем (Hiddify, v2rayN, NekoBox,
 *     отдельно запущенный Flowseal). Теперь завершаются только свои PID.
 *  2. После аварийного завершения LAZEYKA (краш, «Снять задачу») дочерние
 *     процессы в Windows продолжают жить: осиротевший sing-box держит TUN и
 *     порты. Реестр лежит на диске, и при следующем запуске такие процессы
 *     находятся и завершаются.
 *
 * Перед завершением PID сверяется с именем образа — PID в Windows
 * переиспользуются, и за старым номером может оказаться чужой процесс.
 */

interface ChildEntry {
  pid: number
  image: string
  startedAt: number
}

let entries: ChildEntry[] | null = null

function registryFile(): string {
  return path.join(dataDir(), 'children.json')
}

function load(): ChildEntry[] {
  if (entries) return entries
  try {
    const f = registryFile()
    const parsed = existsSync(f) ? JSON.parse(readFileSync(f, 'utf-8')) : []
    entries = Array.isArray(parsed)
      ? parsed.filter((e) => e && Number.isInteger(e.pid) && typeof e.image === 'string')
      : []
  } catch {
    entries = []
  }
  return entries
}

function persist(): void {
  try {
    const f = registryFile()
    mkdirSync(path.dirname(f), { recursive: true })
    writeFileSync(f, JSON.stringify(entries ?? [], null, 2), 'utf-8')
  } catch {
    /* best effort */
  }
}

export function registerChild(pid: number | undefined, imagePath: string): void {
  if (!pid) return
  const list = load().filter((e) => e.pid !== pid)
  list.push({ pid, image: path.win32.basename(imagePath), startedAt: Date.now() })
  entries = list
  persist()
}

export function unregisterChild(pid: number | undefined): void {
  if (!pid) return
  const list = load()
  const next = list.filter((e) => e.pid !== pid)
  if (next.length === list.length) return
  entries = next
  persist()
}

/** Жив ли процесс с этим PID и тем ли он образом, что мы запускали. */
function isOurProcess(entry: ChildEntry): boolean {
  if (process.platform !== 'win32') return false
  try {
    const r = spawnSync('tasklist.exe', ['/FI', `PID eq ${entry.pid}`, '/FO', 'CSV', '/NH'], {
      windowsHide: true,
      timeout: 3000,
      encoding: 'utf8'
    })
    const out = String(r.stdout ?? '').toLowerCase()
    return out.includes(`"${entry.image.toLowerCase()}"`)
  } catch {
    return false
  }
}

/**
 * Синхронно завершить все зарегистрированные процессы и очистить реестр.
 * Вызывается при выходе и при старте (добивает сирот прошлой сессии).
 */
export function killRegisteredChildrenSync(): number {
  const list = load()
  if (list.length === 0) return 0
  let killed = 0
  for (const e of list) {
    if (!isOurProcess(e)) continue
    try {
      spawnSync('taskkill.exe', ['/F', '/T', '/PID', String(e.pid)], { windowsHide: true, timeout: 3000 })
      killed++
    } catch {
      /* noop */
    }
  }
  entries = []
  persist()
  return killed
}

/** PID из реестра с данным именем образа (без учёта регистра). */
export function registeredPids(image: string): number[] {
  const key = image.toLowerCase()
  return load()
    .filter((e) => e.image.toLowerCase() === key)
    .map((e) => e.pid)
}
