import React, { useEffect, useState } from 'react'
import { Eye, EyeOff, Loader2, Network } from 'lucide-react'
import { Button } from '@renderer/components/ui/button'
import { cn } from '@renderer/lib/utils'
import type { NatResult } from '@renderer/utils/prematch-api'
import { EmptyState, LzPanel, LzSectionHead } from '@renderer/components/lz'
import { maskIp } from './format'

const TYPE_STYLE: Record<NatResult['type'], string> = {
  open: 'border-st-ok/40 bg-st-ok/10 text-st-ok-text',
  moderate: 'border-st-ok/40 bg-st-ok/10 text-st-ok-text',
  strict: 'border-st-warn/40 bg-st-warn/10 text-st-warn-text',
  blocked: 'border-st-err/40 bg-st-err/10 text-st-err-text',
  unknown: 'border-foreground/[0.08] bg-foreground/[0.03] text-muted-foreground'
}

/** Проверка NAT по STUN. Внешний IP скрыт, пока человек не нажмёт «показать». */
export const NatCard: React.FC<{ result: NatResult | null; running: boolean; onRun: () => void }> = ({ result, running, onRun }) => {
  const [show, setShow] = useState(false)
  useEffect(() => setShow(false), [result])
  return (
    <LzPanel className="space-y-3 p-4">
      <LzSectionHead
        title="Проверка NAT"
        hint="NAT — это то, как роутер раздаёт один внешний адрес всем устройствам дома. От него зависит, смогут ли другие игроки подключиться к вам напрямую (лобби, голосовой чат). Проверка отправляет по одному маленькому запросу на публичные STUN-серверы Google и Cloudflare и сравнивает, каким они вас увидели."
        sub="Занимает пару секунд, запросы идут мимо VPN"
        right={
          <Button size="sm" variant="outline" className="h-8 shrink-0 gap-1.5 rounded-lg text-xs" disabled={running} onClick={onRun}>
            {running ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Network className="h-3.5 w-3.5" />}
            {running ? 'Проверяю…' : result ? 'Ещё раз' : 'Проверить NAT'}
          </Button>
        }
      />
      {!result && (
        <EmptyState
          compact
          icon={<Network />}
          title={running ? 'Проверяю…' : 'Тип NAT ещё не проверен'}
          text="Покажем, смогут ли другие игроки и голосовой чат подключаться к вам напрямую, и что сделать, если нет."
        />
      )}

      {result && (
        <div className="space-y-3">
          <div className={cn('rounded-xl border px-3 py-2', TYPE_STYLE[result.type])}>
            <div className="text-[15px] font-bold">{result.title}</div>
            <div className="mt-0.5 text-xs opacity-90">{result.summary}</div>
          </div>
          <dl className="grid gap-2 text-xs sm:grid-cols-2">
            <div className="rounded-xl border border-foreground/[0.08] bg-foreground/[0.03] p-2.5">
              <dt className="font-semibold">Для игр</dt>
              <dd className="mt-0.5 text-muted-foreground">{result.forGames}</dd>
            </div>
            <div className="rounded-xl border border-foreground/[0.08] bg-foreground/[0.03] p-2.5">
              <dt className="font-semibold">Для голосового чата</dt>
              <dd className="mt-0.5 text-muted-foreground">{result.forVoice}</dd>
            </div>
          </dl>
          <div className="text-xs">
            <div className="mb-1 font-semibold">Что можно сделать</div>
            <ul className="list-disc space-y-0.5 pl-4 text-muted-foreground">
              {result.advice.map((a) => (
                <li key={a}>{a}</li>
              ))}
            </ul>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <span>
              Внешний IP: <span className="tabular-nums text-foreground">{result.externalIp ? (show ? result.externalIp : maskIp(result.externalIp)) : '—'}</span>
            </span>
            {result.externalIp && (
              <Button size="sm" variant="ghost" className="h-6 gap-1 px-2 text-[11px]" onClick={() => setShow((v) => !v)}>
                {show ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
                {show ? 'скрыть' : 'показать'}
              </Button>
            )}
            <span>Ответили серверов: {result.replied} из {result.queried}.</span>
            {!result.viaPhysical && <span>Не удалось привязаться к физическому адаптеру, при включённом VPN результат может относиться к VPN.</span>}
          </div>
        </div>
      )}
    </LzPanel>
  )
}
