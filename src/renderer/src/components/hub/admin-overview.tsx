import React from 'react'
import { ArrowRight, CheckCheck, Clock, HandHeart, Inbox, Loader2, Megaphone, Plus, ShieldAlert } from 'lucide-react'
import { Button } from '@renderer/components/ui/button'
import { cn } from '@renderer/lib/utils'
import { EmptyState, LzPanel, LzSectionHead } from '@renderer/components/lz'
import { DON_DEFAULT_LEVELS, DON_PALETTE, levelOf, money, type DonationsAdmin } from '@renderer/utils/hub-donations-api'
import type { AdminWarn, AdminWhoami } from '@renderer/utils/hub-admin-api'
import { CampaignCard } from './admin-donations'
import { condText } from './admin-announce'
import { DonorChip } from './donation-ui'

/*
 * «Обзор» (Е8): главное на одном экране без прокрутки — активные сборы той же
 * плашкой, что в «Пожертвованиях» (большие цифры, проценты, полоса уровней),
 * заявки на проверке, объявления и последние предупреждения. Отсюда — переход
 * в нужный раздел; правка — там.
 */

const fmt = (t: number): string => new Date(t).toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
const DON_HEX: Record<string, string> = DON_PALETTE

const Spinner: React.FC = () => (
  <div className="flex h-20 items-center justify-center text-muted-foreground">
    <Loader2 className="size-4 animate-spin" />
  </div>
)

export const AdminOverview: React.FC<{
  who: AdminWhoami | null
  don: DonationsAdmin | null
  warns: AdminWarn[] | null
  loading: boolean
  onDonations: () => void
  onClaims: () => void
  onAnnounce: () => void
  onNewAnnounce: () => void
  onWarnList: () => void
}> = ({ who, don, warns, loading, onDonations, onClaims, onAnnounce, onNewAnnounce, onWarnList }) => {
  const levels = don?.levels ?? DON_DEFAULT_LEVELS
  const active = don?.campaigns.filter((c) => c.active) ?? []
  const wait = (don?.claims ?? []).filter((c) => c.status === 'wait').sort((a, b) => a.at - b.at)
  const ann = who?.announces ?? []
  const lastWarns = (warns ?? []).slice(0, 4)
  const campOf = (id: number): { title: string; cur: string } => {
    const c = don?.campaigns.find((x) => x.id === id)
    return { title: c?.title ?? 'сбор удалён', cur: c?.cur ?? '₽' }
  }

  return (
    <div className="flex flex-col gap-3">
      {/* Сборы — та же плашка, что в «Пожертвованиях». */}
      {!don ? (
        loading ? (
          <LzPanel>
            <Spinner />
          </LzPanel>
        ) : null
      ) : active.length ? (
        <div className={cn('grid gap-3', active.length > 1 && 'lg:grid-cols-2')}>
          {active.map((c) => (
            <CampaignCard
              key={c.id}
              camp={c}
              levels={levels}
              compact={active.length > 1}
              actions={
                <Button size="xs" variant="ghost" onClick={onDonations}>
                  {active.length > 1 ? 'Открыть' : 'Открыть сбор'} <ArrowRight />
                </Button>
              }
            />
          ))}
        </div>
      ) : (
        <LzPanel className="p-4">
          <EmptyState
            compact
            icon={<HandHeart />}
            title="Активных сборов нет"
            text="Сбор с полосой и «стеной благодарностей» появится у всех на странице «Поддержка»."
            action={
              <Button size="sm" variant="outline" onClick={onDonations}>
                <Plus /> Создать сбор
              </Button>
            }
          />
        </LzPanel>
      )}

      {wait.length > 0 && (
        <LzPanel tone="warn" glow={8} className="border-st-warn/35 p-4">
          <LzSectionHead
            title={`Ждут решения: ${wait.length}`}
            sub="Люди нажали «Я отправил пожертвование». Подтвердите или отклоните — человеку уйдёт ответ."
            right={
              <Button size="sm" variant="outline" onClick={onClaims}>
                <Inbox /> Открыть заявки
              </Button>
            }
            className="mb-2.5"
          />
          <div className="divide-y divide-foreground/[0.06] overflow-hidden rounded-xl border border-foreground/[0.08]">
            {wait.slice(0, 4).map((c) => {
              const { title, cur } = campOf(c.camp)
              return (
                <button key={c.id} type="button" onClick={onClaims} className="flex w-full cursor-pointer items-center gap-3 px-3.5 py-2.5 text-left hover:bg-foreground/[0.03]">
                  <DonorChip nick={c.nick} levels={levels} level={levelOf(levels, c.amount)} size="sm" className="max-w-[40%]" />
                  <span className="shrink-0 text-[15px] font-extrabold tabular-nums">{money(c.amount, cur)}</span>
                  <span className="min-w-0 flex-1 truncate text-[12px] text-muted-foreground">
                    «{title}»{c.method ? `, через ${c.method}` : ''}
                  </span>
                  <span className="shrink-0 text-[11px] text-muted-foreground tabular-nums">{fmt(c.at)}</span>
                </button>
              )
            })}
          </div>
          {wait.length > 4 && <div className="mt-2 text-[11.5px] text-muted-foreground">и ещё {wait.length - 4}</div>}
        </LzPanel>
      )}

      <div className="grid items-start gap-3 lg:grid-cols-2">
        <LzPanel className="p-4">
          <LzSectionHead
            title="Объявления"
            sub={who ? `Показываются ${ann.length} из ${who.maxActive}` : undefined}
            right={
              <Button size="sm" variant="outline" onClick={ann.length ? onAnnounce : onNewAnnounce}>
                {ann.length ? (
                  <>
                    Открыть <ArrowRight />
                  </>
                ) : (
                  <>
                    <Megaphone /> Написать
                  </>
                )}
              </Button>
            }
            className="mb-2.5"
          />
          {!who ? (
            loading ? <Spinner /> : null
          ) : ann.length ? (
            <div className="space-y-1.5">
              {ann.map((a) => (
                <button
                  key={String(a.id)}
                  type="button"
                  onClick={onAnnounce}
                  className="relative block w-full cursor-pointer overflow-hidden rounded-xl border border-foreground/[0.08] bg-foreground/[0.025] py-2 pr-3 pl-4 text-left transition-colors hover:border-primary/40"
                >
                  <span aria-hidden className="absolute top-0 bottom-0 left-0 w-[3px] bg-primary" style={a.accent && DON_HEX[a.accent] ? { background: DON_HEX[a.accent] } : undefined} />
                  <span className="line-clamp-2 text-[12.5px] leading-snug">
                    {a.emoji ? `${a.emoji} ` : ''}
                    {a.text}
                  </span>
                  <span className="mt-0.5 block text-[11px] text-muted-foreground">
                    до {fmt(a.until)}, {a.label || condText(a.os, a.ver)}
                  </span>
                </button>
              ))}
            </div>
          ) : (
            <EmptyState
              compact
              icon={<Megaphone />}
              title="Сейчас объявлений нет"
              text="Плашка на главной и уведомление у всех, кому подходит условие."
              action={
                <Button size="sm" onClick={onNewAnnounce}>
                  <Megaphone /> Новое объявление
                </Button>
              }
            />
          )}
        </LzPanel>

        <LzPanel className="p-4">
          <LzSectionHead
            title="Последние предупреждения"
            sub={warns ? `Не прочитано ${warns.filter((w) => !w.ack).length} из ${warns.length}` : undefined}
            right={
              <Button size="sm" variant="outline" onClick={onWarnList}>
                Открыть <ArrowRight />
              </Button>
            }
            className="mb-2.5"
          />
          {!warns ? (
            loading ? <Spinner /> : <p className="py-4 text-center text-[12px] text-muted-foreground">Hub не прислал список.</p>
          ) : lastWarns.length ? (
            <div className="divide-y divide-foreground/[0.06] overflow-hidden rounded-xl border border-foreground/[0.08]">
              {lastWarns.map((w) => (
                <div key={w.id} className="relative px-3.5 py-2">
                  <span aria-hidden className={cn('absolute top-2 bottom-2 left-0 w-[3px] rounded-r-full', w.lvl === 'yellow' && w.kind === 'warn' ? 'bg-st-warn' : 'bg-st-err')} />
                  <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                    <span className="font-mono text-foreground/80">{w.install || '—'}</span>
                    <span>{w.kind === 'ban' ? 'блокировка' : w.lvl === 'yellow' ? 'жёлтое' : 'красное'}</span>
                    <span className={cn('ml-auto inline-flex items-center gap-1', w.ack ? 'text-st-ok-text' : 'text-st-warn-text')}>
                      {w.ack ? <CheckCheck className="size-3" /> : <Clock className="size-3" />}
                      {w.ack ? 'прочитано' : 'не прочитано'}
                    </span>
                  </div>
                  <p className="mt-0.5 truncate text-[12.5px]">{w.text}</p>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState compact icon={<ShieldAlert />} title="Предупреждений не было" text="Личное сообщение установке по коду из бота: жёлтая или красная плашка вверху окна." />
          )}
        </LzPanel>
      </div>
    </div>
  )
}
