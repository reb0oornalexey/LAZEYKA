import { bgKind, bgUrl, getPoster, isBuiltin } from './bg-media'
import { builtinById } from './wallpapers'

/**
 * Маленькие неподвижные миниатюры фона для плиток тем.
 * Результат — data URL уменьшенного кадра (без objectURL, освобождать нечего).
 * Видео не проигрывается: берётся тот же первый кадр, что снимает bg-media.
 */

/** Ширина миниатюры: плитка ~120–200 px, с запасом на экраны с масштабом 150–200%. */
const THUMB_W = 320
/** Сколько миниатюр держать в памяти (по ~10–20 КБ каждая). */
const CACHE_LIMIT = 48

const cache = new Map<string, Promise<string | null>>()

function toCanvasUrl(src: CanvasImageSource, w: number, h: number): string | null {
  if (!w || !h) return null
  const scale = Math.min(1, THUMB_W / w)
  const c = document.createElement('canvas')
  c.width = Math.max(1, Math.round(w * scale))
  c.height = Math.max(1, Math.round(h * scale))
  const ctx = c.getContext('2d')
  if (!ctx) return null
  ctx.imageSmoothingQuality = 'medium'
  ctx.drawImage(src, 0, 0, c.width, c.height)
  return c.toDataURL('image/jpeg', 0.8)
}

async function fromUrl(url: string, cors: boolean): Promise<string | null> {
  const img = new Image()
  img.decoding = 'async'
  if (cors) img.crossOrigin = 'anonymous'
  img.src = url
  await img.decode()
  const out = toCanvasUrl(img, img.naturalWidth, img.naturalHeight)
  img.src = ''
  return out
}

async function build(name: string): Promise<string | null> {
  try {
    if (isBuiltin(name)) {
      // Встроенные обои и так небольшие (≈60 КБ webp) — отдаём файл как есть.
      return builtinById(name)?.src ?? null
    }
    if (bgKind(name) === 'video') {
      // Первый кадр (общий кэш с галереей обоев), затем уменьшение до размера плитки.
      const poster = await getPoster(name)
      return poster ? await fromUrl(poster, false) : null
    }
    // Картинка или GIF / анимированный WebP: декодируется только первый кадр.
    return await fromUrl(bgUrl(name), true)
  } catch {
    return null
  }
}

/** Миниатюра фона темы (или null: файла нет, не открылся, у видео не снялся кадр). */
export function getThemeThumb(name: string): Promise<string | null> {
  const hit = cache.get(name)
  if (hit) return hit
  const p = build(name)
  cache.set(name, p)
  if (cache.size > CACHE_LIMIT) {
    const first = cache.keys().next().value
    if (first !== undefined) cache.delete(first)
  }
  return p
}
