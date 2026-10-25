import React, { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { Eye, EyeOff, MousePointerClick, PanelRightOpen, Redo2, RotateCcw, Undo, Undo2, X } from 'lucide-react'
import BasePage from '@renderer/components/base/base-page'
import { Button } from '@renderer/components/ui/button'
import { Switch } from '@renderer/components/ui/switch'
import { cn } from '@renderer/lib/utils'
import { useAppearanceStore } from '@renderer/lib/appearance/store'
import { useUiState, type AppearanceTab } from '@renderer/lib/appearance/ui-state'
import { ThemeCard } from '@renderer/components/appearance/preset-bar'
import { WallpaperCard } from '@renderer/components/appearance/wallpaper-grid'
import { SystemCard } from '@renderer/components/appearance/system-card'
import { AdvancedTab, ColorsTab } from '@renderer/components/appearance/token-editor'
import { InterfaceTab } from '@renderer/components/appearance/settings-panel'
import { InfoTip } from '@renderer/components/appearance/section'
import { Preview } from '@renderer/components/appearance/preview'
import { flushAppearanceSave } from '@renderer/lib/appearance/runtime'

const TABS: { id: AppearanceTab; label: string }[] = [
  { id: 'themes', label: 'Темы и фон' },
  { id: 'colors', label: 'Цвета' },
  { id: 'interface', label: 'Интерфейс' },
  { id: 'advanced', label: 'Расширенные' }
]

const WIDE_PX = 720

const isEditable = (t: EventTarget | null): boolean =>
  t instanceof HTMLElement && (t.isContentEditable || t instanceof HTMLTextAreaElement || (t instanceof HTMLInputElement && !['range', 'checkbox'].includes(t.type)))

/** Шапка предпросмотра: все действия здесь, внизу ничего нет. Ряд переносится, ничего не обрезается. */
const PreviewBar: React.FC = () => {
  const compare = useAppearanceStore((s) => s.compare)
  const canUndo = useAppearanceStore((s) => s.past.length > 0)
  const canRedo = useAppearanceStore((s) => s.future.length > 0)
  const hasEdits = useAppearanceStore((s) => Object.keys(s.tokens).length > 0)
  const states = useUiState((s) => s.showStates)
  const cfg = useUiState((s) => s.configMode)
  const { undo, redo, setCompare, revertToBaseline, resetTokens } = useAppearanceStore.getState()
  return (
    <div className="mb-1.5 min-w-0 space-y-1">
      <div className="flex min-w-0 items-center gap-1.5">
        <span className="text-[13px] font-semibold">Предпросмотр</span>
        <InfoTip text={<>Изменения применяются сразу ко всему приложению. Нажмите на элемент, чтобы перейти к его настройке. Если интерфейс стал нечитаемым — <b>Ctrl+Shift+R</b> на любой странице сбросит оформление к «Тёмная».</>} />
        <button type="button" title="Показать подсказку ещё раз" onClick={() => useUiState.getState().showCoach()} className="flex size-4 cursor-pointer items-center justify-center rounded-full border border-border text-[10px] font-bold text-muted-foreground hover:border-primary hover:text-foreground">
          ?
        </button>
        {compare && <span className="rounded-full bg-primary/15 px-2 py-0.5 text-[10px] font-semibold text-primary">как было</span>}
        <label className="ml-auto flex shrink-0 cursor-pointer items-center gap-1 text-[11px]" title="Включено: клик по элементу открывает его настройки. Выключено: элементы предпросмотра работают как обычно">
          Режим настройки
          <Switch size="sm" checked={cfg} onCheckedChange={(v) => useUiState.getState().setConfigMode(v)} />
        </label>
        <label className="flex shrink-0 cursor-pointer items-center gap-1 text-[11px]" title="Наведение, фокус и отключённое состояние рядом">
          Состояния
          <Switch size="sm" checked={states} onCheckedChange={(v) => useUiState.getState().setShowStates(v)} />
        </label>
      </div>
      <div className="flex min-w-0 flex-wrap items-center gap-1">
        <Button size="icon-xs" variant="ghost" title="Отменить (Ctrl+Z)" disabled={!canUndo} onClick={undo}>
          <Undo2 />
        </Button>
        <Button size="icon-xs" variant="ghost" title="Повторить (Ctrl+Shift+Z)" disabled={!canRedo} onClick={redo}>
          <Redo2 />
        </Button>
        <Button size="xs" variant={compare ? 'default' : 'outline'} title="Показать предпросмотр с тем оформлением, которое было при открытии страницы" onClick={() => setCompare(!compare)}>
          {compare ? <EyeOff /> : <Eye />} Сравнить
        </Button>
        <Button size="xs" variant="outline" title="Вернуть всё, как было при открытии страницы" disabled={!canUndo} onClick={() => { revertToBaseline(); toast.success('Возвращено к состоянию при открытии') }}>
          <Undo /> Отменить изменения
        </Button>
        <Button size="xs" variant="outline" title="Убрать правки цветов поверх выбранной темы" disabled={!hasEdits} onClick={resetTokens}>
          <RotateCcw /> Сбросить к пресету
        </Button>
      </div>
    </div>
  )
}

const HINT_KEY = 'lazeyka.appearance.hintDismissed'

/** Подсказка над предпросмотром; закрытие запоминается. */
const PreviewHint: React.FC = () => {
  const [hidden, setHidden] = useState(() => {
    try {
      return localStorage.getItem(HINT_KEY) === '1'
    } catch {
      return false
    }
  })
  if (hidden) return null
  return (
    <div className="mb-1.5 flex items-center gap-1.5 rounded-lg border border-primary/40 bg-primary/10 px-2 py-1 text-[11px]">
      <MousePointerClick className="size-3.5 shrink-0 text-primary" />
      <span className="min-w-0 flex-1">Нажмите на любой элемент, чтобы перейти к его настройке</span>
      <button
        type="button"
        title="Скрыть подсказку"
        onClick={() => {
          setHidden(true)
          try {
            localStorage.setItem(HINT_KEY, '1')
          } catch {
            /* noop */
          }
        }}
        className="flex size-4 cursor-pointer items-center justify-center rounded text-muted-foreground hover:text-foreground"
      >
        <X className="size-3" />
      </button>
    </div>
  )
}

/** Всплывающая подсказка при первом заходе, со стрелкой на макет. */
const CoachMark: React.FC = () => (
  <div className="absolute inset-x-3 top-3 z-30 flex flex-col items-center">
    <div className="relative w-full max-w-72 rounded-xl border-2 border-primary bg-popover p-3 text-popover-foreground shadow-2xl">
      <div className="flex gap-2 text-xs leading-snug">
        <MousePointerClick className="mt-0.5 size-4 shrink-0 text-primary" />
        <span>Нажмите на любой элемент в предпросмотре — откроется его настройка. Наведите, чтобы увидеть, что это.</span>
      </div>
      <Button size="xs" className="mt-2 ml-auto flex" onClick={() => useUiState.getState().dismissCoach()}>
        Понятно
      </Button>
      <span className="absolute -bottom-[7px] left-1/2 size-3 -translate-x-1/2 rotate-45 border-r-2 border-b-2 border-primary bg-popover" />
    </div>
  </div>
)

const PreviewBox: React.FC = () => {
  const compare = useAppearanceStore((s) => s.compare)
  const baseline = useAppearanceStore((s) => s.baseline)
  const coach = useUiState((s) => s.coach)
  return (
    <div className="relative size-full">
      <Preview compareWith={compare && baseline ? baseline : null} />
      {coach && <CoachMark />}
    </div>
  )
}

const Appearance: React.FC = () => {
  const loaded = useAppearanceStore((s) => s.loaded)
  const tab = useUiState((s) => s.tab)
  const drawer = useUiState((s) => s.drawer)
  const [wide, setWide] = useState(true)
  const root = useRef<HTMLDivElement>(null)

  // Точка отсчёта для «Сравнить» и «Отменить изменения» — состояние при открытии страницы.
  useEffect(() => {
    if (loaded) useAppearanceStore.getState().markBaseline()
    return () => flushAppearanceSave()
  }, [loaded])

  // Двухколоночный вид или выдвижная панель — по ширине страницы (только при изменении размера).
  useEffect(() => {
    const el = root.current
    if (!el) return
    const ro = new ResizeObserver(([e]) => setWide(e.contentRect.width >= WIDE_PX))
    ro.observe(el)
    return () => ro.disconnect()
  }, [loaded])

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape' && useUiState.getState().drawer) {
        useUiState.getState().setDrawer(false)
        return
      }
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

  if (!loaded) return <BasePage title="Оформление" />

  const content =
    tab === 'themes' ? (
      <>
        <ThemeCard />
        <WallpaperCard />
        <SystemCard />
      </>
    ) : tab === 'colors' ? (
      <ColorsTab />
    ) : tab === 'interface' ? (
      <InterfaceTab />
    ) : (
      <AdvancedTab />
    )

  return (
    <BasePage title="Оформление" contentClassName="overflow-hidden pb-3">
      <div ref={root} className="relative h-full w-full max-w-full min-w-0 overflow-hidden px-4">
        <div className={cn('grid h-full min-w-0 gap-4', wide ? 'grid-cols-[minmax(0,1fr)_minmax(320px,44%)]' : 'grid-cols-1')}>
          <div className="@container flex min-h-0 min-w-0 flex-col">
            <div className="mb-2 flex shrink-0 gap-0.5 rounded-xl border border-border bg-card p-0.5" role="tablist">
              {TABS.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  role="tab"
                  aria-selected={tab === t.id}
                  onClick={() => useUiState.getState().setTab(t.id)}
                  className={cn(
                    'h-8 flex-1 cursor-pointer truncate rounded-lg px-2 text-xs font-semibold transition-colors',
                    tab === t.id ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-accent hover:text-foreground'
                  )}
                >
                  {t.label}
                </button>
              ))}
            </div>
            <div className="custom-scrollbar min-h-0 flex-1 space-y-2.5 overflow-y-auto pr-1 pb-1">{content}</div>
          </div>

          {wide && (
            <div className="flex min-h-0 min-w-0 flex-col overflow-hidden">
              <PreviewBar />
              <PreviewHint />
              <div className="min-h-0 flex-1">
                <PreviewBox />
              </div>
            </div>
          )}
        </div>

        {!wide && (
          <>
            <button
              type="button"
              onClick={() => useUiState.getState().setDrawer(true)}
              className="absolute top-1/2 right-0 z-20 flex -translate-y-1/2 cursor-pointer items-center gap-1 rounded-l-xl border border-r-0 border-border bg-card px-1.5 py-3 text-xs font-semibold text-card-foreground shadow-lg hover:bg-accent"
              style={{ writingMode: 'vertical-rl' }}
            >
              <PanelRightOpen className="size-3.5 rotate-90" /> Предпросмотр
            </button>
            <div
              onClick={() => useUiState.getState().setDrawer(false)}
              className={cn('absolute inset-0 z-30 bg-black/40 transition-opacity duration-200', drawer ? 'opacity-100' : 'pointer-events-none opacity-0')}
            />
            <aside
              className={cn(
                'absolute top-0 right-0 bottom-0 z-40 flex w-[380px] max-w-full flex-col rounded-l-2xl border-l border-border bg-card p-3 shadow-2xl transition-transform duration-200 ease-out',
                drawer ? 'translate-x-0' : 'translate-x-full'
              )}
              aria-hidden={!drawer}
            >
              <div className="mb-1 flex items-center">
                <div className="min-w-0 flex-1">{drawer && <PreviewBar />}</div>
                <button type="button" title="Закрыть (Esc)" onClick={() => useUiState.getState().setDrawer(false)} className="ml-1 flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-lg hover:bg-accent">
                  <X className="size-4" />
                </button>
              </div>
              {drawer && <PreviewHint />}
              <div className="min-h-0 flex-1">{drawer && <PreviewBox />}</div>
            </aside>
          </>
        )}
      </div>
    </BasePage>
  )
}

export default Appearance
