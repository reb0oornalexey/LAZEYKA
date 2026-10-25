import { DARK_TOKENS, LIGHT_TOKENS } from './palettes'
import { derive, type Seed } from './presets'
import { deriveFor } from './derive'
import { auditContrast, surfaceOf, type AuditContext } from './audit-core'
import {
  hexToRgba,
  oklchToRgb,
  readableOn,
  rgbToOklch,
  rgbaToHex,
  solveForeground,
  type Rgba
} from './contrast-core'

export interface WallpaperSwatch {
  color: string
  share: number
}

export interface WallpaperStats {
  average: { r: number; g: number; b: number }
  luminance: number
  spread: number
}

export interface GeneratedTheme {
  mode: AppearanceMode
  /** Только отличия от базового пресета + явные цвета ролей текста. */
  tokens: Record<string, string>
  settings: { bgDim: number; bgDimColor: string; panelOpacity: number }
  /** Сколько проблем с читаемостью осталось после подбора (должно быть 0). */
  issues: number
}

const clamp = (n: number, a: number, b: number): number => Math.min(b, Math.max(a, n))
const ok = (l: number, c: number, h: number): string => rgbaToHex(oklchToRgb({ l, c, h }))
const rgb = (hex: string): Rgba => hexToRgba(hex) ?? { r: 0, g: 0, b: 0, a: 1 }

/**
 * Полная тема из картинки: режим, акцент, фон/панели/меню с оттенком картинки, рамки,
 * 4 роли текста, статусы, затемнение и прозрачность панелей. Текст подбирается по
 * ФАКТИЧЕСКОМУ фону (панель с прозрачностью поверх затемнённых обоев).
 */
export function generateTheme(swatches: WallpaperSwatch[], stats: WallpaperStats): GeneratedTheme {
  const mode: AppearanceMode = stats.luminance < 0.4 ? 'dark' : 'light'
  const dark = mode === 'dark'
  const base = dark ? DARK_TOKENS : LIGHT_TOKENS

  const ok3 = swatches.map((s) => ({ ...s, o: rgbToOklch(rgb(s.color)) }))
  // Оттенок поверхностей — от самого заметного цвета картинки.
  const dominant = [...ok3].sort((a, b) => b.share * (b.o.c + 0.04) - a.share * (a.o.c + 0.04))[0]
  const H = dominant ? dominant.o.h : 260
  const tint = dark ? Math.min(0.03 + (dominant?.o.c ?? 0) * 0.25, 0.05) : Math.min(0.02 + (dominant?.o.c ?? 0) * 0.2, 0.04)

  // Затемнение и прозрачность панелей: ярче и «шумнее» картинка → плотнее.
  const dimColor = dark ? '#000000' : '#ffffff'
  const bgDim = dark
    ? clamp(0.28 + 0.55 * Math.max(0, stats.luminance - 0.15) + 0.5 * stats.spread, 0.28, 0.7)
    : clamp(0.3 + 0.4 * stats.spread + 0.3 * Math.max(0, 0.6 - stats.luminance), 0.3, 0.65)
  let panelOpacity = clamp(0.74 + 0.35 * stats.spread + 0.25 * stats.luminance, 0.74, 0.95)
  const round2 = (n: number): number => Math.round(n * 100) / 100

  const L = dark
    ? { bg: 0.15, card: 0.2, pop: 0.23, raised: 0.27, muted: 0.19, border: 0.31, input: 0.36, side: 0.12 }
    : { bg: 0.95, card: 0.985, pop: 0.995, raised: 0.91, muted: 0.93, border: 0.86, input: 0.8, side: 0.975 }
  const surf = (l: number): string => ok(l, tint, H)

  // Акцент: самый яркий по цветности цвет картинки.
  const vivid = [...ok3]
    .filter((s) => s.share >= 0.015)
    .sort((a, b) => b.o.c * (b.o.l > 0.3 && b.o.l < 0.9 ? 1 : 0.5) - a.o.c * (a.o.l > 0.3 && a.o.l < 0.9 ? 1 : 0.5))[0]
  const accentH = vivid && vivid.o.c >= 0.05 ? vivid.o.h : H
  const accentC = clamp(vivid && vivid.o.c >= 0.05 ? vivid.o.c : 0.14, 0.12, 0.2)
  let primary = ok(dark ? 0.74 : 0.5, accentC, accentH)

  const seed = (): Seed => ({
    bg: surf(L.bg), card: surf(L.card), popover: surf(L.pop), raised: surf(L.raised), muted: surf(L.muted),
    border: surf(L.border), input: surf(L.input), fg: '#ffffff', mutedFg: '#ffffff', sidebar: surf(L.side),
    sidebarFg: '#ffffff', primary, primaryFg: rgbaToHex(readableOn(rgb(primary))),
    deep: ok(dark ? 0.5 : 0.36, accentC, accentH)
  })

  const build = (): { tokens: Record<string, string>; ctx: AuditContext } => {
    const tokens = derive(base, seed())
    const ctx: AuditContext = {
      tokens,
      hasWallpaper: true,
      wallpaperAverage: { ...stats.average, a: 1 },
      dimColor,
      dim: bgDim,
      panelOpacity
    }
    return { tokens, ctx }
  }

  let { tokens, ctx } = build()
  const fit = (start: string, keys: string[], min: number): string => {
    let c = rgb(start)
    for (let i = 0; i < 4; i++) for (const k of keys) c = solveForeground(c, surfaceOf(ctx, k), min)
    return rgbaToHex(c)
  }

  const textFg = dark ? ok(0.95, 0.012, H) : ok(0.22, 0.02, H)
  const muted = dark ? ok(0.72, 0.02, H) : ok(0.45, 0.02, H)
  const header = dark ? ok(0.97, 0.01, H) : ok(0.18, 0.015, H)
  const title = dark ? ok(0.96, 0.012, H) : ok(0.2, 0.018, H)
  const apply = (): void => {
    const fg = fit(textFg, ['background', 'card', 'sidebar'], 4.6)
    for (const k of ['foreground', 'card-foreground', 'popover-foreground', 'secondary-foreground', 'accent-foreground', 'sidebar-accent-foreground']) tokens[k] = fg
    tokens['text-header'] = fit(header, ['sidebar', 'background'], 4.6)
    tokens['text-title'] = fit(title, ['card'], 4.6)
    tokens['muted-foreground'] = fit(muted, ['background', 'card'], 4.6)
    tokens['sidebar-foreground'] = fit(dark ? ok(0.9, 0.015, H) : ok(0.25, 0.02, H), ['sidebar'], 4.6)
    // Акцент должен читаться на панелях.
    primary = fit(primary, ['card', 'background'], 3.3)
    tokens['primary'] = primary
    Object.assign(tokens, deriveFor('primary', primary, { card: tokens['card'] }))
    // Статусы: узнаваемые оттенки, подогнанная светлота.
    const status: [string, number][] = [['success', 150], ['destructive', 25], ['warning', 85], ['info', 245]]
    for (const [key, hue] of status) {
      const c = fit(ok(dark ? 0.78 : 0.52, 0.16, (hue * Math.PI) / 180), ['card'], 3.3)
      tokens[key] = c
      Object.assign(tokens, deriveFor(key, c, { card: tokens['card'] }))
    }
  }
  apply()

  // Контрольный проход: что осталось нечитаемым — чиним, при необходимости делаем панели плотнее.
  let issues = auditContrast(ctx)
  for (let round = 0; round < 4 && issues.length > 0; round++) {
    panelOpacity = Math.min(0.97, panelOpacity + 0.04)
    ;({ tokens, ctx } = (() => {
      const nb = build()
      // сохраняем уже подобранные цвета текста и статусов
      return { tokens: { ...nb.tokens, ...tokens, background: nb.tokens['background'] }, ctx: nb.ctx }
    })())
    ctx.tokens = tokens
    apply()
    issues = auditContrast(ctx)
  }

  const diff: Record<string, string> = {}
  for (const [k, v] of Object.entries(tokens)) if (base[k] !== v) diff[k] = v
  for (const k of ['text-header', 'text-title', 'foreground', 'muted-foreground', 'sidebar-foreground', 'info']) diff[k] = tokens[k]
  return {
    mode,
    tokens: diff,
    settings: { bgDim: round2(bgDim), bgDimColor: dimColor, panelOpacity: round2(panelOpacity) },
    issues: issues.length
  }
}
