import type { LzTone } from '@renderer/components/lz'
import { verdictLabel } from '@renderer/components/site-check-card'
import type { SiteCheckResult } from '@renderer/utils/ipc'
import type { LeakResult, Tone, WhitelistResult, WifiResult } from '@renderer/utils/diag-api'

/** Итог одной проверки для пульта «Диагностики»: тон и короткая строка. */
export interface CheckSummary {
  tone: LzTone
  short: string
}

const FROM_TONE: Record<Tone, LzTone> = { ok: 'on', info: 'on', warn: 'warn', bad: 'error' }
const NONE: CheckSummary = { tone: 'off', short: 'не проверяли' }
const BUSY: CheckSummary = { tone: 'busy', short: 'проверяю…' }

export function siteSummary(busy: boolean, r: SiteCheckResult | null, error: string | null): CheckSummary {
  if (busy) return BUSY
  if (error) return { tone: 'error', short: 'ошибка проверки' }
  if (!r) return NONE
  if (r.pageError) return { tone: 'error', short: `${r.host}: не открылся` }
  if (r.pageTimedOut) return { tone: 'warn', short: `${r.host}: таймаут загрузки` }
  if ((r.pageStatusCode ?? 0) >= 400) return { tone: 'error', short: `${r.host}: HTTP ${r.pageStatusCode}` }
  const tones = r.probes.map((p) => verdictLabel(p).tone)
  const bad = tones.filter((t) => t === 'bad').length
  const warn = tones.filter((t) => t === 'warn').length
  if (bad) return { tone: 'error', short: `${r.host}: проблем ${bad}` }
  if (warn) return { tone: 'warn', short: `${r.host}: замечаний ${warn}` }
  return { tone: 'on', short: `${r.host}: открывается` }
}

export function leakSummary(busy: boolean, r: LeakResult | null): CheckSummary {
  if (busy) return BUSY
  if (!r) return NONE
  return { tone: FROM_TONE[r.verdict.kind], short: r.verdict.headline }
}

const BAND = { '2.4': '2,4 ГГц', '5': '5 ГГц', '6': '6 ГГц' } as const

export function wifiSummary(busy: boolean, r: WifiResult | null): CheckSummary {
  if (busy) return BUSY
  if (!r) return NONE
  const lines = r.advice.lines
  const tone: LzTone = lines.some((l) => l.kind === 'bad') ? 'error' : lines.some((l) => l.kind === 'warn') || r.problem ? 'warn' : 'on'
  const c = r.current
  if (!c) return { tone: r.problem ? 'warn' : tone, short: r.networks.length ? 'не подключён к Wi-Fi' : 'не удалось прочитать' }
  const parts = [c.signalPct != null ? `сигнал ${c.signalPct} %` : null, c.band ? BAND[c.band] : null, c.channel != null ? `канал ${c.channel}` : null].filter(Boolean)
  return { tone, short: parts.join(', ') || 'подключён' }
}

const WL_TONE: Record<NonNullable<WhitelistResult['verdict']>['kind'], LzTone> = { whitelist: 'error', normal: 'on', 'no-internet': 'warn', unclear: 'warn' }

export function whitelistSummary(busy: boolean, r: WhitelistResult | null): CheckSummary {
  if (busy) return BUSY
  if (!r) return NONE
  if (!r.available || !r.verdict) return { tone: 'warn', short: 'не удалось проверить' }
  return { tone: WL_TONE[r.verdict.kind], short: r.verdict.headline }
}
