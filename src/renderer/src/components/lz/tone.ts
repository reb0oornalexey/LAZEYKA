import './lz.css'

/**
 * Состояния языка «Сигнал». Одни и те же четыре слова для всех вкладок:
 * on — работает (светится цветом темы), busy — в процессе (бегущий пунктир),
 * off — выключено по выбору человека (матовое, без свечения, это не ошибка),
 * error — не получилось (красная кромка и текст). warn — «нужно внимание»
 * (жёлтый) — только для сводок и предупреждений, не для выключенных служб.
 */
export type LzTone = 'on' | 'busy' | 'off' | 'error' | 'warn'

/** Цвет текста состояния. */
export const TONE_TEXT: Record<LzTone, string> = {
  on: 'text-primary',
  busy: 'text-primary',
  off: 'text-muted-foreground',
  error: 'text-st-err-text',
  warn: 'text-st-warn-text'
}

/** Заливка точки / полосы состояния. */
export const TONE_FILL: Record<LzTone, string> = {
  on: 'bg-primary',
  busy: 'bg-primary/40',
  off: 'bg-muted-foreground/45',
  error: 'bg-st-err',
  warn: 'bg-st-warn'
}

/** CSS-цвет состояния для SVG и градиентов (только токены темы). */
export const TONE_VAR: Record<LzTone, string> = {
  on: 'var(--primary)',
  busy: 'var(--primary)',
  off: 'var(--muted-foreground)',
  error: 'var(--st-err)',
  warn: 'var(--st-warn)'
}

/** Мягкое свечение сверху панели (слой absolute внутри карточки). */
export function glowBackground(tone: LzTone, strength = 16): string | undefined {
  if (tone === 'off') return undefined
  return `radial-gradient(120% 90% at 50% -10%, color-mix(in oklab, ${TONE_VAR[tone]} ${strength}%, transparent), transparent 70%)`
}
