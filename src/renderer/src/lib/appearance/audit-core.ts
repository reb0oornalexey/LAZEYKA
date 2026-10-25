import { CONTRAST_PAIRS, PANEL_SURFACES, type ContrastPair } from './pairs'
import { contrast, effectiveBackground, flatten, hexToRgba, type Rgba } from './contrast-core'

/** Если значения нет в токенах, смотрим, на что оно ссылается по умолчанию (как в main.css). */
const FALLBACK: Record<string, string> = {
  'text-header': 'foreground',
  'text-title': 'card-foreground',
  'sidebar-foreground': 'sidebar-foreground'
}

const BLACK: Rgba = { r: 0, g: 0, b: 0, a: 1 }

export interface AuditContext {
  /** Эффективные токены (hex). */
  tokens: Record<string, string>
  hasWallpaper: boolean
  wallpaperAverage?: Rgba | null
  dimColor: string
  dim: number
  panelOpacity: number
}

const get = (t: Record<string, string>, key: string): Rgba | null => {
  const v = t[key] ?? (FALLBACK[key] ? t[FALLBACK[key]] : undefined)
  return v ? hexToRgba(v) : null
}

export function surfaceOf(ctx: AuditContext, key: string): Rgba {
  const panel = get(ctx.tokens, key) ?? BLACK
  const appBg = get(ctx.tokens, 'background') ?? BLACK
  if (!ctx.hasWallpaper) return flatten(panel, flatten(appBg, BLACK))
  return effectiveBackground({
    panel: PANEL_SURFACES.includes(key) ? panel : { ...panel, a: panel.a / Math.max(ctx.panelOpacity, 0.0001) },
    appBg,
    wallpaperAverage: ctx.wallpaperAverage ?? { r: 128, g: 128, b: 128, a: 1 },
    dimColor: hexToRgba(ctx.dimColor) ?? BLACK,
    dim: ctx.dim,
    panelOpacity: ctx.panelOpacity
  })
}

export interface AuditIssue {
  pair: ContrastPair
  ratio: number
}

export function auditContrast(ctx: AuditContext): AuditIssue[] {
  const out: AuditIssue[] = []
  for (const pair of CONTRAST_PAIRS) {
    const fg = get(ctx.tokens, pair.fg)
    if (!fg) continue
    const ratio = contrast(fg, surfaceOf(ctx, pair.bg))
    if (ratio < pair.min) out.push({ pair, ratio })
  }
  return out
}
