/**
 * Проверка Telegram по его собственному протоколу (MTProto), без Electron и без сети:
 * сборка первого запроса и разбор ответа. Сеть — в service-status.ts.
 *
 * Первый шаг любого клиента Telegram — незашифрованный запрос req_pq_multi со
 * случайным nonce. Сервер Telegram отвечает resPQ с тем же nonce. Если ответ
 * пришёл, значит, до серверов Telegram действительно доходят данные, а не только
 * открывается TCP-соединение (провайдер может пропускать соединение и резать
 * трафик внутри него).
 *
 * Два способа упаковки:
 *  - напрямую на адрес дата-центра — «abridged» (первый байт 0xef);
 *  - через локальный MTProto-прокси LAZEYKA (секрет dd…) — «обфускация» с
 *    ключами, смешанными с секретом прокси, и «padded intermediate».
 * Описание: https://core.telegram.org/mtproto/mtproto-transports и
 * https://core.telegram.org/mtproto/mtproto-transports#transport-obfuscation
 */
import { createCipheriv, createDecipheriv, createHash, randomBytes, type Cipheriv, type Decipheriv } from 'node:crypto'

/** req_pq_multi#be7e8ef1 nonce:int128 = ResPQ */
const REQ_PQ_MULTI = 0xbe7e8ef1
/** resPQ#05162463 */
const RES_PQ = 0x05162463

/** Дата-центры Telegram (официальные адреса из документации и клиентов). Любой ответивший — Telegram доступен. */
export const TELEGRAM_DC_TARGETS: { dc: number; ip: string; port: number }[] = [
  { dc: 2, ip: '149.154.167.51', port: 443 },
  { dc: 4, ip: '149.154.167.91', port: 443 },
  { dc: 1, ip: '149.154.175.53', port: 443 },
  { dc: 5, ip: '91.108.56.130', port: 443 }
]

/** Незашифрованное сообщение req_pq_multi: auth_key_id=0, message_id, длина, тело. 40 байт. */
export function buildReqPqMulti(nonce: Buffer, nowMs: number = Date.now()): Buffer {
  if (nonce.length !== 16) throw new Error('nonce должен быть 16 байт')
  const msg = Buffer.alloc(40)
  // auth_key_id = 0 (8 байт нулей)
  // message_id ≈ unixtime · 2^32, делится на 4.
  const low = (Math.floor((nowMs % 1000) * 4294967.296) >>> 0) & ~3
  msg.writeUInt32LE(low >>> 0, 8)
  msg.writeUInt32LE(Math.floor(nowMs / 1000) >>> 0, 12)
  msg.writeInt32LE(20, 16)
  msg.writeUInt32LE(REQ_PQ_MULTI, 20)
  nonce.copy(msg, 24)
  return msg
}

export type ResPqVerdict =
  | { ok: true }
  | { ok: false; reason: 'transport-error'; code: number }
  | { ok: false; reason: 'bad' }
  | { ok: false; reason: 'short' }

/**
 * Разбор полезной нагрузки ответа (без транспортной обёртки).
 * 4 байта — код ошибки транспорта (отрицательное число, например −404).
 */
export function parseResPq(payload: Buffer, nonce: Buffer): ResPqVerdict {
  if (payload.length === 4) return { ok: false, reason: 'transport-error', code: payload.readInt32LE(0) }
  if (payload.length < 40) return { ok: false, reason: 'short' }
  const authKeyLo = payload.readUInt32LE(0)
  const authKeyHi = payload.readUInt32LE(4)
  if (authKeyLo !== 0 || authKeyHi !== 0) return { ok: false, reason: 'bad' }
  const ctor = payload.readUInt32LE(20)
  if (ctor !== RES_PQ) return { ok: false, reason: 'bad' }
  return payload.subarray(24, 40).equals(nonce) ? { ok: true } : { ok: false, reason: 'bad' }
}

// ---- abridged (напрямую) -------------------------------------------------------------

/** Первый пакет abridged-транспорта: байт 0xef, длина в 4-байтовых словах, сообщение. */
export function abridgedFirstPacket(msg: Buffer): Buffer {
  const words = msg.length / 4
  if (!Number.isInteger(words) || words >= 0x7f) throw new Error('неподходящая длина сообщения')
  return Buffer.concat([Buffer.from([0xef, words]), msg])
}

/** Достаёт полезную нагрузку первого пакета abridged из накопленных байтов; null — пришло не всё. */
export function abridgedTakePacket(buf: Buffer): Buffer | null {
  if (buf.length < 1) return null
  let words = buf[0]
  let head = 1
  if (words === 0x7f) {
    if (buf.length < 4) return null
    words = buf.readUIntLE(1, 3)
    head = 4
  }
  const len = words * 4
  if (buf.length < head + len) return null
  return buf.subarray(head, head + len)
}

// ---- intermediate (через прокси) -----------------------------------------------------

/** Пакет padded intermediate: длина (int32 LE, с учётом добавки), сообщение, 0–15 случайных байт. */
export function paddedPacket(msg: Buffer, pad: Buffer = randomBytes(randomBytes(1)[0] % 16)): Buffer {
  const len = Buffer.alloc(4)
  len.writeInt32LE(msg.length + pad.length, 0)
  return Buffer.concat([len, msg, pad])
}

/** Первый пакет intermediate из накопленных (уже расшифрованных) байтов; null — пришло не всё. */
export function intermediateTakePacket(buf: Buffer): Buffer | null {
  if (buf.length < 4) return null
  const len = buf.readInt32LE(0)
  if (len < 0 || len > 1 << 20) return Buffer.alloc(0)
  if (buf.length < 4 + len) return null
  return buf.subarray(4, 4 + len)
}

// ---- обфускация (MTProto-прокси) -------------------------------------------------------

export const TAG_PADDED = 0xdddddddd

export interface Obfuscated {
  /** 64 байта, которые клиент отправляет первыми. */
  header: Buffer
  /** Шифр для всего, что клиент отправляет дальше (продолжение того же потока). */
  encrypt: Cipheriv
  /** Расшифровка ответа сервера. */
  decrypt: Decipheriv
}

const FORBIDDEN_STARTS = [0x44414548 /* HEAD */, 0x54534f50 /* POST */, 0x20544547 /* GET  */, 0x4954504f /* OPTI */, 0xdddddddd, 0xeeeeeeee, 0x02010316]

/** Случайные 64 байта, которые сервер не спутает с HTTP, TLS или другим транспортом. */
export function randomInit(rnd: (n: number) => Buffer = randomBytes): Buffer {
  for (;;) {
    const b = rnd(64)
    if (b[0] === 0xef) continue
    const first = b.readUInt32LE(0)
    if (FORBIDDEN_STARTS.includes(first)) continue
    if (b.readUInt32LE(4) === 0) continue
    return b
  }
}

/** Ключ шифра: с секретом прокси — SHA-256(ключ ‖ секрет). */
function mixKey(key: Buffer, secret: Buffer | null): Buffer {
  return secret ? createHash('sha256').update(Buffer.concat([key, secret])).digest() : Buffer.from(key)
}

/**
 * Начало обфусцированного соединения.
 * secret — 16 байт секрета прокси (без префикса dd/ee); dc — номер дата-центра (для прокси).
 */
export function obfuscatedInit(secret: Buffer | null, dc: number, tag: number = TAG_PADDED, init: Buffer = randomInit()): Obfuscated {
  const b = Buffer.from(init)
  b.writeUInt32LE(tag >>> 0, 56)
  b.writeInt16LE(dc, 60)
  const encKey = mixKey(b.subarray(8, 40), secret)
  const encIv = Buffer.from(b.subarray(40, 56))
  const rev = Buffer.from(b.subarray(8, 56)).reverse()
  const decKey = mixKey(rev.subarray(0, 32), secret)
  const decIv = Buffer.from(rev.subarray(32, 48))
  const encrypt = createCipheriv('aes-256-ctr', encKey, encIv)
  const decrypt = createDecipheriv('aes-256-ctr', decKey, decIv)
  const enc = encrypt.update(b)
  const header = Buffer.concat([b.subarray(0, 56), enc.subarray(56, 64)])
  return { header, encrypt, decrypt }
}

/**
 * Серверная сторона (для проверки в тестах): по 64 байтам клиента восстанавливает
 * тег, номер DC и шифры. null — тег не совпал (не тот секрет).
 */
export function obfuscatedAccept(header: Buffer, secret: Buffer | null): { tag: number; dc: number; decrypt: Decipheriv; encrypt: Cipheriv } | null {
  const b = Buffer.from(header)
  const dKey = mixKey(b.subarray(8, 40), secret)
  const dIv = Buffer.from(b.subarray(40, 56))
  const rev = Buffer.from(b.subarray(8, 56)).reverse()
  const eKey = mixKey(rev.subarray(0, 32), secret)
  const eIv = Buffer.from(rev.subarray(32, 48))
  const decrypt = createDecipheriv('aes-256-ctr', dKey, dIv)
  const plain = decrypt.update(b)
  const tag = plain.readUInt32LE(56)
  if (tag !== 0xdddddddd && tag !== 0xeeeeeeee && tag !== 0xefefefef) return null
  return { tag, dc: plain.readInt16LE(60), decrypt, encrypt: createCipheriv('aes-256-ctr', eKey, eIv) }
}

/** Секрет прокси из настроек: 32 hex; с префиксом dd/ee (и доменом после ee) — тоже понимаем. */
export function proxySecretBytes(raw: string | undefined): { secret: Buffer; fakeTls: boolean } | null {
  const s = String(raw ?? '').trim().toLowerCase()
  if (/^[0-9a-f]{32}$/.test(s)) return { secret: Buffer.from(s, 'hex'), fakeTls: false }
  if (/^dd[0-9a-f]{32}$/.test(s)) return { secret: Buffer.from(s.slice(2), 'hex'), fakeTls: false }
  if (/^ee[0-9a-f]{32}/.test(s)) return { secret: Buffer.from(s.slice(2, 34), 'hex'), fakeTls: true }
  return null
}

/** Понятный текст для неудачного ответа MTProto. */
export function describeResPq(v: ResPqVerdict): string {
  if (v.ok) return 'сервер Telegram ответил'
  if (v.reason === 'transport-error') return `сервер вернул ошибку транспорта (${v.code})`
  if (v.reason === 'short') return 'ответ оборвался'
  return 'пришёл не ответ Telegram (похоже на подмену или блокировку)'
}
