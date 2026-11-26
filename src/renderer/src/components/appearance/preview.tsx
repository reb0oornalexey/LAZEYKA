import React, { memo, useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import { CircleCheckIcon, Gamepad2, Home, InfoIcon, OctagonXIcon, Shield, TriangleAlertIcon } from 'lucide-react'
import { useShallow } from 'zustand/react/shallow'
import { Button } from '@renderer/components/ui/button'
import { Input } from '@renderer/components/ui/input'
import { Switch } from '@renderer/components/ui/switch'
import { Badge } from '@renderer/components/ui/badge'
import { Card } from '@renderer/components/ui/card'
import { BrandText, NavItem } from '@renderer/components/app-chrome'
import { cn } from '@renderer/lib/utils'
import { resolveAppearance, type AppearanceSnapshot } from '@renderer/lib/appearance/resolve'
import { useAppearanceStore } from '@renderer/lib/appearance/store'
import { PV } from '@renderer/lib/appearance/pv-map'
import { PvPopover, type PvPopState } from './pv-popover'
import { useUiState } from '@renderer/lib/appearance/ui-state'
import { BackgroundLayer } from './background-layer'

/**
 * Витрина элементов в натуральном масштабе из НАСТОЯЩИХ компонентов (Button, Card, Switch,
 * Input, Badge, пункт меню — те же, что в приложении). Они читают те же CSS-переменные
 * документа, поэтому правка цвета меняет и приложение, и витрину одновременно, без перерисовки
 * React. Переменные задаются прямо на контейнере только в режиме «Сравнить».
 * Уведомления нарисованы той же разметкой и теми же переменными --toast-*, что и в sonner.
 * Блоки: «Основное» (окно, меню, панель), «Элементы», «Сообщения».
 */

/** Метки для общей плавающей подсказки и окна настроек (см. lib/appearance/pv-map.ts). */
const pv = (id: string, act?: boolean): Record<string, string> => (act ? { 'data-pv': id, 'data-pv-act': '' } : { 'data-pv': id })
/** Элементы-«пульты» витрины (показ уведомлений): работают как обычно, настройки не открывают. */
const live = { 'data-pv-live': '' }

const TOAST_ICONS = { success: CircleCheckIcon, error: OctagonXIcon, info: InfoIcon, warning: TriangleAlertIcon, normal: Shield } as const
type ToastKind = keyof typeof TOAST_ICONS
const TOAST_TEXT: Record<ToastKind, string> = {
  success: 'Настройки сохранены',
  error: 'Не удалось подключиться',
  info: 'Доступно обновление',
  warning: 'Низкая скорость',
  normal: 'Обычное сообщение'
}

const ToastMock = memo(function ToastMock({ kind }: { kind: ToastKind }) {
  const Icon = TOAST_ICONS[kind]
  return (
    <div
      {...pv(`toast-${kind}`)}
      className="flex items-center gap-2 border px-3 py-2 text-[13px] shadow-sm"
      style={{
        background: `var(--toast-${kind}-bg)`,
        color: `var(--toast-${kind}-fg)`,
        borderColor: `var(--toast-${kind}-border)`,
        borderRadius: 'var(--radius)'
      }}
    >
      <Icon className="size-4 shrink-0" />
      {TOAST_TEXT[kind]}
    </div>
  )
})

const VARIANTS = ['default', 'secondary', 'outline', 'destructive', 'ghost'] as const
type Variant = (typeof VARIANTS)[number]
const VARIANT_LABEL: Record<Variant, string> = { default: 'Основная', secondary: 'Вторичная', outline: 'Контурная', destructive: 'Опасная', ghost: 'Прозрачная' }
const VARIANT_VAR: Record<Variant, string> = { default: 'primary', secondary: 'secondary', outline: 'outline', destructive: 'destructive', ghost: 'ghost' }

const hoverClass = (v: Variant): string => {
  const x = VARIANT_VAR[v]
  return v === 'outline'
    ? '!bg-[color:var(--btn-outline-hover)] !border-[color:var(--btn-outline-hover-border)]'
    : `!bg-[color:var(--btn-${x}-hover)]`
}

const Muted: React.FC<{ children: React.ReactNode; className?: string }> = ({ children, className }) => (
  <span {...pv('muted')} className={cn('text-xs text-muted-foreground', className)}>
    {children}
  </span>
)

/** Подпись блока витрины («Основное», «Элементы», «Сообщения»). */
const Block: React.FC<{ title: string; children: React.ReactNode }> = ({ title, children }) => (
  <section className="space-y-2">
    <div className="px-0.5 text-[10px] font-semibold tracking-[0.12em] text-muted-foreground uppercase">{title}</div>
    {children}
  </section>
)

/** Подпись строки внутри карточки «Элементы». */
const Row: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <div className="space-y-1.5">
    <Muted className="block text-[11px]">{label}</Muted>
    {children}
  </div>
)

const StatusDots: React.FC = () => (
  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
    {(
      [
        ['success', 'Успех', 'dot-success'],
        ['destructive', 'Ошибка', 'dot-error'],
        ['warning', 'Внимание', 'dot-warning'],
        ['info', 'Инфо', 'dot-info']
      ] as const
    ).map(([k, l, id]) => (
      <span key={k} {...pv(id)} className="flex items-center gap-1">
        <span className="size-2 rounded-full" style={{ background: `var(--${k})` }} />
        <span style={{ color: `var(--${k})` }}>{l}</span>
      </span>
    ))}
  </div>
)

/** «Основное»: шапка окна, фрагмент бокового меню и панель со статусом и переключателем. */
const WindowMock: React.FC<{ compact?: boolean }> = ({ compact }) => {
  const [on, setOn] = useState(true)
  return (
    <div className="overflow-hidden rounded-lg border border-border shadow-sm">
      <div {...pv('header-bar')} className="flex h-10 items-center gap-2 border-b border-border bg-background px-3">
        <span {...pv('header-title')} className="text-sm font-bold text-[color:var(--text-header)]">
          Главная
        </span>
        <span className="ml-auto flex items-center gap-1.5" aria-hidden>
          {[0, 1, 2].map((i) => (
            <span key={i} className="size-2 rounded-full bg-muted-foreground/40" />
          ))}
        </span>
      </div>
      <div className="flex">
        <aside {...pv('sidebar')} className={cn('shrink-0 space-y-0.5 border-r border-sidebar-border bg-sidebar p-2 pl-2.5 text-sidebar-foreground', compact ? 'w-[54px] pl-2' : 'w-[132px]')}>
          {compact ? (
            <div {...pv('header-title')} className="pt-0.5 pb-1.5 text-center text-[13px] font-black text-[color:var(--text-header)]">
              L
            </div>
          ) : (
            <div {...pv('header-title')} className="px-2 pt-0.5 pb-1.5">
              <BrandText />
            </div>
          )}
          <div {...pv('nav-active')}>
            <NavItem icon={Home} label="Главная" active collapsed={compact} />
          </div>
          <div {...pv('nav')}>
            <NavItem icon={Shield} label="Zapret" active={false} collapsed={compact} />
          </div>
          <div {...pv('nav')}>
            <NavItem icon={Gamepad2} label="Игры" active={false} collapsed={compact} />
          </div>
        </aside>
        <div className={cn('min-w-0 flex-1', compact ? 'p-1.5' : 'p-2.5')}>
          <Card className={cn('cyber-card gap-2', compact ? 'p-2.5' : 'p-3')} {...pv('card')}>
            <div className="flex items-center gap-2">
              <span {...pv('card-title')} className="min-w-0 flex-1 truncate text-sm font-semibold text-[color:var(--text-title)]">
                Подключение
              </span>
              {!compact && <Badge {...pv('badge')}>Zapret</Badge>}
            </div>
            <div className="flex items-center justify-between gap-2">
              <div className="min-w-0">
                <div {...pv('body')} className="truncate text-[13px]">
                  Обход блокировок
                </div>
                <Muted className="block truncate text-[11px]">Профиль «Общий»</Muted>
              </div>
              <Switch checked={on} onCheckedChange={setOn} {...pv(on ? 'switch-on' : 'switch-off')} />
            </div>
            <div {...pv('border')} className="h-px bg-border" />
            <div className="flex items-center gap-1.5 text-[11px]" {...pv('dot-success')}>
              <span className="size-2 rounded-full" style={{ background: 'var(--success)' }} />
              <span style={{ color: 'var(--success)' }}>Работает</span>
            </div>
          </Card>
        </div>
      </div>
    </div>
  )
}

const ButtonStates: React.FC = () => (
  <div className="space-y-1.5">
    <div className="grid grid-cols-[4.5rem_repeat(4,minmax(0,1fr))] gap-1 text-[10px]">
      <span />
      {['Обычная', 'Наведение', 'Фокус', 'Отключена'].map((h) => (
        <Muted key={h} className="truncate text-center text-[10px]">
          {h}
        </Muted>
      ))}
    </div>
    {VARIANTS.map((v) => (
      <div key={v} className="grid grid-cols-[4.5rem_repeat(4,minmax(0,1fr))] items-center gap-1">
        <Muted className="truncate text-[10px]">{VARIANT_LABEL[v]}</Muted>
        <Button size="xs" variant={v} {...pv(`btn-${v}`)}>Аа</Button>
        <Button size="xs" variant={v} className={hoverClass(v)} {...pv(`btn-${v}`)}>Аа</Button>
        <Button size="xs" variant={v} className="ring-2 ring-ring" {...pv('btn-focus')}>Аа</Button>
        <span {...pv(`btn-${v}`)} className="inline-flex">
          <Button size="xs" variant={v} disabled className="w-full">Аа</Button>
        </span>
      </div>
    ))}
  </div>
)

/** Всплывающее меню: обычный пункт, пункт под курсором, приглушённый и вторичный фон. */
const MenuMock: React.FC = () => (
  <div {...pv('surface-popover')} className="rounded-lg border border-border bg-popover p-1 text-popover-foreground shadow-md">
    <div className="rounded-md px-2 py-1 text-xs">
      <span {...pv('body')}>Открыть</span>
    </div>
    <div {...pv('surface-accent')} className="rounded-md bg-accent px-2 py-1 text-xs">
      <span {...pv('body')}>Под курсором</span>
    </div>
    <div {...pv('surface-muted')} className="mt-0.5 rounded-md bg-muted px-2 py-1 text-[11px]">
      <span {...pv('muted')}>Приглушённый</span>
    </div>
    <div {...pv('surface-secondary')} className="mt-0.5 rounded-md bg-secondary px-2 py-1 text-[11px]">
      <span {...pv('body')}>Вторичный</span>
    </div>
  </div>
)

/** Список с полосой прокрутки: нажатие на полосу открывает её цвета. */
const ScrollMock: React.FC = () => (
  <div {...pv('page-scroll')} className="custom-scrollbar h-[118px] overflow-y-scroll rounded-lg border border-border pr-0.5">
    {['discord.com', 'youtube.com', 'twitch.tv', 'telegram.org', 'steam.com', 'github.com', 'x.com'].map((h, i) => (
      <div key={h} className="flex items-center justify-between gap-2 px-2 py-1 text-[11px]">
        <span {...pv('body')} className="truncate">
          {h}
        </span>
        <Muted className="text-[10px]">{(i + 2) * 13} мс</Muted>
      </div>
    ))}
  </div>
)

const Elements: React.FC<{ states: boolean; compact?: boolean }> = ({ states, compact }) => (
  <Card className={cn('cyber-card', compact ? 'gap-3 p-2.5' : 'gap-3.5 p-3')} {...pv('card')}>
    <Row label={states ? 'Кнопки: обычная, наведение, фокус, отключена' : 'Кнопки'}>
      {states ? (
        <ButtonStates />
      ) : (
        <div className={cn(compact ? 'grid grid-cols-3 gap-1' : 'flex flex-wrap gap-1.5')}>
          {VARIANTS.map((v) => (
            <Button key={v} size={compact ? 'xs' : 'sm'} variant={v} className={cn(compact && 'h-7 min-w-0 px-1.5 text-[11px]')} {...pv(`btn-${v}`)}>
              <span className="truncate">{VARIANT_LABEL[v]}</span>
            </Button>
          ))}
        </div>
      )}
    </Row>
    <Row label="Поля ввода">
      <div className={cn('grid gap-1.5', compact ? 'grid-cols-1' : 'grid-cols-2')}>
        <Input placeholder="Обычное поле" {...pv('input')} />
        <Input placeholder="В фокусе" className="!border-[color:var(--input-focus-border)] ring-2 ring-[color:var(--input-focus-ring)]" {...pv('input-focus')} />
        {states && (
          <>
            <div {...pv('input')}>
              <Input placeholder="Отключено" disabled />
            </div>
            <Input placeholder="С ошибкой" aria-invalid {...pv('input-invalid')} />
          </>
        )}
      </div>
    </Row>
    <Row label="Переключатели и значки">
      <div className="flex flex-wrap items-center gap-2">
        <Switch checked {...pv('switch-on')} />
        <Switch checked={false} {...pv('switch-off')} />
        <span className="mx-0.5 h-4 w-px bg-border" />
        <Badge {...pv('badge')}>Обычный</Badge>
        <Badge variant="secondary" {...pv('badge-secondary')}>Вторичный</Badge>
        <Badge variant="destructive" {...pv('badge-danger')}>Ошибка</Badge>
        <Badge variant="outline" {...pv('badge-outline')}>Контур</Badge>
      </div>
    </Row>
    <Row label="Всплывающее меню и прокрутка">
      <div className={cn('grid gap-2', compact ? 'grid-cols-1' : 'grid-cols-2')}>
        <MenuMock />
        <ScrollMock />
      </div>
    </Row>
  </Card>
)

const Messages: React.FC<{ compact?: boolean }> = ({ compact }) => (
  <div className="space-y-1.5">
    {(['success', 'error', 'info', 'warning', 'normal'] as const).map((k) => (
      <ToastMock key={k} kind={k} />
    ))}
    <div className="pt-1">
      <StatusDots />
    </div>
    <div className={cn('flex-wrap items-center gap-1 pt-1', compact ? 'grid grid-cols-4' : 'flex')}>
      <span className={cn('mr-1 text-[11px] text-muted-foreground', compact && 'col-span-4')} title="Показать настоящее уведомление программы">
        Показать настоящее уведомление:
      </span>
      {(
        [
          ['success', 'Успех', 'border-st-ok/50 text-st-ok-text hover:bg-st-ok/10'],
          ['error', 'Ошибка', 'border-st-err/50 text-st-err-text hover:bg-st-err/10'],
          ['info', 'Инфо', 'border-st-info/50 text-st-info-text hover:bg-st-info/10'],
          ['warning', 'Внимание', 'border-st-warn/50 text-st-warn-text hover:bg-st-warn/10']
        ] as const
      ).map(([k, l, cls]) => (
        <Button key={k} size="xs" variant="outline" {...live} className={cls} onClick={(e) => { e.stopPropagation(); toast[k](TOAST_TEXT[k]) }}>
          {l}
        </Button>
      ))}
    </div>
  </div>
)

export const Preview: React.FC<{
  /** Не null — режим «Сравнить»: показываем сохранённое состояние поверх текущего. */
  compareWith: AppearanceSnapshot | null
  /** Узкая колонка (окно уже 1280 px): блоки в одну колонку, меньше отступы. */
  compact?: boolean
}> = ({ compareWith, compact }) => {
  const states = useUiState((s) => s.showStates)
  const cfg = useUiState((s) => s.configMode)
  const coach = useUiState((s) => s.coach)
  const settings = useAppearanceStore(useShallow((s) => s.settings))
  const custom = useAppearanceStore((s) => s.custom)
  const wrap = useRef<HTMLDivElement>(null)
  const tip = useRef<HTMLDivElement>(null)
  const hot = useRef<HTMLElement | null>(null)
  const raf = useRef(0)
  const last = useRef<{ x: number; y: number; t: EventTarget | null }>({ x: 0, y: 0, t: null })
  const [pop, setPop] = useState<PvPopState | null>(null)

  const scoped = useMemo(() => (compareWith ? resolveAppearance(compareWith, custom, null) : null), [compareWith, custom])
  const st = compareWith?.settings ?? settings

  /** Ближайший предок с data-pv; на поле прокрутки отличаем полосу прокрутки от пустого места. */
  const resolve = (t: EventTarget | null, x: number): { el: HTMLElement; id: string } | null => {
    if (!(t instanceof Element) || t.closest('[data-pv-live]')) return null
    const el = t.closest<HTMLElement>('[data-pv]')
    if (!el || !wrap.current?.contains(el)) return null
    let id = el.dataset.pv ?? ''
    if (id === 'page-scroll') {
      const r = el.getBoundingClientRect()
      const k = r.width / (el.offsetWidth || 1)
      id = (x - r.left) / k >= el.clientLeft + el.clientWidth ? 'scroll' : 'page'
    }
    return PV[id] ? { el, id } : null
  }

  const setHot = (el: HTMLElement | null): void => {
    if (hot.current === el) return
    hot.current?.removeAttribute('data-pv-hot')
    el?.setAttribute('data-pv-hot', '')
    hot.current = el
  }
  const hideTip = (): void => {
    setHot(null)
    if (tip.current) tip.current.style.display = 'none'
  }

  const paint = (): void => {
    raf.current = 0
    const root = wrap.current
    const tp = tip.current
    if (!root || !tp) return
    const r = resolve(last.current.t, last.current.x)
    setHot(r?.el ?? null)
    if (!r) {
      tp.style.display = 'none'
      return
    }
    tp.textContent = PV[r.id].label
    tp.style.display = 'block'
    const b = root.getBoundingClientRect()
    const tw = tp.offsetWidth
    const th = tp.offsetHeight
    const cx = last.current.x - b.left
    const cy = last.current.y - b.top
    let x = cx + 14
    let y = cy + 18
    if (x + tw > b.width - 4) x = cx - tw - 14
    if (y + th > b.height - 4) y = cy - th - 12
    tp.style.transform = `translate(${Math.max(4, x)}px, ${Math.max(4, y)}px)`
  }

  const onMove = (e: React.PointerEvent): void => {
    if (!cfg) return
    last.current = { x: e.clientX, y: e.clientY, t: e.target }
    if (!raf.current) raf.current = requestAnimationFrame(paint)
  }

  useEffect(() => {
    if (!cfg) hideTip()
    return () => {
      if (raf.current) cancelAnimationFrame(raf.current)
    }
  }, [cfg])

  // В режиме настройки клики не доходят до самих контролов: поля не получают фокус, переключатели не щёлкают.
  const block = (e: React.SyntheticEvent): void => {
    if (!cfg) return
    const m = e as unknown as MouseEvent
    const r = resolve(e.target, m.clientX)
    if (!r || r.el.closest('[data-pv-act]')) return
    e.preventDefault()
    e.stopPropagation()
    // Нажатие на полосу прокрутки не порождает click — окно настроек открываем сразу.
    if (r.id === 'scroll' && e.type === 'pointerdown') setPop({ x: m.clientX, y: m.clientY, id: r.id })
  }
  const onClick = (e: React.MouseEvent): void => {
    if (!cfg) return
    const r = resolve(e.target, e.clientX)
    if (!r) return
    if (!r.el.closest('[data-pv-act]')) {
      e.preventDefault()
      e.stopPropagation()
    }
    setPop({ x: e.clientX, y: e.clientY, id: r.id })
  }

  return (
    <>
      <div
        ref={wrap}
        data-pv-skip=""
        data-coach={coach ? '' : undefined}
        onPointerMove={onMove}
        onPointerLeave={hideTip}
        onPointerDownCapture={block}
        onMouseDownCapture={block}
        onClickCapture={onClick}
        className={cn(
          'pv-root relative isolate size-full min-h-[240px] overflow-hidden rounded-xl border border-border bg-[color:var(--app-canvas,var(--background))] text-foreground',
          scoped && 'appearance-scope',
          scoped?.mode === 'dark' && 'dark'
        )}
        style={scoped ? ({ ...scoped.vars, fontFamily: 'var(--font-sans)' } as React.CSSProperties) : undefined}
      >
        <BackgroundLayer settings={st} staticOnly />
        <div {...pv('page-scroll')} data-ap-pvscroll="" className={cn('custom-scrollbar absolute inset-0 overflow-y-auto', compact ? 'space-y-3 p-2' : 'space-y-4 p-3')}>
          <Block title="Основное">
            <WindowMock compact={compact} />
          </Block>
          <Block title="Элементы">
            <Elements states={states} compact={compact} />
          </Block>
          <Block title="Сообщения">
            <Messages compact={compact} />
          </Block>
        </div>
        <div
          ref={tip}
          data-pv-skip=""
          className="pointer-events-none absolute top-0 left-0 z-50 hidden max-w-[80%] rounded-md border border-border bg-popover px-2 py-1 text-[11px] font-medium text-popover-foreground shadow-lg"
        />
      </div>
      <PvPopover pop={pop} onClose={() => setPop(null)} />
    </>
  )
}
