import React, { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { Bot, Check, Loader2, Minus, X } from 'lucide-react'
import { Button } from '@renderer/components/ui/button'
import { EmptyState, LzPanel, LzSectionHead } from '@renderer/components/lz'
import { cn } from '@renderer/lib/utils'
import { dnsApplySystem } from '@renderer/utils/ipc'
import { diagAiDns, onAiDnsEvent, type AiDnsResult, type AiDnsState } from '@renderer/utils/diag-api'

type CellView = { state: AiDnsState | 'running'; detail?: string; ip?: string | null; ms?: number | null }

const CELL: Record<AiDnsState, { text: string; cls: string; Icon: React.ElementType }> = {
  open: { text: 'открылось', cls: 'text-st-ok-text', Icon: Check },
  region: { text: 'отказ по региону', cls: 'text-st-warn-text', Icon: Minus },
  fail: { text: 'нет соединения', cls: 'text-st-err-text', Icon: X }
}

/**
 * «Нейросети по DNS» (вкладка DNS): для каждого DNS-сервера с DoH и каждой
 * нейросети — адрес через DoH этого сервера и запрос на этот адрес. Запуск
 * только по кнопке.
 */
const AiDnsCheckCard: React.FC = () => {
  const [running, setRunning] = useState(false)
  const [providers, setProviders] = useState<{ id: string; name: string }[]>([])
  const [services, setServices] = useState<{ id: string; name: string }[]>([])
  const [cells, setCells] = useState<Record<string, CellView>>({})
  const [result, setResult] = useState<AiDnsResult | null>(null)
  const [applying, setApplying] = useState(false)
  const unsub = useRef<(() => void) | null>(null)

  useEffect(() => () => unsub.current?.(), [])

  const run = async (): Promise<void> => {
    if (running) return
    setRunning(true)
    setResult(null)
    setCells({})
    unsub.current?.()
    unsub.current = onAiDnsEvent((e) => {
      if (e.kind === 'plan') {
        setProviders(e.providers)
        setServices(e.services)
      } else {
        setCells((p) => ({ ...p, [`${e.providerId}|${e.serviceId}`]: { state: e.state, detail: e.detail, ip: e.ip, ms: e.ms } }))
      }
    })
    try {
      const r = await diagAiDns()
      setResult(r)
      setProviders(r.providers)
      setServices(r.services)
      setCells(Object.fromEntries(r.cells.map((c) => [`${c.providerId}|${c.serviceId}`, { state: c.state, detail: c.detail, ip: c.ip, ms: c.ms }])))
    } catch (e) {
      toast.error('Проверка не удалась', { description: e instanceof Error ? e.message : String(e) })
    } finally {
      unsub.current?.()
      unsub.current = null
      setRunning(false)
    }
  }

  const best = result?.bestId ? providers.find((p) => p.id === result.bestId) : null

  const apply = async (): Promise<void> => {
    if (!best) return
    setApplying(true)
    try {
      const res = await dnsApplySystem(best.id)
      if (!res.success) toast.error('DNS не изменён', { description: res.message, duration: 10000 })
      else if (res.needsProfile) toast.info('Осталось установить профиль DNS', { description: 'Завершите установку на этой вкладке, в списке серверов.', duration: 10000 })
      else toast.success(res.message, { duration: 8000 })
    } catch (e) {
      toast.error('Не удалось изменить DNS', { description: e instanceof Error ? e.message : String(e) })
    } finally {
      setApplying(false)
    }
  }

  return (
    <LzPanel data-tour="dns-ai-check" tone={best ? 'on' : 'off'} glow={8} className="p-4">
      <LzSectionHead
        title="Нейросети по DNS"
        hint="Некоторые DNS отдают для нейросетей особые адреса, через которые они открываются без VPN. Проверка показывает, какой из них работает у вас. Запускается только по кнопке."
        sub={
          running
            ? 'Проверяю каждый DNS с шифрованием на каждой нейросети…'
            : result
              ? best
                ? `Лучше всех у вас: ${best.name}`
                : 'Ни один DNS не открыл нейросети в вашей сети'
              : 'Для каждого DNS с шифрованием — запрос к ChatGPT, Claude, Gemini и другим'
        }
        right={
          <Button size="sm" variant="outline" className="h-8 gap-1.5 rounded-lg text-xs" onClick={() => void run()} disabled={running}>
            {running ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Bot className="h-3.5 w-3.5" />}
            {running ? 'Проверяю…' : result ? 'Проверить ещё раз' : 'Проверить'}
          </Button>
        }
      />

      {providers.length === 0 && !running && (
        <EmptyState
          icon={<Bot />}
          title="Какой DNS открывает нейросети у вас"
          text="Проверка займёт до минуты. Настройки системы она не меняет: поставить лучший DNS можно будет одной кнопкой."
          action={
            <Button size="sm" className="h-9 gap-1.5 rounded-xl px-4 text-xs" onClick={() => void run()}>
              <Bot className="h-3.5 w-3.5" />
              Проверить
            </Button>
          }
        />
      )}
      {providers.length === 0 && running && (
        <div className="mt-3 space-y-2">
          {Array.from({ length: 4 }, (_, i) => (
            <div key={i} className="h-11 animate-pulse rounded-xl bg-foreground/[0.04]" />
          ))}
        </div>
      )}

      {providers.length > 0 && (
        <div className="mt-3 overflow-x-auto">
          <div className="grid min-w-[560px] gap-1" style={{ gridTemplateColumns: `minmax(150px, 1.2fr) repeat(${Math.max(1, services.length)}, minmax(0, 1fr))` }}>
            <div className="px-3 py-1 text-[11.5px] text-muted-foreground">DNS-сервер</div>
            {services.map((s) => (
              <div key={s.id} className="px-2 py-1 text-[11.5px] font-semibold text-muted-foreground">
                {s.name}
              </div>
            ))}
            {providers.map((p) => {
              const isBest = result?.bestId === p.id
              return (
                <React.Fragment key={p.id}>
                  <div
                    className={cn(
                      'flex items-center gap-2 rounded-xl px-3 py-2 text-[13px] font-semibold',
                      isBest ? 'bg-primary/12 text-primary' : 'bg-foreground/[0.03] text-foreground'
                    )}
                  >
                    <span className="truncate">{p.name}</span>
                    {isBest && <span className="shrink-0 rounded-md bg-primary px-1.5 py-px text-[10px] font-bold text-primary-foreground">лучший</span>}
                  </div>
                  {services.map((s) => {
                    const c = cells[`${p.id}|${s.id}`]
                    if (!c)
                      return (
                        <div key={s.id} className="flex items-center rounded-xl border border-dashed border-foreground/[0.1] px-2 text-[12px] text-muted-foreground">
                          —
                        </div>
                      )
                    if (c.state === 'running') {
                      return (
                        <div key={s.id} className="flex items-center rounded-xl bg-foreground/[0.03] px-2 text-muted-foreground">
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        </div>
                      )
                    }
                    const v = CELL[c.state]
                    return (
                      <div
                        key={s.id}
                        title={c.detail}
                        className={cn(
                          'flex items-center gap-1.5 rounded-xl px-2 text-[12px] font-medium',
                          v.cls,
                          c.state === 'open' ? 'bg-st-ok/[0.08]' : c.state === 'region' ? 'bg-st-warn/[0.08]' : 'bg-st-err/[0.07]'
                        )}
                      >
                        <v.Icon className="h-3.5 w-3.5 shrink-0" />
                        <span className="truncate">{v.text}</span>
                      </div>
                    )
                  })}
                </React.Fragment>
              )
            })}
          </div>
        </div>
      )}

      {result && (
        <div className="mt-3 flex items-center justify-between gap-2 rounded-xl border border-foreground/[0.08] bg-foreground/[0.035] px-3 py-2 text-[12.5px]">
          {best ? (
            <>
              <span>
                Лучший вариант: <b>{best.name}</b>. Он станет DNS системы.
              </span>
              <Button size="sm" className="h-8 rounded-lg text-xs" onClick={() => void apply()} disabled={applying}>
                {applying ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                {applying ? 'Ставлю…' : 'Поставить'}
              </Button>
            </>
          ) : (
            <span className="text-muted-foreground">Ни один DNS не открыл нейросети в вашей сети — понадобится VPN.</span>
          )}
        </div>
      )}
    </LzPanel>
  )
}

export default AiDnsCheckCard
