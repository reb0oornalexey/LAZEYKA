/**
 * Расчёт контраста и подбор читаемого цвета. Файл намеренно без импортов:
 * его проверяет scripts/check-contrast.mjs прямо в Node.
 */

export interface Rgba {
  r: number // 0–255
  g: number
  b: number
  a: number // 0–1
}

const clamp01 = (n: number): number => Math.min(1, Math.max(0, n))
const clamp255 = (n: number): number => Math.min(255, Math.max(0, Math.round(n)))

export function hexToRgba(hex: string): Rgba | null {
  const m = /^#([0-9a-f]{3,8})$/i.exec(hex.trim())
  if (!m) return null
  let h = m[1]
  if (h.length === 3 || h.length === 4) h = h.split('').map((c) => c + c).join('')
  if (h.length !== 6 && h.length !== 8) return null
  return {
    r: parseInt(h.slice(0, 2), 16),
    g: parseInt(h.slice(2, 4), 16),
    b: parseInt(h.slice(4, 6), 16),
    a: h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1
  }
}

export function rgbaToHex(c: Rgba): string {
  const h2 = (n: number): string => clamp255(n).toString(16).padStart(2, '0')
  return `#${h2(c.r)}${h2(c.g)}${h2(c.b)}${c.a < 0.999 ? h2(c.a * 255) : ''}`
}

const lin = (c: number): number => {
  const s = c / 255
  return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4)
}
const delin = (v: number): number => 255 * (v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(v, 1 / 2.4) - 0.055)

export const luminance = (c: Rgba): number => 0.2126 * lin(c.r) + 0.7152 * lin(c.g) + 0.0722 * lin(c.b)

/** Накладывает (полупрозрачный) цвет на непрозрачную подложку. */
export function flatten(top: Rgba, over: Rgba): Rgba {
  const a = clamp01(top.a)
  return {
    r: top.r * a + over.r * (1 - a),
    g: top.g * a + over.g * (1 - a),
    b: top.b * a + over.b * (1 - a),
    a: 1
  }
}

/** Контраст WCAG между непрозрачными цветами (прозрачность, если есть, накладывается на bg). */
export function contrast(fg: Rgba, bgOpaque: Rgba): number {
  const f = flatten(fg, { ...bgOpaque, a: 1 })
  const l1 = luminance(f)
  const l2 = luminance(bgOpaque)
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05)
}

// ---- OKLCH ----------------------------------------------------------------------

export interface Oklch {
  l: number
  c: number
  h: number
}

export function rgbToOklch(c: Rgba): Oklch {
  const r = lin(c.r)
  const g = lin(c.g)
  const b = lin(c.b)
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b)
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b)
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b)
  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s
  const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s
  const B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s
  return { l: L, c: Math.hypot(A, B), h: Math.atan2(B, A) }
}

/** OKLCH → sRGB; если цвет вне гаммы, снижаем насыщенность, сохраняя оттенок и светлоту. */
export function oklchToRgb(o: Oklch, alpha = 1): Rgba {
  let c = o.c
  for (let i = 0; i < 24; i++) {
    const A = c * Math.cos(o.h)
    const B = c * Math.sin(o.h)
    const l = Math.pow(o.l + 0.3963377774 * A + 0.2158037573 * B, 3)
    const m = Math.pow(o.l - 0.1055613458 * A - 0.0638541728 * B, 3)
    const s = Math.pow(o.l - 0.0894841775 * A - 1.291485548 * B, 3)
    const r = 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s
    const g = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s
    const b = -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s
    const inGamut = [r, g, b].every((v) => v >= -0.0005 && v <= 1.0005)
    if (inGamut || c < 0.0005) {
      return { r: clamp255(delin(clamp01(r))), g: clamp255(delin(clamp01(g))), b: clamp255(delin(clamp01(b))), a: alpha }
    }
    c *= 0.9
  }
  const v = clamp255(delin(clamp01(o.l)))
  return { r: v, g: v, b: v, a: alpha }
}

const NEAR_WHITE: Rgba = { r: 245, g: 247, b: 250, a: 1 }
const NEAR_BLACK: Rgba = { r: 11, g: 13, b: 16, a: 1 }

/** Ближайший к белому/чёрному читаемый цвет на данном фоне. */
export function readableOn(bgOpaque: Rgba): Rgba {
  return contrast(NEAR_WHITE, bgOpaque) >= contrast(NEAR_BLACK, bgOpaque) ? NEAR_WHITE : NEAR_BLACK
}

/**
 * Подбор цвета текста. Меняется ТОЛЬКО светлота в OKLCH (оттенок и насыщенность те же):
 * идём от текущего цвета в сторону, противоположную фону, и бинарным поиском находим
 * минимальное изменение, при котором контраст ≥ target. Если недостижимо — берём
 * почти-белый или почти-чёрный, у которого контраст выше.
 */
export function solveForeground(fg: Rgba, bgOpaque: Rgba, target = 4.5): Rgba {
  if (contrast(fg, bgOpaque) >= target) return fg
  target += 0.05 // запас на округление до 8 бит
  const o = rgbToOklch(fg)
  const bgL = rgbToOklch(bgOpaque).l
  const up = o.l >= bgL // текст светлее фона → светлим дальше, иначе темним
  let lo = o.l
  let hi = up ? 1 : 0
  const at = (l: number): Rgba => oklchToRgb({ ...o, l }, fg.a)
  if (contrast(at(hi), bgOpaque) < target) return readableOn(bgOpaque)
  for (let i = 0; i < 24; i++) {
    const mid = (lo + hi) / 2
    if (contrast(at(mid), bgOpaque) >= target) hi = mid
    else lo = mid
  }
  return at(hi)
}

/**
 * Подбор цвета ФОНА при неизменном тексте: двигаем светлоту фона от текста.
 * canvas — то, что лежит под полупрозрачной панелью; panelAlpha — множитель прозрачности.
 */
export function solveBackground(bg: Rgba, fg: Rgba, canvas: Rgba, panelAlpha = 1, target = 4.5): Rgba {
  const eff = (c: Rgba): Rgba => flatten({ ...c, a: c.a * panelAlpha }, canvas)
  if (contrast(fg, eff(bg)) >= target) return bg
  target += 0.05
  const o = rgbToOklch(bg)
  const fgL = rgbToOklch(flatten(fg, eff(bg))).l
  const up = o.l >= fgL
  let lo = o.l
  let hi = up ? 1 : 0
  const at = (l: number): Rgba => oklchToRgb({ ...o, l }, bg.a)
  if (contrast(fg, eff(at(hi))) < target) {
    const dark = contrast(fg, eff({ ...NEAR_BLACK, a: bg.a })) >= contrast(fg, eff({ ...NEAR_WHITE, a: bg.a }))
    return { ...(dark ? NEAR_BLACK : NEAR_WHITE), a: bg.a }
  }
  for (let i = 0; i < 24; i++) {
    const mid = (lo + hi) / 2
    if (contrast(fg, eff(at(mid))) >= target) hi = mid
    else lo = mid
  }
  return at(hi)
}

/**
 * Реальный фон под текстом. Без обоев — фон приложения; с обоями — затемнение
 * поверх среднего цвета картинки. Панель с прозрачностью накладывается сверху.
 */
export function effectiveBackground(opts: {
  panel: Rgba
  appBg: Rgba
  wallpaperAverage?: Rgba | null
  dimColor?: Rgba
  dim?: number
  panelOpacity?: number
}): Rgba {
  let canvas = flatten(opts.appBg, { r: 0, g: 0, b: 0, a: 1 })
  if (opts.wallpaperAverage) {
    canvas = flatten({ ...(opts.dimColor ?? { r: 0, g: 0, b: 0, a: 1 }), a: opts.dim ?? 0 }, { ...opts.wallpaperAverage, a: 1 })
  }
  const a = opts.wallpaperAverage ? (opts.panelOpacity ?? 1) : 1
  return flatten({ ...opts.panel, a: opts.panel.a * a }, canvas)
}
