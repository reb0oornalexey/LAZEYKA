import { DEPENDANTS } from './dependants'
import { hexToRgba, rgbaToHex, flatten, solveForeground, readableOn, type Rgba } from './contrast-core'
import { parseColor, formatColor } from './color'

export interface DeriveCtx {
  /** Цвет панели (карточки) — на него накладываются фоны уведомлений и проверяется читаемость. */
  card: string
}

const toRgba = (v: string): Rgba | null => {
  const h = hexToRgba(v)
  if (h) return h
  const p = parseColor(v)
  return p ? { r: p.r, g: p.g, b: p.b, a: p.a } : null
}
const hex = (c: Rgba): string => rgbaToHex(c)


/** Значения, зависящие от смыслового цвета `key`. Работает только для ключей из DEPENDANTS. */
export function deriveFor(key: string, value: string, ctx: DeriveCtx): Record<string, string> {
  if (!(key in DEPENDANTS)) return {}
  const c = toRgba(value)
  const card = toRgba(ctx.card) ?? { r: 0, g: 0, b: 0, a: 1 }
  const cardOpaque = flatten(card, { r: 0, g: 0, b: 0, a: 1 })
  if (!c) return {}
  const on = hex(readableOn(flatten(c, cardOpaque)))
  const out: Record<string, string> = {}

  // Уведомление: фон ~12% цвета поверх панели, рамка ~30%, текст подбирается под читаемость.
  const toastSet = (type: string): void => {
    const bg = flatten({ ...c, a: 0.12 }, cardOpaque)
    out[`toast-${type}-bg`] = hex(bg)
    out[`toast-${type}-border`] = hex(flatten({ ...c, a: 0.3 }, cardOpaque))
    out[`toast-${type}-fg`] = hex(solveForeground(c, bg, 4.5))
  }
  const textOnCard = hex(solveForeground(c, cardOpaque, 4.5))

  switch (key) {
    case 'primary': {
      const fg = hex(readableOn(c))
      out['primary-foreground'] = fg
      out['sidebar-primary-foreground'] = fg
      out['ring'] = value
      out['sidebar-primary'] = value
      out['sidebar-ring'] = value
      out['stroke-power-on'] = value
      out['gradient-start-power-on'] = value
      out['gradient-end-power-on'] = hex({ r: c.r * 0.7, g: c.g * 0.7, b: c.b * 0.7, a: 1 })
      out['profile-active'] = formatColor({ r: c.r, g: c.g, b: c.b, a: 0.14 })
      out['stroke-profile-active'] = value
      out['chart-1'] = value
      break
    }
    case 'card':
      out['popover'] = value
      break
    case 'border':
      out['sidebar-border'] = value
      out['stroke'] = value
      break
    case 'foreground':
      out['card-foreground'] = value
      out['popover-foreground'] = value
      out['secondary-foreground'] = value
      out['accent-foreground'] = value
      break
    case 'success':
      out['success-foreground'] = on
      out['st-ok'] = value
      out['st-ok-text'] = textOnCard
      toastSet('success')
      break
    case 'destructive': {
      out['destructive-foreground'] = on
      out['btn-destructive-fg'] = on
      out['st-err'] = value
      out['st-err-text'] = textOnCard
      toastSet('error')
      out['badge-danger-bg'] = hex(flatten({ ...c, a: 0.15 }, cardOpaque))
      out['badge-danger-border'] = hex(flatten({ ...c, a: 0.3 }, cardOpaque))
      out['badge-danger-fg'] = textOnCard
      break
    }
    case 'warning':
      out['warning-foreground'] = on
      out['st-warn'] = value
      out['st-warn-text'] = textOnCard
      toastSet('warning')
      break
    case 'info':
      out['st-info-text'] = textOnCard
      toastSet('info')
      break
  }
  return out
}
