/** Пары «цвет на фоне», за которыми следит проверка читаемости. Чистые данные. */
export interface ContrastPair {
  fg: string
  bg: string
  label: string
  /** Порог WCAG: 4.5 для текста, 3 для крупных элементов и акцентов. */
  min: number
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

/** Поверхности, к которым при обоях применяется прозрачность панелей. */
export const PANEL_SURFACES: string[] = ['background', 'card', 'sidebar', 'muted', 'secondary']
