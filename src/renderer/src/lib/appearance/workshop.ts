/**
 * «Тонкая настройка» в виде мастерских компонентов: какие варианты у компонента, какие у него
 * «слоты» цвета и как они сгруппированы по смыслу. Чистые данные + поиск слота по ключу.
 * Ключи цветов — те же, что в ADVANCED_GROUPS (tokens.ts); здесь только раскладка для интерфейса.
 */

export type WsState = 'normal' | 'hover' | 'active' | 'disabled' | 'focus'

export const WS_STATE_LABEL: Record<WsState, string> = {
  normal: 'Обычное',
  hover: 'Наведение',
  active: 'Нажатие',
  disabled: 'Отключено',
  focus: 'Фокус'
}

export interface WsSlot {
  key: string
  label: string
  hint?: string
  /** Общий цвет, который используют и другие компоненты (в счётчик «изменено» не входит). */
  shared?: boolean
}

export interface WsGroup {
  title: string
  /** Какое состояние образца показать, когда выделен слот из этой группы. */
  state?: WsState
  slots: WsSlot[]
}

export interface WsVariant {
  id: string
  label: string
  groups: WsGroup[]
}

export interface WsComponent {
  /** id из ADVANCED_GROUPS — на него ссылаются пары читаемости (ContrastPair.group). */
  id: string
  title: string
  description: string
  states: WsState[]
  variants: WsVariant[]
}

const s = (key: string, label: string, hint?: string, shared?: boolean): WsSlot => ({ key, label, hint, shared })

const RING = s('ring', 'Рамка фокуса', 'Общая для всех элементов: видна при переходе клавишей Tab', true)

const btn = (v: string, label: string): WsVariant => ({
  id: v,
  label,
  groups: [
    { title: 'Фон', slots: [s(`btn-${v}-bg`, 'Фон')] },
    { title: 'Текст', slots: [s(`btn-${v}-fg`, 'Текст и значок')] },
    {
      title: 'Рамка',
      slots: [s(`btn-${v}-border`, 'Рамка')]
    },
    {
      title: 'Наведение',
      state: 'hover',
      slots: [
        s(`btn-${v}-hover`, 'Фон при наведении'),
        ...(v === 'outline' ? [s('btn-outline-hover-border', 'Рамка при наведении')] : [])
      ]
    },
    { title: 'Фокус', state: 'focus', slots: [RING] }
  ]
})

const toast = (v: string, label: string): WsVariant => ({
  id: v,
  label,
  groups: [
    { title: 'Фон', slots: [s(`toast-${v}-bg`, 'Фон')] },
    { title: 'Текст', slots: [s(`toast-${v}-fg`, 'Текст и значок')] },
    { title: 'Рамка', slots: [s(`toast-${v}-border`, 'Рамка')] }
  ]
})

const badge = (prefix: string, id: string, label: string): WsVariant => ({
  id,
  label,
  groups: [
    { title: 'Фон', slots: [s(`${prefix}-bg`, 'Фон')] },
    { title: 'Текст', slots: [s(`${prefix}-fg`, 'Текст')] },
    { title: 'Рамка', slots: [s(`${prefix}-border`, 'Рамка')] }
  ]
})

const main = (groups: WsGroup[]): WsVariant[] => [{ id: 'main', label: '', groups }]

export const WS_COMPONENTS: WsComponent[] = [
  {
    id: 'adv-buttons',
    title: 'Кнопки',
    description: 'Пять вариантов, у каждого свои цвета',
    states: ['normal', 'hover', 'active', 'disabled', 'focus'],
    variants: [
      btn('primary', 'Основная'),
      btn('secondary', 'Вторичная'),
      btn('outline', 'Контурная'),
      btn('destructive', 'Опасная'),
      btn('ghost', 'Прозрачная')
    ]
  },
  {
    id: 'adv-inputs',
    title: 'Поля ввода',
    description: 'Текстовые поля и списки',
    states: ['normal', 'focus', 'disabled'],
    variants: main([
      { title: 'Фон', slots: [s('input-bg', 'Фон поля', 'Текст в поле — «Основной текст» на вкладке «Цвета»')] },
      { title: 'Рамка', slots: [s('input-border', 'Рамка')] },
      {
        title: 'Фокус',
        state: 'focus',
        slots: [s('input-focus-border', 'Рамка в фокусе'), s('input-focus-ring', 'Свечение в фокусе')]
      }
    ])
  },
  {
    id: 'adv-switches',
    title: 'Переключатели',
    description: 'Включённый и выключенный',
    states: ['normal', 'disabled'],
    variants: main([
      { title: 'Включён', slots: [s('switch-on', 'Дорожка'), s('switch-thumb-on', 'Ползунок')] },
      { title: 'Выключен', slots: [s('switch-off', 'Дорожка'), s('switch-thumb-off', 'Ползунок')] }
    ])
  },
  {
    id: 'adv-toasts',
    title: 'Уведомления',
    description: 'Всплывающие сообщения пяти типов',
    states: ['normal'],
    variants: [
      toast('normal', 'Обычное'),
      toast('success', 'Успех'),
      toast('error', 'Ошибка'),
      toast('info', 'Инфо'),
      toast('warning', 'Внимание')
    ]
  },
  {
    id: 'adv-menu',
    title: 'Меню',
    description: 'Боковое меню программы',
    states: ['normal'],
    variants: main([
      { title: 'Пункты', slots: [s('sidebar-foreground', 'Текст пунктов')] },
      {
        title: 'Активный пункт',
        slots: [s('sidebar-accent', 'Фон'), s('sidebar-accent-foreground', 'Текст'), s('sidebar-primary', 'Полоска слева')]
      },
      { title: 'Линии', slots: [s('sidebar-border', 'Разделители и край меню')] }
    ])
  },
  {
    id: 'adv-badges',
    title: 'Значки',
    description: 'Небольшие метки рядом с заголовками',
    states: ['normal'],
    variants: [badge('badge', 'badge', 'Обычный'), badge('badge-secondary', 'secondary', 'Вторичный'), badge('badge-danger', 'danger', 'Ошибка')]
  },
  {
    id: 'adv-scroll',
    title: 'Полоса прокрутки',
    description: 'Ползунок и дорожка',
    states: ['normal', 'hover'],
    variants: main([
      { title: 'Ползунок', slots: [s('scrollbar-thumb', 'Ползунок')] },
      { title: 'Наведение', state: 'hover', slots: [s('scrollbar-thumb-hover', 'Ползунок при наведении')] },
      { title: 'Дорожка', slots: [s('scrollbar-track', 'Дорожка')] }
    ])
  },
  {
    id: 'adv-surfaces',
    title: 'Поверхности',
    description: 'Всплывающие окна, приглушённый фон, наведение, фокус',
    states: ['normal'],
    variants: main([
      { title: 'Окна и меню', slots: [s('popover', 'Фон всплывающих окон')] },
      { title: 'Наведение', slots: [s('accent', 'Пункт под курсором')] },
      { title: 'Фоны', slots: [s('muted', 'Приглушённый фон'), s('secondary', 'Вторичная поверхность')] },
      { title: 'Фокус', slots: [s('ring', 'Рамка фокуса', 'Видна при переходе клавишей Tab по кнопкам и полям')] }
    ])
  }
]

export const wsComponent = (id: string | null): WsComponent | undefined => WS_COMPONENTS.find((c) => c.id === id)

/** Собственные ключи компонента (без общих) — для счётчика «изменено» и «Сбросить компонент». */
export function ownKeys(c: WsComponent): string[] {
  const out: string[] = []
  for (const v of c.variants) for (const g of v.groups) for (const sl of g.slots) if (!sl.shared && !out.includes(sl.key)) out.push(sl.key)
  return out
}

/** Где искать ключ: первый компонент, где он свой (не общий). */
export function locateSlot(key: string): { comp: string; variant: string } | null {
  for (const c of WS_COMPONENTS)
    for (const v of c.variants) for (const g of v.groups) if (g.slots.some((sl) => sl.key === key && !sl.shared)) return { comp: c.id, variant: v.id }
  return null
}

/** Вариант компонента, где есть ключ (для общих — первый вариант). */
export function variantOfKey(comp: string, key: string): string {
  const c = wsComponent(comp)
  if (!c) return 'main'
  for (const v of c.variants) for (const g of v.groups) if (g.slots.some((sl) => sl.key === key)) return v.id
  return c.variants[0].id
}

/** Группа, в которой лежит слот (чтобы показать нужное состояние образца). */
export function groupOfSlot(comp: string, variant: string, key: string): WsGroup | undefined {
  const v = wsComponent(comp)?.variants.find((x) => x.id === variant)
  return v?.groups.find((g) => g.slots.some((sl) => sl.key === key))
}
