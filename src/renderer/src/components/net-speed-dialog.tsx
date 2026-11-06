import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ArrowDown, ArrowUp, Check, ChevronDown, Gauge, Loader2, Shield, Timer, X } from 'lucide-react'
import { Button } from '@renderer/components/ui/button'
import { cn } from '@renderer/lib/utils'
import { speedRun, speedRunNode, type IncyNode, type NetSpeedProgress, type NetSpeedResult, type SpeedService } from '@renderer/utils/ipc'

const SERVICES: { id: SpeedService; name: string; hint: string }[] = [
  { id: 'yandex', name: 'Яндекс', hint: 'Интернетометр, серверы в РФ' },
  { id: 'ookla', name: 'Speedtest', hint: 'Ookla, ближайший сервер' },
  { id: 'cloudflare', name: 'Cloudflare', hint: 'speed.cloudflare.com' }
]

const STORE_KEY = 'lazeyka.speedService'

function readService(): SpeedService {
  try {
    const v = localStorage.getItem(STORE_KEY)
    if (v === 'yandex' || v === 'ookla' || v === 'cloudflare') return v
  } catch {
    /* noop */
  }
  return 'yandex'
}

function fmt(v: number | null | undefined): string {
  if (v == null) return '—'
  return v >= 100 ? String(Math.round(v)) : v.toFixed(1)
}

const PHASE_TEXT: Record<NetSpeedProgress['phase'], string> = {
  prepare: 'Выбираю сервер…',
  ping: 'Замеряю задержку…',
  download: 'Скачивание…',
  upload: 'Отдача…',
  done: 'Готово',
  error: 'Ошибка'
}

/**
 * Тест скорости интернета (кнопка «Скорость» на главной). Как у всех
 * спидтестов: если INCY подключён — замер идёт через него, иначе напрямую.
 */
export default function NetSpeedDialog({
  open,
  onClose,
  vpnOn,
  nodes,
  initialNodeId
}: {
  open: boolean
  onClose: () => void
  vpnOn: boolean
  /** Вкладка INCY: можно выбрать сервер, замер идёт через него (временное ядро). */
  nodes?: IncyNode[]
  initialNodeId?: string | null
}): React.ReactElement | null {
  const [service, setService] = useState<SpeedService>(readService)
  const [economy, setEconomy] = useState(false)
  const [nodeId, setNodeId] = useState<string>('')
  useEffect(() => {
    if (open) setNodeId(nodes?.length ? (initialNodeId ?? nodes[0].id) : '')
  }, [open, initialNodeId, nodes])
  const [running, setRunning] = useState(false)
  const [progress, setProgress] = useState<NetSpeedProgress | null>(null)
  const [result, setResult] = useState<NetSpeedResult | null>(null)

  useEffect(() => {
    const on = (_e: unknown, p: NetSpeedProgress): void => setProgress(p)
    window.electron.ipcRenderer.on('speed:progress', on)
    return () => {
      window.electron.ipcRenderer.removeAllListeners('speed:progress')
    }
  }, [])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape' && !running) onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, running, onClose])

  const start = async (): Promise<void> => {
    try {
      localStorage.setItem(STORE_KEY, service)
    } catch {
      /* noop */
    }
    setRunning(true)
    setResult(null)
    setProgress({ phase: 'prepare' })
    try {
      setResult(nodeId ? await speedRunNode(nodeId, service, economy) : await speedRun(service, economy))
    } catch (e) {
      setResult({
        service,
        server: '',
        viaVpn: vpnOn,
        pingMs: null,
        jitterMs: null,
        downloadMbps: null,
        uploadMbps: null,
        downloadedMB: 0,
        uploadedMB: 0,
        error: e instanceof Error ? e.message : String(e)
      })
    } finally {
      setRunning(false)
    }
  }

  if (!open || typeof document === 'undefined') return null

  const phase = progress?.phase
  const live = running ? progress : null
  const ping = result?.pingMs ?? live?.pingMs ?? null
  const down = result?.downloadMbps ?? (phase === 'download' ? live?.mbps : live?.downloadMbps) ?? null
  const up = result?.uploadMbps ?? (phase === 'upload' ? live?.mbps : null) ?? null

  const Metric = ({ icon, label, value, unit, active }: { icon: React.ReactNode; label: string; value: string; unit: string; active: boolean }): React.ReactElement => (
    <div className={cn('ui-glow rounded-2xl border px-4 py-3 transition-colors', active ? 'border-primary/50 bg-primary/[0.08]' : 'border-border bg-card/60')}>
      <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        {icon}
        {label}
      </div>
      <div className="mt-1 flex items-baseline gap-1">
        <span className="text-3xl font-black tabular-nums text-foreground">{value}</span>
        <span className="text-xs text-muted-foreground">{unit}</span>
      </div>
    </div>
  )

  return createPortal(
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !running) onClose()
      }}
    >
      <div className="relative w-full max-w-lg overflow-hidden rounded-2xl border border-border/70 bg-background shadow-2xl">
        <div className="flex items-start justify-between gap-3 px-5 pt-5">
          <div>
            <div className="flex items-center gap-2 text-lg font-black">
              <Gauge className="size-5 text-primary" />
              Скорость интернета
            </div>
            <div className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">
              <Shield className={cn('size-3.5', vpnOn ? 'text-st-ok-text' : 'text-muted-foreground')} />
              {nodeId ? 'Через выбранный сервер (VPN не разрывается)' : vpnOn ? 'Через подключённый VPN (INCY)' : 'Напрямую, без VPN'}
              {result?.server ? ` · ${result.server}` : ''}
            </div>
          </div>
          <button type="button" disabled={running} className="cursor-pointer rounded-lg p-1 text-muted-foreground hover:bg-foreground/[0.06] disabled:opacity-40" onClick={onClose}>
            <X className="size-4" />
          </button>
        </div>

        <div className="space-y-4 px-5 py-4">
          {nodes && nodes.length > 0 && (
            <NodePicker
              value={nodeId}
              disabled={running}
              onChange={setNodeId}
              emptyLabel={vpnOn ? 'Текущее подключение' : 'Напрямую, без VPN'}
              nodes={nodes}
            />
          )}
          <div className="grid grid-cols-3 gap-1.5 rounded-xl border border-border bg-card/40 p-1">
            {SERVICES.map((s) => (
              <button
                key={s.id}
                type="button"
                disabled={running}
                onClick={() => setService(s.id)}
                title={s.hint}
                className={cn(
                  'cursor-pointer rounded-lg px-2 py-1.5 text-xs font-semibold transition-colors disabled:cursor-not-allowed',
                  service === s.id ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-foreground/[0.05]'
                )}
              >
                {s.name}
              </button>
            ))}
          </div>

          <div className="grid grid-cols-3 gap-2.5">
            <Metric icon={<Timer className="size-3" />} label="Пинг" value={ping == null ? '—' : String(ping)} unit="мс" active={phase === 'ping' && running} />
            <Metric icon={<ArrowDown className="size-3" />} label="Загрузка" value={fmt(down)} unit="Мбит/с" active={phase === 'download' && running} />
            <Metric icon={<ArrowUp className="size-3" />} label="Отдача" value={fmt(up)} unit="Мбит/с" active={phase === 'upload' && running} />
          </div>

          <div className="space-y-1.5">
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-foreground/[0.07]">
              <div
                className="h-full rounded-full bg-primary transition-[width] duration-300"
                style={{
                  width: `${
                    !running
                      ? result && !result.error ? 100 : 0
                      : phase === 'prepare' ? 4
                        : phase === 'ping' ? 4 + (progress?.progress ?? 0) * 8
                          : phase === 'download' ? 12 + (progress?.progress ?? 0) * 50
                            : phase === 'upload' ? 62 + (progress?.progress ?? 0) * 38
                              : 100
                  }%`
                }}
              />
            </div>
            <div className="flex justify-between text-[11px] text-muted-foreground">
              <span>{running ? PHASE_TEXT[phase ?? 'prepare'] : result?.error ? `Не получилось: ${result.error}` : result ? `Готово · джиттер ${result.jitterMs ?? '—'} мс` : 'Замер длится ~25 секунд'}</span>
              {result && !result.error && <span>скачано {result.downloadedMB} МБ · отдано {result.uploadedMB} МБ</span>}
            </div>
          </div>

          <p className="text-[10.5px] leading-relaxed text-muted-foreground">
            Пинг — до сервера замера, а не до провайдера. Яндекс часто ставит свои серверы прямо у провайдера, поэтому у него
            пинг 3–10 мс, а у Speedtest и Cloudflare — до их ближайшего узла (бывает за границей), отсюда 50–80 мс.
          </p>

          <div className="flex items-center justify-between gap-3">
            <label className="flex cursor-pointer items-center gap-2 text-[11px] text-muted-foreground">
              <input type="checkbox" className="accent-[color:var(--primary)]" checked={!economy} disabled={running} onChange={(e) => setEconomy(!e.target.checked)} />
              Полный замер без лимита трафика
            </label>
            <Button onClick={() => void start()} disabled={running} className="min-w-36">
              {running ? <Loader2 className="size-4 animate-spin" /> : <Gauge className="size-4" />}
              {running ? 'Замеряю…' : result ? 'Ещё раз' : 'Начать'}
            </Button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  )
}

/** Выбор сервера в стиле приложения (родной <select> рисовался белым списком Windows). */
function NodePicker({
  value,
  onChange,
  nodes,
  emptyLabel,
  disabled
}: {
  value: string
  onChange: (v: string) => void
  nodes: IncyNode[]
  emptyLabel: string
  disabled?: boolean
}): React.ReactElement {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const off = (e: MouseEvent): void => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    const esc = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', off)
    document.addEventListener('keydown', esc, true)
    return () => {
      document.removeEventListener('mousedown', off)
      document.removeEventListener('keydown', esc, true)
    }
  }, [open])
  const current = nodes.find((n) => n.id === value)
  const items = [{ id: '', label: emptyLabel }, ...nodes.map((n) => ({ id: n.id, label: n.name }))]
  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        disabled={disabled}
        aria-label="Сервер для замера"
        onClick={() => setOpen((o) => !o)}
        className={cn(
          'flex h-9 w-full cursor-pointer items-center gap-2 rounded-xl border bg-card/60 px-3 text-left text-xs font-semibold outline-none transition-colors disabled:cursor-not-allowed disabled:opacity-50',
          open ? 'border-primary' : 'border-border hover:border-foreground/25'
        )}
      >
        <span className="min-w-0 flex-1 truncate">{current ? `Через сервер: ${current.name}` : emptyLabel}</span>
        <ChevronDown className={cn('size-4 shrink-0 text-muted-foreground transition-transform', open && 'rotate-180')} />
      </button>
      {open && (
        <div className="absolute inset-x-0 top-full z-50 mt-1 max-h-60 overflow-y-auto rounded-xl border border-border bg-popover p-1 text-popover-foreground shadow-2xl">
          {items.map((it) => {
            const active = it.id === value
            return (
              <button
                key={it.id || '__none'}
                type="button"
                onClick={() => {
                  onChange(it.id)
                  setOpen(false)
                }}
                className={cn(
                  'flex w-full cursor-pointer items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-xs transition-colors',
                  active ? 'bg-primary/15 font-semibold text-foreground' : 'text-foreground/85 hover:bg-foreground/[0.06]'
                )}
              >
                <span className="min-w-0 flex-1 truncate">{it.label}</span>
                {active && <Check className="size-3.5 shrink-0 text-primary" />}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
