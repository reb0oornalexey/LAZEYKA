import React from 'react'
import { BarChart3, Cloud, Cpu, FileText, Lightbulb, Loader2, Palette, ShieldBan, TriangleAlert } from 'lucide-react'
import { cn } from '@renderer/lib/utils'
import { EmptyState, LiveNumber, LzPanel, LzSectionHead, StatChip } from '@renderer/components/lz'
import type { AdminStats, CfUsage, VersionSummary } from '@renderer/utils/hub-admin-api'

const n0 = (n: number | null | undefined): string => (n == null ? '—' : Math.round(n).toLocaleString('ru-RU'))
const pctOf = (n: number, limit: number): number => (limit ? Math.round((n / limit) * 100) : 0)

/** Тон по доле расхода: до 70 % — обычный, до 90 % — предупреждение, выше — тревога. */
export const usageTone = (p: number): { bar: string; text: string } =>
  p >= 90 ? { bar: 'bg-st-err', text: 'text-st-err-text' } : p >= 70 ? { bar: 'bg-st-warn', text: 'text-st-warn-text' } : { bar: 'bg-st-ok', text: 'text-st-ok-text' }

/** Доля программ 2.0 и новее среди всех, кто отметился за окно (версии до 2.0 себя не называют). */
export function share20(s: VersionSummary | undefined): number | null {
  if (!s || !s.total) return null
  const n = s.versions.filter((x) => Number(x.v.split('.')[0]) >= 2).reduce((a, x) => a + x.n, 0)
  return Math.round((n / s.total) * 100)
}

/** Самый расходный лимит Cloudflare сегодня, % (null — аналитики нет). */
export function cfMaxPct(cf: CfUsage | null | undefined): number | null {
  if (!cf || !cf.ok) return null
  return cf.maxPct ?? Math.max(0, ...(cf.rows ?? []).map((r) => pctOf(r.today, r.limit)))
}

/** Полоса заполнения: цвет по порогу расхода (или свой класс). */
export const Meter: React.FC<{ value: number; className?: string; barClass?: string }> = ({ value, className, barClass }) => {
  const t = usageTone(value)
  return (
    <div className={cn('h-1.5 w-full overflow-hidden rounded-full bg-foreground/[0.08]', className)}>
      <div className={cn('h-full rounded-full transition-[width] duration-700', barClass ?? t.bar)} style={{ width: `${Math.min(100, Math.max(2, value))}%` }} />
    </div>
  )
}

/** Большое число с подписью — ячейка сетки счётчиков. */
const BigCell: React.FC<{ label: string; value: React.ReactNode; tone?: string; sub?: React.ReactNode }> = ({ label, value, tone, sub }) => (
  <div className="min-w-0 rounded-xl border border-foreground/[0.07] bg-foreground/[0.025] px-3.5 py-3">
    <div className="truncate text-[11.5px] text-muted-foreground">{label}</div>
    <LiveNumber value={value} className={cn('mt-1 text-[24px] leading-tight font-extrabold text-[color:var(--text-title)]', tone)} />
    {sub && <div className="mt-0.5 truncate text-[11px] text-muted-foreground">{sub}</div>}
  </div>
)

/** Распределение по версиям: итог крупно, системы одной полосой, полоски по версиям. */
const Versions: React.FC<{ title: string; s: VersionSummary | undefined }> = ({ title, s }) => {
  if (!s || !s.total)
    return (
      <div className="rounded-xl border border-foreground/[0.07] bg-foreground/[0.025] p-3.5">
        <div className="text-[13px] font-semibold">{title}</div>
        <div className="mt-2 text-[12px] text-muted-foreground">Пока никто не отметился.</div>
      </div>
    )
  const top = s.versions.slice(0, 6)
  const win = pctOf(s.win, s.total)
  const mac = pctOf(s.mac, s.total)
  const linux = pctOf(s.linux ?? 0, s.total)
  const s20 = share20(s)
  return (
    <div className="space-y-3 rounded-xl border border-foreground/[0.07] bg-foreground/[0.025] p-3.5">
      <div className="flex items-baseline justify-between gap-2">
        <div className="text-[13px] font-semibold">{title}</div>
        {s20 != null && <span className="text-[12px] text-muted-foreground">2.0 и новее — <b className="tabular-nums text-primary">{s20} %</b></span>}
      </div>
      <div className="flex items-baseline gap-2">
        <span className="text-[28px] leading-none font-extrabold tabular-nums text-[color:var(--text-title)]">{n0(s.total)}</span>
        <span className="text-[12px] text-muted-foreground">программ</span>
      </div>
      <div className="space-y-1">
        <div className="flex h-2 w-full overflow-hidden rounded-full bg-foreground/[0.08]">
          <div className="h-full bg-primary" style={{ width: `${win}%` }} title={`Windows ${s.win}`} />
          <div className="h-full bg-st-info" style={{ width: `${mac}%` }} title={`Mac ${s.mac}`} />
          {s.linux !== undefined && <div className="h-full bg-st-warn" style={{ width: `${linux}%` }} title={`Linux ${s.linux}`} />}
        </div>
        <div className="flex flex-wrap gap-x-3 text-[11px] text-muted-foreground">
          <span className="inline-flex items-center gap-1">
            <span aria-hidden className="size-1.5 rounded-full bg-primary" /> Windows <b className="tabular-nums text-foreground">{n0(s.win)}</b> · {win} %
          </span>
          <span className="inline-flex items-center gap-1">
            <span aria-hidden className="size-1.5 rounded-full bg-st-info" /> Mac <b className="tabular-nums text-foreground">{n0(s.mac)}</b> · {mac} %
          </span>
          {s.linux !== undefined && (
            <span className="inline-flex items-center gap-1">
              <span aria-hidden className="size-1.5 rounded-full bg-st-warn" /> Linux <b className="tabular-nums text-foreground">{n0(s.linux)}</b> · {linux} %
            </span>
          )}
          {s.latest && (
            <span>
              {s.latest} и выше — {pctOf(s.atLatest, s.total)} %
            </span>
          )}
        </div>
      </div>
      <div className="space-y-1.5">
        {top.map((x) => {
          const p = pctOf(x.n, s.total)
          return (
            <div key={x.v || 'none'} className="grid grid-cols-[5.5rem_minmax(0,1fr)_4.5rem] items-center gap-2 text-[12px]">
              <span className="truncate font-medium tabular-nums">{x.v || 'не сообщают'}</span>
              <Meter value={p} barClass="bg-primary/80" />
              <span className="text-right tabular-nums text-muted-foreground">
                {x.n} · <b className="text-foreground">{p} %</b>
              </span>
            </div>
          )
        })}
        {s.versions.length > 6 && <div className="text-[11px] text-muted-foreground">и ещё {s.versions.length - 6}</div>}
      </div>
    </div>
  )
}

const Loading: React.FC<{ loading: boolean; text?: string }> = ({ loading, text = 'Hub не прислал статистику. Нажмите «Обновить» в шапке.' }) => (
  <LzPanel className="p-4">
    {loading ? (
      <div className="flex h-28 items-center justify-center text-muted-foreground">
        <Loader2 className="size-4 animate-spin" />
      </div>
    ) : (
      <EmptyState compact icon={<BarChart3 />} title="Нет данных" text={text} />
    )}
  </LzPanel>
)

/** «Статистика»: счётчик онлайна, что пришло за сутки, версии и системы. */
export const AdminStatsPanel: React.FC<{ stats: AdminStats | null; loading: boolean }> = ({ stats, loading }) => {
  if (!stats) return <Loading loading={loading} />
  const c = stats.counter
  const vs = stats.versions
  return (
    <div className="flex flex-col gap-3" data-tour="author-stats">
      <LzPanel className="p-4">
        <LzSectionHead title="Счётчик онлайна" hint="Считаются программы со включённым счётчиком онлайна (Настройки → Обновления). Рекорд — наибольшее число одновременно в сети." className="mb-3" />
        {c ? (
          <div className="grid grid-cols-3 gap-2 lg:grid-cols-6">
            <BigCell label="В сети" value={n0(c.online)} tone="text-primary" />
            <BigCell label="За сутки" value={n0(c.day)} />
            <BigCell label="За 7 дней" value={n0(c.week)} />
            <BigCell label="За 30 дней" value={n0(c.month)} />
            <BigCell label="Установок" value={n0(c.total)} />
            <BigCell label="Рекорд" value={n0(c.peak)} />
          </div>
        ) : (
          <p className="text-[12px] text-muted-foreground">Счётчик онлайна не ответил.</p>
        )}
      </LzPanel>

      <LzPanel className="p-4">
        <LzSectionHead title="За сутки пришло" hint="Отчёты, темы и идеи от пользователей за последние 24 часа. Решать по ним — в боте." className="mb-3" />
        <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
          <StatChip icon={<FileText />} label="Отчётов" value={<LiveNumber value={stats.report} />} tone={stats.report ? 'on' : undefined} />
          <StatChip icon={<Lightbulb />} label="Идей" value={<LiveNumber value={stats.idea} />} />
          <StatChip icon={<Palette />} label="Тем" value={`${stats.theme}${stats.pendingThemes ? `, ждут решения ${stats.pendingThemes}` : ''}`} tone={stats.pendingThemes ? 'warn' : undefined} />
          <StatChip icon={<ShieldBan />} label="Заблокировано" value={<LiveNumber value={stats.banned} />} />
        </div>
      </LzPanel>

      {vs && (
        <LzPanel className="p-4" data-tour="author-stats-versions">
          <LzSectionHead
            title="Версии и системы"
            sub={vs.latest ? `Текущая версия ${vs.latest}` : undefined}
            hint="Считаются программы с включённым счётчиком онлайна; «не сообщают» — версии до 2.0, они свою версию и систему не называют."
            className="mb-3"
          />
          <div className="grid gap-3 lg:grid-cols-2">
            <Versions title="За 24 часа" s={vs.day} />
            <Versions title="За 7 дней" s={vs.week} />
          </div>
        </LzPanel>
      )}
    </div>
  )
}

/** «Cloudflare»: расход бесплатных лимитов за сутки по UTC — большие проценты и полосы с цветом порога. */
export const AdminCloudflarePanel: React.FC<{ stats: AdminStats | null; loading: boolean }> = ({ stats, loading }) => {
  if (!stats) return <Loading loading={loading} />
  const cf = stats.cf
  const max = cfMaxPct(cf)
  return (
    <LzPanel className="p-4" data-tour="author-stats-cloudflare">
      <LzSectionHead
        title="Ресурсы Cloudflare"
        sub="Сутки по UTC, сброс лимитов в 03:00 МСК"
        hint="Бесплатные лимиты Workers, KV и Durable Objects. После лимита запросы к Worker получают ошибку до сброса. Цвет полосы: до 70 % — спокойно, до 90 % — внимание, дальше — тревога."
        right={max != null ? <span className={cn('text-[13px] font-bold tabular-nums', usageTone(max).text)}>максимум {max} %</span> : undefined}
        className="mb-3"
      />
      {cf === undefined ? (
        <EmptyState compact icon={<Cloud />} title="Hub не присылает расход" text="Этот Hub старее аналитики Cloudflare. Обновите сервер — здесь появятся лимиты." />
      ) : !cf || cf.error === 'no_token' ? (
        <EmptyState compact icon={<Cloud />} title="Токен аналитики не подключён" text="Добавьте в Hub переменные CF_API_TOKEN и CF_ACCOUNT_ID (README). После этого здесь появятся лимиты." />
      ) : !cf.ok ? (
        <EmptyState compact icon={<TriangleAlert />} title="Аналитика не ответила" text={cf.message ? `Cloudflare: ${cf.message}. Попробуйте «Обновить» позже.` : 'Попробуйте «Обновить» позже.'} />
      ) : (
        <div className="space-y-3">
          <div className="grid gap-2 md:grid-cols-2">
            {(cf.rows ?? []).map((r) => {
              const p = pctOf(r.today, r.limit)
              const t = usageTone(p)
              return (
                <div key={r.key} className="space-y-2 rounded-xl border border-foreground/[0.07] bg-foreground/[0.025] px-3.5 py-3">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="min-w-0 truncate text-[12.5px] font-semibold">{r.label}</span>
                    <LiveNumber value={`${p} %`} className={cn('text-[24px] leading-none font-extrabold', t.text)} />
                  </div>
                  <Meter value={p} className="h-2" />
                  <div className="flex justify-between gap-2 text-[11px] text-muted-foreground tabular-nums">
                    <span>
                      {n0(r.today)} из {n0(r.limit)}
                    </span>
                    <span>
                      вчера {n0(r.yesterday)} · {pctOf(r.yesterday, r.limit)} %
                    </span>
                  </div>
                </div>
              )
            })}
          </div>
          {(cf.cpuP99Ms != null || cf.errors) && (
            <div className="grid gap-2 md:grid-cols-2">
              {cf.cpuP99Ms != null && (
                <StatChip
                  icon={<Cpu />}
                  label="Время процессора на запрос (99 %)"
                  value={`${cf.cpuP99Ms} мс из ${cf.cpuLimitMs ?? 10} мс`}
                  tone={cf.cpuP99Ms >= (cf.cpuLimitMs ?? 10) * 0.9 ? 'error' : cf.cpuP99Ms >= (cf.cpuLimitMs ?? 10) * 0.7 ? 'warn' : 'on'}
                />
              )}
              {cf.errors && (
                <StatChip
                  icon={<TriangleAlert />}
                  label="Ошибки Workers"
                  value={`сегодня ${n0(cf.errors.today)}, вчера ${n0(cf.errors.yesterday)}`}
                  tone={cf.errors.today ? 'warn' : 'on'}
                />
              )}
            </div>
          )}
          {cf.rowsNote && <p className="text-[11.5px] text-muted-foreground">{cf.rowsNote}</p>}
        </div>
      )}
    </LzPanel>
  )
}
