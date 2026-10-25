/** Небольшие помощники для работы с цветом (без внешних библиотек). */

export interface RGBA {
  r: number // 0–255
  g: number
  b: number
  a: number // 0–1
}

export interface HSVA {
  h: number // 0–360
  s: number // 0–1
  v: number // 0–1
  a: number // 0–1
}

const clamp = (n: number, min: number, max: number): number => Math.min(max, Math.max(min, n))

let probe: CanvasRenderingContext2D | null | undefined

function getProbe(): CanvasRenderingContext2D | null {
  if (probe !== undefined) return probe
  try {
    const c = document.createElement('canvas')
    c.width = 1
    c.height = 1
    probe = c.getContext('2d', { willReadFrequently: true })
  } catch {
    probe = null
  }
  return probe
}

/** Любой CSS-цвет (color-mix, oklch, hsl, имена…) → RGBA через canvas. */
function parseViaCanvas(input: string): RGBA | null {
  const ctx = getProbe()
  if (!ctx) return null
  ctx.fillStyle = '#010203'
  ctx.fillStyle = input
  const first = ctx.fillStyle
  ctx.fillStyle = '#fdfcfb'
  ctx.fillStyle = input
  // Если значение не распозналось, fillStyle остаётся прежним — результаты разойдутся.
  if (first !== ctx.fillStyle) return null
  ctx.clearRect(0, 0, 1, 1)
  ctx.fillRect(0, 0, 1, 1)
  const d = ctx.getImageData(0, 0, 1, 1).data
  return { r: d[0], g: d[1], b: d[2], a: Math.round((d[3] / 255) * 1000) / 1000 }
}

export function parseColor(input: string | undefined | null): RGBA | null {
  if (!input) return null
  const s = input.trim().toLowerCase()
  if (!s) return null
  if (s === 'transparent') return { r: 0, g: 0, b: 0, a: 0 }
  const hex = /^#([0-9a-f]{3,8})$/.exec(s)
  if (hex) {
    let h = hex[1]
    if (h.length === 3 || h.length === 4) h = h.split('').map((c) => c + c).join('')
    if (h.length === 6 || h.length === 8) {
      return {
        r: parseInt(h.slice(0, 2), 16),
        g: parseInt(h.slice(2, 4), 16),
        b: parseInt(h.slice(4, 6), 16),
        a: h.length === 8 ? Math.round((parseInt(h.slice(6, 8), 16) / 255) * 1000) / 1000 : 1
      }
    }
    return null
  }
  const rgb = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:[\s,/]+([\d.]+)(%?))?\s*\)$/.exec(s)
  if (rgb) {
    const a = rgb[4] === undefined ? 1 : rgb[5] ? Number(rgb[4]) / 100 : Number(rgb[4])
    return {
      r: clamp(Math.round(Number(rgb[1])), 0, 255),
      g: clamp(Math.round(Number(rgb[2])), 0, 255),
      b: clamp(Math.round(Number(rgb[3])), 0, 255),
      a: clamp(a, 0, 1)
    }
  }
  return parseViaCanvas(s)
}

const hex2 = (n: number): string => clamp(Math.round(n), 0, 255).toString(16).padStart(2, '0')

export function rgbaToHex(c: RGBA, withAlpha = c.a < 1): string {
  const base = `#${hex2(c.r)}${hex2(c.g)}${hex2(c.b)}`
  return withAlpha ? base + hex2(c.a * 255) : base
}

/** Каноничная запись цвета в токене: #rrggbb или #rrggbbaa. */
export function formatColor(c: RGBA): string {
  return rgbaToHex(c, c.a < 0.999)
}

export function rgbToHsv({ r, g, b, a }: RGBA): HSVA {
  const rn = r / 255
  const gn = g / 255
  const bn = b / 255
  const max = Math.max(rn, gn, bn)
  const min = Math.min(rn, gn, bn)
  const d = max - min
  let h = 0
  if (d !== 0) {
    if (max === rn) h = ((gn - bn) / d) % 6
    else if (max === gn) h = (bn - rn) / d + 2
    else h = (rn - gn) / d + 4
    h *= 60
    if (h < 0) h += 360
  }
  return { h, s: max === 0 ? 0 : d / max, v: max, a }
}

export function hsvToRgb({ h, s, v, a }: HSVA): RGBA {
  const c = v * s
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1))
  const m = v - c
  let r = 0
  let g = 0
  let b = 0
  const hh = ((h % 360) + 360) % 360
  if (hh < 60) [r, g, b] = [c, x, 0]
  else if (hh < 120) [r, g, b] = [x, c, 0]
  else if (hh < 180) [r, g, b] = [0, c, x]
  else if (hh < 240) [r, g, b] = [0, x, c]
  else if (hh < 300) [r, g, b] = [x, 0, c]
  else [r, g, b] = [c, 0, x]
  return { r: Math.round((r + m) * 255), g: Math.round((g + m) * 255), b: Math.round((b + m) * 255), a }
}

/** Тот же цвет с другой прозрачностью (a умножается). */
export function withAlpha(value: string, factor: number): string {
  const c = parseColor(value)
  if (!c) return value
  return formatColor({ ...c, a: clamp(c.a * factor, 0, 1) })
}

/** Значение, которое можно безопасно вставить в CSS (без ; { } < > url( и т.п.). */
export function isSafeCssValue(v: unknown): v is string {
  return typeof v === 'string' && v.length > 0 && v.length <= 160 && /^[#a-zA-Z0-9(),.%\s/+-]*$/.test(v) && !/url\(|expression|import/i.test(v)
}

export interface HSLA {
  h: number
  s: number
  l: number
  a: number
}

export function rgbToHsl({ r, g, b, a }: RGBA): HSLA {
  const rn = r / 255
  const gn = g / 255
  const bn = b / 255
  const max = Math.max(rn, gn, bn)
  const min = Math.min(rn, gn, bn)
  const l = (max + min) / 2
  const d = max - min
  if (d === 0) return { h: 0, s: 0, l, a }
  const s = d / (1 - Math.abs(2 * l - 1))
  let h: number
  if (max === rn) h = ((gn - bn) / d) % 6
  else if (max === gn) h = (bn - rn) / d + 2
  else h = (rn - gn) / d + 4
  h *= 60
  if (h < 0) h += 360
  return { h, s, l, a }
}

export function hslToRgb({ h, s, l, a }: HSLA): RGBA {
  const c = (1 - Math.abs(2 * l - 1)) * s
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1))
  const m = l - c / 2
  const hh = ((h % 360) + 360) % 360
  let r = 0
  let g = 0
  let b = 0
  if (hh < 60) [r, g, b] = [c, x, 0]
  else if (hh < 120) [r, g, b] = [x, c, 0]
  else if (hh < 180) [r, g, b] = [0, c, x]
  else if (hh < 240) [r, g, b] = [0, x, c]
  else if (hh < 300) [r, g, b] = [x, 0, c]
  else [r, g, b] = [c, 0, x]
  return { r: Math.round((r + m) * 255), g: Math.round((g + m) * 255), b: Math.round((b + m) * 255), a }
}

export const hslHex = (h: number, s: number, l: number): string => formatColor(hslToRgb({ h, s: clamp(s, 0, 1), l: clamp(l, 0, 1), a: 1 }))

export { clamp }
