import React, { useCallback, useEffect, useState } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { ArrowRight, CalendarClock, Loader2, Pencil, RefreshCw, RotateCcw, Trash2, Unlink } from 'lucide-react'
import BasePage from '@renderer/components/base/base-page'
import { Button } from '@renderer/components/ui/button'
import { cn, pluralRu } from '@renderer/lib/utils'
import { useTourTab } from '@renderer/lib/tour-focus'
import { LiveNumber, LzPanel, LzSectionHead, type LzTone } from '@renderer/components/lz'
import { useAuthorState } from '@renderer/components/hub/use-author'
import { AdminAnnounceSection } from '@renderer/components/hub/admin-announce'
import { AdminDonationsSection, type DonTab } from '@renderer/components/hub/admin-donations'
import { AdminWarnSection, type WarnTab } from '@renderer/components/hub/admin-warn'
import { AdminCloudflarePanel, AdminStatsPanel, cfMaxPct, share20 } from '@renderer/components/hub/admin-stats'
import { AdminNav, isAdminTab, type AdminNavStatus, type AdminTab } from '@renderer/components/hub/admin-nav'
import { AdminHero } from '@renderer/components/hub/admin-hero'
import { AdminOverview } from '@renderer/components/hub/admin-overview'
import { HubModal } from '@renderer/components/hub/modal'
import { adminDnsPlan, adminStats, adminUnpair, adminWarns, adminWhoami, type AdminStats, type AdminWarn, type AdminWhoami, type DnsPlan } from '@renderer/utils/hub-admin-api'
import { adminDonations, type DonationsAdmin } from '@renderer/utils/hub-donations-api'

/*
 * «Админка» на языке «Сигнал» (Е8).
 *
 * Сверху пульт — кольцо из пяти показателей с онлайном в центре, состояние словами,
 * «Новое объявление» и быстрые переходы. Ниже слева список разделов (как группы в
 * «Настройках»), справа один открытый раздел вместо длинной простыни. Открытый
 * раздел запоминается.
 *
 * Пункт меню и страница есть только при привязке режима автора; без неё адрес ведёт
 * на главную. Все запросы — из главного процесса с ключом автора; окно знает только
 * «привязка есть / нет». Данные грузятся при открытии и по кнопке «Обновить»,
 * фоновых опросов нет.
 */

const TAB_KEY = 'lazeyka.admin.tab'
const msg = (e: unknown): string => (e instanceof Error ? e.message : String(e))
const dayRu = (t: number): string => new Date(t).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' })

function readTab(): AdminTab {
  try {
    const v = localStorage.getItem(TAB_KEY)
    if (isAdminTab(v)) return v
  } catch {
    /* хранилище недоступно */
  }
  return 'overview'
}

/** Счётчик каталога DNS: число крупно, подсветка, если есть неопубликованное. */
const DnsCount: React.FC<{ label: string; value: number }> = ({ label, value }) => (
  <div className={cn('rounded-xl border px-3.5 py-3', value ? 'border-primary/40 bg-primary/[0.07]' : 'border-foreground/[0.07] bg-foreground/[0.025]')}>
    <div className="text-[11.5px] text-muted-foreground">{label}</div>
    <LiveNumber value={value} className={cn('mt-1 text-[24px] leading-tight font-extrabold', value ? 'text-primary' : 'text-[color:var(--text-title)]')} />
  </div>
)

const Admin: React.FC = () => {
  const st = useAuthorState()
  const navigate = useNavigate()
  const paired = Boolean(st?.paired)
  const [who, setWho] = useState<AdminWhoami | null>(null)
  const [stats, setStats] = useState<AdminStats | null>(null)
  const [plan, setPlan] = useState<DnsPlan | null>(null)
  const [don, setDon] = useState<DonationsAdmin | null>(null)
  const [warns, setWarns] = useState<AdminWarn[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [rk, setRk] = useState(0)
  const [unpairAsk, setUnpairAsk] = useState(false)
  const [busy, setBusy] = useState(false)
  const [tab, setTabState] = useState<AdminTab>(readTab)
  const [donTab, setDonTab] = useState<DonTab>('list')
  const [warnTab, setWarnTab] = useState<WarnTab>('warn')
  const [focusNew, setFocusNew] = useState(0)

  const open = useCallback((t: AdminTab, remember = true): void => {
    setTabState(t)
    if (remember) {
      try {
        localStorage.setItem(TAB_KEY, t)
      } catch {
        /* не запомнится — не страшно */
      }
    }
  }, [])
  // Экскурсия может открыть раздел: шаг с tab = id раздела.
  const tourOpen = useCallback((t: string) => isAdminTab(t) && open(t, false), [open])
  useTourTab<string>('/admin', tourOpen)

  const load = useCallback(async () => {
    setLoading(true)
    const [w, s, p, d, wr] = await Promise.allSettled([adminWhoami(), adminStats(), adminDnsPlan(), adminDonations(), adminWarns()])
    if (w.status === 'fulfilled') setWho(w.value)
    if (s.status === 'fulfilled') setStats(s.value)
    if (p.status === 'fulfilled') setPlan(p.value)
    if (d.status === 'fulfilled') setDon(d.value)
    if (wr.status === 'fulfilled') setWarns(wr.value)
    const err = [w, s, d].find((x) => x.status === 'rejected') as PromiseRejectedResult | undefined
    if (err) toast.error('Админка', { description: msg(err.reason) })
    setLoading(false)
  }, [])

  useEffect(() => {
    if (paired) void load()
  }, [paired, load])

  if (st && !paired) return <Navigate to="/home" replace />

  const c = stats?.counter
  const s20 = share20(stats?.versions?.day)
  const cf = stats?.cf
  const cfPct = cfMaxPct(cf)
  const pending = plan ? plan.edits.length + plan.remove.length + plan.restore.length : 0
  const until = who?.until ?? st?.until ?? null
  const daysLeft = until ? Math.max(0, Math.ceil((until - Date.now()) / 86_400_000)) : null
  const claimsWait = don?.hasClaims ? don.claims.filter((x) => x.status === 'wait').length : null
  const unread = warns ? warns.filter((w) => !w.ack).length : null
  const activeCamp = don?.campaigns.find((x) => x.active) ?? null
  const annN = who?.announces.length ?? null

  const refresh = (): void => {
    void load()
    setRk((k) => k + 1)
  }

  const goClaims = (): void => {
    setDonTab('claims')
    open('donations')
  }
  const goWarn = (t: WarnTab): void => {
    setWarnTab(t)
    open('warn')
  }
  const goNewAnnounce = (): void => {
    open('announce')
    setFocusNew((n) => n + 1)
  }

  const unpair = async (): Promise<void> => {
    setBusy(true)
    try {
      const r = await adminUnpair()
      toast.success('Устройство отвязано', { description: r.serverOk ? 'Пункт «Админка» скрыт.' : 'Сервер не ответил: ключ стёрт здесь; на всякий случай отзовите его в боте.' })
    } catch (e) {
      toast.error('Не удалось', { description: msg(e) })
    } finally {
      setBusy(false)
      setUnpairAsk(false)
    }
  }

  const nav: Partial<Record<AdminTab, AdminNavStatus>> = {
    overview: { text: claimsWait ? 'есть что решить' : 'главное на одном экране', tone: claimsWait ? 'warn' : 'on' },
    announce: annN == null ? { text: loading ? 'загружаю…' : 'нет данных', tone: 'off' } : { text: annN ? `показываются ${annN} из ${who?.maxActive ?? 3}` : 'сейчас нет', tone: annN ? 'on' : 'off' },
    donations:
      claimsWait != null && claimsWait > 0
        ? { text: `ждут ${claimsWait} ${pluralRu(claimsWait, 'заявка', 'заявки', 'заявок')}`, tone: 'warn', badge: claimsWait }
        : activeCamp
          ? { text: `«${activeCamp.title}» — ${Math.round(activeCamp.pct)} %`, tone: 'on' }
          : { text: don ? 'активных сборов нет' : loading ? 'загружаю…' : 'нет данных', tone: 'off' },
    warn: unread == null ? { text: 'и шаблоны', tone: 'off' } : unread ? { text: `не прочитано ${unread}`, tone: 'busy', badge: unread } : { text: warns?.length ? 'все прочитаны' : 'и шаблоны', tone: warns?.length ? 'on' : 'off' },
    stats: c?.day != null ? { text: `за сутки ${Math.round(c.day).toLocaleString('ru-RU')}`, tone: 'on' } : { text: 'онлайн, версии, системы', tone: 'off' },
    dns: pending ? { text: `не опубликовано ${pending}`, tone: 'warn', badge: pending } : { text: who?.dns ? `версия ${who.dns.version}` : 'правок нет', tone: who?.dns ? 'on' : 'off' },
    cloudflare:
      cfPct != null
        ? { text: `расход ${cfPct} %`, tone: (cfPct >= 90 ? 'error' : cfPct >= 70 ? 'warn' : 'on') as LzTone }
        : { text: cf?.error === 'no_token' ? 'токен не подключён' : 'нет данных', tone: 'off' },
    device: daysLeft != null ? { text: `ключ ещё ${daysLeft} ${pluralRu(daysLeft, 'день', 'дня', 'дней')}`, tone: daysLeft <= 7 ? 'warn' : 'on' } : { text: 'привязано', tone: 'on' }
  }

  let body: React.ReactNode
  switch (tab) {
    case 'overview':
      body = (
        <AdminOverview
          who={who}
          don={don}
          warns={warns}
          loading={loading}
          onDonations={() => {
            setDonTab('list')
            open('donations')
          }}
          onClaims={goClaims}
          onAnnounce={() => open('announce')}
          onNewAnnounce={goNewAnnounce}
          onWarnList={() => goWarn('list')}
        />
      )
      break
    case 'announce':
      body = <AdminAnnounceSection who={who} loading={loading} onChanged={() => void load()} onWho={setWho} focusKey={focusNew} />
      break
    case 'donations':
      body = <AdminDonationsSection data={don} loading={loading} onData={setDon} tab={donTab} onTab={setDonTab} />
      break
    case 'warn':
      body = <AdminWarnSection key={`warn-${rk}`} tab={warnTab} onTab={setWarnTab} warns={warns} onWarns={setWarns} />
      break
    case 'stats':
      body = <AdminStatsPanel stats={stats} loading={loading} />
      break
    case 'cloudflare':
      body = <AdminCloudflarePanel stats={stats} loading={loading} />
      break
    case 'dns':
      body = (
        <LzPanel className="p-4" data-tour="admin-dns">
          <LzSectionHead
            title="Каталог DNS"
            sub={who?.dns ? `Опубликован: версия ${who.dns.version} от ${who.dns.updated}` : 'В Hub ещё не публиковался'}
            hint="Правки адресов и отметки «убрать у всех» делаются на странице DNS (меню у строки сервера) и публикуются там кнопкой «Опубликовать правки DNS»."
            right={
              <Button size="sm" variant={pending ? 'default' : 'outline'} onClick={() => navigate('/dns')}>
                {pending ? 'Опубликовать на странице DNS' : 'Открыть DNS'} <ArrowRight />
              </Button>
            }
            className="mb-3"
          />
          <div className="grid grid-cols-3 gap-2">
            <DnsCount label="Изменено" value={plan?.edits.length ?? 0} />
            <DnsCount label="Убрать у всех" value={plan?.remove.length ?? 0} />
            <DnsCount label="Вернуть" value={plan?.restore.length ?? 0} />
          </div>
          {pending > 0 && plan && (
            <div className="mt-3 divide-y divide-foreground/[0.06] overflow-hidden rounded-xl border border-foreground/[0.08]">
              {plan.edits.map((e) => (
                <div key={`e-${e.id}`} className="flex items-center gap-2.5 px-3.5 py-2 text-[12.5px]">
                  <Pencil className="size-3.5 shrink-0 text-primary" />
                  <span className="min-w-0 flex-1 truncate font-medium">{e.name}</span>
                  <span className="shrink-0 text-[11px] text-muted-foreground">адреса изменены</span>
                </div>
              ))}
              {plan.remove.map((e) => (
                <div key={`r-${e.id}`} className="flex items-center gap-2.5 px-3.5 py-2 text-[12.5px]">
                  <Trash2 className="size-3.5 shrink-0 text-st-err-text" />
                  <span className="min-w-0 flex-1 truncate font-medium">{e.name}</span>
                  <span className="max-w-[50%] shrink-0 truncate text-[11px] text-muted-foreground">{e.reason || 'убрать у всех'}</span>
                </div>
              ))}
              {plan.restore.map((e) => (
                <div key={`b-${e.id}`} className="flex items-center gap-2.5 px-3.5 py-2 text-[12.5px]">
                  <RotateCcw className="size-3.5 shrink-0 text-st-ok-text" />
                  <span className="min-w-0 flex-1 truncate font-medium">{e.name}</span>
                  <span className="shrink-0 text-[11px] text-muted-foreground">вернуть</span>
                </div>
              ))}
            </div>
          )}
          <p className="mt-3 text-[12px] text-muted-foreground">
            {pending ? `Не опубликовано: ${pending} ${pluralRu(pending, 'правка', 'правки', 'правок')}.` : 'Неопубликованных правок нет.'}
            {plan?.removed.length ? ` Уже убраны у всех: ${plan.removed.length}.` : ''}
          </p>
        </LzPanel>
      )
      break
    case 'device':
      body = (
        <LzPanel className="p-4" data-tour="author-unpair">
          <LzSectionHead
            title="Это устройство"
            sub={until ? `Ключ автора до ${dayRu(until)}` : undefined}
            hint="Ключ хранится только в защищённом хранилище системы. Срок — 90 дней, потом привязка заново: код из бота и «Да» в Telegram."
            className="mb-3"
          />
          {daysLeft != null && (
            <div className="space-y-2 rounded-xl border border-foreground/[0.07] bg-foreground/[0.025] px-4 py-3.5">
              <div className="flex items-baseline justify-between gap-2">
                <span className="inline-flex items-center gap-1.5 text-[12px] text-muted-foreground">
                  <CalendarClock className="size-3.5" /> Осталось до новой привязки
                </span>
                <span className={cn('text-[28px] leading-none font-extrabold tabular-nums', daysLeft <= 7 ? 'text-st-warn-text' : 'text-[color:var(--text-title)]')}>
                  {daysLeft} <span className="text-[14px] font-semibold text-muted-foreground">{pluralRu(daysLeft, 'день', 'дня', 'дней')}</span>
                </span>
              </div>
              <div className="h-2 w-full overflow-hidden rounded-full bg-foreground/[0.08]">
                <div className={cn('h-full rounded-full', daysLeft <= 7 ? 'bg-st-warn' : 'bg-primary')} style={{ width: `${Math.min(100, Math.max(2, (daysLeft / 90) * 100))}%` }} />
              </div>
              <div className="text-[11px] text-muted-foreground">из 90 дней</div>
            </div>
          )}
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <span className="min-w-0 flex-1 text-[12px] text-muted-foreground">Отвязка стирает ключ здесь и отзывает его в Hub. Пункт «Админка» пропадёт.</span>
            <Button size="sm" variant="outline" onClick={() => setUnpairAsk(true)} disabled={busy}>
              <Unlink /> Отвязать это устройство
            </Button>
          </div>
        </LzPanel>
      )
      break
  }

  return (
    <BasePage
      title="Админка"
      header={
        <Button size="sm" variant="outline" className="app-nodrag" onClick={refresh} disabled={loading}>
          <RefreshCw className={cn(loading && 'animate-spin')} /> Обновить
        </Button>
      }
    >
      <div className="mx-auto flex w-full max-w-[1080px] flex-col lz-page-gap lz-page-x pb-5">
        <AdminHero
          p={{
            online: c?.online ?? null,
            peak: c?.peak ?? null,
            day: c?.day ?? null,
            week: c?.week ?? null,
            share20: s20,
            share20Of: stats?.versions?.day?.total ?? null,
            cfPct,
            cfNote: cf && cf.error === 'no_token' ? 'токен не подключён' : cf && !cf.ok ? 'аналитика не ответила' : 'нет данных',
            claims: claimsWait,
            unread,
            warnsTotal: warns?.length ?? null,
            until,
            latest: who?.latest ?? null,
            loading
          }}
          onAnnounce={goNewAnnounce}
          onWarn={() => goWarn('warn')}
          onClaims={goClaims}
          onWarnList={() => goWarn('list')}
          onStats={() => open('stats')}
          onCloudflare={() => open('cloudflare')}
        />

        <div className="grid grid-cols-[220px_minmax(0,1fr)] items-start gap-3">
          <AdminNav active={tab} status={nav} onSelect={(t) => open(t)} />
          <div data-section={tab} className="min-w-0">
            {body}
          </div>
        </div>
      </div>

      <HubModal
        open={unpairAsk}
        onClose={() => setUnpairAsk(false)}
        locked={busy}
        icon={Unlink}
        title="Отвязать это устройство?"
        className="max-w-md"
        footer={
          <>
            <Button variant="ghost" onClick={() => setUnpairAsk(false)} disabled={busy}>
              Нет
            </Button>
            <Button variant="destructive" onClick={() => void unpair()} disabled={busy}>
              {busy ? <Loader2 className="animate-spin" /> : <Unlink />} Отвязать
            </Button>
          </>
        }
      >
        <p className="text-xs text-muted-foreground">Чтобы вернуть «Админку», нужен новый код из бота и подтверждение в Telegram.</p>
      </HubModal>
    </BasePage>
  )
}

export default Admin
