/** Режим темы: определяет класс .dark, нативную тему окна и вариант логотипа. */
type AppearanceMode = 'light' | 'dark'
type AppearanceFit = 'cover' | 'contain' | 'tile'
type AppearanceDensity = 'compact' | 'normal' | 'comfortable'
type AppearanceAnimations = 'on' | 'off' | 'auto'

/** Не цветовые настройки оформления + фон. */
interface AppearanceSettings {
  /** Масштаб шрифта интерфейса (0.9–1.25). */
  fontScale: number
  /** id шрифта из списка (onest, system, …, custom). */
  fontFamily: string
  /** Имя своего системного шрифта (для fontFamily = custom). */
  fontCustom: string
  /** Скругление, rem (0–1.5). */
  radius: number
  density: AppearanceDensity
  animations: AppearanceAnimations
  /** Ширина бокового меню, px (180–280). */
  sidebarWidth: number
  /** Имя файла в папке backgrounds (не путь!). Пусто — без картинки. */
  bgImage: string
  bgFit: AppearanceFit
  /** Размытие картинки, px (0–40). */
  bgBlur: number
  /** Затемнение поверх картинки, 0–1. */
  bgDim: number
  /** Яркость картинки (0.5–1.5) и насыщенность (0–2) — только слой фона. */
  bgBrightness: number
  bgSaturation: number
  /** «Стекло»: размытие того, что находится ПОД панелями (дорого для GPU). */
  bgGlass: boolean
  bgDimColor: string
  /** Непрозрачность панелей/карточек при фоне (0.2–1). */
  panelOpacity: number
  /** Градиентный фон вместо сплошного (если нет картинки). */
  bgGradient: boolean
  bgGradientFrom: string
  bgGradientTo: string
  bgGradientAngle: number
  /** Анимировать фон (GIF / анимированный WebP, APNG / видео). */
  bgAnimate: boolean
  /** Ставить анимацию на паузу, когда окно не в фокусе. */
  bgPauseOnBlur: boolean
}

interface CustomAppearanceTheme {
  id: string
  name: string
  mode: AppearanceMode
  /** Полный набор токенов (поверх базового пресета). */
  tokens: Record<string, string>
  settings: AppearanceSettings
}

/** «Как в системе»: смена пресета по светлой/тёмной теме Windows и акцент Windows. */
interface AppearanceSystemOptions {
  follow: boolean
  lightPreset: string
  darkPreset: string
  accent: boolean
}

interface AppearanceConfig {
  version: number
  /** id встроенного пресета ('dark', 'light', 'graphite', …) или id своей темы. */
  presetId: string
  mode: AppearanceMode
  /** Правки токенов поверх выбранного пресета (несохранённые в именованную тему). */
  tokens: Record<string, string>
  settings: AppearanceSettings
  custom: CustomAppearanceTheme[]
  recentColors: string[]
  system: AppearanceSystemOptions
}
