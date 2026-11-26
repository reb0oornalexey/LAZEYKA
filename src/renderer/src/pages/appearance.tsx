import React, { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { Popover } from 'radix-ui'
import {
  Check,
  Eye,
  History,
  LayoutGrid,
  MessageCircleQuestion,
  MousePointerClick,
  MoreHorizontal,
  Paintbrush,
  PanelRightClose,
  PanelRightOpen,
  Redo2,
  RotateCcw,
  SlidersHorizontal,
  SwatchBook,
  Undo2
} from 'lucide-react'
import BasePage from '@renderer/components/base/base-page'
import { Button } from '@renderer/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@renderer/components/ui/tooltip'
import { cn } from '@renderer/lib/utils'
import { useAppearanceStore } from '@renderer/lib/appearance/store'
import { useUiState, type AppearanceTab } from '@renderer/lib/appearance/ui-state'
import { ThemeCard } from '@renderer/components/appearance/preset-bar'
import { WallpaperCard } from '@renderer/components/appearance/wallpaper-grid'
import { ThemeGallery } from '@renderer/components/hub/theme-gallery'
import { SystemCard } from '@renderer/components/appearance/system-card'
import { AdvancedTab, ColorsTab } from '@renderer/components/appearance/token-editor'
import { InterfaceTab } from '@renderer/components/appearance/settings-panel'
import { InfoTip } from '@renderer/components/appearance/section'
import { Preview } from '@renderer/components/appearance/preview'
import { flushAppearanceSave } from '@renderer/lib/appearance/runtime'
import { AppearanceConsole } from '@renderer/components/appearance/appearance-console'
import { Segmented } from '@renderer/components/lz'
import { useTourTab } from '@renderer/lib/tour-focus'

// Ключи вкладок не меняются (на них ссылаются экскурсия и переходы из предпросмотра) — только подписи.
const TABS: { id: AppearanceTab; label: string; short?: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { id: 'themes', label: 'Темы и фон', short: 'Темы', icon: LayoutGrid },
  { id: 'colors', label: 'Цвета', icon: SwatchBook },
  { id: 'interface', label: 'Элементы', icon: Paintbrush },
  { id: 'advanced', label: 'Тонкая настройка', short: 'Тонкая', icon: SlidersHorizontal }
]

/** С этой ширины окна предпросмотр стоит колонкой справа, меньше — выезжает по кнопке. */
const WIDE_QUERY = '(min-width: 1280px)'

const isEditable = (t: EventTarget | null): boolean =>
  t instanceof HTMLElement && (t.isContentEditable || t instanceof HTMLTextAreaElement || (t instanceof HTMLInputElement && !['range', 'checkbox'].includes(t.type)))

/** Ширина окна — только по событию изменения (matchMedia), без опроса. */
function useWideWindow(): boolean {
  const [wide, setWide] = useState(() => window.matchMedia(WIDE_QUERY).matches)
  useEffect(() => {
    const mq = window.matchMedia(WIDE_QUERY)
    const on = (): void => setWide(mq.matches)
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [])
  return wide
}

/** Значок-кнопка с подсказкой при наведении. */
const IconBtn: React.FC<{
  tip: React.ReactNode
  onClick?: () => void
  disabled?: boolean
  active?: boolean
  children: React.ReactNode
  label: string
  className?: string
}> = ({ tip, onClick, disabled, active, children, label, className }) => (
  <Tooltip>
    <TooltipTrigger asChild>
      <span className="inline-flex">
        <Button
          size="icon-sm"
          variant={active ? 'default' : 'ghost'}
          aria-label={label}
          aria-pressed={active}
          disabled={disabled}
          onClick={onClick}
          className={cn('size-7', className)}
        >
          {children}
        </Button>
      </span>
    </TooltipTrigger>
    <TooltipContent side="bottom" className="max-w-60 text-xs">
      {tip}
    </TooltipContent>
  </Tooltip>
)

/**
 * «Сравнить с исходным»: короткое нажатие — переключить, удержание — смотреть, пока держите.
 * Исходное — оформление на момент открытия страницы.
 */
const CompareButton: React.FC = () => {
  const compare = useAppearanceStore((s) => s.compare)
  const press = useRef<{ t: number; wasOn: boolean } | null>(null)
  const set = useAppearanceStore.getState().setCompare
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          size="sm"
          variant={compare ? 'default' : 'ghost'}
          aria-pressed={compare}
          className="h-7 gap-1 px-2 text-xs"
          onPointerDown={() => {
            press.current = { t: performance.now(), wasOn: compare }
            if (!compare) set(true)
          }}
          onPointerUp={() => {
            const p = press.current
            press.current = null
            if (!p) return
            if (p.wasOn || performance.now() - p.t > 350) set(false)
          }}
          onPointerLeave={() => {
            const p = press.current
            if (p && !p.wasOn && performance.now() - p.t > 350) set(false)
            press.current = null
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault()
              set(!compare)
            }
          }}
        >
          <Eye className="size-3.5" />
          {compare ? 'Исходное' : 'Сравнить'}
        </Button>
      </TooltipTrigger>
      <TooltipContent side="bottom" className="max-w-60 text-xs">
        Показать в предпросмотре оформление, которое было при открытии страницы. Нажмите — переключить, удерживайте — смотреть, пока держите.
      </TooltipContent>
    </Tooltip>
  )
}

/** Пункт меню «⋯» с пояснением; опасные действия просят подтверждения прямо в меню. */
const MenuItem: React.FC<{
  icon: React.ComponentType<{ className?: string }>
  title: string
  hint: string
  disabled?: boolean
  onClick: () => void
  checked?: boolean
}> = ({ icon: Icon, title, hint, disabled, onClick, checked }) => (
  <button
    type="button"
    disabled={disabled}
    onClick={onClick}
    className="flex w-full cursor-pointer items-start gap-2.5 rounded-lg px-2 py-1.5 text-left hover:bg-accent disabled:pointer-events-none disabled:opacity-45"
  >
    <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
    <span className="min-w-0 flex-1">
      <span className="block text-xs font-medium">{title}</span>
      <span className="block text-[11px] leading-snug text-muted-foreground">{hint}</span>
    </span>
    {checked !== undefined && (
      <span className={cn('mt-0.5 flex size-4 shrink-0 items-center justify-center rounded border', checked ? 'border-primary bg-primary text-primary-foreground' : 'border-border')}>
        {checked && <Check className="size-3" />}
      </span>
    )}
  </button>
)

type Confirm = 'revert' | 'reset' | null

const MoreMenu: React.FC = () => {
  const [open, setOpen] = useState(false)
  const [confirm, setConfirm] = useState<Confirm>(null)
  const canRevert = useAppearanceStore((s) => s.past.length > 0)
  const hasEdits = useAppearanceStore((s) => Object.keys(s.tokens).length > 0)
  const states = useUiState((s) => s.showStates)
  const close = (): void => {
    setOpen(false)
    setConfirm(null)
  }
  const doConfirm = (): void => {
    const st = useAppearanceStore.getState()
    if (confirm === 'revert') {
      st.revertToBaseline()
      toast.success('Оформление возвращено к состоянию при открытии страницы')
    } else if (confirm === 'reset') {
      st.resetTokens()
      toast.success('Правки цветов убраны, тема как в исходном виде')
    }
    close()
  }
  return (
    <Popover.Root open={open} onOpenChange={(o) => (o ? setOpen(true) : close())}>
      <Tooltip>
        <TooltipTrigger asChild>
          <Popover.Trigger asChild>
            <Button size="icon-sm" variant="ghost" aria-label="Ещё" className="size-7">
              <MoreHorizontal className="size-4" />
            </Button>
          </Popover.Trigger>
        </TooltipTrigger>
        <TooltipContent side="bottom" className="text-xs">
          Ещё: сброс, показ состояний, подсказка
        </TooltipContent>
      </Tooltip>
      <Popover.Portal>
        <Popover.Content
          align="end"
          sideOffset={6}
          collisionPadding={12}
          className="z-[190] w-72 rounded-xl border border-border bg-popover p-1.5 text-popover-foreground shadow-2xl outline-none"
        >
          {confirm ? (
            <div className="space-y-2 p-1.5">
              <div className="text-xs font-semibold">{confirm === 'revert' ? 'Отменить все изменения за сеанс?' : 'Сбросить к выбранной теме?'}</div>
              <div className="text-[11px] leading-snug text-muted-foreground">
                {confirm === 'revert'
                  ? 'Тема, цвета, фон и вид элементов вернутся к тому, что было при открытии страницы. Это можно отменить кнопкой «Отменить».'
                  : 'Все ваши правки цветов поверх темы удалятся, фон и вид элементов останутся. Это можно отменить кнопкой «Отменить».'}
              </div>
              <div className="flex justify-end gap-1.5">
                <Button size="xs" variant="ghost" onClick={() => setConfirm(null)}>
                  Нет
                </Button>
                <Button size="xs" variant="destructive" onClick={doConfirm}>
                  {confirm === 'revert' ? 'Отменить всё' : 'Сбросить'}
                </Button>
              </div>
            </div>
          ) : (
            <>
              <MenuItem
                icon={History}
                title="Отменить все изменения за сеанс"
                hint="Вернуть всё, как было при открытии этой страницы"
                disabled={!canRevert}
                onClick={() => setConfirm('revert')}
              />
              <MenuItem
                icon={RotateCcw}
                title="Сбросить к выбранной теме"
                hint="Убрать свои правки цветов; фон и вид элементов не меняются"
                disabled={!hasEdits}
                onClick={() => setConfirm('reset')}
              />
              <div className="my-1 h-px bg-border" />
              <MenuItem
                icon={MousePointerClick}
                title="Показывать состояния кнопок"
                hint="В предпросмотре рядом: наведение, фокус, отключённая кнопка и поле с ошибкой"
                checked={states}
                onClick={() => useUiState.getState().setShowStates(!states)}
              />
              <MenuItem
                icon={MessageCircleQuestion}
                title="Показать подсказку снова"
                hint="Как пользоваться предпросмотром"
                onClick={() => {
                  useUiState.getState().showCoach()
                  close()
                }}
              />
            </>
          )}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  )
}

/** Панель предпросмотра: одна строка значков, подсказка при первом заходе, витрина. */
const PreviewPanel: React.FC<{ compact?: boolean; onCollapse?: () => void }> = ({ compact, onCollapse }) => {
  const compare = useAppearanceStore((s) => s.compare)
  const baseline = useAppearanceStore((s) => s.baseline)
  const canUndo = useAppearanceStore((s) => s.past.length > 0)
  const canRedo = useAppearanceStore((s) => s.future.length > 0)
  const cfg = useUiState((s) => s.configMode)
  const coach = useUiState((s) => s.coach)
  const { undo, redo } = useAppearanceStore.getState()
  return (
    <div className="flex h-full min-h-0 flex-col gap-2">
      <div className={cn('flex min-w-0 gap-0.5', compact ? 'flex-col items-stretch gap-1.5' : 'items-center')}>
        <div className="flex min-w-0 items-center gap-1">
          <span className="text-[13px] font-semibold text-[color:var(--text-title)]">Предпросмотр</span>
          <InfoTip
            text={
              <>
                Изменения применяются ко всей программе: меню слева и шапка тоже меняются. Здесь собраны все элементы в одном месте. Если интерфейс стал нечитаемым — <b>Ctrl+Shift+R</b> на любой странице вернёт тему «Тёмная».
              </>
            }
          />
          {onCollapse && (
            <IconBtn label="Свернуть предпросмотр" tip="Свернуть предпросмотр в полоску справа — больше места для настроек" onClick={onCollapse} className="ml-auto">
              <PanelRightClose className="size-4" />
            </IconBtn>
          )}
        </div>
        <div className={cn('flex items-center gap-0.5', compact ? 'rounded-lg border border-border bg-card/50 p-0.5' : 'ml-auto')}>
          <IconBtn
            label="Выбор элемента"
            active={cfg}
            onClick={() => useUiState.getState().setConfigMode(!cfg)}
            tip={
              cfg
                ? 'Выбор элемента включён: нажмите на элемент в предпросмотре, чтобы открыть его цвета. Нажмите здесь, чтобы элементы работали как обычно.'
                : 'Выбор элемента выключен: элементы предпросмотра работают как обычно. Нажмите, чтобы по нажатию открывались их цвета.'
            }
          >
            <MousePointerClick className="size-3.5" />
          </IconBtn>
          <span className="mx-1 h-4 w-px bg-border" />
          <IconBtn label="Отменить" tip="Отменить (Ctrl+Z)" disabled={!canUndo} onClick={undo}>
            <Undo2 className="size-3.5" />
          </IconBtn>
          <IconBtn label="Повторить" tip="Повторить (Ctrl+Shift+Z)" disabled={!canRedo} onClick={redo}>
            <Redo2 className="size-3.5" />
          </IconBtn>
          <span className={cn(compact && 'ml-auto')}>
            <CompareButton />
          </span>
          <MoreMenu />
        </div>
      </div>
      {coach && (
        <div className="relative shrink-0 rounded-xl border border-primary/50 bg-popover p-3 text-popover-foreground shadow-lg">
          <div className="flex gap-2 text-xs leading-snug">
            <MousePointerClick className="mt-0.5 size-4 shrink-0 text-primary" />
            <span className="min-w-0 flex-1">Нажмите на элемент в предпросмотре — откроется его настройка. При наведении видно, что это за элемент.</span>
          </div>
          <div className="mt-2 flex justify-end">
            <Button size="xs" onClick={() => useUiState.getState().dismissCoach()}>
              Понятно
            </Button>
          </div>
          <span className="absolute -bottom-[7px] left-8 size-3 rotate-45 border-r border-b border-primary/50 bg-popover" />
        </div>
      )}
      <div className="min-h-0 flex-1">
        <Preview compact={compact} compareWith={compare && baseline ? baseline : null} />
      </div>
    </div>
  )
}

const Appearance: React.FC = () => {
  const [galleryRequest, setGalleryRequest] = useState(0)
  const loaded = useAppearanceStore((s) => s.loaded)
  const tab = useUiState((s) => s.tab)
  const collapsed = useUiState((s) => s.pvCollapsed)
  useTourTab<AppearanceTab>('/appearance', (t) => useUiState.getState().setTab(t))
  const wide = useWideWindow()

  // Точка отсчёта для «Сравнить» и «Отменить все изменения» — состояние при открытии страницы.
  useEffect(() => {
    if (loaded) useAppearanceStore.getState().markBaseline()
    return () => flushAppearanceSave()
  }, [loaded])

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (!(e.ctrlKey || e.metaKey) || isEditable(e.target)) return
      const st = useAppearanceStore.getState()
      if (e.code === 'KeyZ' && !e.shiftKey) {
        e.preventDefault()
        st.undo()
      } else if (e.code === 'KeyY' || (e.code === 'KeyZ' && e.shiftKey)) {
        e.preventDefault()
        st.redo()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  useEffect(() => {
    if (tab !== 'themes') setGalleryRequest(0)
  }, [tab])

  if (!loaded) return <BasePage title="Оформление" />

  const content =
    tab === 'themes' ? (
      <>
        <ThemeCard />
        <div data-ctl="setting:wallpaper"><WallpaperCard /></div>
        <div data-tour="theme-gallery">
          <ThemeGallery openRequest={galleryRequest} />
        </div>
        <SystemCard />
      </>
    ) : tab === 'colors' ? (
      <ColorsTab />
    ) : tab === 'interface' ? (
      <InterfaceTab />
    ) : (
      <AdvancedTab />
    )

  const showPanel = wide || !collapsed
  const setCollapsed = (v: boolean): void => useUiState.getState().setPvCollapsed(v)

  return (
    <BasePage title="Оформление" contentClassName="overflow-hidden pb-4">
      <div className="h-full w-full max-w-full min-w-0 overflow-hidden lz-page-x">
        <div
          className={cn(
            'grid h-full min-w-0 gap-4 transition-[grid-template-columns] duration-200 ease-out',
            wide ? 'grid-cols-[minmax(0,1fr)_minmax(380px,34%)]' : collapsed ? 'grid-cols-[minmax(0,1fr)_40px] gap-3' : 'grid-cols-[minmax(0,1fr)_clamp(296px,32%,340px)] gap-3'
          )}
        >
          <div className="@container flex min-h-0 min-w-0 flex-col">
            <AppearanceConsole onGallery={() => {
              useUiState.getState().setTab('themes')
              setGalleryRequest((request) => request + 1)
            }} />
            <Segmented
              data-tour="appearance-tabs"
              aria-label="Настройки оформления"
              className="mb-3 shrink-0"
              items={TABS}
              value={tab}
              onChange={useUiState.getState().setTab}
            />
            <div data-ap-scroll="" className="custom-scrollbar min-h-0 flex-1 space-y-3 overflow-y-auto pr-1.5 pb-2">
              {content}
            </div>
          </div>

          {showPanel ? (
            <div data-tour="appearance-preview" className="flex min-h-0 min-w-0 flex-col">
              <PreviewPanel compact={!wide} onCollapse={wide ? undefined : () => setCollapsed(true)} />
            </div>
          ) : (
            <button
              type="button"
              data-tour="appearance-preview-toggle"
              onClick={() => setCollapsed(false)}
              title="Развернуть предпросмотр всех элементов: шапка, меню, кнопки, поля, уведомления"
              className="ui-card group flex min-h-0 cursor-pointer flex-col items-center gap-3 rounded-xl border border-border bg-card py-3 text-muted-foreground transition-colors hover:border-primary/50 hover:text-foreground"
            >
              <PanelRightOpen className="size-4 shrink-0 text-primary" />
              <span className="text-xs font-semibold tracking-wide [writing-mode:vertical-rl]">Предпросмотр</span>
            </button>
          )}
        </div>
      </div>
    </BasePage>
  )
}

export default Appearance
