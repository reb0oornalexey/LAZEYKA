import React, { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Loader2, RefreshCw } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@renderer/components/ui/button'
import { Hint } from '@renderer/components/prematch/hint'
import { ServiceIcon } from '@renderer/components/service-icons'
import { cn } from '@renderer/lib/utils'
import { SERVICE_META, agoText, diagServices, type ServiceResult, type ServiceState } from '@renderer/utils/diag-api'

/**
 * Что отдаёт main (src/main/core/service-status.ts) сверх типов diag-api.ts:
 * состояние «частично», подпись под плиткой и результаты по точкам.
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

/**
 * Состояние показывает рамка плитки и подпись под названием; цвет самого значка
 * остаётся фирменным. У недоступного сервиса значок приглушён (muted).
 */
const TILE: Record<TileState, { label: string; box: string; text: string; dot: string; muted: boolean }> = {
  ok: { label: 'открывается', box: 'border-st-ok/50', text: 'text-st-ok-text', dot: 'bg-st-ok', muted: false },
  slow: { label: 'медленно', box: 'border-st-warn/50', text: 'text-st-warn-text', dot: 'bg-st-warn', muted: false },
  partial: { label: 'частично', box: 'border-st-warn/50', text: 'text-st-warn-text', dot: 'bg-st-warn', muted: false },
  down: { label: 'не открывается', box: 'border-st-err/50', text: 'text-st-err-text', dot: 'bg-st-err', muted: true },
  region: { label: 'недоступно в регионе', box: 'border-st-err/50', text: 'text-st-err-text', dot: 'bg-st-err', muted: true },
  unchecked: { label: 'не проверялось', box: 'border-border', text: 'text-muted-foreground', dot: 'bg-muted-foreground/50', muted: false }
}

const MARK: Record<PointReport['state'], string> = { ok: '✓', slow: '~', down: '✕', region: '✕', unverified: '?' }

/** Подсказка при наведении: итог и каждая проверенная точка. */
function tooltip(r: TileResult | undefined): string {
  if (!r) return 'Ещё не проверялось'
  const lines = [r.detail]
  for (const p of r.points ?? []) lines.push(`${MARK[p.state]} ${p.label} (${p.host}) — ${p.detail}`)
  return lines.join('\n')
}

/**
 * Панель сервисов на главной: что сейчас работает с этого компьютера.
 * Проверка идёт при открытии (если прошло больше 10 минут — решает main), по
 * кнопке «Проверить» и из мастера «Ничего не открывается?» (его результат
 * приходит сюда же событием diag:servicesUpdated). Сама по себе — никогда.
 */
const ServicesPanel: React.FC = () => {
  const navigate = useNavigate()
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

  const anyPartial = Object.values(results).some((r) => r.state === 'partial')

  return (
    <div data-tour="home-services" className="ui-card space-y-3 rounded-xl border border-border bg-card/40 p-4">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-sm font-bold">
          Сервисы
          <Hint text="Показывает, что сейчас работает с вашего компьютера. У каждого сервиса проверяется то, без чего им не пользоваться: у Discord — сервер чата, у YouTube — видео, у Telegram — ответ его серверов. Наведите на плитку, чтобы увидеть подробности. Нажмите на красную или жёлтую плитку — программа найдёт причину." />
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[11px] text-muted-foreground">{busy ? 'проверяю…' : agoText(at)}</span>
          <Button size="sm" variant="outline" className="h-8 gap-1.5 text-xs" onClick={() => void load(true)} disabled={busy}>
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
            Проверить
          </Button>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {SERVICE_META.map((m) => {
          const r = results[m.id]
          const state: TileState = r?.state ?? 'unchecked'
          const t = TILE[state]
          const clickable = state === 'down' || state === 'region' || state === 'slow' || state === 'partial'
          const domain = r?.checkDomain || m.siteDomain
          return (
            <button
              key={m.id}
              type="button"
              title={tooltip(r)}
              onClick={clickable ? () => navigate(`/diagnostics?site=${encodeURIComponent(domain)}`) : undefined}
              className={cn(
                'flex flex-col items-center gap-1 rounded-lg border bg-background/40 px-2 py-3 text-center transition-colors',
                t.box,
                clickable ? 'cursor-pointer hover:brightness-110' : 'cursor-default',
                busy && 'opacity-70'
              )}
            >
              <ServiceIcon id={m.id} className="h-7 w-7" muted={t.muted} />
              <span className={cn('text-xs font-semibold', t.muted ? 'text-muted-foreground' : 'text-foreground')}>{m.name}</span>
              <span className={cn('flex items-center gap-1 text-[11px] leading-tight', t.text)}>
                <span aria-hidden className={cn('inline-block size-1.5 shrink-0 rounded-full', t.dot)} />
                {t.label}
              </span>
              {r?.note && <span className="line-clamp-2 text-[10px] leading-tight text-muted-foreground">{r.note}</span>}
            </button>
          )
        })}
      </div>
      {Object.values(results).some((r) => r.state === 'region') && (
        <p className="text-[11px] text-muted-foreground">Недоступно в вашем регионе (поможет DNS или VPN): проверьте вкладку «DNS» — там есть проверка нейросетей.</p>
      )}
      {anyPartial && (
        <p className="text-[11px] text-muted-foreground">«Частично» — сервис отвечает, но его часть (видео, картинки, обновления) не грузится. Подробности — при наведении на плитку.</p>
      )}
    </div>
  )
}

export default ServicesPanel
