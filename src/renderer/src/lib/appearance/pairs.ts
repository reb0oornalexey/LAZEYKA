/** Пары «цвет на фоне», за которыми следит проверка читаемости. Чистые данные. */
export interface ContrastPair {
  fg: string
  bg: string
  label: string
  /** Порог WCAG: 4.5 для текста, 3 для крупных элементов и акцентов. */
  min: number
  /** На чём лежит полупрозрачный фон пары (например, кнопка на панели). Без него — на фоне приложения. */
  on?: string
  /** Что исправлять первым в «Исправить всё»: обычно цвет текста; 'bg' — когда текст общий для всего приложения. */
  prefer?: 'bg'
  /** Группа вкладки «Тонкая настройка» (id из ADVANCED_GROUPS). */
  group?: string
}

export const CONTRAST_PAIRS: ContrastPair[] = [
  { fg: 'text-header', bg: 'sidebar', label: 'Шапка на боковом меню', min: 4.5 },
  { fg: 'text-header', bg: 'background', label: 'Шапка на фоне', min: 4.5 },
  { fg: 'text-title', bg: 'card', label: 'Заголовки на панелях', min: 4.5 },
  { fg: 'foreground', bg: 'background', label: 'Основной текст на фоне', min: 4.5 },
  { fg: 'foreground', bg: 'card', label: 'Основной текст на панелях', min: 4.5 },
  { fg: 'muted-foreground', bg: 'background', label: 'Подписи на фоне', min: 4.5 },
  { fg: 'muted-foreground', bg: 'card', label: 'Подписи на панелях', min: 4.5 },
  { fg: 'sidebar-foreground', bg: 'sidebar', label: 'Текст меню', min: 4.5 },
  { fg: 'primary', bg: 'card', label: 'Акцент на панелях', min: 3 },
  { fg: 'success', bg: 'card', label: 'Успех на панелях', min: 3 },
  { fg: 'destructive', bg: 'card', label: 'Ошибка на панелях', min: 3 },
  { fg: 'warning', bg: 'card', label: 'Внимание на панелях', min: 3 },
  { fg: 'info', bg: 'card', label: 'Инфо на панелях', min: 3 }
]

const adv = (group: string, fg: string, bg: string, label: string, extra: Partial<ContrastPair> = {}): ContrastPair => ({
  fg,
  bg,
  label,
  min: 4.5,
  group,
  ...extra
})
// Кнопки и значки: короткие надписи полужирным шрифтом — порог 3:1, как у крупного текста.
// Иначе почти все готовые темы (белый текст на красной кнопке) помечались бы как нечитаемые.
const btn = (v: string, name: string): ContrastPair[] => [
  adv('adv-buttons', `btn-${v}-fg`, `btn-${v}-bg`, `Кнопка «${name}»`, { on: 'card', min: 3 }),
  adv('adv-buttons', `btn-${v}-fg`, `btn-${v}-hover`, `Кнопка «${name}» при наведении`, { on: 'card', min: 3 })
]
const toast = (v: string, name: string): ContrastPair =>
  adv('adv-toasts', `toast-${v}-fg`, `toast-${v}-bg`, `Уведомление «${name}»`, { on: 'background' })

/**
 * Пары для вкладки «Тонкая настройка»: текст на фоне конкретного элемента.
 * Только там, где у элемента есть и текст, и фон. Переключатели и полоса прокрутки
 * текста не содержат — для них пар нет.
 */
export const ADVANCED_PAIRS: ContrastPair[] = [
  ...btn('primary', 'Основная'),
  ...btn('secondary', 'Вторичная'),
  ...btn('outline', 'Контурная'),
  ...btn('destructive', 'Опасная'),
  ...btn('ghost', 'Прозрачная'),
  adv('adv-inputs', 'foreground', 'input-bg', 'Текст в поле', { on: 'card', prefer: 'bg' }),
  toast('normal', 'Обычное'),
  toast('success', 'Успех'),
  toast('error', 'Ошибка'),
  toast('info', 'Информация'),
  toast('warning', 'Предупреждение'),
  adv('adv-menu', 'sidebar-foreground', 'sidebar', 'Пункты меню'),
  adv('adv-menu', 'sidebar-accent-foreground', 'sidebar-accent', 'Активный пункт меню', { on: 'sidebar' }),
  adv('adv-badges', 'badge-fg', 'badge-bg', 'Значок «Обычный»', { on: 'card', min: 3 }),
  adv('adv-badges', 'badge-secondary-fg', 'badge-secondary-bg', 'Значок «Вторичный»', { on: 'card', min: 3 }),
  adv('adv-badges', 'badge-danger-fg', 'badge-danger-bg', 'Значок «Ошибка»', { on: 'card', min: 3 }),
  adv('adv-surfaces', 'foreground', 'popover', 'Текст во всплывающих окнах', { prefer: 'bg' }),
  adv('adv-surfaces', 'foreground', 'accent', 'Текст под курсором', { on: 'popover', prefer: 'bg' }),
  adv('adv-surfaces', 'muted-foreground', 'muted', 'Подписи на приглушённом фоне', { on: 'card', prefer: 'bg' }),
  adv('adv-surfaces', 'foreground', 'secondary', 'Текст на вторичной поверхности', { on: 'card', prefer: 'bg' })
]

/** Поверхности, к которым при обоях применяется прозрачность панелей. */
export const PANEL_SURFACES: string[] = ['background', 'card', 'sidebar', 'muted', 'secondary']
