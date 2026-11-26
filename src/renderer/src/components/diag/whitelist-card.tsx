import React from 'react'
import { ListChecks, Loader2 } from 'lucide-react'
import { Button } from '@renderer/components/ui/button'
import { EmptyState } from '@renderer/components/lz'
import { cn } from '@renderer/lib/utils'
import type { Tone, WhitelistResult } from '@renderer/utils/diag-api'
import { useDiagStore } from './diag-store'
import { DiagCard, TONE_BOX } from './diag-card'

export const KIND_TONE: Record<NonNullable<WhitelistResult['verdict']>['kind'], Tone> = {
  whitelist: 'bad',
  normal: 'ok',
  'no-internet': 'warn',
  unclear: 'warn'
}

export const WhitelistCard: React.FC = () => {
  const { busy, r } = useDiagStore((s) => s.whitelist)
  const run = useDiagStore((s) => s.runWhitelist)

  return (
    <DiagCard
      icon={<ListChecks className="h-4 w-4 text-primary" />}
      tour="diag-whitelist"
      title="Белые списки"
      sub="Не включён ли у провайдера режим «только разрешённые сайты»"
      hint="В мобильных сетях бывает режим, когда открываются только разрешённые сайты. Проверка, мимо VPN, пробует российские и нейтральные зарубежные сайты и по ответам определяет, какой это случай."
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
          icon={busy ? <Loader2 className="animate-spin" /> : <ListChecks />}
          title={busy ? 'Проверяю…' : 'Режим белых списков'}
          text="Проверка мимо VPN пробует российские и зарубежные сайты и по ответам понимает, режет ли сеть всё, кроме разрешённого."
          action={
            !busy && (
              <Button size="sm" className="h-8 text-xs" onClick={() => void run()}>
                Проверить сеть
              </Button>
            )
          }
        />
      )}
      {r && !r.available && <div className={cn('rounded-xl border px-3 py-2.5 text-xs', TONE_BOX.warn)}>{r.message}</div>}
      {r?.verdict && (
        <div className="space-y-2">
          <div className={cn('rounded-xl border px-3 py-2.5', TONE_BOX[KIND_TONE[r.verdict.kind]])}>
            <div className="text-sm font-semibold">{r.verdict.headline}</div>
            <div className="mt-1 text-xs">{r.verdict.advice}</div>
          </div>
          <div className="grid grid-cols-1 gap-x-4 gap-y-1 text-xs sm:grid-cols-2">
            {r.probes.map((p) => (
              <div key={p.host} className="flex items-center justify-between gap-2 border-b border-foreground/[0.06] py-1.5">
                <span className="font-mono">{p.host}</span>
                <span className={p.ok ? 'text-st-ok-text' : 'text-st-err-text'}>{p.ok ? `отвечает${p.ms != null ? `, ${p.ms} мс` : ''}` : 'нет ответа'}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </DiagCard>
  )
}
