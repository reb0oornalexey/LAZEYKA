import React, { useState } from 'react'
import { Cloud, Inbox, Megaphone, Rocket, ShieldAlert, TriangleAlert, UsersRound } from 'lucide-react'
import { Button } from '@renderer/components/ui/button'
import { cn, pluralRu } from '@renderer/lib/utils'
import { LiveNumber, LzHero, StatusRing, TONE_FILL, TONE_TEXT, type LzTone, type RingSegment } from '@renderer/components/lz'
import { usageTone } from './admin-stats'

/*
 * Пульт «Админки» (Е8) — командный центр автора. Прибор слева — кольцо из пяти
 * дуг, по одной на показатель внизу (в том же порядке): за сутки, доля 2.0,
 * Cloudflare, заявки, предупреждения. В центре — сколько программ в сети сейчас.
 * Показатели нажимаются и открывают свой раздел; наведение подсвечивает дугу.
 * Только то, что программа уже получает от Hub, без новых запросов.
 */

const n0 = (n: number | null | undefined): string => (n == null ? '—' : Math.round(n).toLocaleString('ru-RU'))

export interface AdminPulse {
  online: number | null
  peak: number | null
  day: number | null
  week: number | null
  share20: number | null
  share20Of: number | null
  cfPct: number | null
  /** Почему расхода нет: «токен не подключён», «нет данных». */
  cfNote: string
  /** null — сбор ещё не загружен или Hub без заявок. */
  claims: number | null
  /** null — список предупреждений не загружен. */
  unread: number | null
  warnsTotal: number | null
  until: number | null
  latest: string | null
  loading: boolean
}

type Key = 'day' | 'share' | 'cf' | 'claims' | 'warns'

function greeting(d = new Date()): string {
  const h = d.getHours()
  if (h >= 5 && h < 12) return 'Доброе утро'
  if (h >= 12 && h < 18) return 'Добрый день'
  if (h >= 18 && h < 23) return 'Добрый вечер'
  return 'Доброй ночи'
}
const dayRu = (t: number): string => new Date(t).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' })

/** Показатель пульта: подпись с точкой тона, крупное число, внизу полоса или пояснение. */
const Gauge: React.FC<{
  id: Key
  icon: React.ReactNode
  label: string
  value: React.ReactNode
  tone: LzTone
  /** Полоса 0–100 под числом. */
  meter?: number | null
  meterClass?: string
  sub?: React.ReactNode
  title?: string
  onHover: (k: Key | null) => void
  onClick: () => void
}> = ({ id, icon, label, value, tone, meter, meterClass, sub, title, onHover, onClick }) => (
  <button
    type="button"
    title={title}
    onClick={onClick}
    onMouseEnter={() => onHover(id)}
    onMouseLeave={() => onHover(null)}
    onFocus={() => onHover(id)}
    onBlur={() => onHover(null)}
    className="group/g flex min-w-0 cursor-pointer flex-col gap-1 rounded-xl border border-foreground/[0.08] bg-foreground/[0.035] px-3 py-2.5 text-left transition-colors hover:border-primary/40 hover:bg-foreground/[0.06]"
  >
    <span className="flex items-center gap-1.5 text-[11.5px] leading-tight text-muted-foreground">
      <span className="flex size-3.5 shrink-0 items-center justify-center [&_svg]:size-3.5">{icon}</span>
      <span className="truncate">{label}</span>
      <span aria-hidden className={cn('ml-auto size-1.5 shrink-0 rounded-full', TONE_FILL[tone])} />
    </span>
    <LiveNumber value={value} className={cn('text-[21px] leading-tight font-extrabold text-[color:var(--text-title)]', tone === 'warn' || tone === 'error' ? TONE_TEXT[tone] : '')} />
    {meter != null ? (
      <span className="mt-1 mb-1 block h-1.5 w-full overflow-hidden rounded-full bg-foreground/[0.08]">
        <span className={cn('block h-full rounded-full transition-[width] duration-700', meterClass ?? 'bg-primary')} style={{ width: `${Math.min(100, Math.max(2, meter))}%` }} />
      </span>
    ) : (
      <span className="block truncate text-[11px] leading-[18px] text-muted-foreground">{sub ?? '\u00a0'}</span>
    )}
  </button>
)

export const AdminHero: React.FC<{
  p: AdminPulse
  onAnnounce: () => void
  onWarn: () => void
  onClaims: () => void
  onWarnList: () => void
  onStats: () => void
  onCloudflare: () => void
}> = ({ p, onAnnounce, onWarn, onClaims, onWarnList, onStats, onCloudflare }) => {
  const [hot, setHot] = useState<Key | null>(null)
  const ready = !p.loading || p.online != null

  const cfTone: LzTone = p.cfPct == null ? 'off' : p.cfPct >= 90 ? 'error' : p.cfPct >= 70 ? 'warn' : 'on'
  const tones: Record<Key, LzTone> = {
    day: p.day ? 'on' : 'off',
    share: p.share20 != null ? 'on' : 'off',
    cf: cfTone,
    claims: p.claims == null ? 'off' : p.claims > 0 ? 'warn' : 'on',
    warns: p.unread == null ? 'off' : p.unread > 0 ? 'busy' : 'on'
  }
  const segments: RingSegment[] = [
    { key: 'day', label: 'За сутки', tone: tones.day, icon: <UsersRound className="size-3.5" /> },
    { key: 'share', label: 'Доля 2.0', tone: tones.share, icon: <Rocket className="size-3.5" /> },
    { key: 'cf', label: 'Cloudflare', tone: tones.cf, icon: <Cloud className="size-3.5" /> },
    { key: 'claims', label: 'Заявки', tone: tones.claims, icon: <Inbox className="size-3.5" /> },
    { key: 'warns', label: 'Предупреждения', tone: tones.warns, icon: <ShieldAlert className="size-3.5" /> }
  ]

  const claims = p.claims ?? 0
  let tone: LzTone = 'on'
  let title: string
  if (!ready) {
    tone = 'off'
    title = 'Собираю показатели'
  } else if (p.cfPct != null && p.cfPct >= 90) {
    tone = 'warn'
    title = `Cloudflare почти на пределе: ${p.cfPct} %`
  } else if (claims > 0) {
    tone = 'warn'
    title = `Ждут решения: ${claims} ${pluralRu(claims, 'заявка', 'заявки', 'заявок')}`
  } else if (p.cfPct != null && p.cfPct >= 70) {
    tone = 'warn'
    title = `Расход Cloudflare выше обычного: ${p.cfPct} %`
  } else {
    title = 'Всё спокойно'
  }

  const meta = [p.until ? `ключ до ${dayRu(p.until)}` : null, p.latest ? `текущая версия ${p.latest}` : null].filter(Boolean).join(', ')
  const text = `${greeting()}, reb0oorn. Режим автора${meta ? `: ${meta}` : ''}.${claims > 0 ? ' Заявки можно решить здесь или в боте.' : ''}`

  const link = 'inline-flex cursor-pointer items-center gap-1.5 text-[12.5px] font-semibold text-primary hover:underline'

  return (
    <LzHero
      tone={tone}
      data-tour="admin-hero"
      visual={
        <StatusRing size={136} waves segments={segments} active={hot} halo={tone === 'off' ? null : tone === 'warn' ? 'warn' : 'on'} pulse={tone === 'on'}>
          <LiveNumber value={n0(p.online)} className="text-[38px] leading-none font-extrabold tracking-tight text-[color:var(--text-title)]" />
          <span className="mt-1 text-[11px] font-medium text-muted-foreground">в сети сейчас</span>
        </StatusRing>
      }
      title={title}
      text={text}
      extra={
        <>
          <button type="button" className={link} onClick={onWarn}>
            <TriangleAlert className="size-3.5" /> Предупредить
          </button>
          <button type="button" className={link} onClick={onClaims}>
            <Inbox className="size-3.5" /> Открыть заявки
          </button>
          {p.peak != null && <span className="text-[12px] text-muted-foreground">рекорд онлайна {n0(p.peak)}</span>}
        </>
      }
      actions={
        <Button size="lg" className="h-11 rounded-xl px-5 text-[14px]" onClick={onAnnounce} data-tour="admin-new-announce">
          <Megaphone className="size-4" /> Новое объявление
        </Button>
      }
      footer={
        <div className="grid grid-cols-5 gap-2" data-tour="admin-kpi">
          <Gauge
            id="day"
            icon={<UsersRound />}
            label="За сутки"
            value={n0(p.day)}
            tone={tones.day}
            sub={p.week != null ? `за 7 дней ${n0(p.week)}` : 'счётчик онлайна'}
            onHover={setHot}
            onClick={onStats}
          />
          <Gauge
            id="share"
            icon={<Rocket />}
            label="Доля 2.0"
            value={p.share20 == null ? '—' : `${p.share20} %`}
            tone={tones.share}
            meter={p.share20}
            meterClass="bg-primary"
            sub="нет данных"
            title={p.share20Of ? `2.0 и новее — из ${n0(p.share20Of)} программ за сутки` : 'Доля программ 2.0 и новее за сутки'}
            onHover={setHot}
            onClick={onStats}
          />
          <Gauge
            id="cf"
            icon={<Cloud />}
            label="Расход Cloudflare"
            value={p.cfPct == null ? '—' : `${p.cfPct} %`}
            tone={cfTone}
            meter={p.cfPct}
            meterClass={p.cfPct != null ? usageTone(p.cfPct).bar : undefined}
            sub={p.cfNote}
            title="Самый расходный бесплатный лимит за сегодня (сутки по UTC)"
            onHover={setHot}
            onClick={onCloudflare}
          />
          <Gauge
            id="claims"
            icon={<Inbox />}
            label="Заявки"
            value={p.claims == null ? '—' : p.claims}
            tone={tones.claims}
            sub={p.claims == null ? 'нет данных' : p.claims ? 'ждут решения' : 'все решены'}
            onHover={setHot}
            onClick={onClaims}
          />
          <Gauge
            id="warns"
            icon={<ShieldAlert />}
            label="Предупреждения"
            value={p.unread == null ? '—' : p.unread}
            tone={tones.warns}
            sub={p.unread == null ? 'нет данных' : p.unread ? `не прочитано из ${p.warnsTotal ?? 0}` : 'все прочитаны'}
            onHover={setHot}
            onClick={onWarnList}
          />
        </div>
      }
    />
  )
}
