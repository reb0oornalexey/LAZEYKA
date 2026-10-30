import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import { Activity, CheckCircle2, Loader2, Search, ShieldAlert, X } from 'lucide-react'
import {
  incyGetAppTraffic,
  incyGetConnections,
  incyCloseConnection,
  exitLagCheck,
  type AppTraffic,
  type HostTraffic,
  type LiveConnection,
  type ExitLagCheckResult
} from '@renderer/utils/ipc'
import { cn } from '@renderer/lib/utils'
import { appLabel, listHasProc } from '@renderer/utils/per-app'

interface Props {
  /** Приложения из списка ExitLag. */
  apps: string[]
  /** Туннель поднят в режиме ExitLag — только тогда есть что показывать. */
  active: boolean
  mode: 'proxy_only' | 'bypass_only'
  /** Те же функции, что использует список ExitLag на странице (горячее применение уже внутри). */
  onAddApp: (name: string) => Promise<void>
  onRemoveApp: (name: string) => Promise<void>
}

function fmtBytes(b: number): string {
  if (b < 1024) return `${Math.round(b)} Б`
  if (b < 1024 ** 2) return `${(b / 1024).toFixed(b < 10 * 1024 ? 1 : 0)} КБ`
  if (b < 1024 ** 3) return `${(b / 1024 ** 2).toFixed(b < 10 * 1024 ** 2 ? 1 : 0)} МБ`
  return `${(b / 1024 ** 3).toFixed(2)} ГБ`
}
function fmtRate(bps: number): string {
  if (bps < 1) return '0'
  return `${fmtBytes(bps)}/с`
}
function fmtDur(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000))
  if (s < 60) return `${s} с`
  if (s < 3600) return `${Math.floor(s / 60)} мин`
  return `${Math.floor(s / 3600)} ч ${Math.floor((s % 3600) / 60)} мин`
}

/** Цвет маршрута: VPN — акцент, напрямую — нейтральный, прочее — янтарный. */
function routeClass(route: string): string {
  if (route === 'VPN') return 'text-primary'
  if (route === 'напрямую') return 'text-muted-foreground'
  return 'text-st-warn-text'
}

const OWN = new Set(['xray.exe', 'sing-box.exe', 'python.exe', 'tgwsproxy_windows.exe', 'xray', 'sing-box', 'sing-box-lx', 'sing-box-lxd'])

/** Опрос только пока карточка на экране и окно видимо. */
function usePolling(enabled: boolean, ms: number, fn: () => Promise<void>): void {
  const ref = useRef(fn)
  ref.current = fn
  useEffect(() => {
    if (!enabled) return
    let stopped = false
    const run = async (): Promise<void> => {
      if (stopped || document.visibilityState === 'hidden') return
      await ref.current().catch(() => void 0)
    }
    void run()
    const t = setInterval(() => void run(), ms)
    return () => {
      stopped = true
      clearInterval(t)
    }
  }, [enabled, ms])
}

const ExitLagTrafficCard: React.FC<Props> = ({ apps, active, mode, onAddApp, onRemoveApp }) => {
  const [tab, setTab] = useState<'apps' | 'conns'>('apps')
  const [traffic, setTraffic] = useState<AppTraffic[] | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const [hosts, setHosts] = useState<HostTraffic[]>([])
  const [conns, setConns] = useState<LiveConnection[] | null>(null)
  const [query, setQuery] = useState('')
  const [onlyListed, setOnlyListed] = useState(false)
  const [busyName, setBusyName] = useState<string | null>(null)
  const [check, setCheck] = useState<ExitLagCheckResult | null>(null)
  const [checking, setChecking] = useState(false)
  /** Прошлые счётчики соединений — для скорости. */
  const prev = useRef<Map<string, { up: number; down: number; at: number }>>(new Map())
  const [speeds, setSpeeds] = useState<Map<string, { d: number; u: number }>>(new Map())

  useEffect(() => {
    if (!active) {
      setTraffic(null)
      setConns(null)
      setHosts([])
      prev.current = new Map()
    }
  }, [active])

  usePolling(active && tab === 'apps', 2000, async () => {
    const r = await incyGetAppTraffic(selected ?? undefined)
    setTraffic(r.apps)
    setHosts(r.apps.find((a) => a.name.toLowerCase() === selected?.toLowerCase())?.hosts ?? [])
  })

  usePolling(active && tab === 'conns', 2000, async () => {
    const list = await incyGetConnections()
    if (!list) {
      setConns([])
      return
    }
    const now = Date.now()
    const sp = new Map<string, { d: number; u: number }>()
    const next = new Map<string, { up: number; down: number; at: number }>()
    for (const c of list) {
      const p = prev.current.get(c.id)
      if (p && now > p.at) {
        const dt = (now - p.at) / 1000
        sp.set(c.id, { d: Math.max(0, (c.download - p.down) / dt), u: Math.max(0, (c.upload - p.up) / dt) })
      }
      next.set(c.id, { up: c.upload, down: c.download, at: now })
    }
    prev.current = next
    setSpeeds(sp)
    setConns(list)
  })

  // Утечки: приложения не из списка, которые прямо сейчас идут через VPN (только режим белого списка).
  const leaks = useMemo(
    () =>
      mode === 'proxy_only' && traffic
        ? traffic.filter((a) => a.open > 0 && a.route === 'VPN' && !listHasProc(apps, a.name, a.rule) && !OWN.has(a.name.toLowerCase()))
        : [],
    [traffic, apps, mode]
  )

  type Row = { name: string; rule?: string; t: AppTraffic | null; inList: boolean }
  const rows: Row[] = useMemo(() => {
    const seen = new Set<string>()
    const out: Row[] = []
    for (const t of traffic ?? []) {
      const k = t.name.toLowerCase()
      if (OWN.has(k)) continue
      seen.add(k)
      out.push({ name: t.name, rule: t.rule, t, inList: listHasProc(apps, t.name, t.rule) })
    }
    for (const a of apps) {
      const label = appLabel(a)
      if (!seen.has(label.toLowerCase())) out.push({ name: label, rule: a, t: null, inList: true })
    }
    return out
  }, [traffic, apps])

  const act = async (name: string, fn: () => Promise<void>): Promise<void> => {
    setBusyName(name)
    try {
      await fn()
    } finally {
      setBusyName(null)
    }
  }

  const runCheck = async (): Promise<void> => {
    if (checking) return
    setChecking(true)
    try {
      setCheck(await exitLagCheck())
    } catch (e) {
      setCheck({
        exitLagActive: active,
        mode,
        outside: { ip: null },
        listed: { ip: null },
        selfListed: false,
        verdict: 'unknown',
        message: e instanceof Error ? e.message : String(e)
      })
    } finally {
      setChecking(false)
    }
  }

  const closeConn = useCallback(async (id: string) => {
    const ok = await incyCloseConnection(id).catch(() => false)
    if (ok) setConns((l) => l?.filter((c) => c.id !== id) ?? l)
    else toast.error('Не удалось закрыть соединение')
  }, [])

  const filteredConns = useMemo(() => {
    const q = query.trim().toLowerCase()
    return (conns ?? [])
      .filter((c) => !onlyListed || listHasProc(apps, c.process, c.appRule))
      .filter((c) => !q || c.process.toLowerCase().includes(q) || c.host.toLowerCase().includes(q))
      .sort((a, b) => b.start - a.start)
  }, [conns, query, onlyListed, apps])

  const totals = useMemo(
    () => filteredConns.reduce((s, c) => ({ d: s.d + c.download, u: s.u + c.upload }), { d: 0, u: 0 }),
    [filteredConns]
  )

  const sel = rows.find((r) => r.name.toLowerCase() === selected?.toLowerCase()) ?? null

  const tabBtn = (id: 'apps' | 'conns', label: string): React.JSX.Element => (
    <button
      type="button"
      onClick={() => setTab(id)}
      className={cn(
        'rounded-md px-2.5 py-1 text-[11px] font-semibold transition-colors cursor-pointer',
        tab === id ? 'bg-primary/15 text-primary' : 'text-muted-foreground hover:text-foreground'
      )}
    >
      {label}
    </button>
  )

  return (
    <div className="cyber-card space-y-2 rounded-xl border border-border/50 bg-background/40 p-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-xs font-semibold">
          <Activity className="h-3.5 w-3.5 text-primary" />
          Сеть приложений
        </div>
        <div className="flex items-center gap-1">
          {tabBtn('apps', 'Приложения')}
          {tabBtn('conns', 'Соединения')}
        </div>
      </div>

      {!active ? (
        <p className="text-[11px] text-muted-foreground">
          Появится, когда VPN работает в режиме ExitLag — тут будет видно, какие приложения выходят в сеть и куда.
        </p>
      ) : tab === 'apps' ? (
        traffic === null ? (
          <p className="text-[11px] text-muted-foreground">Получаю данные ядра…</p>
        ) : rows.length === 0 ? (
          <p className="text-[11px] text-muted-foreground">Пока тихо — приложения ещё не выходили в сеть.</p>
        ) : (
          <div className="space-y-1">
            {rows.map((r) => {
              const isSel = sel?.name === r.name
              return (
                <div key={r.name} className="rounded-lg border border-transparent hover:border-border/60">
                  <button
                    type="button"
                    onClick={() => setSelected(isSel ? null : r.name)}
                    className={cn(
                      'flex w-full items-center justify-between gap-2 rounded-lg px-2 py-1 text-left text-[11px] cursor-pointer',
                      isSel && 'bg-primary/10'
                    )}
                  >
                    <span className="flex min-w-0 items-center gap-1.5">
                      <span
                        className={cn(
                          'size-1.5 shrink-0 rounded-full',
                          !r.t ? 'bg-muted-foreground/40' : r.t.open > 0 ? 'bg-primary' : 'bg-muted-foreground/60'
                        )}
                      />
                      <span className="truncate font-mono font-semibold">{r.name}</span>
                      {r.inList && <span className="shrink-0 rounded bg-primary/10 px-1 text-[9px] text-primary">в списке</span>}
                    </span>
                    <span className="flex shrink-0 items-center gap-2 text-muted-foreground">
                      {r.t ? (
                        <>
                          <span className={cn('font-semibold', routeClass(r.t.route))}>
                            {r.t.route === 'VPN' ? 'через VPN' : r.t.route}
                          </span>
                          <span>↓ {fmtBytes(r.t.download)} ↑ {fmtBytes(r.t.upload)}</span>
                          <span className="w-16 text-right tabular-nums">{fmtRate(r.t.downSpeed + r.t.upSpeed)}</span>
                        </>
                      ) : (
                        <span>в списке, но ещё не выходило в сеть</span>
                      )}
                    </span>
                  </button>

                  {isSel && (
                    <div className="space-y-2 px-2 pb-2 pt-1">
                      <div className="flex flex-wrap gap-1.5">
                        {(() => {
                          const viaVpnIsAdd = mode === 'proxy_only'
                          const vpnDisabled = viaVpnIsAdd ? r.inList : !r.inList
                          return (
                            <button
                              type="button"
                              disabled={busyName === r.name || vpnDisabled}
                              onClick={() => void act(r.name, () => (viaVpnIsAdd ? onAddApp(r.rule ?? r.name) : onRemoveApp(r.rule ?? r.name)))}
                              className="rounded-lg border border-primary/40 px-2 py-1 text-[11px] font-semibold text-primary hover:bg-primary/10 disabled:opacity-40 cursor-pointer"
                            >
                              Пустить через VPN
                            </button>
                          )
                        })()}
                        {mode === 'proxy_only' ? (
                          <button
                            type="button"
                            disabled={busyName === r.name || !r.inList}
                            onClick={() => void act(r.name, () => onRemoveApp(r.rule ?? r.name))}
                            className="rounded-lg border border-border/60 px-2 py-1 text-[11px] font-semibold hover:border-destructive/50 hover:text-destructive disabled:opacity-40 cursor-pointer"
                          >
                            Убрать из ExitLag
                          </button>
                        ) : (
                          <button
                            type="button"
                            disabled={busyName === r.name || r.inList}
                            onClick={() => void act(r.name, () => onAddApp(r.rule ?? r.name))}
                            className="rounded-lg border border-border/60 px-2 py-1 text-[11px] font-semibold hover:border-primary/50 disabled:opacity-40 cursor-pointer"
                          >
                            Пустить напрямую
                          </button>
                        )}
                      </div>
                      {r.t ? (
                        hosts.length > 0 ? (
                          <div className="max-h-48 overflow-auto rounded-lg border border-border/40">
                            <table className="w-full text-[11px]">
                              <thead className="sticky top-0 bg-background/90 text-muted-foreground">
                                <tr>
                                  <th className="px-2 py-1 text-left font-medium">Хост</th>
                                  <th className="px-2 py-1 text-left font-medium">Маршрут</th>
                                  <th className="px-2 py-1 text-right font-medium">Соед.</th>
                                  <th className="px-2 py-1 text-right font-medium">Скачано</th>
                                </tr>
                              </thead>
                              <tbody>
                                {hosts.map((h) => (
                                  <tr key={h.host} className="border-t border-border/30">
                                    <td className="max-w-[16rem] truncate px-2 py-0.5 font-mono">{h.host}</td>
                                    <td className={cn('px-2 py-0.5 font-semibold', routeClass(h.route))}>
                                      {h.route === 'VPN' ? 'VPN' : h.route}
                                    </td>
                                    <td className="px-2 py-0.5 text-right tabular-nums">{h.connections}</td>
                                    <td className="px-2 py-0.5 text-right tabular-nums">{fmtBytes(h.download)}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        ) : (
                          <p className="text-[11px] text-muted-foreground">Хосты загружаются…</p>
                        )
                      ) : (
                        <p className="text-[11px] text-muted-foreground">Как только приложение выйдет в сеть, здесь появятся его хосты.</p>
                      )}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )
      ) : (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative min-w-[10rem] flex-1">
              <Search className="pointer-events-none absolute left-2 top-1/2 size-3 -translate-y-1/2 text-muted-foreground" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Поиск по процессу или хосту"
                className="h-7 w-full rounded-lg border border-border/60 bg-background/60 pl-7 pr-2 text-[11px] outline-none focus:border-primary/60"
              />
            </div>
            <label className="flex items-center gap-1.5 text-[11px] text-muted-foreground cursor-pointer">
              <input type="checkbox" checked={onlyListed} onChange={(e) => setOnlyListed(e.target.checked)} />
              только приложения из списка
            </label>
          </div>
          <div className="text-[11px] text-muted-foreground">
            Соединений: <b className="text-foreground">{filteredConns.length}</b> · ↓ {fmtBytes(totals.d)} · ↑ {fmtBytes(totals.u)}
          </div>
          {conns === null ? (
            <p className="text-[11px] text-muted-foreground">Получаю данные ядра…</p>
          ) : filteredConns.length === 0 ? (
            <p className="text-[11px] text-muted-foreground">Подходящих соединений сейчас нет.</p>
          ) : (
            <div className="max-h-72 overflow-auto rounded-lg border border-border/40">
              <table className="w-full text-[11px]">
                <thead className="sticky top-0 bg-background/90 text-muted-foreground">
                  <tr>
                    <th className="px-2 py-1 text-left font-medium">Процесс</th>
                    <th className="px-2 py-1 text-left font-medium">Адрес</th>
                    <th className="px-2 py-1 text-left font-medium">Тип</th>
                    <th className="px-2 py-1 text-left font-medium">Маршрут</th>
                    <th className="px-2 py-1 text-right font-medium">Скорость</th>
                    <th className="px-2 py-1 text-right font-medium">Трафик</th>
                    <th className="px-2 py-1 text-right font-medium">Время</th>
                    <th className="w-6" />
                  </tr>
                </thead>
                <tbody>
                  {filteredConns.slice(0, 300).map((c) => {
                    const sp = speeds.get(c.id)
                    return (
                      <tr key={c.id} className="border-t border-border/30">
                        <td className="max-w-[9rem] truncate px-2 py-0.5 font-mono font-semibold">{c.process || '—'}</td>
                        <td className="max-w-[14rem] truncate px-2 py-0.5 font-mono" title={c.rule}>
                          {c.host}:{c.port}
                        </td>
                        <td className="px-2 py-0.5 uppercase">{c.network}</td>
                        <td className={cn('px-2 py-0.5 font-semibold', routeClass(c.route))}>{c.route}</td>
                        <td className="px-2 py-0.5 text-right tabular-nums">{sp ? fmtRate(sp.d + sp.u) : '—'}</td>
                        <td className="px-2 py-0.5 text-right tabular-nums">
                          ↓{fmtBytes(c.download)} ↑{fmtBytes(c.upload)}
                        </td>
                        <td className="px-2 py-0.5 text-right tabular-nums">{c.start ? fmtDur(Date.now() - c.start) : '—'}</td>
                        <td className="px-1 py-0.5">
                          <button
                            type="button"
                            title="Закрыть соединение"
                            onClick={() => void closeConn(c.id)}
                            className="text-muted-foreground hover:text-destructive cursor-pointer"
                          >
                            <X className="size-3" />
                          </button>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {active && leaks.length > 0 && (
        <div className="rounded-lg border border-st-warn/40 bg-st-warn/10 px-2.5 py-1.5 text-[11px] text-st-warn-text">
          Через VPN идут приложения не из списка: {leaks.map((l) => `${l.name} (${l.open})`).join(', ')}
        </div>
      )}

      <div className="flex items-center justify-between gap-2 border-t border-border/40 pt-2">
        <span className="text-[11px] text-muted-foreground">
          Проверка: с какого IP выходят приложения из списка и все остальные.
        </span>
        <button
          type="button"
          onClick={() => void runCheck()}
          disabled={checking}
          className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-border/60 px-2 py-1 text-[11px] font-semibold text-foreground transition-colors hover:border-primary/50 hover:text-primary disabled:opacity-60 cursor-pointer"
        >
          {checking && <Loader2 className="size-3 animate-spin" />}
          Проверить ExitLag
        </button>
      </div>
      {check && (
        <div
          className={
            check.verdict === 'ok'
              ? 'space-y-1 rounded-lg border border-st-ok/30 bg-st-ok/10 px-2.5 py-2 text-[11px]'
              : check.verdict === 'leak'
                ? 'space-y-1 rounded-lg border border-st-err/40 bg-st-err/10 px-2.5 py-2 text-[11px]'
                : 'space-y-1 rounded-lg border border-border/60 bg-card/60 px-2.5 py-2 text-[11px]'
          }
        >
          <div className="flex items-start gap-1.5 font-semibold">
            {check.verdict === 'ok' ? (
              <CheckCircle2 className="mt-px size-3.5 shrink-0 text-st-ok-text" />
            ) : (
              <ShieldAlert className="mt-px size-3.5 shrink-0 text-st-warn-text" />
            )}
            <span>{check.message}</span>
          </div>
          <div className="font-mono text-muted-foreground">
            не из списка: {check.outside.ip ?? '—'} {check.outside.country ? `· ${check.outside.country}` : ''}
            {check.outside.isp ? ` · ${check.outside.isp}` : ''}
          </div>
          <div className="font-mono text-muted-foreground">
            из списка: {check.listed.ip ?? '—'} {check.listed.country ? `· ${check.listed.country}` : ''}
            {check.listed.isp ? ` · ${check.listed.isp}` : ''}
          </div>
        </div>
      )}
    </div>
  )
}

export default ExitLagTrafficCard
