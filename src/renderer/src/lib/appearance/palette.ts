import { formatColor, parseColor, rgbToHsl, type RGBA } from './color'

export interface Swatch {
  color: string
  share: number
}

/** Статистика кадра: средний цвет, яркость и «пёстрота» (разброс яркости). */
export interface ImageStats {
  average: RGBA
  /** Относительная яркость среднего цвета, 0–1. */
  luminance: number
  /** Стандартное отклонение яркости пикселей, 0–0.5 — чем больше, тем «шумнее» картинка. */
  spread: number
}

const lum = (r: number, g: number, b: number): number => {
  const f = (c: number): number => {
    const s = c / 255
    return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4)
  }
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b)
}

export function statsOf(px: number[][]): ImageStats {
  let r = 0
  let g = 0
  let b = 0
  const ls: number[] = []
  for (const p of px) {
    r += p[0]
    g += p[1]
    b += p[2]
    ls.push(lum(p[0], p[1], p[2]))
  }
  const n = Math.max(px.length, 1)
  const mean = ls.reduce((a, c) => a + c, 0) / n
  const variance = ls.reduce((a, c) => a + (c - mean) * (c - mean), 0) / n
  const average = { r: r / n, g: g / n, b: b / n, a: 1 }
  return { average, luminance: lum(average.r, average.g, average.b), spread: Math.sqrt(variance) }
}

/** Пиксели кадра, уменьшенного до ~64 px по длинной стороне. */
export async function samplePixels(url: string, side = 64): Promise<number[][]> {
  const img = new Image()
  img.src = url
  await img.decode()
  const scale = side / Math.max(img.naturalWidth, img.naturalHeight, 1)
  const w = Math.max(1, Math.round(img.naturalWidth * scale))
  const h = Math.max(1, Math.round(img.naturalHeight * scale))
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  const ctx = c.getContext('2d', { willReadFrequently: true })
  if (!ctx) return []
  ctx.drawImage(img, 0, 0, w, h)
  const data = ctx.getImageData(0, 0, w, h).data
  const px: number[][] = []
  for (let i = 0; i < data.length; i += 4) if (data[i + 3] > 128) px.push([data[i], data[i + 1], data[i + 2]])
  return px
}

/** k-means по пикселям. Детерминированный старт — без случайности. */
export function quantize(px: number[][], k = 5): Swatch[] {
  if (px.length === 0) return []
  const sorted = [...px].sort((a, b) => a[0] + a[1] + a[2] - (b[0] + b[1] + b[2]))
  let centers = Array.from({ length: k }, (_, i) => [...sorted[Math.floor(((i + 0.5) / k) * sorted.length)]])
  const assign = new Array<number>(px.length).fill(0)
  for (let it = 0; it < 8; it++) {
    const sums = centers.map(() => [0, 0, 0, 0])
    for (let i = 0; i < px.length; i++) {
      let best = 0
      let bd = Infinity
      for (let j = 0; j < centers.length; j++) {
        const dr = px[i][0] - centers[j][0]
        const dg = px[i][1] - centers[j][1]
        const db = px[i][2] - centers[j][2]
        const d = dr * dr + dg * dg + db * db
        if (d < bd) {
          bd = d
          best = j
        }
      }
      assign[i] = best
      sums[best][0] += px[i][0]
      sums[best][1] += px[i][1]
      sums[best][2] += px[i][2]
      sums[best][3]++
    }
    centers = centers.map((c0, j) => (sums[j][3] ? [sums[j][0] / sums[j][3], sums[j][1] / sums[j][3], sums[j][2] / sums[j][3]] : c0))
  }
  const counts = centers.map(() => 0)
  for (const a of assign) counts[a]++
  return centers
    .map((c0, j) => ({ color: formatColor({ r: Math.round(c0[0]), g: Math.round(c0[1]), b: Math.round(c0[2]), a: 1 }), share: counts[j] / px.length }))
    .filter((s) => s.share > 0)
    .sort((a, b) => b.share - a.share)
}

export async function extractPaletteFromUrl(url: string, k = 5): Promise<Swatch[]> {
  return quantize(await samplePixels(url), k)
}

/** Самый «цветной» кластер, который не слишком тёмный и не слишком светлый. */
export function pickAccent(swatches: Swatch[]): string {
  let best = swatches[0]?.color ?? '#4ce896'
  let score = -1
  for (const s of swatches) {
    const hsl = rgbToHsl(parseColor(s.color) as RGBA)
    const lightOk = 1 - Math.abs(hsl.l - 0.55) * 1.6
    const sc = hsl.s * Math.max(0, lightOk) * (0.4 + Math.min(s.share * 4, 0.6))
    if (sc > score) {
      score = sc
      best = s.color
    }
  }
  return best
}
