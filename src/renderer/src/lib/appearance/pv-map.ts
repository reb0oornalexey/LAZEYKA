/**
 * Что можно настроить, нажав на элемент предпросмотра. Файл — чистые данные (его читает
 * scripts/audit-appearance.mjs). Элемент помечается data-pv="<id>"; ищется ближайший предок.
 * container — фон/рамка (под ним лежит другой контент), leaf — сам текст или контрол.
 */
export interface PvProp {
  key: string
  name: string
}
export interface PvGroup {
  label: string
  kind: 'container' | 'leaf'
  props: PvProp[]
}

const p = (key: string, name: string): PvProp => ({ key, name })
const btn = (v: string, label: string, extra: PvProp[] = []): PvGroup => ({
  label: `Кнопка · ${label}`,
  kind: 'leaf',
  props: [p(`btn-${v}-bg`, 'Фон'), p(`btn-${v}-fg`, 'Текст'), p(`btn-${v}-border`, 'Рамка'), p(`btn-${v}-hover`, 'При наведении'), ...extra]
})
const badge = (v: string, label: string): PvGroup => ({
  label: `Значок · ${label}`,
  kind: 'leaf',
  props: [p(`${v}-bg`, 'Фон'), p(`${v}-fg`, 'Текст'), p(`${v}-border`, 'Рамка')]
})
const toast = (v: string, label: string): PvGroup => ({
  label: `Уведомление · ${label}`,
  kind: 'leaf',
  props: [p(`toast-${v}-bg`, 'Фон'), p(`toast-${v}-fg`, 'Текст'), p(`toast-${v}-border`, 'Рамка')]
})
const dot = (key: string, label: string): PvGroup => ({ label, kind: 'leaf', props: [p(key, label)] })

export const PV: Record<string, PvGroup> = {
  page: { label: 'Фон приложения', kind: 'container', props: [p('background', 'Фон приложения')] },
  scroll: { label: 'Полоса прокрутки', kind: 'container', props: [p('scrollbar-thumb', 'Ползунок'), p('scrollbar-thumb-hover', 'При наведении'), p('scrollbar-track', 'Дорожка')] },
  'header-bar': { label: 'Шапка · фон', kind: 'container', props: [p('background', 'Фон шапки (как фон приложения)')] },
  'header-title': { label: 'Шапка', kind: 'leaf', props: [p('text-header', 'Текст шапки')] },
  sidebar: { label: 'Боковое меню', kind: 'container', props: [p('sidebar', 'Фон меню'), p('sidebar-border', 'Линии меню')] },
  nav: { label: 'Меню · пункт', kind: 'leaf', props: [p('sidebar-foreground', 'Текст пунктов'), p('sidebar-accent', 'Фон при наведении')] },
  'nav-active': { label: 'Меню · активный пункт', kind: 'leaf', props: [p('sidebar-accent', 'Фон'), p('sidebar-accent-foreground', 'Текст'), p('sidebar-primary', 'Полоска')] },
  card: { label: 'Панели', kind: 'container', props: [p('card', 'Фон панели'), p('border', 'Рамки')] },
  border: { label: 'Рамки', kind: 'container', props: [p('border', 'Цвет рамок')] },
  'card-title': { label: 'Заголовки', kind: 'leaf', props: [p('text-title', 'Цвет заголовков')] },
  body: { label: 'Основной текст', kind: 'leaf', props: [p('foreground', 'Основной текст')] },
  muted: { label: 'Подписи', kind: 'leaf', props: [p('muted-foreground', 'Цвет подписей')] },
  'btn-default': btn('primary', 'Основная'),
  'btn-secondary': btn('secondary', 'Вторичная'),
  'btn-outline': btn('outline', 'Контурная', [p('btn-outline-hover-border', 'Рамка при наведении')]),
  'btn-destructive': btn('destructive', 'Опасная'),
  'btn-ghost': btn('ghost', 'Прозрачная'),
  'btn-focus': { label: 'Кнопка · фокус', kind: 'leaf', props: [p('ring', 'Рамка фокуса')] },
  input: { label: 'Поле ввода', kind: 'leaf', props: [p('input-bg', 'Фон'), p('input-border', 'Рамка'), p('foreground', 'Текст'), p('muted-foreground', 'Подсказка')] },
  'input-focus': { label: 'Поле · фокус', kind: 'leaf', props: [p('input-focus-border', 'Рамка в фокусе'), p('input-focus-ring', 'Свечение')] },
  'input-invalid': { label: 'Поле · ошибка', kind: 'leaf', props: [p('destructive', 'Цвет ошибки')] },
  badge: badge('badge', 'обычный'),
  'badge-secondary': badge('badge-secondary', 'вторичный'),
  'badge-danger': badge('badge-danger', 'ошибка'),
  'badge-outline': { label: 'Значок · контур', kind: 'leaf', props: [p('muted-foreground', 'Текст'), p('border', 'Рамка')] },
  'dot-success': dot('success', 'Успех'),
  'dot-error': dot('destructive', 'Ошибка'),
  'dot-warning': dot('warning', 'Внимание'),
  'dot-info': dot('info', 'Инфо'),
  'switch-on': { label: 'Переключатель · вкл', kind: 'leaf', props: [p('switch-on', 'Дорожка'), p('switch-thumb-on', 'Ползунок'), p('primary', 'Акцент')] },
  'switch-off': { label: 'Переключатель · выкл', kind: 'leaf', props: [p('switch-off', 'Дорожка'), p('switch-thumb-off', 'Ползунок')] },
  'surface-popover': { label: 'Всплывающие окна', kind: 'container', props: [p('popover', 'Фон окон и меню')] },
  'surface-accent': { label: 'Наведение на элементы', kind: 'leaf', props: [p('accent', 'Цвет наведения')] },
  'surface-muted': { label: 'Приглушённый фон', kind: 'leaf', props: [p('muted', 'Цвет фона')] },
  'surface-secondary': { label: 'Вторичная поверхность', kind: 'leaf', props: [p('secondary', 'Цвет поверхности')] },
  'toast-normal': toast('normal', 'обычное'),
  'toast-success': toast('success', 'успех'),
  'toast-error': toast('error', 'ошибка'),
  'toast-info': toast('info', 'инфо'),
  'toast-warning': toast('warning', 'внимание')
}
