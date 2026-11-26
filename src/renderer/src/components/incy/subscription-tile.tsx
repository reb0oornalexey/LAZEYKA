import React, { useState } from 'react'
import { CalendarClock, ChevronDown, HelpCircle, Plus, Send, Server, Star } from 'lucide-react'
import { Button } from '@renderer/components/ui/button'
import { LzPanel } from '@renderer/components/lz'
import { SubIcon } from './sub-icon'
import { SubscriptionProviderInfo } from './provider-info'
import { OpsIconButton, OpsStatusLine, type IncyOps } from './ping-ops-control'
import { daysText, gb, subUsage } from './signal'
import type { IncySubscription } from '@renderer/utils/ipc'
import { cn } from '@renderer/lib/utils'

const LEADING_EMOJI = /^[\p{Extended_Pictographic}\p{Regional_Indicator}️‍\s]+/u

/** Значок объявления по его тексту (как раньше на обеих вкладках). */
function annEmoji(ann: string): string {
  if (ann.includes('📶') || ann.includes('LTE')) return '📶'
  if (ann.includes('⚠️') || ann.includes('Глушат')) return '⚠️'
  if (ann.includes('⛔') || ann.includes('Перестало')) return '⛔'
  if (ann.includes('🆔') || ann.includes('⏱️')) return '🆔'
  return 'ℹ️'
}

/**
 * Объявления провайдера. Первое видно всегда, остальные — по «Ещё N»: на
 * Главной плитка не должна растягиваться на пол-экрана.
 */
export const SubAnnouncements: React.FC<{ items?: string[]; collapsible?: boolean; className?: string }> = ({ items, collapsible, className }) => {
  const [all, setAll] = useState(false)
  if (!items || items.length === 0) return null
  const shown = collapsible && !all ? items.slice(0, 1) : items
  return (
    <div className={cn('space-y-1', className)}>
      {shown.map((ann, idx) => (
        <div key={idx} className="flex items-start gap-2 rounded-lg bg-st-warn/[0.07] px-2 py-1 text-[11.5px] leading-snug text-st-warn-text">
          <span className="shrink-0">{annEmoji(ann)}</span>
          <span className={cn(collapsible && !all && 'line-clamp-2')}>{ann.replace(LEADING_EMOJI, '').trim() || ann}</span>
        </div>
      ))}
      {collapsible && items.length > 1 && (
        <button
          type="button"
          onClick={() => setAll((v) => !v)}
          className="flex cursor-pointer items-center gap-1 px-1 text-[11.5px] font-semibold text-muted-foreground hover:text-foreground"
        >
          <ChevronDown className={cn('size-3.5 transition-transform', all && 'rotate-180')} />
          {all ? 'Свернуть' : `Ещё ${items.length - 1} от провайдера`}
        </button>
      )}
    </div>
  )
}

/** Остаток трафика: тонкая полоса, подпись «осталось X из Y». */
export const TrafficLeft: React.FC<{ sub: IncySubscription; className?: string }> = ({ sub, className }) => {
  const u = subUsage(sub)
  if (u.leftBytes === null || u.totalBytes === null || u.usedPct === null) return null
  return (
    <div className={className} title={`Использовано ${gb(sub.usedBytes ?? 0)} из ${gb(u.totalBytes)}`}>
      <div className="flex items-baseline justify-between gap-2 text-[11.5px] text-muted-foreground">
        <span>Трафик</span>
        <span className={cn('tabular-nums', u.low ? 'font-semibold text-st-warn-text' : 'text-foreground/85')}>
          осталось {gb(u.leftBytes)} из {gb(u.totalBytes)}
        </span>
      </div>
      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-foreground/10">
        <div
          className={cn('h-full rounded-full transition-[width] duration-500', u.low ? 'bg-st-warn' : 'bg-primary')}
          style={{ width: `${Math.max(2, 100 - u.usedPct)}%` }}
        />
      </div>
    </div>
  )
}

/** Ссылки провайдера: сайт, поддержка, продление. */
export const SubLinks: React.FC<{ sub: IncySubscription; className?: string }> = ({ sub, className }) => {
  if (!sub.webPageUrl && !sub.supportUrl && !sub.premiumUrl) return null
  const link = (url: string, icon: React.ReactNode, label: string, accent?: boolean): React.ReactElement => (
    <button
      type="button"
      onClick={() => window.open(url, '_blank')}
      className={cn(
        'inline-flex cursor-pointer items-center gap-1.5 rounded-lg border px-2 py-1 text-[11.5px] font-semibold transition-colors',
        accent
          ? 'border-primary/35 bg-primary/10 text-primary hover:bg-primary/15'
          : 'border-foreground/[0.08] bg-foreground/[0.04] text-foreground/85 hover:border-primary/35'
      )}
    >
      {icon}
      {label}
    </button>
  )
  return (
    <div className={cn('flex flex-wrap gap-1.5', className)}>
      {sub.premiumUrl && link(sub.premiumUrl, <Star className="size-3.5" />, 'Продлить', true)}
      {sub.webPageUrl && link(sub.webPageUrl, <Send className="size-3.5" />, 'Канал / сайт')}
      {sub.supportUrl && link(sub.supportUrl, <HelpCircle className="size-3.5" />, 'Поддержка')}
    </div>
  )
}

interface TileProps {
  subscription: IncySubscription | null
  nodeCount: number
  others: IncySubscription[]
  othersCount: (id: string) => number
  onSwitchProvider: (sub: IncySubscription) => void
  onAdd: () => void
  ops: IncyOps
  pingDisabled: boolean
  hintsIgnored: boolean
  className?: string
}

/**
 * Плитка «Подписка» на Главной INCY: значок и имя провайдера, сколько дней и
 * трафика осталось, ссылки провайдера, объявления и быстрый переход к другим
 * подпискам. Без подписки — приглашение добавить её.
 */
export const SubscriptionTile: React.FC<TileProps> = ({
  subscription: sub,
  nodeCount,
  others,
  othersCount,
  onSwitchProvider,
  onAdd,
  ops,
  pingDisabled,
  hintsIgnored,
  className
}) => {
  if (!sub) {
    return (
      <LzPanel data-tour="incy-subscription" className={cn('flex flex-col gap-3 p-4', className)}>
        <div className="flex items-center gap-2.5">
          <span className="flex size-8 shrink-0 items-center justify-center rounded-full border border-dashed border-foreground/25 text-muted-foreground">
            <Plus className="size-4" />
          </span>
          <div className="min-w-0">
            <div className="text-[14px] font-bold text-[color:var(--text-title)]">Подписки пока нет</div>
            <div className="text-[11.5px] text-muted-foreground">нет VPN — нет и серверов</div>
          </div>
        </div>
        <p className="text-[12.5px] leading-relaxed text-muted-foreground">
          Подписка — это ссылка от VPN-сервиса. Её выдаёт Telegram-бот сервиса, а здесь достаточно её вставить.
        </p>
        <Button size="sm" variant="outline" className="mt-auto h-9 gap-1.5 rounded-xl text-xs" onClick={onAdd}>
          <Plus className="size-3.5" />
          У меня есть подписка — добавить
        </Button>
      </LzPanel>
    )
  }

  const u = subUsage(sub)
  return (
    <LzPanel
      tone={u.low ? 'warn' : 'off'}
      glow={10}
      data-tour="incy-subscription"
      className={cn('flex flex-col gap-2.5 p-4', u.low && 'border-st-warn/40', className)}
    >
      <div className="flex items-center gap-2.5">
        <SubIcon subId={sub.id} title={sub.title} />
        <div className="min-w-0 flex-1">
          <div data-sensitive="node" className="truncate text-[14px] font-bold text-[color:var(--text-title)]" title={sub.title}>
            {sub.title}
          </div>
          <div className="flex items-center gap-1 text-[11.5px] text-muted-foreground">
            <Server className="size-3" />
            <span className="tabular-nums">{nodeCount}</span> серв.
          </div>
        </div>
        <div className="flex shrink-0 items-center">
          <OpsIconButton kind="refresh" ops={ops} scope={{ type: 'sub', subId: sub.id }} title="Обновить подписку" activeHere />
          <OpsIconButton kind="ping" ops={ops} scope={{ type: 'all' }} title="Проверить пинг всех серверов" disabled={pingDisabled} activeHere />
        </div>
      </div>

      <div className="rounded-xl border border-foreground/[0.07] bg-foreground/[0.03] px-3 py-2.5">
        <div className="flex items-baseline gap-2">
          <CalendarClock className={cn('size-4 self-center', u.low ? 'text-st-warn-text' : 'text-muted-foreground')} />
          <span className={cn('text-[20px] leading-none font-extrabold tabular-nums', u.low ? 'text-st-warn-text' : 'text-[color:var(--text-title)]')}>
            {u.daysLeft !== null ? daysText(u.daysLeft) : sub.expireDate ? sub.expireDate : 'Без срока'}
          </span>
          {u.daysLeft !== null && u.daysLeft > 0 && <span className="text-[12px] text-muted-foreground">осталось</span>}
        </div>
        <TrafficLeft sub={sub} className="mt-2" />
      </div>

      <OpsStatusLine ops={ops} />
      <SubLinks sub={sub} />
      <SubAnnouncements items={sub.announcements} collapsible />
      <SubscriptionProviderInfo sub={sub} hintsIgnored={hintsIgnored} />

      {others.length > 0 && (
        <div className="mt-auto border-t border-foreground/[0.07] pt-2">
          <div className="mb-1.5 text-[11.5px] text-muted-foreground">Другие подписки — нажмите, чтобы переключиться</div>
          <div className="flex flex-wrap gap-1.5">
            {others.map((o) => {
              const n = othersCount(o.id)
              return (
                <button
                  key={o.id}
                  type="button"
                  disabled={n === 0}
                  onClick={() => onSwitchProvider(o)}
                  title={`Переключиться на «${o.title}»: возьмётся самый быстрый сервер`}
                  className="inline-flex max-w-full cursor-pointer items-center gap-1.5 rounded-lg border border-foreground/[0.08] bg-foreground/[0.04] py-0.5 pr-2 pl-1 text-[11.5px] font-semibold transition-colors hover:border-primary/40 disabled:cursor-default disabled:opacity-50"
                >
                  <SubIcon subId={o.id} title={o.title} size="sm" readOnly />
                  <span data-sensitive="node" className="truncate">
                    {o.title}
                  </span>
                  <span className="text-muted-foreground tabular-nums">{n}</span>
                </button>
              )
            })}
          </div>
        </div>
      )}
    </LzPanel>
  )
}

export default SubscriptionTile
