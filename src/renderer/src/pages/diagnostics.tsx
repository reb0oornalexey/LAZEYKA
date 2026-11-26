import React, { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Globe, ListChecks, Loader2, ShieldQuestion, Stethoscope, Wifi } from 'lucide-react'
import BasePage from '@renderer/components/base/base-page'
import { Button } from '@renderer/components/ui/button'
import { LiveNumber, LzHero, StatChip, StatusRing, type LzTone, type RingSegment } from '@renderer/components/lz'
import SiteCheckCard from '@renderer/components/site-check-card'
import { LeakCard } from '@renderer/components/diag/leak-card'
import { WifiCard } from '@renderer/components/diag/wifi-card'
import { WhitelistCard } from '@renderer/components/diag/whitelist-card'
import { useDiagStore } from '@renderer/components/diag/diag-store'
import { leakSummary, siteSummary, whitelistSummary, wifiSummary, type CheckSummary } from '@renderer/components/diag/diag-summary'
import { PageColumn, PageTabs, usePageTab, type PageTab } from '@renderer/components/e9/page-tabs'

type Tab = 'site' | 'leak' | 'wifi' | 'whitelist'
const IDS: Tab[] = window.api.platform === 'linux' ? ['site', 'leak', 'whitelist'] : ['site', 'leak', 'wifi', 'whitelist']
const ICON: Record<Tab, React.ComponentType<{ className?: string }>> = { site: Globe, leak: ShieldQuestion, wifi: Wifi, whitelist: ListChecks }
const TABS: PageTab<Tab>[] = [
  { id: 'site', label: 'Сайты', icon: Globe, hint: 'Почему конкретный сайт не открывается или грузится долго' },
  { id: 'leak', label: 'Утечки', icon: ShieldQuestion, hint: 'Какой IP видят сайты, IPv6 и DNS мимо VPN' },
  { id: 'wifi', label: 'Wi-Fi', icon: Wifi, hint: 'Сигнал, канал и загруженность соседними сетями' },
  { id: 'whitelist', label: 'Белые списки', icon: ListChecks, hint: 'Режим «только разрешённые сайты» в мобильных сетях' }
]
const NAME: Record<Tab, string> = { site: 'Сайты', leak: 'Утечки', wifi: 'Wi-Fi', whitelist: 'Белые списки' }
const RANK: Record<LzTone, number> = { error: 4, warn: 3, busy: 2, on: 1, off: 0 }

/**
 * Страница «Диагностика» (Е9). Пульт — кольцо из четырёх дуг, по одной на
 * проверку, в том же порядке, что и вкладки: горит — в порядке, жёлтая —
 * нужно внимание, красная — найдена проблема, пунктир — идёт проверка.
 * «Проверить сеть» запускает три сетевые проверки разом (сайт требует адреса).
 */
const DiagnosticsPage: React.FC = () => {
  const [params] = useSearchParams()
  const site = params.get('site')?.trim() || null
  const [tab, setTab] = usePageTab<Tab>('/diagnostics', IDS, 'site')
  const [hover, setHover] = useState<Tab | null>(null)
  const st = useDiagStore()

  // Адрес пришёл с панели сервисов на главной — открываем вкладку «Сайт» и сразу проверяем его.
  useEffect(() => {
    if (!site) return
    setTab('site')
    if (useDiagStore.getState().autoSite === site) return
    useDiagStore.getState().setAutoSite(site)
    void useDiagStore.getState().runSite(site)
  }, [site, setTab])
  useEffect(() => () => useDiagStore.getState().setAutoSite(null), [])

  const sum: Record<Tab, CheckSummary> = {
    site: siteSummary(st.site.busy, st.site.r, st.site.error),
    leak: leakSummary(st.leak.busy, st.leak.r),
    wifi: wifiSummary(st.wifi.busy, st.wifi.r),
    whitelist: whitelistSummary(st.whitelist.busy, st.whitelist.r)
  }
  const done = IDS.filter((t) => sum[t].tone !== 'off' && sum[t].tone !== 'busy')
  const worst = IDS.reduce<LzTone>((w, t) => (RANK[sum[t].tone] > RANK[w] ? sum[t].tone : w), 'off')
  const netBusy = st.leak.busy || st.wifi.busy || st.whitelist.busy
  const problems = IDS.filter((t) => sum[t].tone === 'error')
  const warns = IDS.filter((t) => sum[t].tone === 'warn')

  const title =
    worst === 'off'
      ? 'Проверьте сеть'
      : worst === 'busy'
        ? 'Проверяю…'
        : worst === 'error'
          ? problems.length === 1
            ? `Найдена проблема: ${NAME[problems[0]].toLowerCase()}`
            : `Найдено проблем: ${problems.length}`
          : worst === 'warn'
            ? 'Есть на что посмотреть'
            : 'Проблем не найдено'
  const focus = problems[0] ?? warns[0]
  const text =
    worst === 'off'
      ? 'Сайт не открывается или тормозит игра — проверьте утечки, Wi-Fi и белые списки одной кнопкой. Для конкретного сайта откройте вкладку «Сайт».'
      : worst === 'busy'
        ? 'Проверки идут параллельно, обычно несколько секунд. Результаты появятся на вкладках ниже.'
        : focus
          ? `${NAME[focus]}: ${sum[focus].short}. Подробности и что сделать — на вкладке «${NAME[focus]}».`
          : `Проверено ${done.length} из 4: всё в порядке.`

  const segments: RingSegment[] = IDS.map((t) => {
    const Icon = ICON[t]
    return { key: t, label: NAME[t], tone: sum[t].tone, icon: <Icon /> }
  })
  const heroTone: LzTone = worst === 'error' ? 'error' : worst === 'warn' ? 'warn' : worst

  const runNet = (): void => {
    void st.runLeak()
    if (IDS.includes('wifi')) void st.runWifi()
    void st.runWhitelist()
  }

  return (
    <BasePage title="Диагностика">
      <PageColumn>
        <LzHero
          tone={heroTone}
          visual={
            <StatusRing segments={segments} active={hover ?? null} halo={worst === 'on' ? 'on' : null} size={136}>
              <div className="flex flex-col items-center leading-none">
                <Stethoscope className="mb-1 size-4 text-muted-foreground" />
                <LiveNumber value={done.length} className="text-[30px] font-extrabold text-[color:var(--text-title)]" />
                <span className="mt-0.5 text-[10.5px] text-muted-foreground">из 4</span>
              </div>
            </StatusRing>
          }
          title={title}
          text={text}
          actions={
            <Button
              size="lg"
              className="h-11 rounded-xl px-5 text-[14px]"
              disabled={netBusy}
              onClick={runNet}
              title="Утечки IP и DNS, Wi-Fi и белые списки — одновременно. Займёт несколько секунд."
            >
              {netBusy ? <Loader2 className="size-4 animate-spin" /> : <Stethoscope className="size-4" />}
              {netBusy ? 'Проверяю сеть…' : done.length ? 'Проверить сеть снова' : 'Проверить сеть'}
            </Button>
          }
          footer={
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
              {IDS.map((t) => {
                const Icon = ICON[t]
                return (
                  <div key={t} onMouseEnter={() => setHover(t)} onMouseLeave={() => setHover(null)} className="min-w-0">
                    <StatChip
                      icon={<Icon />}
                      tone={sum[t].tone}
                      label={NAME[t]}
                      value={sum[t].short}
                      title={`${NAME[t]}: ${sum[t].short}. Нажмите, чтобы открыть вкладку`}
                      onClick={() => setTab(t)}
                      className={tab === t ? 'w-full border-primary/40' : 'w-full'}
                    />
                  </div>
                )
              })}
            </div>
          }
        />

        <PageTabs tabs={TABS.filter((item) => IDS.includes(item.id))} value={tab} onChange={setTab} label="Проверки" width="w-[520px]" tour="diag-tabs" />

        {tab === 'site' && <SiteCheckCard />}
        {tab === 'leak' && <LeakCard />}
        {tab === 'wifi' && <WifiCard />}
        {tab === 'whitelist' && <WhitelistCard />}
      </PageColumn>
    </BasePage>
  )
}

export default DiagnosticsPage
