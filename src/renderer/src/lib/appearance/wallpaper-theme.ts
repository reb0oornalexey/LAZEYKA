import { toast } from 'sonner'
import { useAppearanceStore } from './store'
import { useUiState } from './ui-state'
import { getPoster, isBuiltin } from './bg-media'
import { builtinById } from './wallpapers'
import { quantize, samplePixels, statsOf } from './palette'
import { generateTheme, type GeneratedTheme } from './theme-gen'
import { WALLPAPER_THEMES } from './wallpaper-themes'

const cache = new Map<string, GeneratedTheme>()

/** Полная тема под обои: готовая (для встроенных) или посчитанная по кадру картинки. */
export async function themeForWallpaper(name: string): Promise<GeneratedTheme> {
  const hit = cache.get(name)
  if (hit) return hit
  const pre = WALLPAPER_THEMES[name]
  if (pre) {
    const t: GeneratedTheme = { ...pre, issues: 0 }
    cache.set(name, t)
    return t
  }
  const poster = await getPoster(name)
  if (!poster) throw new Error('Не удалось прочитать кадр фона')
  const px = await samplePixels(poster, 64)
  if (px.length === 0) throw new Error('Фон слишком прозрачный')
  const stats = statsOf(px)
  const t = generateTheme(quantize(px, 5), { average: stats.average, luminance: stats.luminance, spread: stats.spread })
  cache.set(name, t)
  return t
}

export const wallpaperTitle = (name: string): string => {
  const b = isBuiltin(name) ? builtinById(name) : null
  return b ? b.name : 'Мои обои'
}

/** Применяет подобранную тему одним шагом истории и показывает тост с «Отменить» / «Сохранить как мою тему». */
export async function applyThemeFromWallpaper(name: string): Promise<void> {
  try {
    const t = await themeForWallpaper(name)
    const store = useAppearanceStore.getState()
    store.applyGenerated({ mode: t.mode, tokens: t.tokens, settings: t.settings })
    const title = wallpaperTitle(name)
    toast.success('Тема подобрана', {
      description: `Под фон «${title}». Все цвета проверены на читаемость.`,
      duration: 9000,
      cancel: { label: 'Отменить', onClick: () => useAppearanceStore.getState().undo() },
      action: {
        label: 'Сохранить как мою тему',
        onClick: () => {
          useUiState.getState().openSaver(`Под «${title}»`)
          requestAnimationFrame(() => document.querySelector('[data-ctl="my-themes"]')?.scrollIntoView({ behavior: 'smooth', block: 'center' }))
        }
      }
    })
  } catch (e) {
    toast.error('Не удалось подобрать тему', { description: e instanceof Error ? e.message : String(e) })
  }
}
