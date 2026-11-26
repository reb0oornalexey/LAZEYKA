import React from 'react'
import { ExternalLink, Loader2, ShieldQuestion } from 'lucide-react'
import { Button } from '@renderer/components/ui/button'
import { EmptyState } from '@renderer/components/lz'
import { cn } from '@renderer/lib/utils'
import { openExternalUrl } from '@renderer/utils/ipc'
import type { IpView } from '@renderer/utils/diag-api'
import { useDiagStore } from './diag-store'
import { DiagCard, TONE_BOX, ToneList } from './diag-card'
import { MaskedIp } from './masked-ip'

const Row: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <div className="flex items-center justify-between gap-3 border-t border-foreground/[0.06] px-1 py-2 text-xs first:border-t-0">
    <span className="text-muted-foreground">{label}</span>
    <span className="text-right">{children}</span>
  </div>
)

const Ip: React.FC<{ v: IpView | null }> = ({ v }) =>
  v?.ip ? (
    <span className="inline-flex flex-wrap items-center justify-end gap-2">
      <MaskedIp ip={v.ip} />
      {v.country && <span className="text-muted-foreground">{v.country}</span>}
    </span>
  ) : (
    <span className="text-muted-foreground">нет ответа</span>
  )

export const LeakCard: React.FC = () => {
  const { busy, r } = useDiagStore((s) => s.leak)
  const run = useDiagStore((s) => s.runLeak)

  return (
    <DiagCard
      icon={<ShieldQuestion className="h-4 w-4 text-primary" />}
      tour="diag-leak"
      title="Проверка утечек"
      sub="Какой адрес видят сайты и не уходит ли трафик мимо VPN"
      hint="Показывает, какой адрес видят сайты и не уходит ли часть трафика мимо VPN: по IPv4, IPv6 и DNS. Запросы идут к обычным сервисам определения адреса, больше ничего не отправляется."
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
          icon={busy ? <Loader2 className="animate-spin" /> : <ShieldQuestion />}
          title={busy ? 'Проверяю…' : 'Какой адрес видят сайты'}
          text="Проверка покажет внешний IP по IPv4 и IPv6, адрес мимо VPN и DNS адаптера. Займёт несколько секунд."
          action={
            !busy && (
              <Button size="sm" className="h-8 text-xs" onClick={() => void run()}>
                Проверить утечки
              </Button>
            )
          }
        />
      )}
      {r && (
        <div className="grid items-start gap-3 lg:grid-cols-2">
          <div className={cn('rounded-xl border px-3 py-2.5', TONE_BOX[r.verdict.kind])}>
            <div className="text-sm font-semibold">{r.verdict.headline}</div>
            <div className="mt-2">
              <ToneList items={r.verdict.items} />
            </div>
            {r.verdict.todo.length > 0 && (
              <div className="mt-2 text-xs">
                <div className="font-medium">Что сделать:</div>
                <ul className="ml-4 list-disc space-y-0.5">
                  {r.verdict.todo.map((t, i) => (
                    <li key={i}>{t}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
          <div>
            <Row label="Сайты видят (IPv4)">
              <Ip v={r.seen} />
            </Row>
            <Row label="Мимо VPN, с вашего адаптера">
              {r.direct.measurable ? <Ip v={r.direct} /> : <span className="text-muted-foreground">не измерить: {r.direct.reason}</span>}
            </Row>
            {r.vpnExit && (
              <Row label="Через узел VPN">
                <Ip v={r.vpnExit} />
              </Row>
            )}
            <Row label="IPv6 у сайтов">{r.v6.seen ? <MaskedIp ip={r.v6.seen} /> : <span className="text-muted-foreground">нет</span>}</Row>
            {r.v6.measurable && r.v6.seen && <Row label="IPv6 мимо VPN">{r.v6.direct ? <MaskedIp ip={r.v6.direct} /> : <span className="text-muted-foreground">нет</span>}</Row>}
            <Row label="DNS адаптера">
              {r.dns.system.length ? (
                <span className="inline-flex flex-wrap justify-end gap-x-2">
                  {r.dns.system.slice(0, 3).map((a) => (
                    <MaskedIp key={a} ip={a} />
                  ))}
                </span>
              ) : (
                <span className="text-muted-foreground">не удалось прочитать</span>
              )}
            </Row>
            {r.dns.tunnel && <Row label="DNS туннеля">{r.dns.tunnel}</Row>}
          </div>
        </div>
      )}
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        WebRTC из программы не проверить.
        <Button size="sm" variant="outline" className="h-7 gap-1 text-xs" onClick={() => void openExternalUrl('https://browserleaks.com/webrtc')}>
          <ExternalLink className="h-3 w-3" />
          Проверить WebRTC в браузере
        </Button>
      </div>
    </DiagCard>
  )
}
