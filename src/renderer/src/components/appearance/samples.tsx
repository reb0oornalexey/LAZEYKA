import React from 'react'
import { CircleCheckIcon, Gamepad2, Home, InfoIcon, OctagonXIcon, Settings2, Shield, TriangleAlertIcon } from 'lucide-react'
import { Button } from '@renderer/components/ui/button'
import { Input } from '@renderer/components/ui/input'
import { Switch } from '@renderer/components/ui/switch'
import { Badge } from '@renderer/components/ui/badge'
import { BrandText, NavItem } from '@renderer/components/app-chrome'
import type { WsState } from '@renderer/lib/appearance/workshop'
import { cn } from '@renderer/lib/utils'

/**
 * Живые образцы компонентов для «Тонкой настройки»: настоящие Button/Input/Switch/Badge/пункт меню,
 * которые читают те же CSS-переменные, что и вся программа. Части образца помечены data-slot-key —
 * нажатие на них выделяет соответствующий слот цвета (onPick). Состояние (наведение, фокус…)
 * показывается принудительно теми же переменными, что использует компонент в этом состоянии.
 */

export interface SampleProps {
  /** Крупный образец мастерской (иначе — миниатюра для плитки галереи). */
  big?: boolean
  state?: WsState
  variant?: string | null
  onPick?: (key: string, variant?: string) => void
}

const slot = (key: string, variant?: string): Record<string, string> =>
  variant ? { 'data-slot-key': key, 'data-variant': variant } : { 'data-slot-key': key }

/** Обёртка, которая превращает нажатие по части образца в выбор слота и гасит обычное действие элемента. */
export const PickArea: React.FC<{ onPick?: SampleProps['onPick']; className?: string; children: React.ReactNode }> = ({ onPick, className, children }) => {
  const handle = (e: React.SyntheticEvent): void => {
    if (!onPick) return
    const el = (e.target as Element).closest<HTMLElement>('[data-slot-key]')
    if (!el) return
    e.preventDefault()
    e.stopPropagation()
    if (e.type === 'click') {
      const v = el.closest<HTMLElement>('[data-variant]')?.dataset.variant
      onPick(el.dataset.slotKey ?? '', v)
    }
  }
  return (
    <div
      className={cn(onPick ? '[&_[data-slot-key]]:cursor-pointer' : 'pointer-events-none select-none', className)}
      onPointerDownCapture={handle}
      onMouseDownCapture={handle}
      onClickCapture={handle}
      aria-hidden={onPick ? undefined : true}
    >
      {children}
    </div>
  )
}

/** Подпись под вариантом в крупном образце: выбранный — акцентом с точкой. */
const VariantCaption: React.FC<{ on: boolean; children: React.ReactNode }> = ({ on, children }) => (
  <span className={cn('flex items-center justify-center gap-1 text-[10px] font-semibold transition-colors', on ? 'text-primary' : 'text-muted-foreground')}>
    <span className={cn('size-1.5 rounded-full transition-all', on ? 'bg-primary' : 'scale-0 bg-transparent')} />
    {children}
  </span>
)

// ---- Кнопки ----------------------------------------------------------------------

const BTN = [
  ['primary', 'default', 'Основная'],
  ['secondary', 'secondary', 'Вторичная'],
  ['outline', 'outline', 'Контурная'],
  ['destructive', 'destructive', 'Опасная'],
  ['ghost', 'ghost', 'Прозрачная']
] as const

const forcedBtn = (v: string, state: WsState): string => {
  if (state === 'hover' || state === 'active')
    return cn(
      v === 'outline' ? '!border-[color:var(--btn-outline-hover-border)] !bg-[color:var(--btn-outline-hover)]' : `!bg-[color:var(--btn-${v}-hover)]`,
      state === 'active' && 'brightness-90 scale-[0.97]'
    )
  if (state === 'focus') return 'ring-2 ring-[color:var(--ring)] ring-offset-2 ring-offset-card'
  return ''
}

export const ButtonsSample: React.FC<SampleProps> = ({ big, state = 'normal', variant, onPick }) => {
  if (!big)
    return (
      <div className="flex flex-wrap items-center justify-center gap-1.5">
        <Button size="xs">Основная</Button>
        <Button size="xs" variant="outline">
          Контур
        </Button>
        <Button size="xs" variant="destructive">
          Удалить
        </Button>
      </div>
    )
  const bgKey = (v: string): string => (state === 'hover' || state === 'active' ? `btn-${v}-hover` : state === 'focus' ? 'ring' : `btn-${v}-bg`)
  return (
    <PickArea onPick={onPick} className="grid grid-cols-[repeat(auto-fit,minmax(104px,1fr))] gap-x-2 gap-y-3">
      {BTN.map(([v, cv, label]) => (
        <div key={v} className="flex flex-col items-stretch gap-1.5" {...slot(bgKey(v), v)}>
          <span className={cn('flex rounded-xl transition-opacity', variant && variant !== v && 'opacity-80')}>
            <Button variant={cv} disabled={state === 'disabled'} tabIndex={-1} className={cn('w-full', forcedBtn(v, state))}>
              <span {...slot(`btn-${v}-fg`, v)}>{label}</span>
            </Button>
          </span>
          <VariantCaption on={variant === v}>{label}</VariantCaption>
        </div>
      ))}
    </PickArea>
  )
}

// ---- Поля ввода ------------------------------------------------------------------

const focusCls = '!border-[color:var(--input-focus-border)] ring-2 ring-[color:var(--input-focus-ring)]'

export const InputsSample: React.FC<SampleProps> = ({ big, state = 'normal', onPick }) => {
  if (!big)
    return (
      <div className="w-full max-w-[180px] space-y-1.5">
        <Input placeholder="Поиск" className="h-7 text-xs" tabIndex={-1} readOnly />
        <Input defaultValue="example.com" className={cn('h-7 text-xs', focusCls)} tabIndex={-1} readOnly />
      </div>
    )
  const bgKey = state === 'focus' ? 'input-focus-border' : 'input-bg'
  return (
    <PickArea onPick={onPick} className="mx-auto grid w-full max-w-[460px] gap-2.5 @lg:grid-cols-2">
      <label className="space-y-1" {...slot(bgKey)}>
        <span className="block text-[11px] font-semibold text-foreground/90">Адрес сервера</span>
        <Input placeholder="Например, 1.1.1.1" tabIndex={-1} readOnly disabled={state === 'disabled'} className={cn(state === 'focus' && focusCls)} />
      </label>
      <label className="space-y-1" {...slot(state === 'focus' ? 'input-focus-ring' : 'input-border')}>
        <span className="block text-[11px] font-semibold text-foreground/90">Название</span>
        <Input defaultValue="Мой DNS" tabIndex={-1} readOnly disabled={state === 'disabled'} className={cn(state === 'focus' && focusCls)} />
      </label>
    </PickArea>
  )
}

// ---- Переключатели ---------------------------------------------------------------

export const SwitchesSample: React.FC<SampleProps> = ({ big, state = 'normal', onPick }) => {
  if (!big)
    return (
      <div className="flex items-center gap-3">
        <Switch checked tabIndex={-1} />
        <Switch checked={false} tabIndex={-1} />
      </div>
    )
  const dis = state === 'disabled'
  return (
    <PickArea onPick={onPick} className="mx-auto grid w-full max-w-[420px] gap-2">
      {[
        ['switch-on', 'Обход блокировок', 'Включено', true],
        ['switch-off', 'Запуск вместе с системой', 'Выключено', false]
      ].map(([k, t, sub, on]) => (
        <div key={k as string} className="flex items-center gap-3 rounded-xl border border-border bg-card px-3 py-2.5" {...slot(k as string)}>
          <div className="min-w-0 flex-1">
            <div className="truncate text-[13px] font-medium">{t}</div>
            <div className="text-[11px] text-muted-foreground">{sub}</div>
          </div>
          <Switch checked={on as boolean} disabled={dis} tabIndex={-1} className="scale-125" />
        </div>
      ))}
    </PickArea>
  )
}

// ---- Уведомления ----------------------------------------------------------------

const TOASTS = [
  ['success', 'Успех', 'Настройки сохранены', CircleCheckIcon],
  ['error', 'Ошибка', 'Не удалось подключиться', OctagonXIcon],
  ['info', 'Инфо', 'Доступно обновление', InfoIcon],
  ['warning', 'Внимание', 'Низкая скорость', TriangleAlertIcon],
  ['normal', 'Обычное', 'Профиль переключён', Shield]
] as const

const ToastBox: React.FC<{ kind: string; text: string; icon: React.ComponentType<{ className?: string }>; small?: boolean; dim?: boolean }> = ({
  kind,
  text,
  icon: Icon,
  small,
  dim
}) => (
  <div
    {...slot(`toast-${kind}-bg`, kind)}
    className={cn('flex items-center gap-2 border shadow-sm transition-opacity', small ? 'px-2 py-1 text-[10px]' : 'px-3 py-2 text-[13px]', dim && 'opacity-75')}
    style={{
      background: `var(--toast-${kind}-bg)`,
      color: `var(--toast-${kind}-fg)`,
      borderColor: `var(--toast-${kind}-border)`,
      borderRadius: 'var(--radius)'
    }}
  >
    <Icon className={cn('shrink-0', small ? 'size-3' : 'size-4')} />
    <span {...slot(`toast-${kind}-fg`, kind)} className="truncate">
      {text}
    </span>
  </div>
)

export const ToastsSample: React.FC<SampleProps> = ({ big, variant, onPick }) => {
  if (!big)
    return (
      <div className="w-full max-w-[180px] space-y-1">
        <ToastBox kind="success" text="Сохранено" icon={CircleCheckIcon} small />
        <ToastBox kind="error" text="Нет связи" icon={OctagonXIcon} small />
      </div>
    )
  return (
    <PickArea onPick={onPick} className="mx-auto grid w-full max-w-[520px] gap-1.5 @lg:grid-cols-2">
      {TOASTS.map(([k, , text, icon]) => (
        <div key={k} className={cn('rounded-[calc(var(--radius)+3px)] p-[2px] transition-shadow', variant === k && 'ring-2 ring-primary/60')}>
          <ToastBox kind={k} text={text} icon={icon} dim={!!variant && variant !== k} />
        </div>
      ))}
    </PickArea>
  )
}

// ---- Меню ------------------------------------------------------------------------

export const MenuSample: React.FC<SampleProps> = ({ big, onPick }) => {
  if (!big)
    return (
      <div className="w-[150px] space-y-0.5 rounded-lg border border-sidebar-border bg-sidebar p-1.5 pl-2.5">
        <div className="relative flex h-6 items-center gap-1.5 rounded-md bg-sidebar-accent px-1.5 text-[10px] font-medium text-sidebar-accent-foreground">
          <span className="absolute top-1.5 bottom-1.5 -left-2 w-[2px] rounded-r-full bg-sidebar-primary" />
          <Home className="size-3 text-sidebar-primary" /> Главная
        </div>
        <div className="flex h-6 items-center gap-1.5 px-1.5 text-[10px] font-medium text-sidebar-foreground/80">
          <Shield className="size-3" /> Zapret
        </div>
      </div>
    )
  return (
    <PickArea onPick={onPick} className="mx-auto w-full max-w-[260px]">
      <div {...slot('sidebar-border')} className="space-y-0.5 rounded-xl border border-sidebar-border bg-sidebar p-2 pl-3 text-sidebar-foreground shadow-sm">
        <div className="px-2 pt-0.5 pb-2">
          <BrandText />
        </div>
        <div {...slot('sidebar-accent')}>
          <NavItem icon={Home} label="Главная" active />
        </div>
        <div {...slot('sidebar-foreground')}>
          <NavItem icon={Shield} label="Zapret" active={false} />
        </div>
        <div {...slot('sidebar-foreground')}>
          <NavItem icon={Gamepad2} label="Игры" active={false} />
        </div>
        <div className="my-1.5 h-px bg-sidebar-border" {...slot('sidebar-border')} />
        <div {...slot('sidebar-foreground')}>
          <NavItem icon={Settings2} label="Настройки" active={false} />
        </div>
      </div>
    </PickArea>
  )
}

// ---- Значки ----------------------------------------------------------------------

export const BadgesSample: React.FC<SampleProps> = ({ big, variant, onPick }) => {
  const list = [
    ['badge', 'default', 'Обычный', 'Zapret'],
    ['secondary', 'secondary', 'Вторичный', 'Бета'],
    ['danger', 'destructive', 'Ошибка', 'Нет связи']
  ] as const
  const pre = (id: string): string => (id === 'badge' ? 'badge' : `badge-${id}`)
  if (!big)
    return (
      <div className="flex flex-wrap items-center justify-center gap-1.5">
        {list.map(([id, v, , t]) => (
          <Badge key={id} variant={v}>
            {t}
          </Badge>
        ))}
      </div>
    )
  return (
    <PickArea onPick={onPick} className="flex flex-wrap items-start justify-center gap-x-5 gap-y-3">
      {list.map(([id, v, label, t]) => (
        <div key={id} className="flex flex-col items-center gap-1.5" {...slot(`${pre(id)}-bg`, id)}>
          <Badge variant={v} className="scale-125">
            <span {...slot(`${pre(id)}-fg`, id)}>{t}</span>
          </Badge>
          <span className="h-1" />
          <VariantCaption on={variant === id}>{label}</VariantCaption>
        </div>
      ))}
    </PickArea>
  )
}

// ---- Полоса прокрутки -----------------------------------------------------------

const HOSTS = ['discord.com', 'youtube.com', 'twitch.tv', 'telegram.org', 'steam.com', 'github.com', 'x.com', 'reddit.com']

export const ScrollSample: React.FC<SampleProps> = ({ big, state = 'normal', onPick }) => {
  const hover = state === 'hover' ? ({ '--scrollbar-thumb': 'var(--scrollbar-thumb-hover)' } as React.CSSProperties) : undefined
  if (!big)
    return (
      <div className="custom-scrollbar h-[64px] w-[150px] overflow-y-scroll rounded-lg border border-border bg-card/60 pr-0.5">
        {HOSTS.slice(0, 6).map((h) => (
          <div key={h} className="truncate px-2 py-0.5 text-[10px]">
            {h}
          </div>
        ))}
      </div>
    )
  return (
    <PickArea onPick={onPick} className="mx-auto w-full max-w-[300px]">
      <div
        {...slot(state === 'hover' ? 'scrollbar-thumb-hover' : 'scrollbar-thumb')}
        style={hover}
        className="custom-scrollbar h-[132px] overflow-y-scroll rounded-xl border border-border bg-card pr-0.5"
      >
        {HOSTS.map((h, i) => (
          <div key={h} className="flex items-center justify-between gap-2 px-3 py-1.5 text-xs">
            <span className="truncate">{h}</span>
            <span className="font-mono text-[10px] text-muted-foreground">{(i + 2) * 13} мс</span>
          </div>
        ))}
      </div>
      <p className="mt-1.5 text-center text-[10.5px] text-muted-foreground">Нажмите на список — выделится ползунок, ниже есть цвет дорожки</p>
    </PickArea>
  )
}

// ---- Поверхности -----------------------------------------------------------------

export const SurfacesSample: React.FC<SampleProps> = ({ big, onPick }) => {
  if (!big)
    return (
      <div className="w-[150px] rounded-lg border border-border bg-popover p-1 text-[10px] text-popover-foreground shadow-md">
        <div className="rounded px-1.5 py-0.5">Открыть</div>
        <div className="rounded bg-accent px-1.5 py-0.5">Под курсором</div>
        <div className="mt-0.5 rounded bg-muted px-1.5 py-0.5 text-muted-foreground">Приглушённый</div>
      </div>
    )
  return (
    <PickArea onPick={onPick} className="mx-auto grid w-full max-w-[460px] items-start gap-3 @lg:grid-cols-[1fr_auto]">
      <div {...slot('popover')} className="rounded-xl border border-border bg-popover p-1.5 text-[13px] text-popover-foreground shadow-lg">
        <div className="rounded-lg px-2.5 py-1.5">Открыть</div>
        <div {...slot('accent')} className="rounded-lg bg-accent px-2.5 py-1.5">
          Пункт под курсором
        </div>
        <div className="my-1 h-px bg-border" />
        <div {...slot('muted')} className="rounded-lg bg-muted px-2.5 py-1.5 text-xs text-muted-foreground">
          Приглушённый фон
        </div>
        <div {...slot('secondary')} className="mt-1 rounded-lg bg-secondary px-2.5 py-1.5 text-xs">
          Вторичная поверхность
        </div>
      </div>
      <div className="flex flex-col items-center gap-1.5 pt-1" {...slot('ring')}>
        <span className="rounded-xl ring-2 ring-[color:var(--ring)] ring-offset-2 ring-offset-card">
          <Button size="sm" variant="outline" tabIndex={-1}>
            В фокусе
          </Button>
        </span>
        <span className="text-[10px] text-muted-foreground">Рамка фокуса</span>
      </div>
    </PickArea>
  )
}

export const SAMPLES: Record<string, React.FC<SampleProps>> = {
  'adv-buttons': ButtonsSample,
  'adv-inputs': InputsSample,
  'adv-switches': SwitchesSample,
  'adv-toasts': ToastsSample,
  'adv-menu': MenuSample,
  'adv-badges': BadgesSample,
  'adv-scroll': ScrollSample,
  'adv-surfaces': SurfacesSample
}
