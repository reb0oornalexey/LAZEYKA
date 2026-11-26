import React, { useState } from 'react'
import { toast } from 'sonner'
import { ArrowRight, BookmarkPlus, ChevronDown, Copy, Globe, Plus, RefreshCw, ShieldPlus } from 'lucide-react'
import { copyText } from '@renderer/utils/clipboard-field'
import { EmptyState, LzPanel, LzSectionHead } from '@renderer/components/lz'
import { useDiagStore } from '@renderer/components/diag/diag-store'
import { Button } from '@renderer/components/ui/button'
import { Input } from '@renderer/components/ui/input'
import { cn } from '@renderer/lib/utils'
import {
  optimizerAddSitesToZapret,
  type SiteCheckResult,
  type SiteHostProbe
} from '@renderer/utils/ipc'
import { rememberRoute } from '@renderer/utils/incy-extra-api'

const VERDICT_LABEL: Record<SiteHostProbe['verdict'], { text: string; tone: 'ok' | 'warn' | 'bad' }> = {
  ok: { text: 'в порядке', tone: 'ok' },
  slow: { text: 'медленно', tone: 'warn' },
  'server-error': { text: 'ошибка сервера', tone: 'warn' },
  'dpi-blocked': { text: 'похоже на DPI', tone: 'bad' },
  'tls-failed': { text: 'TLS не прошёл', tone: 'bad' },
  'tcp16-blocked': { text: 'обрыв на 16 КБ', tone: 'bad' },
  'isp-stub': { text: 'заглушка провайдера', tone: 'bad' },
  'tcp-blocked': { text: 'TCP не ответил', tone: 'bad' },
  'dns-blocked': { text: 'режет DNS', tone: 'warn' },
  'dns-spoofed': { text: 'DNS подменён', tone: 'bad' },
  'dns-failed': { text: 'DNS не отвечает', tone: 'bad' }
}

/** Подпись итога: для DNS — кто именно режет. */
export function verdictLabel(p: SiteHostProbe): { text: string; tone: 'ok' | 'warn' | 'bad' } {
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

function pageStatus(r: SiteCheckResult): string {
  if (r.pageError) return 'Ошибка загрузки'
  if (r.pageTimedOut) return 'Таймаут загрузки'
  if (r.pageStatusCode != null && r.pageStatusCode >= 400) return `HTTP ${r.pageStatusCode}`
  return r.pageLoadMs == null ? 'Нет результата' : `${(r.pageLoadMs / 1000).toFixed(1)} с`
}

function connectionLabel(r: SiteCheckResult): string {
  return [r.zapretRunning ? 'Zapret включён' : 'Zapret выключен', r.viaTunnel ? 'TUN включён' : 'без полного TUN'].join(' · ')
}

const toneClasses = { ok: 'text-st-ok-text', warn: 'text-st-warn-text', bad: 'text-st-err-text' } as const

function verdictStage(probe: SiteHostProbe): string | undefined {
  const { verdict } = probe
  if (verdict.startsWith('dns-')) return 'DNS'
  if (verdict === 'tcp-blocked') return 'TCP'
  if (verdict === 'tls-failed' || verdict === 'dpi-blocked' || (verdict === 'server-error' && probe.tlsMs == null)) return 'TLS'
  return verdict === 'ok' || verdict === 'slow' ? undefined : 'HTTP'
}

/**
 * «Проверка сайтов» в оптимизаторе: почему сайт грузится долго или не
 * открывается и чем это лечится (Zapret, VPN, DNS).
 */
/** Напрямую не открывается, Zapret это не лечит, а через VPN соединение прошло. */
const VPN_ONLY = new Set<SiteHostProbe['verdict']>(['tcp-blocked', 'tcp16-blocked', 'tls-failed'])

/**
 * Результат и адрес лежат в общем хранилище «Диагностики» (diag-store): пульт
 * страницы видит итог, а при смене вкладок ничего не теряется. Адрес из ссылки
 * ?site= (панель сервисов на главной) проверяет сама страница.
 */
const SiteCheckCard: React.FC = () => {
  const url = useDiagStore((s) => s.site.url)
  const setUrl = useDiagStore((s) => s.setUrl)
  const checking = useDiagStore((s) => s.site.busy)
  const result = useDiagStore((s) => s.site.r)
  const previous = useDiagStore((s) => s.site.previous)
  const checkError = useDiagStore((s) => s.site.error)
  const setResult = useDiagStore((s) => s.setSite)
  const runSite = useDiagStore((s) => s.runSite)
  const [remembering, setRemembering] = useState(false)
  const [adding, setAdding] = useState(false)
  const [problemsOnly, setProblemsOnly] = useState(true)
  const primary = result?.probes.find((probe) => probe.host === result.host)
  const problems = result?.probes.filter((probe) => probe.verdict !== 'ok') ?? []
  const shownProbes = result?.probes.filter((probe) => !problemsOnly || probe === primary || probe.verdict !== 'ok') ?? []

  const run = async (): Promise<void> => runSite()

  // Что Zapret может вылечить (см. ZAPRET_FIXABLE) и чего ещё нет в списке. DNS,
  // блок IP и обрыв на 16 КБ он не лечит.
  const fixable = (result?.probes ?? []).filter((p) => ZAPRET_FIXABLE.has(p.verdict) && p.zapret === 'none')
  const dpi = fixable.filter((p) => p.verdict === 'dpi-blocked')
  const vpnOnly = [...new Set((result?.probes ?? []).filter((p) => VPN_ONLY.has(p.verdict) && p.vpnMs != null).map((p) => p.baseDomain))]

  const rememberVpn = async (): Promise<void> => {
    if (vpnOnly.length === 0) return
    setRemembering(true)
    try {
      for (const d of vpnOnly) await rememberRoute(d, 'vpn')
      toast.success(`Запомнено: ${vpnOnly.join(', ')} — всегда через VPN`, {
        description: 'Если VPN сейчас подключён, он переподключится, чтобы применить правило.'
      })
    } catch (e) {
      toast.error('Не удалось запомнить', { description: e instanceof Error ? e.message : String(e) })
    } finally {
      setRemembering(false)
    }
  }

  const copy = async (text: string, what = 'Скопировано'): Promise<void> => {
    if (await copyText(text)) toast.success(what, { duration: 1200 })
  }

  const reportText = (r: SiteCheckResult): string =>
    [
      `Проверка сайта: ${r.url}`,
      `Загрузка: ${r.pageError ? r.pageError : pageStatus(r)}`,
      connectionLabel(r),
      ...(r.vpnNode ? [`INCY (${r.vpnRoute === 'chain' ? 'цепочка' : 'один узел'}): ${r.vpnNode}`] : []),
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
      // Решение запоминается: после обновления списков Zapret домены вернутся сами.
      for (const d of domains) void rememberRoute(d, 'zapret').catch(() => void 0)
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
    <LzPanel data-tour="diag-site-check" className="space-y-3 p-4">
      <LzSectionHead
        title="Проверка сайта"
        hint="Страница открывается в Chromium с текущими настройками сети. Основной и проблемные домены дополнительно проверяются по шагам."
        sub="Проверьте загрузку страницы, этап сбоя и ответ через INCY"
      />
        <div className="flex gap-2">
          <Input paste
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void run()
            }}
            placeholder="hltv.org или https://steamcommunity.com/login/home/"
            className="h-10 rounded-xl text-xs font-mono"
          />
          <Button size="sm" className="h-10 shrink-0 gap-1.5 rounded-xl px-4 text-xs" onClick={() => void run()} disabled={checking || !url.trim()}>
            {checking ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <Globe className="h-3.5 w-3.5" />}
            {checking ? 'Проверяю…' : 'Проверить'}
          </Button>
        </div>

        {checkError && (
          <p className="rounded-xl border border-st-err/30 bg-st-err/10 px-3 py-2 text-xs text-st-err-text" role="alert">
            {checkError}
          </p>
        )}

        {(checking || !result) && !checkError && (
          <EmptyState
            compact
            icon={checking ? <RefreshCw className="animate-spin" /> : <Globe />}
            title={checking ? 'Открываю страницу и проверяю домены…' : 'Здесь появится разбор сайта'}
            text={
              checking
                ? 'Сначала загружается страница, затем проверяются основной домен и проблемные запросы. При таймаутах проверка займёт больше времени.'
                : 'Вставьте адрес из браузера. После изменения DNS, Zapret или VPN повторите проверку того же адреса, чтобы сравнить результат.'
            }
          />
        )}

        {result && !checking && !checkError && (
          <div className="@container select-text space-y-3 rounded-xl border border-foreground/[0.08] bg-foreground/[0.03] p-3">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h3 className="min-w-0 break-all text-base font-semibold">{result.host}</h3>
              <span className="text-xs text-muted-foreground">{connectionLabel(result)}</span>
            </div>

            <div className="grid gap-2 [grid-template-columns:repeat(auto-fit,minmax(min(100%,180px),1fr))]">
              <div className="space-y-1 rounded-xl border border-border bg-card/70 p-3">
                <p className="text-xs text-muted-foreground">Страница · текущая сеть</p>
                <p className={cn('text-sm font-semibold', (result.pageError || result.pageTimedOut || (result.pageStatusCode ?? 0) >= 400) && 'text-st-warn-text')}>{pageStatus(result)}</p>
                {result.documentMs != null && <p className="text-[11px] text-muted-foreground">Документ готов за {(result.documentMs / 1000).toFixed(1)} с</p>}
              </div>
              <div className="space-y-1 rounded-xl border border-border bg-card/70 p-3">
                <p className="text-xs text-muted-foreground">Основной домен · напрямую</p>
                <p className={cn('text-sm font-semibold', primary && toneClasses[verdictLabel(primary).tone])}>{primary ? verdictLabel(primary).text : 'Нет замера'}</p>
                {primary && <p className="text-[11px] text-muted-foreground">DNS → TCP → TLS → HTTP</p>}
              </div>
              <div className="space-y-1 rounded-xl border border-border bg-card/70 p-3">
                <p className="text-xs text-muted-foreground">{result.vpnRoute === 'chain' ? 'Цепочка INCY' : result.vpnRoute === 'single' ? 'Отдельный узел INCY' : 'Проверка INCY'}</p>
                <p className={cn('text-sm font-semibold', primary?.vpnMs != null ? 'text-st-ok-text' : primary?.vpnError && 'text-st-err-text')}>
                  {primary?.vpnMs != null ? `TLS ответил за ${primary.vpnMs} мс` : primary?.vpnError ? 'Проверка INCY не прошла' : 'Нет замера'}
                </p>
                {result.vpnNode && <p className="break-words text-[11px] text-muted-foreground" data-sensitive="node">{result.vpnNode}</p>}
              </div>
            </div>

            {previous && (
              <div className="space-y-2 rounded-xl border border-primary/25 bg-primary/5 p-3">
                <h4 className="text-xs font-semibold">Сравнение с предыдущей проверкой</h4>
                <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2 text-xs">
                  <div><strong>Было · {pageStatus(previous)}</strong><p className="text-[11px] text-muted-foreground">{connectionLabel(previous)}</p></div>
                  <ArrowRight className="size-4 text-primary" />
                  <div><strong>Сейчас · {pageStatus(result)}</strong><p className="text-[11px] text-muted-foreground">{connectionLabel(result)}</p></div>
                </div>
              </div>
            )}

            {result.probeNote && <p className="rounded-lg border border-border px-3 py-2 text-xs text-muted-foreground">{result.probeNote}</p>}
            {result.verdict.length > 0 && (
              <details className="rounded-lg border border-border px-3 py-2">
                <summary className="cursor-pointer text-xs font-semibold">Пояснения к результату</summary>
                <ul className="mt-2 list-disc space-y-1 pl-4 text-xs leading-relaxed">
                  {result.verdict.map((v) => <li key={v}>{v}</li>)}
                </ul>
              </details>
            )}

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
              {vpnOnly.length > 0 && (
                <Button
                  size="sm"
                  variant="outline"
                  className="h-8 gap-1.5 text-xs"
                  disabled={remembering}
                  title="Программа запомнит решение и будет открывать эти сайты через VPN при каждом запуске. Список — INCY → Маршрутизация → «Запомненные сайты»"
                  onClick={() => void rememberVpn()}
                >
                  {remembering ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <BookmarkPlus className="h-3.5 w-3.5" />}
                  Всегда через VPN: {vpnOnly.join(', ')}
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

            {result.probes.length > 0 && (
              <section className="space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h4 className="text-xs font-semibold">Проверенные домены ({result.probes.length})</h4>
                  {shownProbes.length < result.probes.length || !problemsOnly ? (
                    <Button size="sm" variant="ghost" className="h-7 px-2 text-[11px]" onClick={() => setProblemsOnly((v) => !v)}>
                      {problemsOnly ? 'Показать все' : `Только проблемы (${problems.length})`}
                    </Button>
                  ) : null}
                </div>
                {shownProbes.map((probe) => {
                  const verdict = verdictLabel(probe)
                  const failedStage = verdictStage(probe)
                  const stages = [
                    { name: 'DNS', value: probe.dnsMs },
                    { name: 'TCP', value: probe.tcpMs },
                    { name: 'TLS', value: probe.tlsMs },
                    { name: 'HTTP', value: probe.ttfbMs }
                  ]
                  return (
                    <details key={probe.host} className="rounded-xl border border-border bg-card/60 px-3 py-2">
                      <summary className="flex cursor-pointer flex-wrap items-center justify-between gap-2 text-xs [&::-webkit-details-marker]:hidden">
                        <span className="min-w-0 break-all font-semibold">{probe.host}</span>
                        <span className={cn('inline-flex items-center gap-1.5 font-medium', toneClasses[verdict.tone])}>
                          {verdict.text}<ChevronDown className="size-3.5" />
                        </span>
                      </summary>
                      <div className="mt-2 space-y-2">
                        <div className="grid grid-cols-2 gap-1.5 @[430px]:grid-cols-4">
                          {stages.map(({ name, value }) => (
                            <div key={name} className={cn('rounded-lg border border-border px-2 py-1.5 text-[11px]', name === failedStage && 'border-st-err/40 bg-st-err/10 text-st-err-text')}>
                              <b>{name}</b> · {name === failedStage ? 'сбой' : value == null ? '—' : `${value} мс`}
                            </div>
                          ))}
                        </div>
                        {probe.error && <p className="break-words text-xs text-muted-foreground">{probe.error}</p>}
                        {probe.vpnError && <p className="break-words text-xs text-st-err-text">Через INCY: {probe.vpnError}</p>}
                        {probe.vpnMs != null && <p className="text-xs text-st-ok-text">Через INCY: TLS ответил за {probe.vpnMs} мс</p>}
                        <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
                          <span>Zapret: {probe.zapret === 'listed' ? 'в списке' : probe.zapret === 'excluded' ? 'исключён' : 'домена нет в списке'}</span>
                          {probe.zapret === 'none' && ZAPRET_FIXABLE.has(probe.verdict) && (
                            <Button size="sm" variant="outline" className="h-7 px-2 text-[11px]" onClick={() => void addToZapret([probe.baseDomain])} disabled={adding}>
                              <Plus className="size-3" /> В Zapret
                            </Button>
                          )}
                          <Button size="sm" variant="ghost" className="h-7 px-2 text-[11px]" onClick={() => void copy(probe.host, 'Домен скопирован')}>Копировать домен</Button>
                        </div>
                      </div>
                    </details>
                  )
                })}
              </section>
            )}

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
                      <span className={cn('text-right', h.maxMs > 3000 && 'text-st-warn-text')}>
                        {(h.maxMs / 1000).toFixed(1)} с
                      </span>
                      <span className={cn((h.hanging || h.failed) && 'text-st-err-text')}>
                        {h.hanging ? `висит: ${h.hanging}` : h.failed ? `ошибок: ${h.failed}` : ''}
                      </span>
                    </div>
                  ))}
                </div>
              </details>
            )}
          </div>
        )}
    </LzPanel>
  )
}

export default SiteCheckCard
