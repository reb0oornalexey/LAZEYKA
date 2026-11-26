import React, { useState } from 'react'
import { ArrowDownUp, Loader2, MonitorSmartphone, Network, Plug, Power, Settings2, Share2, ShieldCheck, Smartphone, Wifi } from 'lucide-react'
import { toast } from 'sonner'
import BasePage from '@renderer/components/base/base-page'
import { Button } from '@renderer/components/ui/button'
import { EmptyState, LiveNumber, LzHero, LzPanel, StatChip, StatusRing, type LzTone, type RingSegment } from '@renderer/components/lz'
import { lanSetEnabled, lanSetSettings, type LanState } from '@renderer/utils/lan-api'
import { useLanState } from '@renderer/components/lan/use-lan-state'
import { RemoteCard } from '@renderer/components/lan/remote-card'
import { ShareCard } from '@renderer/components/lan/share-card'
import { HotspotCard } from '@renderer/components/lan/hotspot-card'
import { SettingsCard } from '@renderer/components/lan/settings-card'
import { errMsg, fmtBytes } from '@renderer/components/lan/common'
import { PageColumn, PageTabs, usePageTab, type PageTab } from '@renderer/components/e9/page-tabs'

type Tab = 'remote' | 'share' | 'hotspot' | 'router' | 'settings'
const IDS: Tab[] = ['remote', 'share', 'hotspot', 'router', 'settings']
const TABS: PageTab<Tab>[] = [
  { id: 'remote', label: 'Пульт', icon: Smartphone, hint: 'Управление программой с телефона по QR-коду' },
  { id: 'share', label: 'По порту', icon: Share2, hint: 'Прокси компьютера для телефона, приставки и телевизора' },
  { id: 'hotspot', label: 'Wi-Fi', icon: Wifi, hint: 'Своя сеть Wi-Fi компьютера для устройств без настройки прокси' },
  { id: 'router', label: 'Общий Wi-Fi', icon: Network, hint: 'Как проверить маршрут в сети роутера' },
  { id: 'settings', label: 'Настройки', icon: Settings2, hint: 'Порты, пароль прокси, код пульта и брандмауэр' }
]

/** Пока раздел выключен: что здесь будет и одна кнопка, которая это включает. */
const OffPanel: React.FC<{ tour: string; icon: React.ReactNode; title: string; text: string; onEnable: () => void; busy: boolean }> = ({
  tour,
  icon,
  title,
  text,
  onEnable,
  busy
}) => (
  <LzPanel data-tour={tour} className="p-4">
    <EmptyState
      icon={icon}
      title={title}
      text={text}
      action={
        <Button size="sm" className="h-9 rounded-xl px-4 text-xs" disabled={busy} onClick={onEnable}>
          {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Power className="size-3.5" />}
          Включить локальную сеть
        </Button>
      }
    />
  </LzPanel>
)

/**
 * Страница «Локальная сеть» (Е9). Пульт — кольцо из трёх дуг: пульт с телефона,
 * раздача прокси и раздача Wi-Fi (в том же порядке, что и вкладки), в центре —
 * сколько устройств сейчас ходят через компьютер. Главная кнопка включает и
 * выключает раздел; по умолчанию всё выключено.
 */
const Lan: React.FC = () => {
  const { state, reload, setState, loadError } = useLanState()
  const [toggling, setToggling] = useState(false)
  const [tab, setTab] = usePageTab<Tab>('/lan', IDS, 'remote')

  const toggle = async (on: boolean): Promise<void> => {
    setToggling(true)
    try {
      setState(await lanSetEnabled(on))
    } catch (e) {
      toast.error(errMsg(e))
      await reload()
    } finally {
      setToggling(false)
    }
  }

  const working = toggling || Boolean(state?.busy)
  const enabled = state?.enabled ?? false
  const err = loadError || state?.error
  const tone: LzTone = err ? 'error' : working ? 'busy' : enabled ? 'on' : 'off'
  const seg = (lit: boolean): LzTone => (working ? 'busy' : enabled && lit ? 'on' : 'off')
  const segments: RingSegment[] = [
    { key: 'remote', label: 'Пульт с телефона', tone: seg(Boolean(state?.remoteUrl)), icon: <Smartphone /> },
    { key: 'share', label: 'Раздача на устройства', tone: seg(Boolean(state?.proxy)), icon: <Share2 /> },
    { key: 'hotspot', label: 'Раздача Wi-Fi', tone: seg(Boolean(state?.hotspot)), icon: <Wifi /> }
  ]
  const devices = state?.stats?.devices.length ?? 0
  const bytes = (state?.stats?.bytesFromClients ?? 0) + (state?.stats?.bytesToClients ?? 0)

  const title = err
    ? 'Локальная сеть: ошибка'
    : !state
      ? 'Загрузка…'
      : working
        ? enabled
          ? 'Выключаю…'
          : 'Включаю…'
        : enabled
          ? 'Локальная сеть включена'
          : 'Локальная сеть выключена'
  const text = err
    ? err
    : enabled
      ? 'Пульт доступен в локальной сети. Интернет через ПК работает у устройств, на которых настроен прокси.'
      : 'Пульт на телефоне, раздача интернета компьютера на другие устройства и раздача Wi-Fi. Пока выключено, компьютер никого не слушает.'

  const renderTab = (s: LanState): React.ReactNode => {
    const enable = (): void => void toggle(true)
    if (tab === 'remote')
      return s.enabled ? (
        <RemoteCard state={s} />
      ) : (
        <OffPanel
          tour="lan-remote"
          icon={<Smartphone />}
          title="Здесь появится QR-код пульта"
          text="Наведёте камеру телефона — и на нём откроется пульт: Zapret, VPN, Telegram-прокси, ExitLag и сценарии. Работает только в вашей домашней сети."
          onEnable={enable}
          busy={working}
        />
      )
    if (tab === 'share')
      return s.enabled ? (
        s.settings.share ? <ShareCard state={s} /> : (
          <OffPanel
            tour="lan-share"
            icon={<Share2 />}
            title="Прокси по порту выключен"
            text="Включите прокси, чтобы получить адрес и порт для выбранных устройств."
            busy={working}
            onEnable={() => {
              setToggling(true)
              void lanSetSettings({ share: true }).then(setState).catch((error) => toast.error(errMsg(error))).finally(() => setToggling(false))
            }}
          />
        )
      ) : (
        <OffPanel
          tour="lan-share"
          icon={<Share2 />}
          title="Здесь появятся адрес и порт прокси"
          text="Устройство может отправлять запросы через компьютер после настройки адреса и порта прокси."
          onEnable={enable}
          busy={working}
        />
      )
    if (tab === 'hotspot') return <HotspotCard platform={s.platform} state={s} />
    if (tab === 'router')
      return (
        <LzPanel className="space-y-3 p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-sm font-semibold">Телефон в Wi-Fi роутера</h2>
            <span className="lz-onwall text-xs">Маршрут интернета через ПК не подтверждён</span>
          </div>
          <p className="text-xs leading-relaxed">Телефон может открывать YouTube и без прокси. Скорость загрузки сама по себе не показывает, через какое устройство прошёл трафик.</p>
          <div className="grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(min(100%,220px),1fr))]">
            <div className="rounded-lg border border-border p-3">
              <h3 className="text-xs font-semibold">Проверить браузер телефона</h3>
              <p className="mt-1 text-xs text-muted-foreground">В пульте запустите «Проверить этот телефон» с прокси и после его отключения на телефоне. Успешная проверка подтверждает прокси только для браузера.</p>
              <Button size="sm" variant="outline" className="mt-2" onClick={() => setTab('remote')}>Открыть вкладку пульта</Button>
            </div>
            <div className="rounded-lg border border-border p-3">
              <h3 className="text-xs font-semibold">Маршрут всей сети</h3>
              <p className="mt-1 text-xs text-muted-foreground">В этой вкладке показана диагностика. Чтобы направить трафик устройств через ПК без прокси, нужен настроенный шлюз и правило маршрутизации на роутере.</p>
              <Button size="sm" variant="outline" className="mt-2" onClick={() => setTab('share')}>Адрес и порт прокси</Button>
            </div>
          </div>
        </LzPanel>
      )
    return <SettingsCard state={s} onState={setState} />
  }

  return (
    <BasePage title="Локальная сеть">
      <PageColumn>
        <LzHero
          data-tour="lan-hero"
          tone={tone}
          visual={
            <StatusRing segments={segments} active={tab === 'settings' || tab === 'router' ? null : tab} halo={enabled && !err ? 'on' : null} pulse={enabled && devices > 0} size={136}>
              <div className="flex flex-col items-center leading-none">
                <Network className={enabled ? 'mb-1 size-4 text-primary' : 'mb-1 size-4 text-muted-foreground'} />
                <LiveNumber value={devices} className="text-[30px] font-extrabold text-[color:var(--text-title)]" />
                <span className="mt-0.5 text-[10.5px] text-muted-foreground">устройств</span>
              </div>
            </StatusRing>
          }
          title={title}
          text={text}
          actions={
            <Button
              size="lg"
              variant={enabled ? 'outline' : 'default'}
              className="h-11 min-w-[190px] rounded-xl px-5 text-[14px]"
              disabled={!state || working}
              onClick={() => void toggle(!enabled)}
              aria-label="Локальная сеть"
            >
              {working ? <Loader2 className="size-4 animate-spin" /> : <Power className="size-4" />}
              {working ? (enabled ? 'Выключаю…' : 'Включаю…') : enabled ? 'Выключить' : 'Включить'}
            </Button>
          }
          footer={
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
              <StatChip icon={<Plug />} tone={enabled ? 'on' : 'off'} label="Адрес компьютера" value={enabled && state?.address ? state.address : 'не слушает'} sensitive="ip" />
              <StatChip icon={<MonitorSmartphone />} tone={enabled && devices ? 'on' : 'off'} label="Соединений сейчас" value={<LiveNumber value={state?.stats?.active ?? 0} />} />
              <StatChip icon={<ArrowDownUp />} tone={bytes ? 'on' : 'off'} label="Передано через компьютер" value={fmtBytes(bytes)} />
              {state?.platform === 'win32' ? (
                <StatChip
                  icon={<ShieldCheck />}
                  tone={!enabled ? 'off' : state.firewallRule ? 'on' : state.networkCategory === 'public' ? 'warn' : 'off'}
                  label="Брандмауэр Windows"
                  value={state.firewallRule ? 'правило добавлено' : 'правила нет'}
                  title="Правило «LAZEYKA LAN» пускает устройства домашней сети. Нажмите, чтобы открыть настройки"
                  onClick={() => setTab('settings')}
                />
              ) : (
                <StatChip icon={<Settings2 />} label="Порты" value={state ? `${state.settings.hubPort} и ${state.settings.proxyPort}` : '—'} onClick={() => setTab('settings')} />
              )}
            </div>
          }
        />

        <div className="lz-control-surface flex flex-wrap items-center gap-2 rounded-xl border p-3">
          <span className="mr-1 text-xs font-semibold">Как подключить устройства</span>
          <Button size="sm" variant={tab === 'share' ? 'default' : 'outline'} onClick={() => setTab('share')}>По адресу и порту</Button>
          <Button size="sm" variant={tab === 'router' ? 'default' : 'outline'} onClick={() => setTab('router')}>Проверить общий Wi-Fi</Button>
        </div>
        <PageTabs tabs={TABS} value={tab} onChange={setTab} label="Разделы локальной сети" width="w-[640px]" wrapLabels tour="lan-tabs" />

        {state && renderTab(state)}
      </PageColumn>
    </BasePage>
  )
}

export default Lan
