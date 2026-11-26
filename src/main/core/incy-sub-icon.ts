/**
 * Значки провайдеров подписок: загрузка и хранение (логика — в incy-sub-icon-logic.ts).
 *
 * Когда: только вместе с добавлением/обновлением подписки (то есть когда человек сам обновляет
 * подписку или включил автообновление), не чаще раза в неделю на подписку. Отдельно в фоне
 * ничего не ходит. Картинка хранится в файле incy-sub-icons.json как data:URL и работает без сети.
 * Свой значок пользователя (custom) автоматически не перезаписывается.
 */
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { BrowserWindow, ipcMain, net } from 'electron'
import { dataDir } from '../utils/dirs'
import { writeFileAtomic } from '../utils/atomic-write'
import { iconMime, iconSources, pickIconFromHtml, validIconDataUrl } from './incy-sub-icon-logic'

interface IconEntry {
  /** data:URL картинки; null — искали, не нашли (звёздочка). */
  icon: string | null
  custom?: boolean
  from?: string
  at: number
}
type IconStore = Record<string, IconEntry>

const RECHECK_MS = 7 * 24 * 60 * 60 * 1000
const file = (): string => path.join(dataDir(), 'incy-sub-icons.json')

function load(): IconStore {
  try {
    if (!existsSync(file())) return {}
    const j = JSON.parse(readFileSync(file(), 'utf-8')) as IconStore
    return j && typeof j === 'object' ? j : {}
  } catch {
    return {}
  }
}
function save(s: IconStore): void {
  writeFileAtomic(file(), JSON.stringify(s))
}
function broadcast(): void {
  for (const w of BrowserWindow.getAllWindows()) if (!w.isDestroyed()) w.webContents.send('incy:subIconsChanged')
}

async function getLimited(url: string, maxBytes: number, accept: string): Promise<{ type: string | null; bytes: Uint8Array } | null> {
  try {
    const res = await net.fetch(url, {
      headers: { Accept: accept, 'User-Agent': 'Mozilla/5.0 (LAZEYKA)' },
      signal: AbortSignal.timeout(7000)
    })
    if (!res.ok || !res.body) return null
    const reader = res.body.getReader()
    const parts: Uint8Array[] = []
    let total = 0
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      total += value.length
      if (total > maxBytes) {
        void reader.cancel().catch(() => void 0)
        // Страницу читаем только начало — значки объявлены в <head>.
        if (accept.startsWith('text/html')) break
        return null
      }
      parts.push(value)
    }
    const bytes = new Uint8Array(Math.min(total, maxBytes))
    let off = 0
    for (const p of parts) {
      const take = Math.min(p.length, bytes.length - off)
      bytes.set(p.subarray(0, take), off)
      off += take
      if (off >= bytes.length) break
    }
    return { type: res.headers.get('content-type'), bytes }
  } catch {
    return null
  }
}

async function findIcon(sub: { webPageUrl?: string; supportUrl?: string }): Promise<{ icon: string; from: string } | null> {
  for (const src of iconSources(sub)) {
    const page = await getLimited(src.url, 300_000, 'text/html,application/xhtml+xml')
    const candidates = page ? pickIconFromHtml(new TextDecoder().decode(page.bytes), src.url, src.kind) : src.kind === 'site' ? [new URL('/favicon.ico', src.url).href] : []
    for (const c of candidates.slice(0, 4)) {
      const img = await getLimited(c, 300_000, 'image/*')
      if (!img) continue
      const mime = iconMime(img.type, img.bytes)
      if (!mime) continue
      return { icon: `data:${mime};base64,${Buffer.from(img.bytes).toString('base64')}`, from: src.url }
    }
  }
  return null
}

const inFlight = new Set<string>()

/** Вызывается при сохранении подписки: найти значок, если его нет или он старше недели. */
export function ensureProviderIcon(sub: { id: string; webPageUrl?: string; supportUrl?: string }, force = false): Promise<void> {
  const cur = load()[sub.id]
  if (cur?.custom) return Promise.resolve()
  if (!force && cur && Date.now() - cur.at < RECHECK_MS) return Promise.resolve()
  if (inFlight.has(sub.id)) return Promise.resolve()
  if (iconSources(sub).length === 0) {
    if (!cur) {
      const s = load()
      s[sub.id] = { icon: null, at: Date.now() }
      save(s)
    }
    return Promise.resolve()
  }
  inFlight.add(sub.id)
  return findIcon(sub)
    .then((found) => {
      const s = load()
      if (s[sub.id]?.custom) return
      // Не нашли — старую картинку не стираем: сайт мог просто не ответить.
      s[sub.id] = found ? { icon: found.icon, from: found.from, at: Date.now() } : { icon: s[sub.id]?.icon ?? null, from: s[sub.id]?.from, at: Date.now() }
      save(s)
      broadcast()
    })
    .catch(() => void 0)
    .finally(() => inFlight.delete(sub.id))
}

export function removeProviderIcon(id: string): void {
  const s = load()
  if (!(id in s)) return
  delete s[id]
  save(s)
}

export function registerSubIconIpc(getSub: (id: string) => { id: string; webPageUrl?: string; supportUrl?: string } | undefined): void {
  const ok = <T>(value: T): { ok: true; value: T } => ({ ok: true, value })
  const fail = (e: unknown): { ok: false; message: string } => ({ ok: false, message: e instanceof Error ? e.message : String(e) })
  ipcMain.handle('incy:subIcons', () => {
    const out: Record<string, { icon: string | null; custom: boolean; from?: string }> = {}
    for (const [id, e] of Object.entries(load())) out[id] = { icon: e.icon, custom: Boolean(e.custom), from: e.from }
    return ok(out)
  })
  ipcMain.handle('incy:subIconSet', (_e, id: unknown, dataUrl: unknown) => {
    try {
      const key = String(id ?? '')
      if (!key) throw new Error('Подписка не найдена')
      const s = load()
      if (dataUrl === null) {
        // «Взять с сайта провайдера»: снимаем свой значок и ищем заново.
        delete s[key]
        save(s)
        const sub = getSub(key)
        if (sub) void ensureProviderIcon(sub, true)
        broadcast()
        return ok(true)
      }
      if (dataUrl === 'star') {
        s[key] = { icon: null, custom: true, at: Date.now() }
      } else {
        const v = validIconDataUrl(dataUrl)
        if (!v) throw new Error('Нужна картинка PNG, JPG, GIF, WEBP, ICO или SVG размером до 512 КБ')
        s[key] = { icon: v, custom: true, at: Date.now() }
      }
      save(s)
      broadcast()
      return ok(true)
    } catch (e) {
      return fail(e)
    }
  })
}
