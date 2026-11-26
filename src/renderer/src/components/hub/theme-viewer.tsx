import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion } from 'motion/react'
import {
  ChevronLeft,
  ChevronRight,
  Download,
  ImageOff,
  Loader2,
  Maximize2,
  Minimize2,
  MonitorSmartphone,
  Palette,
  RefreshCw,
  Wallpaper,
  X,
  ZoomIn,
  ZoomOut
} from 'lucide-react'
import { Button } from '@renderer/components/ui/button'
import { Hint } from '@renderer/components/prematch/hint'
import { cn } from '@renderer/lib/utils'
import { useHubStore } from '@renderer/store/hub-store'
import { useGallerySocial } from '@renderer/store/gallery-social-store'
import type { GalleryItem } from '@renderer/utils/hub-api'
import { FavButton, LikeButton } from './gallery-social'

const MIN_SCALE = 1
const MAX_SCALE = 6
const STEP = 1.35
const DBL_SCALE = 2.5

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v))
const fmtDate = (at: number): string => (at > 0 ? new Date(at).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' }) : '')

interface View {
  s: number
  x: number
  y: number
}
const FIT: View = { s: 1, x: 0, y: 0 }

/** Сегментированный переключатель «В программе / Только обои» — тёмный, поверх картинки. */
function Tabs({ value, onChange, wall }: { value: 'app' | 'wall'; onChange: (v: 'app' | 'wall') => void; wall: boolean }): React.JSX.Element {
  const items: ['app' | 'wall', string, React.ComponentType<{ className?: string }>][] = [['app', 'В программе', MonitorSmartphone]]
  if (wall) items.push(['wall', 'Только обои', Wallpaper])
  return (
    <div role="tablist" aria-label="Что показать" className="inline-flex rounded-xl border border-border bg-card/60 p-0.5">
      {items.map(([v, text, Icon]) => (
        <button
          key={v}
          type="button"
          role="tab"
          aria-selected={value === v}
          onClick={() => onChange(v)}
          className={cn(
            'inline-flex cursor-pointer items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors',
            value === v ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'
          )}
        >
          <Icon className="size-3.5" />
          {text}
        </button>
      ))}
    </div>
  )
}

const iconBtn =
  'inline-flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:pointer-events-none disabled:opacity-40'

interface Props {
  /** Темы, по которым листают стрелки (в том порядке, как они показаны). */
  items: GalleryItem[]
  /** Открытая тема (индекс в items) или null — окно закрыто. */
  index: number | null
  onIndex: (i: number | null) => void
  /** Штатная установка темы (как кнопка «Установить»). */
  onApply: (item: GalleryItem) => void
  applying: boolean
}

/**
 * Окно темы галереи (В16): крупный снимок «В программе» или обои отдельно, увеличение колесом,
 * кнопками и двойным щелчком, перетаскивание при увеличении, режим «во весь экран» (Esc — выход),
 * стрелки ← → листают темы списка. Под картинкой — название, автор, дата, лайк, избранное, «Применить».
 */
export const ThemeViewer: React.FC<Props> = ({ items, index, onIndex, onApply, applying }) => {
  const open = index !== null && index >= 0 && index < items.length
  const item = open ? items[index as number] : null
  const previews = useHubStore((s) => s.previews)
  const loadPreview = useHubStore((s) => s.loadPreview)
  const walls = useGallerySocial((s) => s.walls)
  const loadWall = useGallerySocial((s) => s.loadWall)
  const loadSocial = useGallerySocial((s) => s.load)

  const [wantWall, setWantWall] = useState(false)
  const [full, setFull] = useState(false)
  const [view, setView] = useState<View>(FIT)
  const [anim, setAnim] = useState<'none' | 'fast' | 'smooth'>('smooth')
  const [dragging, setDragging] = useState(false)
  const [box, setBox] = useState({ w: 0, h: 0 })
  const [nat, setNat] = useState({ w: 0, h: 0 })
  const stageRef = useRef<HTMLDivElement>(null)
  const dialogRef = useRef<HTMLDivElement>(null)
  const drag = useRef<{ id: number; sx: number; sy: number; x: number; y: number } | null>(null)

  const tab: 'app' | 'wall' = wantWall && item?.hasWallpaper ? 'wall' : 'app'
  const src = item ? (tab === 'wall' ? walls[item.id] : previews[item.id]) : undefined

  useEffect(() => {
    if (open) void loadSocial()
  }, [open, loadSocial])

  // Снимок этой темы и соседних (листание без ожидания). Обои — только когда открыта их вкладка.
  useEffect(() => {
    if (!item || index === null) return
    for (const i of [index, index + 1, index - 1]) {
      const it = items[i]
      if (it && useHubStore.getState().previews[it.id] === undefined) loadPreview(it.id)
    }
    if (tab === 'wall' && useGallerySocial.getState().walls[item.id] === undefined) loadWall(item.id)
  }, [item, index, items, tab, loadPreview, loadWall])

  // Другая тема или вкладка — снова «по размеру окна».
  useEffect(() => {
    setAnim('none')
    setView(FIT)
    setNat({ w: 0, h: 0 })
  }, [item?.id, tab])

  useEffect(() => {
    if (!open) {
      setFull(false)
      setWantWall(false)
    } else dialogRef.current?.focus()
  }, [open])

  // Размер области картинки (меняется с окном и с режимом «во весь экран»).
  useLayoutEffect(() => {
    const el = stageRef.current
    if (!el) return
    const measure = (): void => setBox({ w: el.clientWidth, h: el.clientHeight })
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [open, full])

  // Картинка «по размеру окна» (может быть и крупнее своего размера: превью узкие).
  const fit = nat.w && nat.h && box.w && box.h ? Math.min(box.w / nat.w, box.h / nat.h) : 0
  const baseW = nat.w * fit
  const baseH = nat.h * fit

  const clampView = useCallback(
    (v: View): View => {
      const s = clamp(v.s, MIN_SCALE, MAX_SCALE)
      const mx = Math.max(0, (baseW * s - box.w) / 2)
      const my = Math.max(0, (baseH * s - box.h) / 2)
      return { s, x: clamp(v.x, -mx, mx), y: clamp(v.y, -my, my) }
    },
    [baseW, baseH, box.w, box.h]
  )

  /** Увеличить в s раз вокруг точки (px, py) — смещения от центра области. */
  const zoomAt = useCallback(
    (nextS: number, px = 0, py = 0, mode: 'fast' | 'smooth' = 'smooth') => {
      setAnim(mode)
      setView((v) => {
        const s = clamp(nextS, MIN_SCALE, MAX_SCALE)
        const k = s / v.s
        return clampView({ s, x: px - (px - v.x) * k, y: py - (py - v.y) * k })
      })
    },
    [clampView]
  )
  const reset = useCallback(() => {
    setAnim('smooth')
    setView(FIT)
  }, [])

  const close = useCallback(() => {
    if (!applying) onIndex(null)
  }, [applying, onIndex])
  const go = useCallback(
    (d: number) => {
      if (index === null) return
      const n = index + d
      if (n >= 0 && n < items.length) onIndex(n)
    },
    [index, items.length, onIndex]
  )

  // Колесо: увеличение вокруг курсора. Обработчик не пассивный — иначе страница под окном прокручивается.
  useEffect(() => {
    const el = stageRef.current
    if (!el || !open) return
    const onWheel = (e: WheelEvent): void => {
      e.preventDefault()
      const r = el.getBoundingClientRect()
      const px = e.clientX - r.left - r.width / 2
      const py = e.clientY - r.top - r.height / 2
      setView((v) => {
        const s = clamp(v.s * Math.exp(-clamp(e.deltaY, -150, 150) * 0.0015), MIN_SCALE, MAX_SCALE)
        const k = s / v.s
        return clampView({ s, x: px - (px - v.x) * k, y: py - (py - v.y) * k })
      })
      setAnim('fast')
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [open, full, clampView])

  // Клавиши. Перехват на погружении: окно «Вся галерея» под этим окном не должно закрыться от того же Esc.
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent): void => {
      const k = e.key
      let used = true
      if (k === 'Escape') {
        if (full) setFull(false)
        else close()
      } else if (k === 'ArrowLeft') go(-1)
      else if (k === 'ArrowRight') go(1)
      else if (k === '+' || k === '=') zoomAt(view.s * STEP)
      else if (k === '-' || k === '_') zoomAt(view.s / STEP)
      else if (k === '0') reset()
      else if (k === 'f' || k === 'F' || k === 'а' || k === 'А') setFull((v) => !v)
      else used = false
      if (used) {
        e.preventDefault()
        e.stopPropagation()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [open, full, close, go, zoomAt, reset, view.s])

  const onPointerDown = (e: React.PointerEvent): void => {
    if (e.button !== 0 || view.s <= 1.001) return
    drag.current = { id: e.pointerId, sx: e.clientX, sy: e.clientY, x: view.x, y: view.y }
    e.currentTarget.setPointerCapture(e.pointerId)
    setDragging(true)
    setAnim('none')
  }
  const onPointerMove = (e: React.PointerEvent): void => {
    const d = drag.current
    if (!d || d.id !== e.pointerId) return
    setView((v) => clampView({ s: v.s, x: d.x + e.clientX - d.sx, y: d.y + e.clientY - d.sy }))
  }
  const endDrag = (e: React.PointerEvent): void => {
    if (drag.current?.id !== e.pointerId) return
    drag.current = null
    setDragging(false)
  }
  const onDouble = (e: React.MouseEvent): void => {
    const r = e.currentTarget.getBoundingClientRect()
    if (view.s > 1.05) reset()
    else zoomAt(DBL_SCALE, e.clientX - r.left - r.width / 2, e.clientY - r.top - r.height / 2)
  }

  if (typeof document === 'undefined') return null
  const pct = Math.round(view.s * 100)
  const transition = anim === 'none' || dragging ? 'none' : anim === 'fast' ? 'transform 90ms ease-out' : 'transform 220ms cubic-bezier(.2,.7,.2,1)'
  const cursor = view.s > 1.001 ? (dragging ? 'grabbing' : 'grab') : 'zoom-in'

  const zoomBar = (
    <div className="flex items-center gap-0.5">
      <button type="button" className={iconBtn} onClick={() => zoomAt(view.s / STEP)} disabled={view.s <= MIN_SCALE + 0.001} aria-label="Уменьшить" title="Уменьшить (−)">
        <ZoomOut className="size-4" />
      </button>
      <button
        type="button"
        onClick={reset}
        className="h-8 min-w-14 cursor-pointer rounded-lg px-1.5 text-xs font-medium text-muted-foreground tabular-nums transition-colors hover:bg-accent hover:text-foreground"
        title="По размеру окна (0)"
      >
        {pct}%
      </button>
      <button type="button" className={iconBtn} onClick={() => zoomAt(view.s * STEP)} disabled={view.s >= MAX_SCALE - 0.001} aria-label="Увеличить" title="Увеличить (+)">
        <ZoomIn className="size-4" />
      </button>
      <button type="button" className={iconBtn} onClick={() => setFull((v) => !v)} aria-label={full ? 'Выйти из режима во весь экран' : 'Во весь экран'} title={full ? 'Обычный размер (Esc)' : 'Во весь экран (F)'}>
        {full ? <Minimize2 className="size-4" /> : <Maximize2 className="size-4" />}
      </button>
    </div>
  )

  return createPortal(
    <AnimatePresence>
      {open && item && (
        <motion.div
          key="theme-viewer"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
          className={cn('fixed inset-0 z-[120] flex items-center justify-center bg-black/70 backdrop-blur-sm', full ? 'p-0' : 'p-4')}
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) close()
          }}
        >
          <motion.div
            ref={dialogRef}
            tabIndex={-1}
            initial={{ opacity: 0, y: 12, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.98 }}
            transition={{ duration: 0.2, ease: 'easeOut' }}
            role="dialog"
            aria-modal="true"
            aria-label={`Тема «${item.name}»`}
            data-tour="theme-viewer"
            className={cn(
              'relative flex w-full flex-col overflow-hidden bg-background shadow-2xl outline-none',
              full ? 'h-full max-w-none rounded-none border-0' : 'h-[min(860px,94vh)] max-w-6xl rounded-2xl border border-border/70'
            )}
          >
            {!full && (
              <div className="flex flex-wrap items-center gap-2 border-b border-border/50 px-4 py-2.5">
                <Palette className="size-4 shrink-0 text-primary" />
                <Tabs value={tab} onChange={(v) => setWantWall(v === 'wall')} wall={item.hasWallpaper} />
                <Hint
                  text={
                    item.hasWallpaper
                      ? '«В программе» — снимок окна с этой темой. «Только обои» — картинка фона целиком, без окна программы (скачивается при первом открытии этой вкладки).'
                      : '«В программе» — снимок окна с этой темой. У этой темы нет своих обоев, поэтому вкладки «Только обои» нет.'
                  }
                />
                <div className="flex-1" />
                {zoomBar}
                <button type="button" className={cn(iconBtn, 'hover:bg-destructive/15 hover:text-destructive')} onClick={close} disabled={applying} aria-label="Закрыть" title="Закрыть (Esc)">
                  <X className="size-4" />
                </button>
              </div>
            )}

            <div
              ref={stageRef}
              className="relative min-h-0 flex-1 touch-none overflow-hidden bg-[radial-gradient(circle_at_center,color-mix(in_oklab,var(--foreground)_6%,transparent),transparent_70%)] select-none"
              style={{ cursor }}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={endDrag}
              onPointerCancel={endDrag}
              onDoubleClick={onDouble}
            >
              <AnimatePresence initial={false}>
                {src ? (
                  <motion.div
                    key={`${item.id}-${tab}`}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.18 }}
                    className="absolute inset-0 flex items-center justify-center"
                  >
                    <img
                      src={src}
                      alt={tab === 'wall' ? `Обои темы «${item.name}»` : `Программа с темой «${item.name}»`}
                      draggable={false}
                      decoding="async"
                      onLoad={(e) => setNat({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })}
                      className="max-w-none rounded-md shadow-xl will-change-transform"
                      style={{
                        width: baseW || undefined,
                        height: baseH || undefined,
                        opacity: baseW ? 1 : 0,
                        transform: `translate3d(${view.x}px, ${view.y}px, 0) scale(${view.s})`,
                        transition
                      }}
                    />
                  </motion.div>
                ) : (
                  <motion.div key="wait" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-sm text-muted-foreground">
                    {src === null ? (
                      <>
                        <ImageOff className="size-6 opacity-60" />
                        {tab === 'wall' ? 'Обои не скачались.' : 'Снимок не загрузился.'}
                        <Button size="sm" variant="outline" onClick={() => (tab === 'wall' ? loadWall(item.id) : void useHubStore.getState().loadGallery(true, 'full').then(() => loadPreview(item.id)))}>
                          <RefreshCw /> Повторить
                        </Button>
                      </>
                    ) : (
                      <>
                        <Loader2 className="size-6 animate-spin opacity-70" />
                        {tab === 'wall' ? 'Скачиваю обои…' : 'Загружаю снимок…'}
                      </>
                    )}
                  </motion.div>
                )}
              </AnimatePresence>

              {items.length > 1 && (
                <>
                  <button
                    type="button"
                    onPointerDown={(e) => e.stopPropagation()}
                    onDoubleClick={(e) => e.stopPropagation()}
                    onClick={() => go(-1)}
                    disabled={index === 0}
                    aria-label="Предыдущая тема"
                    title="Предыдущая тема (←)"
                    className="absolute top-1/2 left-3 inline-flex size-10 -translate-y-1/2 cursor-pointer items-center justify-center rounded-full bg-black/45 text-white backdrop-blur-sm transition-all hover:bg-black/70 disabled:pointer-events-none disabled:opacity-0"
                  >
                    <ChevronLeft className="size-5" />
                  </button>
                  <button
                    type="button"
                    onPointerDown={(e) => e.stopPropagation()}
                    onDoubleClick={(e) => e.stopPropagation()}
                    onClick={() => go(1)}
                    disabled={index === items.length - 1}
                    aria-label="Следующая тема"
                    title="Следующая тема (→)"
                    className="absolute top-1/2 right-3 inline-flex size-10 -translate-y-1/2 cursor-pointer items-center justify-center rounded-full bg-black/45 text-white backdrop-blur-sm transition-all hover:bg-black/70 disabled:pointer-events-none disabled:opacity-0"
                  >
                    <ChevronRight className="size-5" />
                  </button>
                </>
              )}

              {full && (
                <div
                  className="absolute bottom-4 left-1/2 flex -translate-x-1/2 items-center gap-1 rounded-2xl border border-border/60 bg-background/85 p-1 shadow-xl backdrop-blur"
                  onPointerDown={(e) => e.stopPropagation()}
                  onDoubleClick={(e) => e.stopPropagation()}
                >
                  <span className="max-w-[16rem] truncate px-2 text-xs font-medium">{item.name}</span>
                  {item.hasWallpaper && (
                    <button type="button" className={iconBtn} onClick={() => setWantWall((v) => !v)} title={tab === 'wall' ? 'Показать в программе' : 'Показать только обои'} aria-label={tab === 'wall' ? 'Показать в программе' : 'Показать только обои'}>
                      {tab === 'wall' ? <MonitorSmartphone className="size-4" /> : <Wallpaper className="size-4" />}
                    </button>
                  )}
                  {zoomBar}
                </div>
              )}
            </div>

            {!full && (
              <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-border/50 bg-card/70 px-5 py-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline gap-2">
                    <h2 className="truncate text-base leading-tight font-black tracking-tight">{item.name}</h2>
                    {items.length > 1 && (
                      <span className="shrink-0 text-[11px] text-muted-foreground tabular-nums">
                        {(index as number) + 1} из {items.length}
                      </span>
                    )}
                  </div>
                  <p className="truncate text-xs text-muted-foreground">
                    Автор: {item.author}
                    {fmtDate(item.at) ? ` · ${fmtDate(item.at)}` : ''}
                    {item.hasWallpaper ? ' · со своими обоями' : ''}
                  </p>
                </div>
                <LikeButton item={item} look="panel" />
                <FavButton id={item.id} look="panel" withText />
                <Button onClick={() => onApply(item)} disabled={applying} data-tour="theme-viewer-apply">
                  {applying ? <Loader2 className="animate-spin" /> : <Download />}
                  {applying ? 'Применяю…' : 'Применить'}
                </Button>
                <p className="basis-full text-[11px] leading-snug text-muted-foreground">
                  «Применить» добавит тему в «Мои темы» и включит её{item.hasWallpaper ? ', вместе с ней скачаются обои' : ''}; ваша текущая тема останется в списке. Колесо мыши, + и − — увеличить, двойной
                  щелчок — приблизить или вернуть, перетаскивание — двигать увеличенную картинку, ← → — другие темы, F — во весь экран, Esc — выход.
                </p>
              </div>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body
  )
}
