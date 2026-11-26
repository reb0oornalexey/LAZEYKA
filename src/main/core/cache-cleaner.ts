/**
 * Е6: «Очистить кэш» (Настройки → Профиль и сброс).
 *
 * Чистится только то, что программа скачает или соберёт заново сама:
 *  - gallery — превью и обои галереи тем (hub/gallery/preview-*, wall-*);
 *    установленные темы и обои лежат в своих папках и не затрагиваются;
 *  - logs — файлы логов старше срока хранения (logs/ГГГГ-ММ-ДД.log);
 *  - subIcons — найденные в сети значки подписок INCY (свои значки остаются);
 *  - updates — оставшиеся установщики обновлений LAZEYKA во временной папке
 *    (Windows, LAZEYKA-update-*.exe);
 *  - web — сетевой кэш окна (HTTP-кэш Chromium).
 * Не трогаются: настройки, подписки и узлы, сценарии, темы, списки Zapret,
 * копии профиля.
 */
import { existsSync, readdirSync, readFileSync, statSync, unlinkSync } from 'node:fs'
import path from 'node:path'
import { app, BrowserWindow, session } from 'electron'
import { dataDir, logDir } from '../utils/dirs'
import { writeFileAtomic } from '../utils/atomic-write'
import { getAppConfigSync } from '../config'
import { appLog } from '../utils/app-logger'
import { isOldLogName } from './cache-cleaner-logic'

export type CacheItemId = 'gallery' | 'logs' | 'subIcons' | 'updates' | 'web'

export interface CacheItem {
  id: CacheItemId
  title: string
  desc: string
  bytes: number
  files: number
}

const galleryDir = (): string => path.join(dataDir(), 'hub', 'gallery')
const subIconsFile = (): string => path.join(dataDir(), 'incy-sub-icons.json')

function listFiles(dir: string, match: (name: string) => boolean): { file: string; bytes: number }[] {
  if (!existsSync(dir)) return []
  const out: { file: string; bytes: number }[] = []
  try {
    for (const name of readdirSync(dir)) {
      if (!match(name)) continue
      const file = path.join(dir, name)
      try {
        const st = statSync(file)
        if (st.isFile()) out.push({ file, bytes: st.size })
      } catch {
        /* исчез */
      }
    }
  } catch {
    /* папка недоступна */
  }
  return out
}

const galleryFiles = (): { file: string; bytes: number }[] =>
  listFiles(galleryDir(), (n) => /^(preview|wall)-[A-Za-z0-9_-]+\.(png|jpg|webp)$/.test(n))

function logFiles(): { file: string; bytes: number }[] {
  const days = Number(getAppConfigSync().maxLogDays) || 7
  return listFiles(logDir(), (n) => isOldLogName(n, days, Date.now()))
}

const updateFiles = (): { file: string; bytes: number }[] =>
  process.platform === 'win32' ? listFiles(app.getPath('temp'), (n) => /^LAZEYKA-update-\d+\.exe$/i.test(n)) : []

function subIconsFound(): { store: Record<string, { custom?: boolean }>; found: string[]; bytes: number } {
  try {
    if (!existsSync(subIconsFile())) return { store: {}, found: [], bytes: 0 }
    const store = JSON.parse(readFileSync(subIconsFile(), 'utf-8')) as Record<string, { custom?: boolean }>
    if (!store || typeof store !== 'object') return { store: {}, found: [], bytes: 0 }
    const found = Object.keys(store).filter((k) => !store[k]?.custom)
    const bytes = found.reduce((s, k) => s + JSON.stringify(store[k]).length, 0)
    return { store, found, bytes }
  } catch {
    return { store: {}, found: [], bytes: 0 }
  }
}

const sum = (l: { bytes: number }[]): number => l.reduce((s, x) => s + x.bytes, 0)

export async function cacheInfo(): Promise<CacheItem[]> {
  const g = galleryFiles()
  const l = logFiles()
  const u = updateFiles()
  const s = subIconsFound()
  let web = 0
  try {
    web = await session.defaultSession.getCacheSize()
  } catch {
    web = 0
  }
  const items: CacheItem[] = [
    { id: 'gallery', title: 'Превью и обои галереи тем', desc: 'Скачаются снова, когда откроете галерею', bytes: sum(g), files: g.length },
    { id: 'logs', title: 'Старые логи', desc: `Старше срока хранения (${Number(getAppConfigSync().maxLogDays) || 7} дн.)`, bytes: sum(l), files: l.length },
    { id: 'subIcons', title: 'Значки подписок', desc: 'Найденные в сети, свои значки остаются', bytes: s.bytes, files: s.found.length },
    { id: 'web', title: 'Сетевой кэш окна', desc: 'Картинки и ответы, сохранённые окном программы', bytes: web, files: 0 }
  ]
  if (process.platform === 'win32') {
    items.splice(3, 0, { id: 'updates', title: 'Скачанные установщики', desc: 'Остатки прошлых обновлений во временной папке', bytes: sum(u), files: u.length })
  }
  return items
}

function removeAll(list: { file: string }[]): number {
  let n = 0
  for (const { file } of list) {
    try {
      unlinkSync(file)
      n++
    } catch {
      /* занят — в другой раз */
    }
  }
  return n
}

/** Очистить всё перечисленное. Возвращает, сколько освобождено. */
export async function clearCache(): Promise<{ freedBytes: number }> {
  const before = sum(await cacheInfo())
  removeAll(galleryFiles())
  removeAll(logFiles())
  removeAll(updateFiles())
  const s = subIconsFound()
  if (s.found.length) {
    const keep: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(s.store)) if (v?.custom) keep[k] = v
    try {
      writeFileAtomic(subIconsFile(), JSON.stringify(keep))
      for (const w of BrowserWindow.getAllWindows()) if (!w.isDestroyed()) w.webContents.send('incy:subIconsChanged')
    } catch {
      /* не записалось — останется как было */
    }
  }
  try {
    await session.defaultSession.clearCache()
  } catch {
    /* noop */
  }
  const after = sum(await cacheInfo())
  const freedBytes = Math.max(0, before - after)
  appLog('info', `Кэш очищен: освобождено ${Math.round(freedBytes / 1024)} КБ`)
  return { freedBytes }
}
