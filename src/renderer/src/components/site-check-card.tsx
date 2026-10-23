import React, { useState } from 'react'
import { toast } from 'sonner'
import { Copy, Globe, Plus, RefreshCw, ShieldPlus } from 'lucide-react'
import { copyText } from '@renderer/utils/clipboard-field'
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
  'server-error': { text: 'ошибка сервера', tone: 'warn' },
  'dpi-blocked': { text: 'блокировка DPI', tone: 'bad' },
  'tls-failed': { text: 'сервер не отвечает', tone: 'bad' },
  'tcp16-blocked': { text: 'обрыв на 16 КБ', tone: 'bad' },
  'isp-stub': { text: 'заглушка провайдера', tone: 'bad' },
  'tcp-blocked': { text: 'блокировка IP', tone: 'bad' },
  'dns-blocked': { text: 'режет DNS', tone: 'warn' },
  'dns-spoofed': { text: 'DNS подменён', tone: 'bad' },
  'dns-failed': { text: 'DNS не отвечает', tone: 'bad' }
}

/** Подпись итога: для DNS — кто именно режет. */
function verdictLabel(p: SiteHostProbe): { text: string; tone: 'ok' | 'warn' | 'bad' } {
  if (p.verdict === 'dns-blocked') {
    if (p.dnsSource === 'hosts') return { text: 'блок в hosts', tone: 'warn' }
    if (p.dnsSource === 'isp') return { text: 'режет DNS провайдера', tone: 'bad' }
    return { text: 'режет DNS-фильтр', tone: 'warn' }
  }
  return VERDICT_LABEL[p.verdict]
}

/** Что Zapret умеет лечить: блокировку по имени, заглушку и замедление. */
const ZAPRET_FIXABLE = new Set<SiteHostProbe['verdict']>(['dpi-blocked', 'isp-stub', 'slow'])

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

  // Что Zapret может вылечить (см. ZAPRET_FIXABLE) и чего ещё нет в списке. DNS,
  // блок IP и обрыв на 16 КБ он не лечит.
  const fixable = (result?.probes ?? []).filter((p) => ZAPRET_FIXABLE.has(p.verdict) && p.zapret === 'none')
  const dpi = fixable.filter((p) => p.verdict === 'dpi-blocked')

  const copy = async (text: string, what = 'Скопировано'): Promise<void> => {
    if (await copyText(text)) toast.success(what, { duration: 1200 })
  }

  const reportText = (r: SiteCheckResult): string =>
    [
      `Проверка сайта: ${r.url}`,
      `Загрузка: ${r.pageError ? `ошибка (${r.pageError})` : r.pageTimedOut ? '> 35 с' : r.pageLoadMs != null ? `${(r.pageLoadMs / 1000).toFixed(1)} с` : '—'}; Zapret ${r.zapretRunning ? 'работает' : 'выключен'}`,
      '',
      ...r.verdict.map((v) => `• ${v}`),
      '',
      'Домен | итог | DNS | TCP | TLS | ответ | VPN | Zapret',
      ...r.probes.map(
        (p) =>
          `${p.host} | ${verdictLabel(p).text} | ${ms(p.dnsMs)} | ${ms(p.tcpMs)} | ${ms(p.tlsMs)} | ${ms(p.ttfbMs)} | ${p.vpnMs ?? '—'} | ${p.zapret}`
      ),
      '',
      'Все домены страницы:',
      ...r.pageHosts.map(
        (h) => `${h.host} — запросов ${h.requests}, макс ${(h.maxMs / 1000).toFixed(1)} с${h.hanging ? `, висит ${h.hanging}` : ''}${h.failed ? `, ошибок ${h.failed}` : ''}`
      )
    ].join('\n')

  const addToZapret = async (list: SiteHostProbe[] | string[]): Promise<void> => {
    const domains = [...new Set(list.map((p) => (typeof p === 'string' ? p : p.baseDomain)))]
    if (domains.length === 0) return
    setAdding(true)
    try {
      const r = await optimizerAddSitesToZapret(domains)
      setResult((prev) =>
        prev && {
          ...prev,
          probes: prev.probes.map((p) => (domains.includes(p.baseDomain) ? { ...p, zapret: 'listed' as const } : p))
        }
      )
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
          <Input paste
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
          <div className="select-text space-y-3 rounded-xl border border-border/50 bg-background/40 p-3">
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

            <div className="flex flex-wrap gap-2">
              {fixable.length > 0 && (
                <Button size="sm" className="h-8 gap-1.5 text-xs" onClick={() => void addToZapret(fixable)} disabled={adding}>
                  {adding ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <ShieldPlus className="h-3.5 w-3.5" />}
                  Добавить всё в Zapret ({[...new Set(fixable.map((p) => p.baseDomain))].length})
                </Button>
              )}
              {dpi.length > 0 && dpi.length < fixable.length && (
                <Button
                  size="sm"
                  variant="outline"
                  className="h-8 gap-1.5 text-xs"
                  onClick={() => void addToZapret(dpi)}
                  disabled={adding}
                >
                  Только блокировки DPI: {[...new Set(dpi.map((p) => p.baseDomain))].join(', ')}
                </Button>
              )}
              <Button size="sm" variant="outline" className="h-8 gap-1.5 text-xs" onClick={() => void copy(reportText(result), 'Отчёт скопирован')}>
                <Copy className="h-3.5 w-3.5" />
                Скопировать отчёт
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="h-8 gap-1.5 text-xs"
                onClick={() => void copy(result.pageHosts.map((h) => h.host).join('\n'), 'Домены скопированы')}
              >
                <Copy className="h-3.5 w-3.5" />
                Скопировать домены
              </Button>
            </div>
            {fixable.length > 0 && (
              <p className="text-[10px] text-muted-foreground">
                В Zapret попадут: {[...new Set(fixable.map((p) => p.baseDomain))].join(', ')}. Проблемы DNS, блокировку IP и обрыв
                на 16 КБ Zapret не лечит — такие домены не добавляются.
              </p>
            )}

            <div className="space-y-1">
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
                Пошагово, мс (напрямую, мимо VPN)
              </div>
              <div className="overflow-x-auto">
                <div className="min-w-[600px] space-y-0.5 font-mono text-[11px]">
                  <div className="grid grid-cols-[minmax(0,1fr)_7rem_3rem_3rem_3rem_3.5rem_4rem_4.5rem_2.5rem] gap-2 text-muted-foreground">
                    <span>домен</span>
                    <span>итог</span>
                    <span className="text-right">DNS</span>
                    <span className="text-right">TCP</span>
                    <span className="text-right">TLS</span>
                    <span className="text-right">ответ</span>
                    <span className="text-right">VPN</span>
                    <span>Zapret</span>
                    <span />
                  </div>
                  {result.probes.map((p) => {
                    const v = verdictLabel(p)
                    return (
                      <div
                        key={p.host}
                        className="grid grid-cols-[minmax(0,1fr)_7rem_3rem_3rem_3rem_3.5rem_4rem_4.5rem_2.5rem] items-center gap-2"
                        title={p.error ?? ''}
                      >
                        <button
                          type="button"
                          className="truncate text-left hover:text-primary cursor-pointer"
                          title="Нажмите, чтобы скопировать"
                          onClick={() => void copy(p.host)}
                        >
                          {p.host}
                        </button>
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
                        {p.zapret === 'none' && ZAPRET_FIXABLE.has(p.verdict) ? (
                          <button
                            type="button"
                            className="inline-flex size-6 items-center justify-center rounded-md text-primary hover:bg-primary/10 cursor-pointer"
                            title={`Добавить ${p.baseDomain} в Zapret`}
                            onClick={() => void addToZapret([p.baseDomain])}
                            disabled={adding}
                          >
                            <Plus className="size-3.5" />
                          </button>
                        ) : (
                          <span />
                        )}
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
                      <button
                        type="button"
                        className="truncate text-left hover:text-primary cursor-pointer"
                        title="Нажмите, чтобы скопировать"
                        onClick={() => void copy(h.host)}
                      >
                        {h.host}
                      </button>
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
