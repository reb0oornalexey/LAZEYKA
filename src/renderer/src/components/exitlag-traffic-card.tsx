import React, { useEffect, useMemo, useRef, useState } from 'react'
import { Activity, Cable, CheckCircle2, Loader2, ShieldAlert } from 'lucide-react'
import { EmptyState, LzPanel, LzSectionHead, Segmented } from '@renderer/components/lz'
import {
  incyGetAppTraffic,
  exitLagCheck,
  type AppTraffic,
  type HostTraffic,
  type ExitLagCheckResult
} from '@renderer/utils/ipc'
import { cn } from '@renderer/lib/utils'
import { appLabel, listHasProc } from '@renderer/utils/per-app'
import ConnectionsPanel from '@renderer/components/incy/connections-panel'

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
  const [busyName, setBusyName] = useState<string | null>(null)
  const [check, setCheck] = useState<ExitLagCheckResult | null>(null)
  const [checking, setChecking] = useState(false)
  useEffect(() => {
    if (!active) {
      setTraffic(null)
      setHosts([])
    }
  }, [active])

  usePolling(active && tab === 'apps', 2000, async () => {
    const r = await incyGetAppTraffic(selected ?? undefined)
    setTraffic(r.apps)
    setHosts(r.apps.find((a) => a.name.toLowerCase() === selected?.toLowerCase())?.hosts ?? [])
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

  const sel = rows.find((r) => r.name.toLowerCase() === selected?.toLowerCase()) ?? null

  return (
    <LzPanel tone={active ? 'on' : 'off'} glow={7} className="space-y-3 p-4">
      <LzSectionHead
        title="Сеть приложений"
        hint="Какие программы выходят в сеть, куда и каким путём: через VPN или напрямую. Данные берутся у ядра VPN раз в 2 секунды и только пока открыта эта вкладка."
        sub={active ? 'Нажмите на программу, чтобы увидеть её адреса и сменить путь' : 'Появится, когда VPN работает в режиме ExitLag'}
        right={
          <Segmented
            size="sm"
            items={[
              { id: 'apps', label: 'По приложениям', icon: Activity },
              { id: 'conns', label: 'Живые соединения', icon: Cable }
            ]}
            value={tab}
            onChange={setTab}
            aria-label="Вид"
            className="w-[340px]"
          />
        }
      />

      {!active ? (
        <EmptyState
          compact
          icon={<Activity />}
          title="Здесь будет видно, кто выходит в сеть"
          text="Включите ExitLag и запустите VPN: появятся программы, их скорость и путь — через VPN или напрямую."
        />
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
                      <span className="truncate font-semibold">{r.name}</span>
                      {r.inList && <span className="shrink-0 rounded-md bg-primary/10 px-1.5 py-px text-[10.5px] font-semibold text-primary">в списке</span>}
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
        // Та же таблица, что в INCY → «Статистика» (одна реализация): правила для адреса, пауза,
        // фильтр «только приложения из списка». Опрос идёт, только пока эта вкладка открыта.
        <ConnectionsPanel appList={apps} />
      )}

      {active && leaks.length > 0 && (
        <div className="rounded-lg border border-st-warn/40 bg-st-warn/10 px-2.5 py-1.5 text-[11px] text-st-warn-text">
          Через VPN идут приложения не из списка: {leaks.map((l) => `${l.name} (${l.open})`).join(', ')}
        </div>
      )}

      <div className="flex items-center justify-between gap-2 border-t border-foreground/[0.07] pt-3">
        <span className="text-[12px] text-muted-foreground">
          Проверка: с какого IP выходят приложения из списка и все остальные.
        </span>
        <button
          type="button"
          onClick={() => void runCheck()}
          disabled={checking}
          className="inline-flex h-8 shrink-0 cursor-pointer items-center gap-1.5 rounded-lg border border-foreground/[0.1] bg-foreground/[0.04] px-3 text-[12px] font-semibold text-foreground transition-colors hover:border-primary/50 hover:text-primary disabled:opacity-60"
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
            не из списка: <span data-sensitive="ip">{check.outside.ip ?? '—'}</span> {check.outside.country ? `· ${check.outside.country}` : ''}
            {check.outside.isp ? ` · ${check.outside.isp}` : ''}
          </div>
          <div className="font-mono text-muted-foreground">
            из списка: <span data-sensitive="ip">{check.listed.ip ?? '—'}</span> {check.listed.country ? `· ${check.listed.country}` : ''}
            {check.listed.isp ? ` · ${check.listed.isp}` : ''}
          </div>
        </div>
      )}
    </LzPanel>
  )
}

export default ExitLagTrafficCard
