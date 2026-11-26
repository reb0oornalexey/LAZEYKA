import React from 'react'
import { Loader2, Wifi } from 'lucide-react'
import { Button } from '@renderer/components/ui/button'
import { EmptyState } from '@renderer/components/lz'
import { cn } from '@renderer/lib/utils'
import { useDiagStore } from './diag-store'
import { DiagCard, TONE_BOX, ToneList } from './diag-card'
import { ChannelChart } from './channel-chart'

const Num: React.FC<{ label: string; value: string }> = ({ label, value }) => (
  <div className="rounded-xl border border-foreground/[0.08] bg-foreground/[0.035] px-3 py-2">
    <div className="text-[11px] text-muted-foreground">{label}</div>
    <div className="mt-0.5 text-[15px] font-bold tabular-nums">{value}</div>
  </div>
)

const BAND_TEXT = { '2.4': '2,4 ГГц', '5': '5 ГГц', '6': '6 ГГц' } as const

export const WifiCard: React.FC = () => {
  const { busy, r } = useDiagStore((s) => s.wifi)
  const run = useDiagStore((s) => s.runWifi)

  const c = r?.current
  const worst = r?.advice.lines.some((l) => l.kind === 'bad') ? 'bad' : r?.advice.lines.some((l) => l.kind === 'warn') ? 'warn' : 'ok'

  return (
    <DiagCard
      icon={<Wifi className="h-4 w-4 text-primary" />}
      tour="diag-wifi"
      title="Wi-Fi"
      sub="Сигнал, канал и соседние сети"
      hint="Показывает сигнал и канал вашей сети, а также соседние сети по каналам. Если канал перегружен или сигнал слабый, лаги бывают из-за Wi-Fi, а не из-за провайдера."
      action={
        <Button size="sm" variant="outline" className="h-8 gap-1.5 text-xs" onClick={() => void run()} disabled={busy}>
          {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
          {busy ? 'Проверяю…' : r ? 'Проверить снова' : 'Проверить'}
        </Button>
      }
    >
      {!r && (
        <EmptyState
          compact
          icon={busy ? <Loader2 className="animate-spin" /> : <Wifi />}
          title={busy ? 'Проверяю…' : 'Как дела у вашего Wi-Fi'}
          text="Покажет силу сигнала, диапазон и канал, а также сколько соседних сетей сидят на том же канале."
          action={
            !busy && (
              <Button size="sm" className="h-8 text-xs" onClick={() => void run()}>
                Проверить Wi-Fi
              </Button>
            )
          }
        />
      )}
      {r && (
        <div className="space-y-3">
          {r.problem && r.problem !== 'location' && r.networks.length === 0 && !c ? (
            <div className={cn('rounded-xl border px-3 py-2 text-xs', TONE_BOX.warn)}>{r.message}</div>
          ) : (
            <>
              {c && (
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  <Num label="Сигнал" value={c.signalPct != null ? `${c.signalPct} %${c.rssiDbm != null ? ` (${c.rssiDbm} дБм)` : ''}` : '—'} />
                  <Num label="Диапазон" value={c.band ? BAND_TEXT[c.band] : '—'} />
                  <Num label="Канал" value={c.channel != null ? String(c.channel) : '—'} />
                  <Num label="Скорость соединения" value={c.rxMbps != null ? `${Math.round(c.rxMbps)} Мбит/с` : '—'} />
                </div>
              )}
              {r.problem && r.message && <div className={cn('rounded-xl border px-3 py-2 text-xs', TONE_BOX.warn)}>{r.message}</div>}
              <div className="grid items-start gap-3 lg:grid-cols-[minmax(0,1fr)_320px]">
                {r.channels.length > 0 ? <ChannelChart stats={r.channels} /> : <div />}
                <div className={cn('rounded-xl border px-3 py-2.5', TONE_BOX[worst])}>
                  <ToneList items={r.advice.lines} />
                </div>
              </div>
            </>
          )}
        </div>
      )}
    </DiagCard>
  )
}
