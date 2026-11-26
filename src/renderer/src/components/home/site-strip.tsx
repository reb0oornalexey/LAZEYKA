import React, { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Loader2, RefreshCw } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@renderer/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@renderer/components/ui/tooltip'
import { ServiceIcon } from '@renderer/components/service-icons'
import { LzPanel, LzSectionHead } from '@renderer/components/lz'
import { useTgwsStore } from '@renderer/store/tgws-store'
import { useZapretStore } from '@renderer/store/zapret-store'
import { useIncyStore } from '@renderer/store/incy-store'
import { cn } from '@renderer/lib/utils'
import { SERVICE_META, agoText, diagServices, type ServiceResult, type ServiceState } from '@renderer/utils/diag-api'

/**
 * Что отдаёт main (src/main/core/service-status.ts) сверх типов diag-api.ts:
 * состояние «частично», подпись под плиткой и результаты по точкам.
 * (Те же типы, что в прежнем components/services-panel.tsx.)
 */
type TileState = ServiceState | 'partial'

interface PointReport {
  key: string
  label: string
  host: string
  role: 'core' | 'part' | 'info'
  state: 'ok' | 'slow' | 'down' | 'region' | 'unverified'
  detail: string
  ms: number | null
}

type TileResult = Omit<ServiceResult, 'state'> & {
  state: TileState
  note?: string | null
  via?: 'proxy' | null
  checkDomain?: string
  points?: PointReport[]
}

interface TileReport {
  at: number | null
  results: TileResult[]
}

export interface SiteSummary {
  ok: number
  partial: number
  bad: number
  checked: number
  total: number
}

const CHIP: Record<TileState, { label: string; box: string; text: string; dot: string; muted: boolean }> = {
  ok: { label: 'открывается', box: 'border-foreground/[0.08] bg-foreground/[0.03]', text: 'text-st-ok-text', dot: 'bg-st-ok', muted: false },
  slow: { label: 'медленно', box: 'border-st-warn/45 bg-st-warn/[0.07]', text: 'text-st-warn-text', dot: 'bg-st-warn', muted: false },
  partial: { label: 'частично', box: 'border-st-warn/45 bg-st-warn/[0.07]', text: 'text-st-warn-text', dot: 'bg-st-warn', muted: false },
  down: { label: 'не открывается', box: 'border-st-err/45 bg-st-err/[0.07]', text: 'text-st-err-text', dot: 'bg-st-err', muted: true },
  region: { label: 'закрыт в регионе', box: 'border-st-err/45 bg-st-err/[0.07]', text: 'text-st-err-text', dot: 'bg-st-err', muted: true },
  unchecked: { label: 'не проверялось', box: 'border-dashed border-foreground/[0.12]', text: 'text-muted-foreground', dot: 'bg-muted-foreground/50', muted: false }
}

const MARK: Record<PointReport['state'], { sign: string; cls: string }> = {
  ok: { sign: '✓', cls: 'text-st-ok-text' },
  slow: { sign: '~', cls: 'text-st-warn-text' },
  down: { sign: '✕', cls: 'text-st-err-text' },
  region: { sign: '✕', cls: 'text-st-err-text' },
  unverified: { sign: '?', cls: 'text-st-warn-text' }
}

/** Подсказка при наведении: итог и каждая проверенная точка. */
const SiteTip: React.FC<{ name: string; r: TileResult | undefined; clickable: boolean }> = ({ name, r, clickable }) => (
  <div className="max-w-80 space-y-1 text-left">
    <div className="text-[12px] font-semibold">{name}</div>
    <div className="text-[11.5px] leading-snug opacity-90">{r ? r.detail : 'Ещё не проверялось'}</div>
    {r?.note && <div className="text-[11px] leading-snug opacity-80">{r.note}</div>}
    {r?.points && r.points.length > 0 && (
      <ul className="space-y-0.5 pt-0.5">
        {r.points.map((p) => (
          <li key={p.key} className="flex gap-1.5 text-[11px] leading-snug">
            <span className={cn('w-3 shrink-0 text-center font-bold', MARK[p.state].cls)}>{MARK[p.state].sign}</span>
            <span className="min-w-0">
              {p.label} <span className="opacity-60">({p.host})</span> — {p.detail}
            </span>
          </li>
        ))}
      </ul>
    )}
    {clickable && <div className="pt-0.5 text-[11px] opacity-70">Нажмите, чтобы найти причину</div>}
  </div>
)

/**
 * Лента «Что открывается» на главной: восемь сервисов в одну строку.
 * Проверка — при открытии (если прошло больше 10 минут — решает main), по
 * кнопке «Проверить» и из мастера «Ничего не открывается?» (его результат
 * приходит сюда же событием diag:servicesUpdated). Сама по себе — никогда.
 * Логика та же, что у прежнего components/services-panel.tsx.
 */
export const SiteStrip: React.FC<{ onSummary?: (s: SiteSummary) => void }> = ({ onSummary }) => {
  const navigate = useNavigate()
  const tgState = useTgwsStore((s) => s.status.state)
  const zapretState = useZapretStore((s) => s.status.state)
  const vpn = useIncyStore((s) => s.status)
  const route = JSON.stringify([tgState, zapretState, vpn.state, vpn.activeNodeId, vpn.connectedAt, vpn.connectionMode, vpn.routingMode])
  const lastRoute = useRef(route)
  const [results, setResults] = useState<Record<string, TileResult>>({})
  const [at, setAt] = useState<number | null>(null)
  const [busy, setBusy] = useState(false)
  const alive = useRef(true)

  const apply = useCallback((rep: TileReport): void => {
    setResults(Object.fromEntries(rep.results.map((r) => [r.id, r])))
    setAt(rep.at)
  }, [])

  const load = useCallback(
    async (force: boolean): Promise<void> => {
      setBusy(true)
      try {
        const rep = (await diagServices(force)) as unknown as TileReport
        if (!alive.current) return
        apply(rep)
      } catch (e) {
        if (force) toast.error('Проверка сервисов не удалась', { description: e instanceof Error ? e.message : String(e) })
      } finally {
        if (alive.current) setBusy(false)
      }
    },
    [apply]
  )

  useEffect(() => {
    alive.current = true
    void load(false)
    const off = window.electron.ipcRenderer.on('diag:servicesUpdated', (_e: unknown, rep: TileReport) => {
      if (alive.current && rep && Array.isArray(rep.results)) apply(rep)
    })
    return () => {
      alive.current = false
      if (typeof off === 'function') off()
    }
  }, [load, apply])

  useEffect(() => {
    if (lastRoute.current === route) return
    lastRoute.current = route
    setResults({})
    setAt(null)
    const timer = setTimeout(() => void load(false), 450)
    return () => clearTimeout(timer)
  }, [route, load])

  const list = Object.values(results)
  const anyPartial = list.some((r) => r.state === 'partial')
  const anyRegion = list.some((r) => r.state === 'region')

  useEffect(() => {
    if (!onSummary) return
    const checked = list.filter((r) => r.state !== 'unchecked')
    onSummary({
      ok: checked.filter((r) => r.state === 'ok' || r.state === 'slow').length,
      partial: checked.filter((r) => r.state === 'partial').length,
      bad: checked.filter((r) => r.state !== 'ok').length,
      checked: checked.length,
      total: SERVICE_META.length
    })
  }, [results, onSummary])

  return (
    <LzPanel data-tour="home-services" className="@container p-4">
      <LzSectionHead
        title="Что открывается"
        hint="Показывает, что сейчас работает с вашего компьютера. У каждого сервиса проверяется то, без чего им не пользоваться: у Discord — сервер чата, у YouTube — видео, у Telegram — ответ его серверов. Наведите на значок, чтобы увидеть подробности. Нажмите на красный или жёлтый — программа найдёт причину."
        right={
          <>
            <span className="text-[11px] text-muted-foreground">{busy ? 'проверяю…' : agoText(at)}</span>
            <Button size="sm" variant="outline" className="h-8 gap-1.5 text-xs" onClick={() => void load(true)} disabled={busy}>
              {busy ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />}
              Проверить
            </Button>
          </>
        }
      />
      <div className="mt-3 flex flex-wrap gap-2">
        {SERVICE_META.map((m) => {
          const r = results[m.id]
          const state: TileState = r?.state ?? 'unchecked'
          const t = CHIP[state]
          const clickable = state === 'down' || state === 'region' || state === 'slow' || state === 'partial'
          const domain = r?.checkDomain || m.siteDomain
          return (
            <Tooltip key={m.id}>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  aria-label={`${m.name}: ${t.label}`}
                  onClick={clickable ? () => navigate(`/diagnostics?site=${encodeURIComponent(domain)}`) : undefined}
                  className={cn(
                    'flex min-h-[46px] min-w-0 flex-auto items-center gap-2.5 rounded-xl border px-3 py-1.5 text-left transition-[filter,border-color,opacity]',
                    t.box,
                    clickable ? 'cursor-pointer hover:brightness-110' : 'cursor-default',
                    busy && 'opacity-60'
                  )}
                >
                  <span className="relative shrink-0">
                    <ServiceIcon id={m.id} className="size-[22px]" muted={t.muted} />
                    <span
                      aria-hidden
                      className={cn('absolute -right-1 -bottom-1 size-2.5 rounded-full border-2 border-[color:var(--background)]', t.dot)}
                    />
                  </span>
                  <span className="min-w-0">
                    <span className={cn('block truncate text-[12.5px] font-semibold leading-tight', t.muted ? 'text-muted-foreground' : 'text-foreground')}>
                      {m.name}
                    </span>
                    {(state !== 'ok' || r?.note) && (
                      <span className={cn('block truncate text-[10.5px] leading-tight', t.text)}>{r?.note || t.label}</span>
                    )}
                  </span>
                </button>
              </TooltipTrigger>
              <TooltipContent side="bottom">
                <SiteTip name={m.name} r={r} clickable={clickable} />
              </TooltipContent>
            </Tooltip>
          )
        })}
      </div>
      {(anyRegion || anyPartial) && (
        <div className="mt-2.5 space-y-0.5 text-[11px] leading-snug text-muted-foreground">
          {anyRegion && <p>Закрыт в регионе — поможет DNS или VPN: проверьте вкладку «DNS», там есть проверка нейросетей.</p>}
          {anyPartial && <p>«Частично» — ответили не все точки или доступ нужно подтвердить в браузере. Подробности — при наведении.</p>}
        </div>
      )}
    </LzPanel>
  )
}

export default SiteStrip
