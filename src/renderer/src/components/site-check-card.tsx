import React, { useState } from 'react'
import { toast } from 'sonner'
import { Globe, RefreshCw, ShieldPlus } from 'lucide-react'
import { Card, CardHeader, CardTitle, CardContent } from '@renderer/components/ui/card'
import { Button } from '@renderer/components/ui/button'
import { Input } from '@renderer/components/ui/input'
import { cn } from '@renderer/lib/utils'
import {
  optimizerCheckSite,
  optimizerAddSitesToZapret,
  type SiteCheckResult,
  type SiteHostProbe
} from '@renderer/utils/ipc'

const VERDICT_LABEL: Record<SiteHostProbe['verdict'], { text: string; tone: 'ok' | 'warn' | 'bad' }> = {
  ok: { text: 'в порядке', tone: 'ok' },
  slow: { text: 'медленно', tone: 'warn' },
  'server-error': { text: 'сервер молчит', tone: 'warn' },
  'dpi-blocked': { text: 'блокировка DPI', tone: 'bad' },
  'tcp-blocked': { text: 'блокировка IP', tone: 'bad' },
  'dns-blocked': { text: 'режет ваш DNS', tone: 'warn' },
  'dns-failed': { text: 'DNS не отвечает', tone: 'bad' }
}

function ms(v: number | null | undefined): string {
  return v == null ? '—' : `${v}`
}

/**
 * «Проверка сайтов» в оптимизаторе: почему сайт грузится долго или не
 * открывается и чем это лечится (Zapret, VPN, DNS).
 */
const SiteCheckCard: React.FC = () => {
  const [url, setUrl] = useState('')
  const [checking, setChecking] = useState(false)
  const [result, setResult] = useState<SiteCheckResult | null>(null)
  const [adding, setAdding] = useState(false)

  const run = async (): Promise<void> => {
    if (!url.trim() || checking) return
    setChecking(true)
    setResult(null)
    try {
      setResult(await optimizerCheckSite(url))
    } catch (e: any) {
      toast.error('Проверка не удалась', { description: e?.message || String(e) })
    } finally {
      setChecking(false)
    }
  }

  const fixable = (result?.probes ?? []).filter((p) => p.verdict === 'dpi-blocked' && p.zapret === 'none')
  const addToZapret = async (): Promise<void> => {
    const domains = [...new Set(fixable.map((p) => p.baseDomain))]
    if (domains.length === 0) return
    setAdding(true)
    try {
      const r = await optimizerAddSitesToZapret(domains)
      toast.success(r.added > 0 ? `Добавлено в Zapret: ${domains.join(', ')}` : 'Эти домены уже в списке Zapret', {
        description: r.restarted ? 'Zapret перезапущен. Проверьте сайт ещё раз.' : 'Применится при следующем запуске Zapret.'
      })
    } catch (e: any) {
      toast.error('Не удалось добавить в Zapret', { description: e?.message || String(e) })
    } finally {
      setAdding(false)
    }
  }

  return (
    <Card className="cyber-card">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-bold flex items-center gap-2">
          <Globe className="h-4 w-4 text-primary" />
          Проверка сайтов
        </CardTitle>
        <p className="text-[11px] text-muted-foreground">
          Сайт долго грузится или не открывается? Страница открывается в скрытом окне, как в браузере, и проверяется
          каждый домен, который она тянет: где висит, что это — блокировка по DPI, блокировка IP, фильтр DNS или просто
          медленный сервер, — и помогает ли Zapret или VPN.
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex gap-2">
          <Input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void run()
            }}
            placeholder="hltv.org или https://steamcommunity.com/login/home/"
            className="text-xs font-mono"
          />
          <Button size="sm" className="h-9 shrink-0 gap-1.5 text-xs" onClick={() => void run()} disabled={checking || !url.trim()}>
            {checking ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <Globe className="h-3.5 w-3.5" />}
            {checking ? 'Проверяю (до 50 с)…' : 'Проверить'}
          </Button>
        </div>

        {result && (
          <div className="space-y-3 rounded-xl border border-border/50 bg-background/40 p-3">
            <div className="text-[11px] text-muted-foreground font-mono">
              {result.host} · загрузка:{' '}
              {result.pageError
                ? 'ошибка'
                : result.pageTimedOut
                  ? '> 35 с'
                  : result.pageLoadMs != null
                    ? `${(result.pageLoadMs / 1000).toFixed(1)} с`
                    : '—'}
              {' · '}Zapret {result.zapretRunning ? 'работает' : 'выключен'}
              {result.vpnNode ? ` · VPN-узел для сравнения: ${result.vpnNode}` : ''}
            </div>

            <ul className="space-y-1 text-[11px] leading-relaxed">
              {result.verdict.map((v) => (
                <li key={v}>• {v}</li>
              ))}
            </ul>

            {fixable.length > 0 && (
              <Button size="sm" className="h-8 gap-1.5 text-xs" onClick={() => void addToZapret()} disabled={adding}>
                {adding ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <ShieldPlus className="h-3.5 w-3.5" />}
                Добавить в Zapret: {[...new Set(fixable.map((p) => p.baseDomain))].join(', ')}
              </Button>
            )}

            <div className="space-y-1">
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
                Пошагово, мс (напрямую, мимо VPN)
              </div>
              <div className="overflow-x-auto">
                <div className="min-w-[560px] space-y-0.5 font-mono text-[11px]">
                  <div className="grid grid-cols-[minmax(0,1fr)_7rem_3rem_3rem_3rem_3.5rem_4rem_4.5rem] gap-2 text-muted-foreground">
                    <span>домен</span>
                    <span>итог</span>
                    <span className="text-right">DNS</span>
                    <span className="text-right">TCP</span>
                    <span className="text-right">TLS</span>
                    <span className="text-right">ответ</span>
                    <span className="text-right">VPN</span>
                    <span>Zapret</span>
                  </div>
                  {result.probes.map((p) => {
                    const v = VERDICT_LABEL[p.verdict]
                    return (
                      <div
                        key={p.host}
                        className="grid grid-cols-[minmax(0,1fr)_7rem_3rem_3rem_3rem_3.5rem_4rem_4.5rem] gap-2"
                        title={p.error ?? ''}
                      >
                        <span className="truncate">{p.host}</span>
                        <span
                          className={cn(
                            v.tone === 'ok' && 'text-emerald-500',
                            v.tone === 'warn' && 'text-amber-500',
                            v.tone === 'bad' && 'text-rose-500 font-bold'
                          )}
                        >
                          {v.text}
                        </span>
                        <span className="text-right">{ms(p.dnsMs)}</span>
                        <span className="text-right">{ms(p.tcpMs)}</span>
                        <span className="text-right">{ms(p.tlsMs)}</span>
                        <span className="text-right">{ms(p.ttfbMs)}</span>
                        <span className="text-right" title={p.vpnError ?? ''}>
                          {p.vpnMs != null ? p.vpnMs : p.vpnError ? '✕' : '—'}
                        </span>
                        <span className="text-muted-foreground">
                          {p.zapret === 'listed' ? 'в списке' : p.zapret === 'excluded' ? 'исключён' : 'нет'}
                        </span>
                      </div>
                    )
                  })}
                </div>
              </div>
            </div>

            {result.pageHosts.length > 0 && (
              <details className="text-[11px]">
                <summary className="cursor-pointer text-muted-foreground">
                  Все домены страницы ({result.pageHosts.length})
                </summary>
                <div className="mt-1 space-y-0.5 font-mono">
                  {result.pageHosts.map((h) => (
                    <div key={h.host} className="grid grid-cols-[minmax(0,1fr)_3rem_4.5rem_6rem] gap-2">
                      <span className="truncate">{h.host}</span>
                      <span className="text-right text-muted-foreground">{h.requests}</span>
                      <span className={cn('text-right', h.maxMs > 3000 && 'text-amber-500')}>
                        {(h.maxMs / 1000).toFixed(1)} с
                      </span>
                      <span className={cn((h.hanging || h.failed) && 'text-rose-500')}>
                        {h.hanging ? `висит: ${h.hanging}` : h.failed ? `ошибок: ${h.failed}` : ''}
                      </span>
                    </div>
                  ))}
                </div>
              </details>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

export default SiteCheckCard
