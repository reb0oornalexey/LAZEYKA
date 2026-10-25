/**
 * Что можно настраивать. Файл — чистые данные, без импортов (его читает
 * scripts/audit-appearance.mjs).
 *
 * Простой режим: ~13 смысловых цветов. Всё остальное считается от них само.
 * Расширенный режим: переопределения по компонентам; пока значение не задано — «авто».
 */

export interface TokenDef {
  key: string
  label: string
}

export interface SimpleColor {
  id: string
  key: string
  label: string
  hint: string
}

export interface SimpleGroup {
  id: string
  title: string
  colors: SimpleColor[]
}

export const SIMPLE_GROUPS: SimpleGroup[] = [
  {
    id: 'base',
    title: 'Основа',
    colors: [
      { id: 'accent', key: 'primary', label: 'Акцент', hint: 'Кнопки, активный пункт меню, переключатели, ссылки, фокус' },
      { id: 'canvas', key: 'background', label: 'Фон приложения', hint: 'Виден, когда нет обоев' },
      { id: 'panels', key: 'card', label: 'Панели', hint: 'Карточки и блоки' },
      { id: 'sidebar', key: 'sidebar', label: 'Боковое меню', hint: 'Фон меню слева' },
      { id: 'borders', key: 'border', label: 'Рамки', hint: 'Границы карточек и разделители' }
    ]
  },
  {
    id: 'text',
    title: 'Текст',
    colors: [
      { id: 'text-header', key: 'text-header', label: 'Шапка', hint: '«LAZEYKA» и название раздела сверху' },
      { id: 'text-title', key: 'text-title', label: 'Заголовки', hint: 'Крупные заголовки на странице и в карточках' },
      { id: 'text-body', key: 'foreground', label: 'Основной текст', hint: 'Обычный текст, подписи полей, вторичные кнопки' },
      { id: 'text-muted', key: 'muted-foreground', label: 'Подписи', hint: 'Пояснения и подсказки мелким шрифтом' }
    ]
  },
  {
    id: 'status',
    title: 'Статусы',
    colors: [
      { id: 'st-ok', key: 'success', label: 'Успех', hint: 'Включено, готово, зелёные метки' },
      { id: 'st-err', key: 'destructive', label: 'Ошибка', hint: 'Ошибки и опасные действия' },
      { id: 'st-warn', key: 'warning', label: 'Внимание', hint: 'Предупреждения' },
      { id: 'st-info', key: 'info', label: 'Инфо', hint: 'Информационные сообщения' }
    ]
  }
]

export interface AdvancedGroup {
  id: string
  title: string
  description: string
  blocks: { title?: string; tokens: TokenDef[] }[]
}

const t = (key: string, label: string): TokenDef => ({ key, label })
const btn = (v: string, extra: TokenDef[] = []): TokenDef[] => [
  t(`btn-${v}-bg`, 'Фон'),
  t(`btn-${v}-fg`, 'Текст'),
  t(`btn-${v}-hover`, 'При наведении'),
  t(`btn-${v}-border`, 'Рамка'),
  ...extra
]
const toast = (v: string): TokenDef[] => [t(`toast-${v}-bg`, 'Фон'), t(`toast-${v}-fg`, 'Текст'), t(`toast-${v}-border`, 'Рамка')]

export const ADVANCED_GROUPS: AdvancedGroup[] = [
  {
    id: 'adv-buttons',
    title: 'Кнопки',
    description: 'Каждый вариант отдельно',
    blocks: [
      { title: 'Основная', tokens: btn('primary') },
      { title: 'Вторичная', tokens: btn('secondary') },
      { title: 'Контурная', tokens: btn('outline', [t('btn-outline-hover-border', 'Рамка при наведении')]) },
      { title: 'Опасная', tokens: btn('destructive') },
      { title: 'Прозрачная', tokens: btn('ghost') }
    ]
  },
  {
    id: 'adv-inputs',
    title: 'Поля ввода',
    description: 'Текстовые поля',
    blocks: [
      {
        tokens: [
          t('input-bg', 'Фон поля'),
          t('input-border', 'Рамка'),
          t('input-focus-border', 'Рамка в фокусе'),
          t('input-focus-ring', 'Свечение в фокусе')
        ]
      }
    ]
  },
  {
    id: 'adv-switches',
    title: 'Переключатели',
    description: 'Цвета включённого и выключенного',
    blocks: [
      {
        tokens: [
          t('switch-on', 'Включён — дорожка'),
          t('switch-thumb-on', 'Включён — ползунок'),
          t('switch-off', 'Выключен — дорожка'),
          t('switch-thumb-off', 'Выключен — ползунок')
        ]
      }
    ]
  },
  {
    id: 'adv-toasts',
    title: 'Уведомления',
    description: 'Всплывающие сообщения всех типов',
    blocks: [
      { title: 'Обычное', tokens: toast('normal') },
      { title: 'Успех', tokens: toast('success') },
      { title: 'Ошибка', tokens: toast('error') },
      { title: 'Информация', tokens: toast('info') },
      { title: 'Предупреждение', tokens: toast('warning') }
    ]
  },
  {
    id: 'adv-menu',
    title: 'Меню',
    description: 'Боковое меню подробнее',
    blocks: [
      {
        tokens: [
          t('sidebar-foreground', 'Текст пунктов'),
          t('sidebar-accent', 'Активный пункт — фон'),
          t('sidebar-accent-foreground', 'Активный пункт — текст'),
          t('sidebar-primary', 'Полоска активного пункта'),
          t('sidebar-border', 'Линии меню')
        ]
      }
    ]
  },
  {
    id: 'adv-badges',
    title: 'Значки',
    description: 'Небольшие метки',
    blocks: [
      { title: 'Обычный', tokens: [t('badge-bg', 'Фон'), t('badge-fg', 'Текст'), t('badge-border', 'Рамка')] },
      { title: 'Вторичный', tokens: [t('badge-secondary-bg', 'Фон'), t('badge-secondary-fg', 'Текст'), t('badge-secondary-border', 'Рамка')] },
      { title: 'Ошибка', tokens: [t('badge-danger-bg', 'Фон'), t('badge-danger-fg', 'Текст'), t('badge-danger-border', 'Рамка')] }
    ]
  },
  {
    id: 'adv-scroll',
    title: 'Полоса прокрутки',
    description: 'Скроллбар',
    blocks: [
      {
        tokens: [
          t('scrollbar-thumb', 'Ползунок'),
          t('scrollbar-thumb-hover', 'Ползунок при наведении'),
          t('scrollbar-track', 'Дорожка')
        ]
      }
    ]
  },
  {
    id: 'adv-surfaces',
    title: 'Прочие поверхности',
    description: 'Меню и окна, приглушённый фон, наведение',
    blocks: [
      {
        tokens: [
          t('popover', 'Всплывающие окна'),
          t('muted', 'Приглушённый фон'),
          t('secondary', 'Вторичная поверхность'),
          t('accent', 'Наведение на элементы'),
          t('ring', 'Рамка фокуса')
        ]
      }
    ]
  }
]

/** Ключи, которые есть в пресетах, но в интерфейсе не показываются (считаются сами). */
export const HIDDEN_KEYS: string[] = [
  'primary-foreground', 'card-foreground', 'popover-foreground', 'secondary-foreground', 'accent-foreground',
  'destructive-foreground', 'success-foreground', 'warning-foreground', 'sidebar-primary', 'sidebar-primary-foreground',
  'sidebar-ring', 'stroke', 'input', 'stroke-power-on', 'stroke-power-off', 'gradient-start-power-on',
  'gradient-end-power-on', 'gradient-start-power-off', 'gradient-end-power-off', 'profile-active',
  'stroke-profile-active', 'profile-inactive', 'stroke-profile-inactive', 'chart-1', 'chart-2', 'chart-3',
  'chart-4', 'chart-5', 'app-canvas', 'st-ok', 'st-ok-text', 'st-err', 'st-err-text', 'st-warn', 'st-warn-text',
  'st-info', 'st-info-text'
]

const exposed = (): string[] => [
  ...SIMPLE_GROUPS.flatMap((g) => g.colors.map((c) => c.key)),
  ...ADVANCED_GROUPS.flatMap((g) => g.blocks.flatMap((b) => b.tokens.map((x) => x.key)))
]

/** Все ключи, которые разрешено хранить и применять (чужие/устаревшие отбрасываются). */
export const VALID_KEYS: ReadonlySet<string> = new Set([...exposed(), ...HIDDEN_KEYS])
export const EXPOSED_KEYS: string[] = exposed()

export const TOKEN_LABELS: ReadonlyMap<string, string> = new Map([
  ...SIMPLE_GROUPS.flatMap((g) => g.colors.map((c) => [c.key, c.label] as const)),
  ...ADVANCED_GROUPS.flatMap((g) => g.blocks.flatMap((b) => b.tokens.map((x) => [x.key, x.label] as const)))
])
