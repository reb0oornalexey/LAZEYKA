import React, { useEffect, useRef, useState } from 'react'
import { Activity, CheckCircle2, Loader2, ShieldAlert } from 'lucide-react'
import { incyGetAppActivity, exitLagCheck, type AppActivity, type ExitLagCheckResult } from '@renderer/utils/ipc'

interface Props {
  /** Приложения из списка ExitLag. */
  apps: string[]
  /** Туннель поднят в режиме ExitLag — только тогда есть что показывать. */
  active: boolean
  mode: 'proxy_only' | 'bypass_only'
}

interface Row {
  name: string
  viaVpn: number
  direct: number
  downBps: number
  upBps: number
}

function fmtRate(bps: number): string {
  if (bps < 1024) return `${Math.round(bps)} Б/с`
  if (bps < 1024 * 1024) return `${(bps / 1024).toFixed(bps < 10 * 1024 ? 1 : 0)} КБ/с`
  return `${(bps / 1024 / 1024).toFixed(1)} МБ/с`
}

/**
 * Живой индикатор ExitLag: какие приложения из списка сейчас держат
 * соединения и идут ли они через VPN. Опрашивает ядро раз в 3 секунды и
 * только пока карточка на экране.
 */
const AppActivityCard: React.FC<Props> = ({ apps, active, mode }) => {
  const [rows, setRows] = useState<Row[] | null>(null)
  /** Приложения НЕ из списка, которые сейчас идут через VPN (в белом списке их быть не должно). */
  const [leaks, setLeaks] = useState<{ name: string; viaVpn: number }[]>([])
  const [check, setCheck] = useState<ExitLagCheckResult | null>(null)
  const [checking, setChecking] = useState(false)
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
  const prev = useRef<Map<string, { up: number; down: number; at: number }>>(new Map())

  useEffect(() => {
    if (!active) {
      setRows(null)
      setLeaks([])
      return
    }
    let stopped = false
    const want = new Set(apps.map((a) => a.toLowerCase()))
    const tick = async (): Promise<void> => {
      const list = await incyGetAppActivity().catch(() => null)
      if (stopped) return
      if (!list) {
        setRows([])
        return
      }
      const now = Date.now()
      const next: Row[] = []
      // Служебные процессы LAZEYKA (ядра, TgWsProxy) решают сами — не «утечка».
      const own = new Set(['xray.exe', 'sing-box.exe', 'python.exe', 'tgwsproxy_windows.exe'])
      setLeaks(
        mode === 'proxy_only'
          ? (list as AppActivity[])
              .filter((a) => !want.has(a.name.toLowerCase()) && !own.has(a.name.toLowerCase()) && a.viaVpn > 0)
              .map((a) => ({ name: a.name, viaVpn: a.viaVpn }))
          : []
      )
      for (const a of list as AppActivity[]) {
        const key = a.name.toLowerCase()
        if (!want.has(key)) continue
        const p = prev.current.get(key)
        const dt = p ? (now - p.at) / 1000 : 0
        next.push({
          name: a.name,
          viaVpn: a.viaVpn,
          direct: a.direct,
          downBps: p && dt > 0 ? Math.max(0, (a.download - p.down) / dt) : 0,
          upBps: p && dt > 0 ? Math.max(0, (a.upload - p.up) / dt) : 0
        })
        prev.current.set(key, { up: a.upload, down: a.download, at: now })
      }
      next.sort((x, y) => y.downBps + y.upBps - (x.downBps + x.upBps))
      setRows(next)
    }
    void tick()
    const t = setInterval(() => void tick(), 3000)
    return () => {
      stopped = true
      clearInterval(t)
    }
  }, [active, apps.join('|')])

  return (
    <div className="space-y-2 rounded-xl border border-border/50 bg-background/40 p-3">
      <div className="flex items-center gap-2 text-xs font-semibold">
        <Activity className="h-3.5 w-3.5 text-primary" />
        Сейчас в сети
      </div>
      {!active ? (
        <p className="text-[11px] text-muted-foreground">Появится, когда VPN работает в режиме ExitLag.</p>
      ) : rows === null ? (
        <p className="text-[11px] text-muted-foreground">Получаю данные ядра…</p>
      ) : rows.length === 0 ? (
        <p className="text-[11px] text-muted-foreground">Приложения из списка сейчас не выходят в сеть.</p>
      ) : (
        <div className="space-y-1">
          {rows.map((r) => {
            const expectVpn = mode === 'proxy_only'
            const ok = expectVpn ? r.direct === 0 : r.viaVpn === 0
            return (
              <div key={r.name} className="flex items-center justify-between gap-2 text-[11px]">
                <span className="flex min-w-0 items-center gap-1.5">
                  <span className={ok ? 'size-1.5 shrink-0 rounded-full bg-primary' : 'size-1.5 shrink-0 rounded-full bg-amber-500'} />
                  <span className="truncate font-mono font-semibold">{r.name}</span>
                </span>
                <span className="shrink-0 text-muted-foreground">
                  {r.viaVpn > 0 && `через VPN: ${r.viaVpn}`}
                  {r.viaVpn > 0 && r.direct > 0 && ' · '}
                  {r.direct > 0 && `напрямую: ${r.direct}`}
                  {' · '}↓ {fmtRate(r.downBps)} ↑ {fmtRate(r.upBps)}
                </span>
              </div>
            )
          })}
        </div>
      )}

      {active && leaks.length > 0 && (
        <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-2.5 py-1.5 text-[11px] text-amber-700 dark:text-amber-300">
          Через VPN идут приложения не из списка: {leaks.map((l) => `${l.name} (${l.viaVpn})`).join(', ')}
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
              ? 'space-y-1 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-2 text-[11px]'
              : check.verdict === 'leak'
                ? 'space-y-1 rounded-lg border border-rose-500/40 bg-rose-500/10 px-2.5 py-2 text-[11px]'
                : 'space-y-1 rounded-lg border border-border/60 bg-card/60 px-2.5 py-2 text-[11px]'
          }
        >
          <div className="flex items-start gap-1.5 font-semibold">
            {check.verdict === 'ok' ? (
              <CheckCircle2 className="mt-px size-3.5 shrink-0 text-emerald-500" />
            ) : (
              <ShieldAlert className="mt-px size-3.5 shrink-0 text-amber-500" />
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

export default AppActivityCard
