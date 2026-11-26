/**
 * Статус в Discord без постоянного опроса — так, как это делают игры с Discord SDK.
 * Без Electron: связь с Discord, часы и таймеры передаются снаружи (проверяется отдельным скриптом).
 *
 * Правила:
 *  - пока связь есть, таймеров нет. Активность отправляется только когда меняется
 *    то, что показываем (вызов statusChanged() от событий программы);
 *  - Discord принимает не больше одного обновления в 15 секунд: частые изменения
 *    копятся, через 15 секунд после прошлой отправки уходит последнее состояние;
 *  - пинг обновляется не чаще раза в 60 секунд и только при заметной разнице
 *    (10 мс и больше или другой порядок числа), иначе это поток мелких обновлений;
 *  - разрыв связи узнаём по событию сокета (linkChanged), а не опросом;
 *  - пока Discord не запущен: попытка при изменении состояния, повтор раз в 2 минуты
 *    (активность появится, если Discord открыли позже) и сразу — по кнопке retryNow();
 *  - отказ Discord не повторяется сам по себе: следующая попытка — когда изменится
 *    состояние или по кнопке.
 */
import type { ActivityInput } from './discord-activity'

export const SEND_GAP_MS = 15_000
export const PING_GAP_MS = 60_000
export const RECONNECT_MS = 2 * 60_000
export const PING_DELTA_MS = 10

export interface PresenceRpc {
  readonly link: 'off' | 'waiting' | 'connected'
  connect(): Promise<boolean>
  setActivity(a: ActivityInput | null): Promise<{ ok: boolean; error?: string }>
  close(): void
}

/** Что сейчас хотим показать. ping — null, если пинг не показываем или его нет. */
export interface DesiredActivity {
  details: string
  /** Вторая строка без пинга (например, «Обход блокировок»). */
  extra?: string
  ping: number | null
  startTimestamp: number
}

export interface PresenceDeps {
  rpc: PresenceRpc
  desired(): DesiredActivity
  now(): number
  setTimer(fn: () => void, ms: number): unknown
  clearTimer(h: unknown): void
  /** Состояние для окна изменилось. */
  changed(): void
  log?(msg: string): void
}

export type ActivityState = 'none' | 'sending' | 'confirmed' | 'error'

const digits = (n: number): number => String(Math.max(0, Math.round(Math.abs(n)))).length

/** Пинг изменился настолько, что стоит обновить строку в Discord. */
export function pingChangedEnough(prev: number | null, next: number | null): boolean {
  if (prev === next) return false
  if (prev === null || next === null) return true
  return Math.abs(prev - next) >= PING_DELTA_MS || digits(prev) !== digits(next)
}

/** Строки активности: при пинге вторая строка — «пинг N мс», иначе extra. */
export function activityText(d: DesiredActivity, ping: number | null): { details: string; state?: string } {
  const state = ping !== null ? `пинг ${ping} мс` : d.extra || undefined
  return state ? { details: d.details, state } : { details: d.details }
}

export class DiscordPresence {
  enabled = false
  activity: ActivityState = 'none'
  error: string | null = null
  confirmedAt: number | null = null

  /** Что Discord подтвердил на текущем соединении. */
  private sentKey: string | null = null
  /** Что Discord отклонил: само не повторяем. */
  private failedKey: string | null = null
  private shownPing: number | null = null
  private pingAt = 0
  private lastBase: string | null = null
  private lastSendAt = Number.NEGATIVE_INFINITY
  private sending = false
  private dirty = false
  private connecting = false
  private sendTimer: unknown = null
  private pingTimer: unknown = null
  private reconnectTimer: unknown = null

  private readonly d: PresenceDeps

  constructor(deps: PresenceDeps) {
    this.d = deps
  }

  /** Сколько таймеров сейчас взведено (для проверки «при связи — ни одного»). */
  get pendingTimers(): number {
    return [this.sendTimer, this.pingTimer, this.reconnectTimer].filter((t) => t !== null).length
  }

  /** Что видят друзья (или увидят после подключения). */
  preview(): { details: string; state?: string } {
    const want = this.d.desired()
    return activityText(want, this.lastBase === null ? want.ping : this.shownPing)
  }

  start(): void {
    if (this.enabled) return
    this.enabled = true
    this.resetSession()
    this.error = null
    this.confirmedAt = null
    void this.tryConnect()
  }

  stop(): void {
    this.enabled = false
    this.clearAll()
    this.d.rpc.close()
    this.resetSession()
    this.error = null
    this.confirmedAt = null
  }

  /** Что-то в программе изменилось (Zapret, VPN, прокси, пинг, настройки). */
  statusChanged(): void {
    if (!this.enabled) return
    if (this.linked()) this.evaluate()
    else void this.tryConnect()
  }

  /** Кнопка «Проверить снова»: подключиться сейчас и отправить заново. */
  async retryNow(): Promise<void> {
    if (!this.enabled) return
    this.failedKey = null
    if (!this.linked()) {
      await this.tryConnect()
      return
    }
    this.sentKey = null
    this.evaluate()
  }

  /** Событие сокета: связь появилась или пропала. */
  linkChanged(): void {
    if (!this.enabled) return
    this.sentKey = null
    if (this.linked()) {
      this.clear('reconnectTimer')
      this.evaluate()
    } else {
      this.activity = 'none'
      this.clear('sendTimer')
      this.clear('pingTimer')
      this.armReconnect()
    }
    this.d.changed()
  }

  // ---- внутреннее ---------------------------------------------------------------------

  private linked(): boolean {
    return this.d.rpc.link === 'connected'
  }

  private resetSession(): void {
    this.sentKey = null
    this.failedKey = null
    this.shownPing = null
    this.pingAt = 0
    this.lastBase = null
    this.activity = 'none'
    this.dirty = false
  }

  private clear(name: 'sendTimer' | 'pingTimer' | 'reconnectTimer'): void {
    if (this[name] !== null) this.d.clearTimer(this[name])
    this[name] = null
  }

  private clearAll(): void {
    this.clear('sendTimer')
    this.clear('pingTimer')
    this.clear('reconnectTimer')
  }

  private armReconnect(): void {
    if (!this.enabled || this.reconnectTimer !== null) return
    this.reconnectTimer = this.d.setTimer(() => {
      this.reconnectTimer = null
      void this.tryConnect()
    }, RECONNECT_MS)
  }

  private async tryConnect(): Promise<void> {
    if (!this.enabled || this.connecting || this.linked()) return
    this.connecting = true
    this.clear('reconnectTimer')
    let ok = false
    try {
      ok = await this.d.rpc.connect()
    } catch {
      ok = false
    } finally {
      this.connecting = false
    }
    if (!this.enabled) {
      if (ok) this.d.rpc.close()
      return
    }
    if (ok && this.linked()) this.evaluate()
    else this.armReconnect()
    this.d.changed()
  }

  /** Сравнить желаемое с подтверждённым и отправить, если можно; иначе отложить до конца 15 секунд. */
  private evaluate(): void {
    if (!this.enabled || !this.linked()) return
    const want = this.d.desired()
    const now = this.d.now()
    const base = `${want.details}|${want.extra ?? ''}`
    const fresh = want.ping
    if (base !== this.lastBase || this.shownPing === null || fresh === null) {
      // Сменилось главное (или пинг появился/пропал) — берём текущий пинг сразу.
      if (base !== this.lastBase || this.shownPing !== fresh) {
        this.shownPing = fresh
        this.pingAt = now
      }
      this.clear('pingTimer')
    } else if (pingChangedEnough(this.shownPing, fresh)) {
      const wait = this.pingAt + PING_GAP_MS - now
      if (wait <= 0) {
        this.shownPing = fresh
        this.pingAt = now
        this.clear('pingTimer')
      } else if (this.pingTimer === null) {
        this.pingTimer = this.d.setTimer(() => {
          this.pingTimer = null
          this.evaluate()
        }, wait)
      }
    } else {
      this.clear('pingTimer')
    }
    this.lastBase = base

    const text = activityText(want, this.shownPing)
    const key = `${text.details}|${text.state ?? ''}`
    if (key === this.sentKey) {
      this.clear('sendTimer')
      return
    }
    if (key === this.failedKey) return
    if (this.sending) {
      this.dirty = true
      return
    }
    const wait = this.lastSendAt + SEND_GAP_MS - now
    if (wait > 0) {
      if (this.sendTimer === null) {
        this.sendTimer = this.d.setTimer(() => {
          this.sendTimer = null
          this.evaluate()
        }, wait)
      }
      return
    }
    this.clear('sendTimer')
    void this.send(key, { ...text, startTimestamp: want.startTimestamp })
  }

  private async send(key: string, a: ActivityInput): Promise<void> {
    this.sending = true
    this.lastSendAt = this.d.now()
    this.activity = 'sending'
    this.d.changed()
    let r: { ok: boolean; error?: string }
    try {
      r = await this.d.rpc.setActivity(a)
    } catch (e) {
      r = { ok: false, error: e instanceof Error ? e.message : String(e) }
    }
    this.sending = false
    if (!this.enabled) return
    if (r.ok) {
      this.sentKey = key
      this.failedKey = null
      this.activity = 'confirmed'
      this.error = null
      this.confirmedAt = this.d.now()
    } else if (this.linked()) {
      this.failedKey = key
      this.activity = 'error'
      this.error = r.error ?? 'Discord не принял активность'
      this.d.log?.(`[Discord] активность не принята: ${this.error}`)
    } else {
      // Связь пропала во время отправки: отправим после переподключения.
      this.activity = 'none'
    }
    this.d.changed()
    if (this.dirty) {
      this.dirty = false
      this.evaluate()
    }
  }
}
