import { builtinById } from './wallpapers'
import type { RGBA } from './color'

export type BgKind = 'image' | 'animated' | 'video'

export const isBuiltin = (name: string): boolean => name.startsWith('builtin:')

export const bgUrl = (name: string): string =>
  isBuiltin(name) ? (builtinById(name)?.src ?? '') : `lazeyka-bg://img/${encodeURIComponent(name)}`

export function bgKind(name: string): BgKind {
  if (isBuiltin(name)) return 'image'
  if (/\.(mp4|webm)$/.test(name)) return 'video'
  if (/\.gif$/.test(name) || /-a\.[a-z]+$/.test(name)) return 'animated'
  return 'image'
}

const cache = new Map<string, Promise<string | null>>()
const averages = new Map<string, RGBA>()

const MAX_SIDE = 960

function capture(name: string, src: CanvasImageSource, w: number, h: number): string | null {
  const scale = Math.min(1, MAX_SIDE / Math.max(w, h, 1))
  const c = document.createElement('canvas')
  c.width = Math.max(1, Math.round(w * scale))
  c.height = Math.max(1, Math.round(h * scale))
  const ctx = c.getContext('2d', { willReadFrequently: true })
  if (!ctx) return null
  ctx.drawImage(src, 0, 0, c.width, c.height)
  // Средний цвет кадра — для расчёта читаемости текста поверх обоев.
  const tiny = document.createElement('canvas')
  tiny.width = 8
  tiny.height = 8
  const tctx = tiny.getContext('2d', { willReadFrequently: true })
  if (tctx) {
    tctx.drawImage(c, 0, 0, 8, 8)
    const d = tctx.getImageData(0, 0, 8, 8).data
    let r = 0
    let g = 0
    let b = 0
    for (let i = 0; i < d.length; i += 4) {
      r += d[i]
      g += d[i + 1]
      b += d[i + 2]
    }
    const n = d.length / 4
    averages.set(name, { r: r / n, g: g / n, b: b / n, a: 1 })
  }
  return c.toDataURL('image/jpeg', 0.82)
}

/** Средний цвет обоев, если кадр уже был снят (иначе null). */
export const getAverage = (name: string): RGBA | null => averages.get(name) ?? null

/**
 * Неподвижный первый кадр файла (data URL): для паузы анимации, превью-плитки,
 * предпросмотра и подбора палитры. Кэшируется; временный элемент освобождается.
 */
export function getPoster(name: string): Promise<string | null> {
  const hit = cache.get(name)
  if (hit) return hit
  const p = (async (): Promise<string | null> => {
    try {
      if (bgKind(name) === 'video') {
        const v = document.createElement('video')
        v.crossOrigin = 'anonymous'
        v.muted = true
        v.preload = 'auto'
        v.src = bgUrl(name)
        await new Promise<void>((res, rej) => {
          v.onloadeddata = (): void => res()
          v.onerror = (): void => rej(new Error('video'))
        })
        const out = capture(name, v, v.videoWidth, v.videoHeight)
        v.removeAttribute('src')
        v.load()
        return out
      }
      const img = new Image()
      if (!isBuiltin(name)) img.crossOrigin = 'anonymous'
      img.src = bgUrl(name)
      await img.decode()
      return capture(name, img, img.naturalWidth, img.naturalHeight)
    } catch {
      return null
    }
  })()
  cache.set(name, p)
  return p
}
