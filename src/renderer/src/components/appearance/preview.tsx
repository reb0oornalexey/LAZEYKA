import React, { memo, useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import { CircleCheckIcon, Home, InfoIcon, ListChecks, OctagonXIcon, Settings as SettingsIcon, Shield, TriangleAlertIcon } from 'lucide-react'
import { useShallow } from 'zustand/react/shallow'
import { Button } from '@renderer/components/ui/button'
import { Input } from '@renderer/components/ui/input'
import { Switch } from '@renderer/components/ui/switch'
import { Badge } from '@renderer/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@renderer/components/ui/card'
import { BrandText, NavItem, PageHeader } from '@renderer/components/app-chrome'
import { cn } from '@renderer/lib/utils'
import { resolveAppearance, type AppearanceSnapshot } from '@renderer/lib/appearance/resolve'
import { useAppearanceStore } from '@renderer/lib/appearance/store'
import { PV } from '@renderer/lib/appearance/pv-map'
import { PvPopover, type PvPopState } from './pv-popover'
import { useUiState, type PreviewPage } from '@renderer/lib/appearance/ui-state'
import { BackgroundLayer } from './background-layer'

/**
 * Мини-копия приложения из НАСТОЯЩИХ компонентов (Button, Card, Switch, Input, Badge,
 * пункт меню и шапка — те же, что в приложении). Они читают те же CSS-переменные документа,
 * поэтому правка цвета меняет и приложение, и предпросмотр одновременно, без перерисовки React.
 * Переменные задаются прямо на контейнере только в режиме «Сравнить».
 * Уведомления нарисованы той же разметкой и теми же переменными --toast-*, что и в sonner.
 */

const DESIGN_W = 600
/** Метки для общей плавающей подсказки и окна настроек (см. lib/appearance/pv-map.ts). */
const pv = (id: string, act?: boolean): Record<string, string> => (act ? { 'data-pv': id, 'data-pv-act': '' } : { 'data-pv': id })
/** Элементы-«пульты» предпросмотра (показ уведомлений): работают как обычно, настройки не открывают. */
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

const StatusDots: React.FC = () => (
  <div className="flex items-center gap-3 text-xs">
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

const ButtonStates: React.FC = () => (
  <div className="space-y-1.5">
    {VARIANTS.map((v) => (
      <div key={v} className="flex flex-wrap items-center gap-1.5">
        <span {...pv('muted')} className="w-16 text-[10px] text-muted-foreground">{VARIANT_LABEL[v]}</span>
        <Button size="sm" variant={v} {...pv(`btn-${v}`)}>Обычная</Button>
        <Button size="sm" variant={v} className={hoverClass(v)} {...pv(`btn-${v}`)}>Наведение</Button>
        <Button size="sm" variant={v} className="ring-2 ring-primary" {...pv('btn-focus')}>Фокус</Button>
        <span {...pv(`btn-${v}`)} className="inline-flex">
          <Button size="sm" variant={v} disabled>Отключена</Button>
        </span>
      </div>
    ))}
    <div className="grid grid-cols-2 gap-1.5 pt-1">
      <Input placeholder="Обычное поле" {...pv('input')} />
      <Input placeholder="В фокусе" className="!border-[color:var(--input-focus-border)] ring-2 ring-[color:var(--input-focus-ring)]" {...pv('input-focus')} />
      <div {...pv('input')}>
        <Input placeholder="Отключено" disabled />
      </div>
      <Input placeholder="С ошибкой" aria-invalid {...pv('input-invalid')} />
    </div>
  </div>
)

const HomePage: React.FC<{ states: boolean }> = ({ states }) => {
  const [on, setOn] = useState(true)
  return (
    <div className="space-y-3">
      <Card className="cyber-card gap-3 py-4" {...pv('card')}>
        <CardHeader className="flex flex-row items-center justify-between gap-2 px-4">
          <CardTitle {...pv('card-title')} className="flex items-center gap-2 text-base">
            <Shield className="size-4 text-primary" /> Подключение
          </CardTitle>
          <Badge {...pv('badge')}>Zapret</Badge>
        </CardHeader>
        <CardContent className="space-y-2.5 px-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div {...pv('body')} className="text-sm">Обход блокировок</div>
              <Muted>Работает через winws, профиль «Общий»</Muted>
            </div>
            <Switch checked={on} onCheckedChange={setOn} {...pv(on ? 'switch-on' : 'switch-off')} />
          </div>
          <div {...pv('border')} className="h-px bg-border" />
          <StatusDots />
          <div className="flex flex-wrap gap-1.5">
            <Badge variant="secondary" {...pv('badge-secondary')}>Вторичный</Badge>
            <Badge variant="destructive" {...pv('badge-danger')}>Ошибка</Badge>
            <Badge variant="outline" {...pv('badge-outline')}>Контур</Badge>
          </div>
        </CardContent>
      </Card>

      <Card className="cyber-card gap-3 py-4" {...pv('card')}>
        <CardContent className="space-y-2.5 px-4">
          {states ? (
            <ButtonStates />
          ) : (
            <>
              <div className="flex flex-wrap gap-1.5">
                {VARIANTS.map((v) => (
                  <Button key={v} size="sm" variant={v} {...pv(`btn-${v}`)}>
                    {VARIANT_LABEL[v]}
                  </Button>
                ))}
              </div>
              <Input placeholder="Поле ввода" {...pv('input')} />
            </>
          )}
        </CardContent>
      </Card>

      <div className="space-y-1.5">
        {(['normal', 'success', 'error', 'info', 'warning'] as const).map((k) => (
          <ToastMock key={k} kind={k} />
        ))}
        <div className="flex flex-wrap items-center gap-1 pt-0.5">
          <span {...pv('muted')} className="mr-1 text-[11px] text-muted-foreground">Показать уведомление:</span>
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

      <div {...pv('surface-popover')} className="w-48 rounded-lg border border-border bg-popover p-1 text-popover-foreground shadow-md">
        <div className="rounded-md px-2 py-1 text-xs">
          <span {...pv('body')}>Пункт меню</span>
        </div>
        <div {...pv('surface-accent')} className="rounded-md bg-accent px-2 py-1 text-xs">
          <span {...pv('body')}>Под курсором</span>
        </div>
        <div className="mt-1 flex gap-1">
          <div {...pv('surface-muted')} className="flex-1 rounded-md bg-muted px-2 py-1 text-[11px]">
            <span {...pv('muted')}>Приглушённый</span>
          </div>
          <div {...pv('surface-secondary')} className="flex-1 rounded-md bg-secondary px-2 py-1 text-[11px]">
            <span {...pv('body')}>Вторичный</span>
          </div>
        </div>
      </div>

      <Card className="cyber-card gap-2 py-4" {...pv('card')}>
        <CardHeader className="px-4">
          <CardTitle {...pv('card-title')} className="text-base">Журнал</CardTitle>
        </CardHeader>
        <CardContent className="space-y-1 px-4">
          {Array.from({ length: 6 }, (_, i) => (
            <div key={i} className="flex items-center justify-between text-xs">
              <span {...pv('body')} className="text-foreground">discord.com → стратегия {i + 1}</span>
              <Muted>{(i + 3) * 17} мс</Muted>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  )
}

const ZapretPage: React.FC = () => (
  <div className="space-y-3">
    <Card className="cyber-card gap-3 py-4" {...pv('card')}>
      <CardHeader className="flex flex-row items-center justify-between gap-3 space-y-0 px-4">
        <div className="min-w-0 flex-1">
          <CardTitle {...pv('card-title')} className="flex flex-wrap items-center gap-2 text-base">
            <ListChecks className="size-4 text-muted-foreground" />
            Список хостов и IP
            <span {...pv('muted')} className="text-xs font-normal text-muted-foreground">128 записей в list-general.txt</span>
          </CardTitle>
        </div>
        <Button variant="outline" size="sm" className="shrink-0" {...pv('btn-outline')}>
          Управление списком
        </Button>
      </CardHeader>
    </Card>
    <Card className="cyber-card gap-2 py-4" {...pv('card')}>
      <CardHeader className="px-4">
        <CardTitle {...pv('card-title')} className="text-base">Стратегии</CardTitle>
      </CardHeader>
      <CardContent className="space-y-1.5 px-4">
        {['Общий', 'Discord', 'YouTube', 'Игры'].map((n, i) => (
          <div key={n} {...pv('border')} className="flex items-center justify-between gap-2 rounded-lg border border-border px-2.5 py-1.5">
            <span {...pv('body')} className="text-sm">{n}</span>
            <div className="flex items-center gap-2">
              <Muted>{(i + 1) * 12} хостов</Muted>
              <Badge {...pv(i === 0 ? 'badge' : 'badge-secondary')} variant={i === 0 ? 'default' : 'secondary'}>
                {i === 0 ? 'Активна' : 'Выкл'}
              </Badge>
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  </div>
)

const SettingsPage: React.FC = () => {
  const [a, setA] = useState(true)
  const [b, setB] = useState(false)
  return (
    <Card className="cyber-card gap-3 py-4" {...pv('card')}>
      <CardHeader className="px-4">
        <CardTitle {...pv('card-title')} className="text-base">Общие</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 px-4">
        {(
          [
            ['Запускать вместе с Windows', 'Программа стартует свёрнутой в трей', a, setA],
            ['Проверять обновления', 'Раз в сутки, без вашего участия', b, setB]
          ] as const
        ).map(([t, d, v, set]) => (
          <div key={t} className="flex items-center justify-between gap-3">
            <div>
              <div {...pv('body')} className="text-sm">{t}</div>
              <Muted>{d}</Muted>
            </div>
            <Switch checked={v} onCheckedChange={set} {...pv(v ? 'switch-on' : 'switch-off')} />
          </div>
        ))}
        <Input placeholder="Папка для логов" {...pv('input')} />
      </CardContent>
    </Card>
  )
}

const NAV: { id: PreviewPage; label: string; icon: typeof Home }[] = [
  { id: 'home', label: 'Главная', icon: Home },
  { id: 'zapret', label: 'Zapret', icon: Shield },
  { id: 'settings', label: 'Настройки', icon: SettingsIcon }
]

export const Preview: React.FC<{
  /** Не null — режим «Сравнить»: показываем сохранённое состояние поверх текущего. */
  compareWith: AppearanceSnapshot | null
}> = ({ compareWith }) => {
  const page = useUiState((s) => s.previewPage)
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
  const [box, setBox] = useState({ w: DESIGN_W, h: 460 })
  const [pop, setPop] = useState<PvPopState | null>(null)

  // Размер контейнера — только по событию изменения размера.
  useEffect(() => {
    const el = wrap.current
    if (!el) return
    const ro = new ResizeObserver(([e]) => setBox({ w: e.contentRect.width, h: e.contentRect.height }))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const scale = Math.min(1, Math.max(0.45, box.w / DESIGN_W))
  const scoped = useMemo(() => (compareWith ? resolveAppearance(compareWith, custom, null) : null), [compareWith, custom])
  const st = compareWith?.settings ?? settings

  /** Ближайший предок с data-pv; на самом поле прокрутки отличаем полосу прокрутки от пустого места. */
  const resolve = (t: EventTarget | null, x: number): { el: HTMLElement; id: string } | null => {
    if (!(t instanceof Element) || t.closest('[data-pv-live]')) return null
    const el = t.closest<HTMLElement>('[data-pv]')
    if (!el || !wrap.current?.contains(el)) return null
    let id = el.dataset.pv ?? ''
    if (id === 'page-scroll') {
      const r = el.getBoundingClientRect()
      const k = r.width / (el.offsetWidth || 1)
      id = (x - r.left) / k >= el.clientWidth ? 'scroll' : 'page'
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
    const r = resolve(e.target, (e as unknown as MouseEvent).clientX)
    if (!r || r.el.closest('[data-pv-act]')) return
    e.preventDefault()
    e.stopPropagation()
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

  const title = NAV.find((n) => n.id === page)?.label ?? ''
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
        <div
          {...pv('page')}
          className="absolute top-0 left-0 flex origin-top-left"
          style={{ width: DESIGN_W, height: box.h / scale, transform: `scale(${scale})` }}
        >
          <aside
            {...pv('sidebar')}
            className="flex shrink-0 flex-col gap-1 border-r border-sidebar-border bg-sidebar p-2 text-sidebar-foreground"
            style={{ width: 'var(--sidebar-width, 212px)' }}
          >
            <div {...pv('header-title')} className="flex h-9 items-center px-2">
              <BrandText />
            </div>
            {NAV.map((n) => (
              <div key={n.id} {...pv(n.id === page ? 'nav-active' : 'nav', true)}>
                <NavItem icon={n.icon} label={n.label} active={n.id === page} onClick={() => useUiState.getState().setPage(n.id)} />
              </div>
            ))}
          </aside>
          <div className="flex min-w-0 flex-1 flex-col">
            <PageHeader
              title={title}
              pv={{ bar: 'header-bar', title: 'header-title' }}
              right={<Badge variant="secondary" {...pv('badge-secondary')}>v1.2</Badge>}
            />
            <div {...pv('page-scroll')} className="min-h-0 flex-1 overflow-y-auto p-3">
              {page === 'home' && <HomePage states={states} />}
              {page === 'zapret' && <ZapretPage />}
              {page === 'settings' && <SettingsPage />}
            </div>
          </div>
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
