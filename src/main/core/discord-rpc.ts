/**
 * Минимальный клиент Discord IPC без библиотек.
 * Windows: именованный канал \\?\pipe\discord-ipc-N. macOS: сокет discord-ipc-N в каталоге
 * $XDG_RUNTIME_DIR, $TMPDIR или /tmp. N от 0 до 9 (первый, который ответил READY).
 * Кадр: 4 байта opcode, 4 байта длины (оба little-endian), затем JSON.
 *
 * Связь «есть» только после READY, а отправка активности считается успешной только когда Discord
 * ответил на команду с тем же nonce без ошибки. Текст ошибки возвращается вызывающему.
 */
import net from 'node:net'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { OP, FrameParser, encodeFrame } from './streamer-logic'
import { buildSetActivityFrame, parseFrame, type ActivityInput } from './discord-activity'

export const DISCORD_CLIENT_ID = '1570103555849855036'

export type DiscordLink = 'off' | 'waiting' | 'connected'

export interface RpcOutcome {
  ok: boolean
  error?: string
}

/** Сколько ждём ответа Discord на отправку активности. */
const REPLY_TIMEOUT_MS = 6000

export function discordIpcPath(n: number, platform: NodeJS.Platform = process.platform, env: NodeJS.ProcessEnv = process.env): string {
  if (platform === 'win32') return `\\\\?\\pipe\\discord-ipc-${n}`
  const base = env.XDG_RUNTIME_DIR || env.TMPDIR || env.TMP || env.TEMP || '/tmp'
  return path.join(base, `discord-ipc-${n}`)
}

function tryConnect(p: string): Promise<net.Socket | null> {
  return new Promise((resolve) => {
    const s = net.createConnection({ path: p })
    const timer = setTimeout(() => {
      s.destroy()
      resolve(null)
    }, 1500)
    s.once('connect', () => {
      clearTimeout(timer)
      s.removeAllListeners('error')
      resolve(s)
    })
    s.once('error', () => {
      clearTimeout(timer)
      s.destroy()
      resolve(null)
    })
  })
}

interface Pending {
  resolve: (r: RpcOutcome) => void
  timer: NodeJS.Timeout
}

export class DiscordRpc {
  private socket: net.Socket | null = null
  private ready = false
  private connecting = false
  private pending = new Map<string, Pending>()

  /** Имя пользователя Discord из ответа READY (только для показа в карточке). */
  user: string | null = null
  /** Почему не получилось подключиться или что ответил Discord в последний раз. */
  lastError: string | null = null
  /** Связь появилась или пропала. */
  onLinkChange: (() => void) | null = null

  constructor(
    private readonly clientId: string = DISCORD_CLIENT_ID,
    private readonly paths: (n: number) => string = discordIpcPath
  ) {}

  get link(): DiscordLink {
    return this.socket && this.ready ? 'connected' : 'off'
  }

  /** Подключиться и пройти рукопожатие. true — Discord ответил READY. Ошибок наружу нет, причина в lastError. */
  async connect(): Promise<boolean> {
    if (this.link === 'connected') return true
    if (this.connecting) return false
    this.connecting = true
    let opened = 0
    let reason: string | null = null
    try {
      for (let n = 0; n < 10; n++) {
        const s = await tryConnect(this.paths(n))
        if (!s) continue
        opened++
        const r = await this.handshake(s)
        if (r === true) {
          this.lastError = null
          this.onLinkChange?.()
          return true
        }
        reason = r
      }
      this.lastError =
        opened === 0
          ? 'Discord не запущен или канал связи недоступен'
          : (reason ?? 'Discord не ответил на рукопожатие. Перезапустите Discord')
      return false
    } finally {
      this.connecting = false
    }
  }

  /** true — получили READY; строка — причина отказа. */
  private handshake(s: net.Socket): Promise<true | string> {
    return new Promise((resolve) => {
      const parser = new FrameParser()
      let settled = false
      const finish = (res: true | string): void => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        if (res === true) {
          this.socket = s
          this.ready = true
        } else {
          s.destroy()
        }
        resolve(res)
      }
      const timer = setTimeout(() => finish('Discord не ответил на рукопожатие'), 4000)
      s.on('data', (chunk) => {
        let frames
        try {
          frames = parser.push(chunk)
        } catch {
          if (!settled) finish('Discord прислал непонятный ответ')
          else this.drop(s)
          return
        }
        for (const f of frames) {
          const p = parseFrame(f.op, f.data)
          if (p.kind === 'ping') s.write(encodeFrame(OP.PONG, p.data))
          else if (p.kind === 'close') {
            if (!settled) finish(p.error)
            else {
              this.lastError = p.error
              this.drop(s)
            }
          } else if (p.kind === 'ready') {
            this.user = p.user
            finish(true)
          } else if (p.kind === 'result') this.settle(p.nonce, p.ok ? { ok: true } : { ok: false, error: p.error })
        }
      })
      const lost = (): void => {
        if (!settled) finish('Discord закрыл соединение при рукопожатии')
        this.drop(s)
      }
      s.on('close', lost)
      s.on('error', lost)
      try {
        s.write(encodeFrame(OP.HANDSHAKE, { v: 1, client_id: this.clientId }))
      } catch {
        lost()
      }
    })
  }

  private settle(nonce: string, outcome: RpcOutcome): void {
    const p = this.pending.get(nonce)
    if (!p) return
    this.pending.delete(nonce)
    clearTimeout(p.timer)
    p.resolve(outcome)
  }

  private drop(s: net.Socket): void {
    const wasOurs = this.socket === s
    if (wasOurs) {
      this.socket = null
      this.ready = false
      for (const nonce of [...this.pending.keys()]) this.settle(nonce, { ok: false, error: 'Связь с Discord прервалась' })
    }
    s.destroy()
    if (wasOurs) this.onLinkChange?.()
  }

  /**
   * Отправить активность (null — очистить) и дождаться ответа Discord.
   * ok:true — Discord принял; ok:false — нет канала или Discord вернул ошибку (текст в error).
   */
  setActivity(activity: ActivityInput | null): Promise<RpcOutcome> {
    const s = this.socket
    if (!s || !this.ready) return Promise.resolve({ ok: false, error: 'Нет связи с Discord' })
    const nonce = randomUUID()
    let frame: Buffer
    try {
      frame = buildSetActivityFrame(process.pid, nonce, activity)
    } catch (e) {
      return Promise.resolve({ ok: false, error: e instanceof Error ? e.message : String(e) })
    }
    return new Promise<RpcOutcome>((resolve) => {
      const timer = setTimeout(() => this.settle(nonce, { ok: false, error: 'Discord не ответил на отправку статуса' }), REPLY_TIMEOUT_MS)
      this.pending.set(nonce, { resolve, timer })
      try {
        s.write(frame)
      } catch {
        this.settle(nonce, { ok: false, error: 'Не удалось записать в канал Discord' })
      }
    })
  }

  /** Очистить активность и закрыть канал. */
  close(): void {
    const s = this.socket
    for (const nonce of [...this.pending.keys()]) this.settle(nonce, { ok: false, error: 'Связь закрыта' })
    if (!s) return
    this.socket = null
    this.ready = false
    this.user = null
    try {
      s.write(buildSetActivityFrame(process.pid, randomUUID(), null))
      s.end()
    } catch {
      /* канал уже закрыт */
    }
    setTimeout(() => s.destroy(), 300).unref()
  }
}
