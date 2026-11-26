/**
 * Чистая часть связи с Discord: сборка команды SET_ACTIVITY и разбор ответов.
 * Без Electron и без сети, чтобы проверять отдельным скриптом.
 *
 * Что требует Discord (локальный IPC):
 *  - рукопожатие {v:1, client_id}, в ответ DISPATCH/READY;
 *  - SET_ACTIVITY с args.pid и activity; поля без значения и пустые строки Discord отвергает
 *    целиком (ответ evt:"ERROR"), поэтому пустого не отправляем вообще;
 *  - details и state — строки от 2 до 128 символов;
 *  - timestamps.start — целое число секунд (миллисекунды тоже принимаются), не в будущем;
 *  - ответ приходит с тем же nonce: evt:null — принято, evt:"ERROR" — отклонено, в data.message причина.
 * Принято не значит «видно»: при статусе «Невидимый» или выключенном показе активности Discord
 * отвечает успехом, но друзьям ничего не показывает. Это снаружи не определить.
 */
import { OP, encodeFrame } from './streamer-logic'

export interface ActivityInput {
  details: string
  state?: string
  /** Начало в секундах (или миллисекундах) эпохи. */
  startTimestamp: number
}

export const DISCORD_LARGE_IMAGE = 'logo'

/** Строка для Discord: без управляющих символов и лишних пробелов, 2–128 символов; иначе undefined. */
export function cleanText(v: unknown): string | undefined {
  if (typeof v !== 'string') return undefined
  // eslint-disable-next-line no-control-regex
  const t = v.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim()
  if (t.length < 2) return undefined
  // Режем по символам Юникода, чтобы не разорвать суррогатную пару.
  const chars = Array.from(t)
  return (chars.length > 128 ? chars.slice(0, 128).join('') : t).trim()
}

/** Начало отсчёта: целые секунды, не в будущем. Миллисекунды (>1e11) приводятся к секундам. */
export function cleanStart(v: unknown, nowMs: number = Date.now()): number | undefined {
  if (typeof v !== 'number' || !Number.isFinite(v) || v <= 0) return undefined
  const sec = v > 1e11 ? Math.floor(v / 1000) : Math.floor(v)
  const now = Math.floor(nowMs / 1000)
  return sec > now ? now : sec
}

export interface BuiltActivity {
  details: string
  state?: string
  timestamps?: { start: number }
  assets: { large_image: string; large_text: string }
}

/** Объект activity без пустых строк и null. undefined — details негодный, отправлять нечего. */
export function buildActivity(a: ActivityInput, nowMs: number = Date.now()): BuiltActivity | undefined {
  const details = cleanText(a.details)
  if (!details) return undefined
  const out: BuiltActivity = { details, assets: { large_image: DISCORD_LARGE_IMAGE, large_text: 'LAZEYKA' } }
  const state = cleanText(a.state)
  if (state) out.state = state
  const start = cleanStart(a.startTimestamp, nowMs)
  if (start !== undefined) out.timestamps = { start }
  return out
}

/** Команда SET_ACTIVITY. activity null — очистка. */
export function buildSetActivityFrame(pid: number, nonce: string, activity: ActivityInput | null, nowMs: number = Date.now()): Buffer {
  const built = activity ? buildActivity(activity, nowMs) : undefined
  if (activity && !built) throw new Error('Пустое описание активности')
  const args: Record<string, unknown> = { pid }
  if (built) args.activity = built
  return encodeFrame(OP.FRAME, { cmd: 'SET_ACTIVITY', args, nonce })
}

export type ParsedFrame =
  | { kind: 'ready'; user: string | null }
  | { kind: 'result'; nonce: string; ok: true }
  | { kind: 'result'; nonce: string; ok: false; error: string }
  | { kind: 'close'; error: string }
  | { kind: 'ping'; data: unknown }
  | { kind: 'other' }

const ERROR_TEXT: Record<number, string> = {
  1000: 'неизвестная ошибка Discord',
  4000: 'Discord отклонил данные активности',
  4001: 'Discord отклонил команду',
  4002: 'Discord не принял команду',
  4003: 'Discord не принял приложение: проверьте идентификатор приложения'
}

/** Сообщение об ошибке из data кадра ERROR / CLOSE на русском, с исходным текстом Discord в скобках. */
export function describeError(data: unknown): string {
  const d = (data ?? {}) as { code?: unknown; message?: unknown }
  const code = typeof d.code === 'number' ? d.code : undefined
  const msg = typeof d.message === 'string' ? d.message.trim() : ''
  const base = code !== undefined && ERROR_TEXT[code] ? ERROR_TEXT[code] : 'Discord вернул ошибку'
  const tail = [code !== undefined ? `код ${code}` : '', msg].filter(Boolean).join(': ')
  return tail ? `${base} (${tail})` : base
}

/** Разбор кадра, пришедшего от Discord. */
export function parseFrame(op: number, data: unknown): ParsedFrame {
  if (op === OP.PING) return { kind: 'ping', data }
  if (op === OP.CLOSE) return { kind: 'close', error: describeError(data) }
  if (op !== OP.FRAME) return { kind: 'other' }
  const d = (data ?? {}) as { cmd?: unknown; evt?: unknown; nonce?: unknown; data?: unknown }
  if (d.cmd === 'DISPATCH' && d.evt === 'READY') {
    const u = (d.data as { user?: { username?: unknown; global_name?: unknown } } | undefined)?.user
    const name = typeof u?.global_name === 'string' && u.global_name ? u.global_name : typeof u?.username === 'string' ? u.username : null
    return { kind: 'ready', user: name }
  }
  if (d.cmd === 'DISPATCH' && d.evt === 'ERROR') return { kind: 'close', error: describeError(d.data) }
  if (d.cmd === 'SET_ACTIVITY' && typeof d.nonce === 'string') {
    if (d.evt === 'ERROR') return { kind: 'result', nonce: d.nonce, ok: false, error: describeError(d.data) }
    return { kind: 'result', nonce: d.nonce, ok: true }
  }
  return { kind: 'other' }
}
