import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useLocation, useNavigate } from 'react-router-dom'
import { ArrowLeft, ArrowRight, Compass, Crosshair, Star, X } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@renderer/components/ui/button'
import { linuxUnavailableRoutes, platform, version as appVersion } from '@renderer/utils/init'
import { openExternalUrl } from '@renderer/utils/ipc'
import {
  INTRO_TOUR,
  TOUR_EVENT,
  decideStartupTour,
  isOnboardingDone,
  latestTour,
  markOnboardingDone,
  markTourSeen,
  seenTourVersion,
  tourFor,
  type Tour
} from '@renderer/lib/tour'
import { ackInstallState, getInstallState } from '@renderer/utils/install-state-api'
import { clearTourFocus, requestTourFocus } from '@renderer/lib/tour-focus'

interface Rect {
  top: number
  left: number
  width: number
  height: number
}

interface Viewport {
  w: number
  h: number
}

const CARD_W = 320
const GAP = 14
const EDGE = 12
const PAD = 6

/** Кнопка-ссылка шага открывается только по https. */
function isHttps(url: string): boolean {
  try {
    return new URL(url).protocol === 'https:'
  } catch {
    return false
  }
}

function sameRect(a: Rect | null, b: Rect | null): boolean {
  if (!a || !b) return a === b
  return a.top === b.top && a.left === b.left && a.width === b.width && a.height === b.height
}

/** Куда поставить карточку: рядом с целью и так, чтобы не перекрывать её. */
function placeCard(hole: Rect | null, vp: Viewport, cardH: number): React.CSSProperties {
  if (!hole) return { right: 16, bottom: 16 }
  const maxTop = Math.max(EDGE, vp.h - cardH - EDGE)
  const left = Math.min(Math.max(hole.left, EDGE), Math.max(EDGE, vp.w - CARD_W - EDGE))
  const spaceBelow = vp.h - (hole.top + hole.height) - GAP - EDGE
  const spaceAbove = hole.top - GAP - EDGE
  const lowerHalf = hole.top + hole.height / 2 > vp.h / 2
  const fitsBelow = spaceBelow >= cardH
  const fitsAbove = spaceAbove >= cardH
  // Цель в нижней половине окна: карточка над ней, иначе под ней.
  if (lowerHalf ? fitsAbove : fitsBelow) {
    return lowerHalf ? { left, top: Math.max(EDGE, hole.top - GAP - cardH) } : { left, top: Math.min(maxTop, hole.top + hole.height + GAP) }
  }
  if (lowerHalf ? fitsBelow : fitsAbove) {
    return lowerHalf ? { left, top: Math.min(maxTop, hole.top + hole.height + GAP) } : { left, top: Math.max(EDGE, hole.top - GAP - cardH) }
  }
  // Цель высокая: ставим сбоку.
  const top = Math.min(maxTop, Math.max(EDGE, hole.top))
  if (vp.w - (hole.left + hole.width) - GAP - EDGE >= CARD_W) return { left: hole.left + hole.width + GAP, top }
  if (hole.left - GAP - EDGE >= CARD_W) return { left: hole.left - GAP - CARD_W, top }
  // Места нигде нет: в угол, противоположный центру цели.
  return lowerHalf ? { right: 16, top: EDGE } : { right: 16, bottom: 16 }
}

/**
 * Экскурсия: «Знакомство» для новой установки и «Что нового» после
 * обновления (см. lib/tour.ts). Не блокирует интерфейс: плавающая карточка и
 * подсветка настройки (рамка, свечение, лёгкое затемнение с «вырезом» — всё с
 * pointer-events: none). Шаг сам открывает раздел и вкладку, прокручивает к
 * цели (data-tour) и следит за её положением. Запускается один раз после
 * обновления и по событию TOUR_EVENT (кнопки в «Что нового» и в «Информации»).
 */
export default function FeatureTour(): React.ReactElement | null {
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const pathRef = useRef(pathname)
  const [tour, setTour] = useState<Tour | null>(null)
  const [index, setIndex] = useState(0)
  const [nonce, setNonce] = useState(0)
  const [rect, setRect] = useState<Rect | null>(null)
  const [vp, setVp] = useState<Viewport>({ w: window.innerWidth, h: window.innerHeight })
  const [cardH, setCardH] = useState(190)
  const cardRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    pathRef.current = pathname
  }, [pathname])

  const steps = useMemo(
    () => tour?.steps.filter((step) => (!step.only || step.only === platform) &&
      (platform !== 'linux' || (!linuxUnavailableRoutes.has(step.route) && step.target !== 'incy-killswitch-reset'))) ?? [],
    [tour]
  )
  const step = steps[index]

  /** finished — дошли до «Готово»; иначе экскурсию закрыли или пропустили. */
  const close = useCallback(
    (finished = false) => {
      if (tour) {
        if (tour.kind === 'intro') {
          markOnboardingDone()
          // Новичку «Что нового» в этой же версии не нужно.
          const latest = latestTour()
          if (latest) markTourSeen(latest.version)
        } else {
          markTourSeen(tour.version)
        }
        if (!finished) toast('Обучение можно пройти снова: Информация → Обучение', { duration: 5000 })
      }
      clearTourFocus()
      setTour(null)
      setIndex(0)
    },
    [tour]
  )

  // Первый показ: через пару секунд после запуска, когда окно уже отрисовано.
  // Новой установке — «Знакомство», обновившимся — «Что нового».
  useEffect(() => {
    let alive = true
    const state = getInstallState().catch(() => null)
    const timer = setTimeout(() => {
      void state.then((st) => {
        // Окно открылось — запоминаем версию как последнюю запущенную.
        void ackInstallState().catch(() => undefined)
        if (!alive || document.hidden) return
        const latest = latestTour()
        const pick = decideStartupTour({
          fresh: st ? st.fresh : null,
          onboardingDone: isOnboardingDone(),
          seenVersion: seenTourVersion(),
          latestVersion: latest?.version ?? null,
          appVersion
        })
        const t = pick === 'intro' ? INTRO_TOUR : pick === 'whatsnew' ? latest : null
        if (!t) return
        setIndex(0)
        setTour(t)
      })
    }, 2500)
    return () => {
      alive = false
      clearTimeout(timer)
    }
  }, [])

  useEffect(() => {
    const onStart = (e: Event): void => {
      const v = (e as CustomEvent<{ version?: string }>).detail?.version
      const t = (v ? tourFor(v) : null) ?? latestTour()
      if (!t) return
      setIndex(0)
      setTour(t)
    }
    window.addEventListener(TOUR_EVENT, onStart)
    return () => window.removeEventListener(TOUR_EVENT, onStart)
  }, [])

  // Открыть раздел и вкладку шага.
  useEffect(() => {
    if (!step) return
    requestTourFocus({ route: step.route, tab: step.tab })
    if (pathRef.current !== step.route) navigate(step.route)
  }, [step, nonce, navigate])

  // Найти цель, прокрутить к ней и следить за положением и размером.
  useEffect(() => {
    if (!step) return
    const selector = `[data-tour="${step.target}"]`
    let el: HTMLElement | null = null
    let ro: ResizeObserver | null = null
    let raf = 0
    let lateScroll: ReturnType<typeof setTimeout> | undefined
    let scrolled = false

    const measure = (): void => {
      raf = 0
      const cur = document.querySelector<HTMLElement>(selector)
      if (cur !== el) {
        ro?.disconnect()
        ro = null
        el = cur
        if (el) {
          ro = new ResizeObserver(schedule)
          ro.observe(el)
          if (!scrolled) {
            scrolled = true
            el.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'smooth' })
            // Страница могла дорисоваться и сдвинуть цель: один повторный взгляд.
            lateScroll = setTimeout(() => {
              if (!el) return
              const r = el.getBoundingClientRect()
              if (r.top < 0 || r.bottom > window.innerHeight) el.scrollIntoView({ block: 'center', inline: 'nearest' })
            }, 450)
          }
        }
      }
      setVp((p) => (p.w === window.innerWidth && p.h === window.innerHeight ? p : { w: window.innerWidth, h: window.innerHeight }))
      let next: Rect | null = null
      if (el) {
        const r = el.getBoundingClientRect()
        if (r.width > 0 || r.height > 0) next = { top: r.top, left: r.left, width: r.width, height: r.height }
      }
      setRect((p) => (sameRect(p, next) ? p : next))
    }
    function schedule(): void {
      if (!raf) raf = requestAnimationFrame(measure)
    }

    schedule()
    // Страница ещё грузится или данные приходят позже: следим за DOM самого приложения (не за карточкой экскурсии).
    const mo = new MutationObserver(schedule)
    mo.observe(document.getElementById('root') ?? document.body, { childList: true, subtree: true })
    window.addEventListener('resize', schedule)
    window.addEventListener('scroll', schedule, true)
    return () => {
      if (raf) cancelAnimationFrame(raf)
      if (lateScroll) clearTimeout(lateScroll)
      mo.disconnect()
      ro?.disconnect()
      window.removeEventListener('resize', schedule)
      window.removeEventListener('scroll', schedule, true)
    }
  }, [step, nonce])

  // Высота карточки нужна, чтобы поставить её над целью и не выйти за край.
  useLayoutEffect(() => {
    const h = cardRef.current?.offsetHeight
    if (h && h !== cardH) setCardH(h)
  })

  useEffect(() => {
    if (!tour) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') close(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [tour, close])

  if (!tour || !step) return null

  const last = index === steps.length - 1
  const hole = rect && { top: rect.top - PAD, left: rect.left - PAD, width: rect.width + PAD * 2, height: rect.height + PAD * 2 }
  const cardStyle = placeCard(hole, vp, cardH)

  return createPortal(
    // Контейнер не ловит клики: интерфейс под экскурсией остаётся рабочим.
    <div className="pointer-events-none fixed inset-0 z-[200]" role="dialog" aria-label={tour.title}>
      {hole && (
        <div
          className="pointer-events-none absolute rounded-xl outline-2 outline-primary transition-all duration-200"
          style={{
            ...hole,
            boxShadow: '0 0 0 9999px rgba(0,0,0,0.28), 0 0 22px 4px color-mix(in oklab, var(--color-primary, #7c5cff) 60%, transparent)'
          }}
        />
      )}
      <div
        ref={cardRef}
        className="pointer-events-auto absolute rounded-2xl border border-border/70 bg-background p-3.5 shadow-2xl transition-all duration-200"
        style={{ width: CARD_W, ...cardStyle }}
      >
        <div className="mb-1.5 flex items-center gap-2">
          <Compass className="size-4 shrink-0 text-primary" />
          <span className="flex-1 truncate text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{tour.title}</span>
          <button
            type="button"
            aria-label="Закрыть экскурсию"
            title="Закрыть (Esc)"
            onClick={() => close(false)}
            className="inline-flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-foreground/[0.06]"
          >
            <X className="size-4" />
          </button>
        </div>
        <div className="text-[15px] font-black tracking-tight">{step.title}</div>
        <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">{step.text}</p>
        {step.link && isHttps(step.link.url) && (
          <button
            type="button"
            onClick={() => void openExternalUrl(step.link!.url).catch(() => toast.error('Не удалось открыть ссылку'))}
            className="mt-2 inline-flex max-w-full cursor-pointer items-center gap-1.5 rounded-lg border border-primary/30 bg-primary/[0.06] px-2.5 py-1.5 text-[12px] font-semibold text-primary transition-colors hover:bg-primary/[0.12]"
          >
            <Star className="size-3.5 shrink-0" />
            <span className="truncate">{step.link.label}</span>
          </button>
        )}

        <div className="mt-3 flex items-center gap-2">
          <span className="shrink-0 whitespace-nowrap text-[11px] font-semibold tabular-nums text-muted-foreground">
            {index + 1} из {steps.length}
          </span>
          <div className="ml-auto flex items-center gap-1.5">
            {/* На первом шаге место занимает «Пропустить». */}
            {index > 0 && (
              <Button size="sm" variant="ghost" className="h-8 px-2" onClick={() => setNonce((n) => n + 1)} title="Показать это место ещё раз">
                <Crosshair className="size-4" />
              </Button>
            )}
            {index === 0 ? (
              <Button
                size="sm"
                variant="outline"
                className="h-8 border-primary/40 font-semibold"
                onClick={() => close(false)}
                title="Пропустить экскурсию. Её можно пройти позже: Информация → Обучение"
              >
                Пропустить
              </Button>
            ) : (
              <Button size="sm" variant="outline" className="h-8" onClick={() => setIndex(index - 1)} title="Назад">
                <ArrowLeft className="size-4" />
                Назад
              </Button>
            )}
            {last ? (
              <Button size="sm" className="h-8" onClick={() => close(true)}>
                Готово
              </Button>
            ) : (
              <Button size="sm" className="h-8" onClick={() => setIndex(index + 1)}>
                Дальше
                <ArrowRight className="size-4" />
              </Button>
            )}
          </div>
        </div>
        {!last && index > 0 && (
          <button type="button" onClick={() => close(false)} className="mt-2 cursor-pointer text-[11px] text-muted-foreground underline-offset-2 hover:underline">
            Закрыть экскурсию
          </button>
        )}
      </div>
    </div>,
    document.body
  )
}
