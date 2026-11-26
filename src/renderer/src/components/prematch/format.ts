import type { VerdictKind } from '@renderer/utils/prematch-api'

export function fmtDuration(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  if (h > 0) return `${h} ч ${String(m).padStart(2, '0')} мин`
  if (m > 0) return `${m} мин ${String(s).padStart(2, '0')} с`
  return `${s} с`
}

export function fmtDateTime(ts: number): string {
  return new Date(ts).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
}

export const fmtMs = (v: number | null | undefined): string => (v == null ? '—' : `${v} мс`)

/** Классы по вердикту: плашка и цвет текста. */
export const VERDICT_STYLE: Record<VerdictKind, { box: string; text: string }> = {
  good: { box: 'border-st-ok/40 bg-st-ok/10', text: 'text-st-ok-text' },
  warn: { box: 'border-st-warn/40 bg-st-warn/10', text: 'text-st-warn-text' },
  bad: { box: 'border-st-err/40 bg-st-err/10', text: 'text-st-err-text' },
  unknown: { box: 'border-border bg-card/40', text: 'text-muted-foreground' }
}

/** 95.24.12.34 → 95.24.•••.••• */
export function maskIp(ip: string): string {
  const p = ip.split('.')
  return p.length === 4 ? `${p[0]}.${p[1]}.•••.•••` : '•••'
}
