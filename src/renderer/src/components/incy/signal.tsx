import React from 'react'
import { cn } from '@renderer/lib/utils'
import type { IncySubscription } from '@renderer/utils/ipc'

/*
 * Мелкие общие детали INCY в языке «Сигнал»: деления силы сигнала по пингу,
 * метка протокола и расчёт остатка подписки. Только отображение, без логики.
 */

/** Пинг → число горящих делений из пяти (как у PingMeter на Главной). */
export function pingBars(ms: number | null | undefined): number {
  if (ms == null) return 0
  return ms < 60 ? 5 : ms < 100 ? 4 : ms < 160 ? 3 : ms < 250 ? 2 : 1
}

/** Деления «силы сигнала». Горят цветом темы, если узел подключён, иначе — тоном качества. */
export const SignalBars: React.FC<{
  ms: number | null | undefined
  /** Узел не ответил на замер: одно красное деление. */
  unreachable?: boolean
  on?: boolean
  className?: string
  height?: number
}> = ({ ms, unreachable, on, className, height = 16 }) => {
  const bars = unreachable ? 1 : pingBars(ms)
  const fill = unreachable
    ? 'bg-st-err'
    : on
      ? 'bg-primary'
      : bars >= 4
        ? 'bg-st-ok'
        : bars === 3
          ? 'bg-st-warn'
          : bars > 0
            ? 'bg-st-err'
            : ''
  return (
    <span aria-hidden className={cn('inline-flex shrink-0 items-end gap-[2px]', className)} style={{ height }}>
      {[1, 2, 3, 4, 5].map((b) => (
        <span
          key={b}
          className={cn('w-[3px] rounded-[1px] transition-colors duration-500', b <= bars ? fill : 'bg-foreground/12')}
          style={{ height: `${b * 20}%` }}
        />
      ))}
    </span>
  )
}

/** Короткое имя протокола для метки. */
export function protocolLabel(p: string): string {
  if (p === 'hysteria2') return 'Hysteria2'
  if (p === 'wireguard') return 'WARP'
  if (p === 'shadowsocks') return 'SS'
  return p.toUpperCase()
}

/** Метка протокола: тихая, одна на строку. */
export const ProtocolTag: React.FC<{ protocol: string; json?: boolean; className?: string }> = ({ protocol, json, className }) => (
  <span
    className={cn(
      'inline-flex shrink-0 items-center rounded-md border px-1.5 py-px text-[10px] font-semibold leading-tight',
      protocol === 'hysteria2'
        ? 'border-st-warn/35 bg-st-warn/10 text-st-warn-text'
        : protocol === 'wireguard'
          ? 'border-st-info/35 bg-st-info/10 text-st-info-text'
          : 'border-foreground/[0.1] bg-foreground/[0.05] text-foreground/75',
      className
    )}
  >
    {protocolLabel(protocol)}
    {json && <span className="ml-1 opacity-60">JSON</span>}
  </span>
)

export interface SubUsage {
  /** Дней до конца (может быть ≤ 0), null — срока нет. */
  daysLeft: number | null
  /** Сколько трафика осталось, байт; null — без лимита. */
  leftBytes: number | null
  totalBytes: number | null
  usedPct: number | null
  /** Подписка на исходе: ≤ 3 дней или < 10 % трафика. */
  low: boolean
  expired: boolean
}

export function subUsage(sub: IncySubscription): SubUsage {
  const daysLeft = typeof sub.expireAt === 'number' ? Math.ceil((sub.expireAt - Date.now()) / 86_400_000) : null
  const hasTraffic = sub.totalBytes != null && sub.totalBytes > 0 && sub.usedBytes != null
  const leftBytes = hasTraffic ? Math.max(0, (sub.totalBytes as number) - (sub.usedBytes as number)) : null
  const usedPct = hasTraffic ? Math.min(100, Math.round(((sub.usedBytes as number) / (sub.totalBytes as number)) * 100)) : null
  const expired = (daysLeft !== null && daysLeft <= 0) || leftBytes === 0
  const low = expired || (daysLeft !== null && daysLeft <= 3) || (usedPct !== null && usedPct >= 90)
  return { daysLeft, leftBytes, totalBytes: hasTraffic ? sub.totalBytes : null, usedPct, low, expired }
}

/** Байты → «8,0 ГБ», «512 МБ». */
export function gb(bytes: number): string {
  const g = bytes / 1024 ** 3
  if (g >= 1) return `${(g >= 100 ? Math.round(g).toString() : g.toFixed(1)).replace('.', ',')} ГБ`
  return `${Math.round(bytes / 1024 ** 2)} МБ`
}

/** «осталось 8 дн.», «без срока», «срок истёк». */
export function daysText(daysLeft: number | null, expireDate?: string | null): string {
  if (daysLeft === null) return expireDate ? `до ${expireDate}` : 'без срока'
  if (daysLeft <= 0) return 'срок истёк'
  return `${daysLeft} дн.`
}
