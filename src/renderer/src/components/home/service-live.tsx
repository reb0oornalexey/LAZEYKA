import React from 'react'
import { Globe, Monitor } from 'lucide-react'
import { TelegramBrandIcon as TelegramIcon } from '@renderer/components/service-icons'
import { cn } from '@renderer/lib/utils'
import type { StrategyTestResult } from '@renderer/utils/ipc'

/*
 * «Служба дышит» — живые элементы модулей на главной. Только реальные данные:
 * баллы последней проверки стратегии Zapret, адрес прокси Telegram, пинг узла VPN.
 */

const box = 'rounded-xl border border-foreground/[0.07] bg-foreground/[0.03] px-3 py-2'

/** Zapret: результат последней проверки выбранной стратегии — делениями. */
export const StrategyScore: React.FC<{ result: StrategyTestResult | null; on: boolean; testing: boolean }> = ({ result, on, testing }) => {
  const total = result?.totalCount ?? 0
  const ok = result?.okCount ?? 0
  const cells = Math.max(total, 10)
  return (
    <div className={box} title={result ? `Последняя проверка этой стратегии: открылось ${ok} из ${total}` : 'Эту стратегию ещё не проверяли на вкладке Zapret'}>
      <div className="flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
        <span>{testing ? 'Идёт проверка стратегий…' : 'Проверка стратегии'}</span>
        {result && (
          <span className={cn('font-semibold tabular-nums', ok === total ? 'text-primary' : 'text-st-warn-text')}>
            {ok} из {total}
          </span>
        )}
      </div>
      <div className="mt-1.5 flex gap-[3px]">
        {Array.from({ length: cells }, (_, i) => {
          const filled = result ? i < Math.round((ok / Math.max(1, total)) * cells) : false
          return (
            <span
              key={i}
              className={cn(
                'h-1.5 flex-1 rounded-full transition-colors duration-500',
                filled ? (ok === total ? 'bg-primary' : 'bg-st-warn') : 'bg-foreground/10',
                filled && !on && 'opacity-50'
              )}
              style={{ transitionDelay: `${i * 30}ms` }}
            />
          )
        })}
      </div>
      {!result && !testing && <div className="mt-1 text-[11px] text-muted-foreground">не проверялась</div>}
    </div>
  )
}

/** Telegram: путь «компьютер → прокси LAZEYKA → сеть», точки бегут, пока прокси работает. */
export const ProxyPath: React.FC<{ port: number; on: boolean }> = ({ port, on }) => (
  <div className={cn(box, 'flex items-center gap-2')} title={on ? `Telegram подключается через прокси 127.0.0.1:${port}` : 'Прокси выключен'}>
    <Monitor className={cn('size-4 shrink-0', on ? 'text-foreground' : 'text-muted-foreground')} />
    <span className={cn('h-2 min-w-4 flex-1', on ? 'lz-travel text-primary' : 'border-t border-dashed border-foreground/20 self-center')} />
    <span
      className={cn(
        'flex shrink-0 items-center gap-1.5 rounded-md px-1.5 py-0.5 text-[11.5px] font-semibold tabular-nums',
        on ? 'bg-primary/15 text-primary' : 'bg-foreground/[0.06] text-muted-foreground'
      )}
    >
      <TelegramIcon className={cn('size-3.5', !on && 'grayscale opacity-70')} />
      127.0.0.1:{port}
    </span>
    <span className={cn('h-2 min-w-4 flex-1', on ? 'lz-travel text-primary' : 'border-t border-dashed border-foreground/20 self-center')} />
    <Globe className={cn('size-4 shrink-0', on ? 'text-foreground' : 'text-muted-foreground')} />
  </div>
)

/** VPN: узел с флагом и пинг — делениями «силы сигнала». */
export const PingMeter: React.FC<{ node: string | null; ping: number | null; on: boolean }> = ({ node, ping, on }) => {
  const bars = ping === null ? 0 : ping < 60 ? 5 : ping < 100 ? 4 : ping < 160 ? 3 : ping < 250 ? 2 : 1
  return (
    <div className={cn(box, 'flex items-center gap-3')}>
      <div className="min-w-0 flex-1">
        <div className="text-[11px] text-muted-foreground">{on ? 'Узел' : 'Выбранный узел'}</div>
        <div data-sensitive="node" className="truncate text-[13px] font-semibold text-foreground" title={node ?? undefined}>
          {node ?? 'не выбран'}
        </div>
      </div>
      <div className="flex shrink-0 items-end gap-2" title={ping !== null ? `Пинг до узла: ${ping} мс` : 'Пинг неизвестен'}>
        <div className="flex h-5 items-end gap-[3px]">
          {[1, 2, 3, 4, 5].map((b) => (
            <span
              key={b}
              className={cn('w-[4px] rounded-sm transition-colors duration-500', b <= bars ? (on ? 'bg-primary' : 'bg-muted-foreground/60') : 'bg-foreground/10')}
              style={{ height: `${b * 20}%` }}
            />
          ))}
        </div>
        <span className={cn('text-[15px] font-extrabold tabular-nums leading-none', on ? 'text-primary' : 'text-muted-foreground')}>
          {ping !== null ? `${ping}` : '—'}
          <span className="ml-0.5 text-[11px] font-semibold">мс</span>
        </span>
      </div>
    </div>
  )
}
