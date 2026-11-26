/**
 * Лайки и избранное галереи тем (В15).
 *
 * - Избранное — только на этом компьютере, без сети.
 * - Свои лайки тоже запоминаются здесь (сервер не говорит, что лайкнула эта установка, — только
 *   общее число). Лайк уходит на Hub одним запросом POST /themes/like и только по нажатию;
 *   фоновых опросов нет, счётчики приходят вместе с обычной загрузкой галереи.
 *
 * Файл: <данные>/hub/gallery-social.json { liked: string[], fav: string[] }.
 */
import { ipcMain, net } from 'electron'
import { readFileSync } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import path from 'node:path'
import { dataDir } from '../utils/dirs'
import { writeFileAtomic } from '../utils/atomic-write'
import { HUB_URL, parseLikeAnswer } from './hub-pure'
import { galleryPatchLikes, galleryWallpaper } from './theme-gallery'

const ID_RE = /^[A-Za-z0-9_-]{1,64}$/
const MAX_IDS = 1000
const LIKE_TIMEOUT_MS = 12_000

export interface GallerySocial {
  liked: string[]
  fav: string[]
}

export type LikeResult =
  | { ok: true; id: string; likes: number; liked: boolean }
  | { ok: false; error: 'network' | 'too_often' | 'blocked' | 'not_found' | 'unsupported' | 'server'; message: string }

const file = (): string => path.join(dataDir(), 'hub', 'gallery-social.json')

let state: GallerySocial | null = null

const cleanIds = (v: unknown): string[] => (Array.isArray(v) ? [...new Set(v.filter((x): x is string => typeof x === 'string' && ID_RE.test(x)))].slice(-MAX_IDS) : [])

function load(): GallerySocial {
  if (state) return state
  try {
    const raw = JSON.parse(readFileSync(file(), 'utf-8')) as Record<string, unknown>
    state = { liked: cleanIds(raw.liked), fav: cleanIds(raw.fav) }
  } catch {
    state = { liked: [], fav: [] }
  }
  return state
}

async function save(): Promise<void> {
  const s = load()
  try {
    await mkdir(path.dirname(file()), { recursive: true })
    writeFileAtomic(file(), JSON.stringify(s))
  } catch {
    /* не сохранилось — останется в памяти до перезапуска */
  }
}

const toggle = (list: string[], id: string, on: boolean): string[] => {
  const rest = list.filter((x) => x !== id)
  return on ? [...rest, id].slice(-MAX_IDS) : rest
}

const ERR_TEXT: Record<Exclude<LikeResult, { ok: true }>['error'], string> = {
  network: 'Нет связи с сервером галереи. Попробуйте позже.',
  too_often: 'Слишком часто. Подождите минуту.',
  blocked: 'Отправка с этой установки отключена автором.',
  not_found: 'Этой темы уже нет в галерее. Обновите список.',
  unsupported: 'Сервер галереи пока не принимает лайки.',
  server: 'Сервер не принял лайк. Попробуйте позже.'
}
const fail = (error: Exclude<LikeResult, { ok: true }>['error']): LikeResult => ({ ok: false, error, message: ERR_TEXT[error] })

const inFlight = new Map<string, Promise<LikeResult>>()

async function sendLike(installId: string, id: string, on: boolean): Promise<LikeResult> {
  const signal = AbortSignal.timeout(LIKE_TIMEOUT_MS)
  const init = {
    method: 'POST',
    body: JSON.stringify({ install: installId, id, on }),
    headers: { 'Content-Type': 'application/json', 'User-Agent': 'LAZEYKA' },
    signal
  }
  let res: Response
  try {
    try {
      res = await net.fetch(`${HUB_URL}/themes/like`, init)
    } catch (e) {
      if (signal.aborted) throw e
      res = await fetch(`${HUB_URL}/themes/like`, init)
    }
  } catch {
    return fail('network')
  }
  const data = (await res.json().catch(() => null)) as Record<string, unknown> | null
  const ans = parseLikeAnswer(data, id)
  if (ans) return { ok: true, id, ...ans }
  const err = typeof data?.error === 'string' ? data.error : ''
  if (res.status === 429 || err === 'too_often') return fail('too_often')
  if (res.status === 403 || err === 'blocked') return fail('blocked')
  if (err === 'not_found' && res.status === 404) return fail('not_found')
  // Старый Hub не знает адреса: общий 404 без error 'not_found' у темы.
  if (res.status === 404) return fail('unsupported')
  return fail('server')
}

/** Лайк по нажатию: свой выбор запоминается только после ответа сервера (по полю liked). */
async function like(installId: string, idRaw: unknown, onRaw: unknown): Promise<LikeResult> {
  const id = String(idRaw ?? '')
  if (!ID_RE.test(id)) return fail('not_found')
  const on = onRaw === true
  const key = `${id}:${on}`
  const running = inFlight.get(key)
  if (running) return running
  const p = (async () => {
    const r = await sendLike(installId, id, on)
    const s = load()
    if (r.ok) {
      s.liked = toggle(s.liked, id, r.liked)
      galleryPatchLikes(id, r.likes)
      await save()
    } else if (r.error === 'not_found' && s.liked.includes(id)) {
      s.liked = toggle(s.liked, id, false)
      await save()
    }
    return r
  })().finally(() => inFlight.delete(key))
  inFlight.set(key, p)
  return p
}

function h<T>(fn: (...args: unknown[]) => Promise<T> | T) {
  return async (_event: Electron.IpcMainInvokeEvent, ...args: unknown[]) => {
    try {
      return { ok: true, value: await fn(...args) }
    } catch (e: unknown) {
      return { ok: false, message: e instanceof Error ? e.message : String(e) }
    }
  }
}

function handle<T>(channel: string, fn: (...args: unknown[]) => Promise<T> | T): void {
  ipcMain.removeHandler(channel)
  ipcMain.handle(channel, h(fn))
}

/**
 * IPC: gallery:social (свои лайки и избранное), gallery:like (id, on), gallery:fav (id, on), gallery:wallpaper (id) — обои для просмотра.
 * installId — функция из hub-client (тот же ID установки, что у отчётов и /inbox).
 */
export function registerGallerySocialIpc(installId: () => string): void {
  handle('gallery:social', () => load())
  handle('gallery:like', (id, on) => like(installId(), id, on))
  handle('gallery:wallpaper', (id) => galleryWallpaper(String(id ?? '')))
  handle('gallery:fav', async (idRaw, on) => {
    const id = String(idRaw ?? '')
    if (!ID_RE.test(id)) throw new Error('Неверная тема')
    const s = load()
    s.fav = toggle(s.fav, id, on === true)
    await save()
    return s
  })
}
