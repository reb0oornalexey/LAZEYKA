import React, { useCallback, useEffect, useRef, useState } from 'react'
import { ExternalLink, X } from 'lucide-react'
import { Switch } from '@renderer/components/ui/switch'
import { cn } from '@renderer/lib/utils'
import { useAppearanceFollow } from '@renderer/hooks/use-appearance-sync'
import { useAppConfig } from '@renderer/hooks/use-app-config'
import { attachIncyStore, useIncyStore } from '@renderer/store/incy-store'
import { attachTgwsStore, useTgwsStore } from '@renderer/store/tgws-store'
import { attachZapretStore, useZapretStore } from '@renderer/store/zapret-store'
import { incyConnect, incyDisconnect, tgwsStart, tgwsStop, zapretStart, zapretStop } from '@renderer/utils/ipc'
import { onPrematch, prematchState } from '@renderer/utils/prematch-api'
import { miniClose, miniGetSettings, miniOpenMain, onMiniChanged, type MiniMode } from '@renderer/utils/mini-api'
import { miniFit } from '@renderer/utils/mini-fit-api'
import { onMiniFlash } from '@renderer/utils/mini-flash-api'

/** Сколько последних замеров идёт в подсчёт потерь. */
const WINDOW_SAMPLES = 60

type Key = 'zapret' | 'incy' | 'tgws'

interface Ping {
  sessionId: string
  samples: (number | null)[]
}

/** Строка с переключателем. */
function Row({
  label,
  on,
  busy,
  onChange
}: {
  label: string
  on: boolean
  busy: boolean
  onChange: (v: boolean) => void
}): React.ReactElement {
  return (
    <label className="app-nodrag flex h-7 cursor-pointer items-center justify-between gap-2 rounded-md px-1.5 hover:bg-foreground/[0.04]">
      <span className="flex min-w-0 items-center gap-2 text-[13px] font-medium">
        <span className={cn('size-1.5 shrink-0 rounded-full', on ? 'bg-st-ok' : 'bg-muted-foreground/40')} />
        <span className="truncate">{label}</span>
      </span>
      <Switch size="sm" checked={on} disabled={busy} onCheckedChange={onChange} />
    </label>
  )
}

/** Точка и название — строка индикатора. */
function Dot({ label }: { label: string }): React.ReactElement {
  return (
    <span className="flex items-center gap-2 text-[13px] font-semibold leading-none">
      <span className="size-2 shrink-0 rounded-full bg-st-ok shadow-[0_0_6px_var(--st-ok)]" />
      <span className="whitespace-nowrap">{label}</span>
    </span>
  )
}

/** Мигающая рамка по кнопке «Проверить»: видно, где окно. Клики не перехватывает. */
function FlashFrame({ rounded }: { rounded: string }): React.ReactElement {
  return (
    <span
      aria-hidden
      className={cn('pointer-events-none absolute inset-0 z-50 animate-pulse border-[3px] border-primary', rounded)}
      style={{ animationDuration: '0.6s' }}
    />
  )
}

/**
 * Индикатор: только включённые службы зелёными точками. Кнопок нет.
 * Незакреплённый перетаскивается за плашку; закреплённый пропускает клики сквозь себя.
 */
function Indicator({ items, locked, flash }: { items: string[]; locked: boolean; flash: boolean }): React.ReactElement {
  const ref = useRef<HTMLDivElement>(null)

  // Окно по размеру содержимого: появилась служба — строк стало больше. Главный процесс сам решает,
  // в какую сторону расти (верхняя половина экрана — вниз, нижняя — вверх, правая — влево).
  useEffect(() => {
    const el = ref.current
    if (!el) return
    let last = ''
    const report = (): void => {
      const r = el.getBoundingClientRect()
      const w = Math.ceil(r.width)
      const h = Math.ceil(r.height)
      const key = `${w}x${h}`
      if (w < 1 || h < 1 || key === last) return
      last = key
      void miniFit(w, h).catch(() => void 0)
    }
    report()
    const ro = new ResizeObserver(report)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  return (
    <div ref={ref} className="inline-flex w-max select-none items-start bg-transparent p-1 text-foreground">
      <div
        className={cn(
          'relative flex flex-col gap-1.5 rounded-lg border bg-background/85 px-2.5 py-2',
          locked ? 'border-border/60' : 'app-drag cursor-move border-dashed border-primary/70'
        )}
        title={locked ? undefined : 'Перетащите на нужное место и закрепите в настройках мини-окна'}
      >
        {items.length > 0 ? (
          items.map((it) => <Dot key={it} label={it} />)
        ) : (
          <span className="flex items-center gap-2 whitespace-nowrap text-[12px] font-medium leading-none text-muted-foreground">
            <span className="size-2 shrink-0 rounded-full bg-muted-foreground/50" />
            всё выключено
          </span>
        )}
        {flash && <FlashFrame rounded="rounded-lg" />}
      </div>
    </div>
  )
}

/**
 * Мини-окно (маршрут #/mini): три переключателя и пинг игровой сессии.
 * Состояние служб приходит событиями (как у сторов главного окна), пинг — из
 * событий prematch:sample. Само окно ничего не опрашивает.
 */
export default function MiniWindow(): React.ReactElement {
  useAppearanceFollow()
  const { appConfig } = useAppConfig()
  const zapret = useZapretStore((s) => s.status)
  const tgws = useTgwsStore((s) => s.status)
  const incy = useIncyStore((s) => s.status)

  const [pending, setPending] = useState<Partial<Record<Key, boolean>>>({})
  const [notice, setNotice] = useState<string | null>(null)
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [ping, setPing] = useState<Ping | null>(null)
  // Вид окна (панель или индикатор) приходит из main и может смениться на лету.
  const [mode, setMode] = useState<MiniMode | null>(null)
  const [locked, setLocked] = useState(true)
  // «Проверить» в настройках: рамка мигает несколько секунд.
  const [flash, setFlash] = useState(false)

  useEffect(() => {
    let t: ReturnType<typeof setTimeout> | null = null
    const off = onMiniFlash((ms) => {
      setFlash(true)
      if (t) clearTimeout(t)
      t = setTimeout(() => setFlash(false), ms)
    })
    return () => {
      off()
      if (t) clearTimeout(t)
    }
  }, [])

  useEffect(() => {
    miniGetSettings()
      .then((st) => {
        setMode(st.mode)
        setLocked(st.locked)
      })
      .catch(() => setMode('panel'))
    return onMiniChanged((st) => {
      setMode(st.mode)
      setLocked(st.locked)
    })
  }, [])

  // У индикатора прозрачное окно: убираем фон страницы, пока он открыт.
  useEffect(() => {
    if (mode !== 'indicator') return
    const html = document.documentElement
    const prev = [html.style.background, document.body.style.background]
    html.style.background = 'transparent'
    document.body.style.background = 'transparent'
    return () => {
      html.style.background = prev[0]
      document.body.style.background = prev[1]
    }
  }, [mode])

  useEffect(() => {
    const offs = [attachZapretStore(), attachTgwsStore(), attachIncyStore()]
    return () => offs.forEach((off) => off())
  }, [])

  // Пинг: один запрос состояния при открытии, дальше только события.
  useEffect(() => {
    let alive = true
    prematchState()
      .then((st) => {
        if (alive && st.session) setPing({ sessionId: st.session.id, samples: st.session.samples.slice(-WINDOW_SAMPLES) })
      })
      .catch(() => void 0)
    const offSample = onPrematch('prematch:sample', (e) =>
      setPing((p) => {
        const base = p && p.sessionId === e.sessionId ? p.samples : []
        return { sessionId: e.sessionId, samples: [...base, e.rtt].slice(-WINDOW_SAMPLES) }
      })
    )
    const offEnd = onPrematch('prematch:ended', () => setPing(null))
    return () => {
      alive = false
      offSample()
      offEnd()
    }
  }, [])

  useEffect(
    () => () => {
      if (noticeTimer.current) clearTimeout(noticeTimer.current)
    },
    []
  )

  const say = useCallback((text: string) => {
    setNotice(text)
    if (noticeTimer.current) clearTimeout(noticeTimer.current)
    noticeTimer.current = setTimeout(() => setNotice(null), 5000)
  }, [])

  const run = useCallback(
    async (key: Key, next: boolean, fn: () => Promise<unknown>, fail: string): Promise<void> => {
      setPending((p) => ({ ...p, [key]: next }))
      try {
        await fn()
      } catch (e) {
        say(`${fail}: ${e instanceof Error ? e.message : String(e)}`)
      } finally {
        setPending((p) => ({ ...p, [key]: undefined }))
      }
    },
    [say]
  )

  const toggleZapret = (next: boolean): void => {
    if (next && !appConfig?.zapret?.activeStrategy) {
      say('Сначала выберите стратегию на вкладке Zapret')
      return
    }
    void run('zapret', next, () => (next ? zapretStart() : zapretStop()), next ? 'Zapret не запустился' : 'Zapret не остановился')
  }
  const toggleIncy = (next: boolean): void => {
    void run('incy', next, () => (next ? incyConnect() : incyDisconnect()), next ? 'VPN не подключился' : 'VPN не отключился')
  }
  const toggleTgws = (next: boolean): void => {
    void run('tgws', next, () => (next ? tgwsStart() : tgwsStop()), next ? 'Telegram не запустился' : 'Telegram не остановился')
  }

  const zapretOn = zapret.state === 'running'
  const incyOn = incy.state === 'running'
  const tgwsOn = tgws.state === 'running'
  const exitLagOn = incyOn && Boolean(incy.exitLagActive)
  const busy = (key: Key, state: string): boolean => pending[key] !== undefined || state === 'starting' || state === 'stopping' || state === 'connecting'

  // Пинг и потери по последним замерам сессии.
  const samples = ping?.samples ?? []
  const last = samples.length ? samples[samples.length - 1] : undefined
  const lost = samples.filter((v) => v === null).length
  const lossPct = samples.length ? (lost / samples.length) * 100 : 0

  if (mode === null) return <div className="h-screen w-screen" />

  if (mode === 'indicator') {
    const items: string[] = []
    if (zapretOn) items.push('Zapret')
    if (incyOn) items.push(exitLagOn ? 'VPN · ExitLag' : 'VPN')
    if (tgwsOn) items.push('Telegram')
    return <Indicator items={items} locked={locked} flash={flash} />
  }

  return (
    <div className="app-drag relative flex h-screen w-screen select-none flex-col overflow-hidden border border-border bg-background px-2 pb-2 pt-1.5 text-foreground">
      {flash && <FlashFrame rounded="" />}
      <div className="flex items-center justify-between px-1.5">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">LAZEYKA</span>
        <span className="app-nodrag flex items-center gap-0.5">
          <button
            type="button"
            title="Открыть LAZEYKA"
            aria-label="Открыть LAZEYKA"
            className="cursor-pointer rounded-md p-1 text-muted-foreground hover:bg-foreground/[0.08] hover:text-foreground"
            onClick={() => void miniOpenMain().catch(() => void 0)}
          >
            <ExternalLink className="size-3.5" />
          </button>
          <button
            type="button"
            title="Закрыть мини-окно"
            aria-label="Закрыть мини-окно"
            className="cursor-pointer rounded-md p-1 text-muted-foreground hover:bg-foreground/[0.08] hover:text-foreground"
            onClick={() => void miniClose().catch(() => void 0)}
          >
            <X className="size-3.5" />
          </button>
        </span>
      </div>

      <div className="mt-0.5 space-y-0.5">
        <Row label="Zapret" on={pending.zapret ?? zapretOn} busy={busy('zapret', zapret.state)} onChange={toggleZapret} />
        <Row label={incyOn ? 'VPN включён' : 'VPN выключен'} on={pending.incy ?? incyOn} busy={busy('incy', incy.state)} onChange={toggleIncy} />
        <Row label="Telegram" on={pending.tgws ?? tgwsOn} busy={busy('tgws', tgws.state)} onChange={toggleTgws} />
      </div>

      <div className="mt-auto rounded-md bg-foreground/[0.04] px-2 py-1 text-[11px] leading-snug">
        {notice ? (
          <span className="text-st-warn-text">{notice}</span>
        ) : ping && samples.length > 0 ? (
          <span className="flex items-center justify-between">
            <span className="font-semibold tabular-nums">{last == null ? 'нет ответа' : `${Math.round(last)} мс`}</span>
            <span className={cn('tabular-nums', lossPct > 0 ? 'text-st-warn-text' : 'text-muted-foreground')}>
              потери {lossPct < 10 && lossPct > 0 ? lossPct.toFixed(1) : Math.round(lossPct)}%
            </span>
          </span>
        ) : (
          <span className="text-muted-foreground">
            <span className="font-semibold">—</span> начните сессию в «Перед каткой»
          </span>
        )}
      </div>
    </div>
  )
}
