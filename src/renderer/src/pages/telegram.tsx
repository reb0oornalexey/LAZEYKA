import { useCallback, useEffect, useRef, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { toast } from 'sonner'
import { Loader2, Package, RefreshCw, Route, ShieldCheck, Smartphone, Sparkles, X } from 'lucide-react'
import { useTgwsStore } from '@renderer/store/tgws-store'
import { useIncyStore } from '@renderer/store/incy-store'
import {
  tgwsGetLink,
  tgwsStart,
  tgwsStop,
  tgwsRestart,
  writeClipboard,
  openTelegramLink,
  tgwsCheckUpdate,
  tgwsInstallUpdate,
  tgwsDismissUpdate,
  tgwsGetShareLinks,
  tgwsEnableLan,
  tgwsDisableLan,
  tgwsPingDataCenters,
  type TgwsUpdateInfo,
  type TgwsShareInfo,
  type TelegramDCPing
} from '@renderer/utils/ipc'
import ComponentUpdateDialog from '@renderer/components/component-update-dialog'
import { useAppConfig } from '@renderer/hooks/use-app-config'
import { useTourTab } from '@renderer/lib/tour-focus'
import { Button } from '@renderer/components/ui/button'
import { TelegramBrandIcon as TelegramIcon } from '@renderer/components/service-icons'
import BasePage from '@renderer/components/base/base-page'
import { LzHero, StatChip, type LzTone } from '@renderer/components/lz'
import { ConnectDial } from '@renderer/components/incy/connect-dial'
import { Uptime } from '@renderer/components/incy/incy-console'
import { DcRadar } from '@renderer/components/telegram/dc-radar'
import { ProxyRoute } from '@renderer/components/telegram/proxy-route'
import { PhoneQr } from '@renderer/components/telegram/phone-qr'
import { ConnectLink } from '@renderer/components/telegram/connect-link'
import { TgSettings, type TgSettingsTab } from '@renderer/components/telegram/tg-settings'
import { cn, POWER_ON_BANNER_STYLE, formatInstalledVersion } from '@renderer/lib/utils'

const POWER_ON_TOAST_STYLE = POWER_ON_BANNER_STYLE

function generateTgwsSecret(): string {
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
}

/*
 * Раздел Telegram на языке «Сигнал»:
 *  1. Пульт: клавиша питания, состояние крупно, путь «Telegram → прокси →
 *     способ → датацентры», «Добавить в Telegram» и QR для телефона, чипы.
 *  2. Радар датацентров DC1–DC5 со «станциями» (задержка, состояние).
 *  3. Настройки прокси — одна панель с вкладками «Ссылка / Соединение / Маршрут».
 * Обновление TgWsProxy — в шапке страницы.
 */
const TelegramPage: React.FC = () => {
  const status = useTgwsStore((s) => s.status)
  const incyState = useIncyStore((s) => s.status.state)
  const { appConfig, patchAppConfig } = useAppConfig()
  const [link, setLink] = useState('')
  const [shareInfo, setShareInfo] = useState<TgwsShareInfo | null>(null)
  const [qrOpen, setQrOpen] = useState(false)
  const [linkOpen, setLinkOpen] = useState(false)
  const [enablingLan, setEnablingLan] = useState(false)
  const [dcs, setDcs] = useState<TelegramDCPing[]>([])
  const [dcsAt, setDcsAt] = useState<number | null>(null)
  const [pingingDcs, setPingingDcs] = useState(false)
  const [pending, setPending] = useState<boolean | null>(null)
  const [settingsTab, setSettingsTab] = useState<TgSettingsTab>('link')
  useTourTab<TgSettingsTab>('/telegram', setSettingsTab)
  const settingsRef = useRef<HTMLDivElement>(null)

  const tgws = appConfig?.tgws

  useEffect(() => {
    tgwsGetLink().then(setLink).catch(() => setLink(''))
    tgwsGetShareLinks().then(setShareInfo).catch(() => setShareInfo(null))
  }, [tgws?.host, tgws?.port, tgws?.secret, status.state])

  const running = status.state === 'running'

  // ---- Обновление TgWsProxy
  const [updateInfo, setUpdateInfo] = useState<TgwsUpdateInfo | null>(null)
  const [installing, setInstalling] = useState(false)
  const [checkingUpdate, setCheckingUpdate] = useState(false)
  const installingRef = useRef(false)

  useEffect(() => {
    tgwsCheckUpdate(false).then(setUpdateInfo).catch(() => setUpdateInfo(null))
  }, [])

  const handlePingDcs = useCallback(async (): Promise<void> => {
    setPingingDcs(true)
    try {
      const results = await tgwsPingDataCenters()
      setDcs(results)
      setDcsAt(Date.now())
    } catch {
      toast.error('Не удалось замерить задержку датацентров')
    } finally {
      setPingingDcs(false)
    }
  }, [])
  const pingingRef = useRef(false)
  const pingDcs = (): void => {
    if (pingingRef.current) return
    pingingRef.current = true
    void handlePingDcs().finally(() => {
      pingingRef.current = false
    })
  }

  // Один замер при открытии раздела (как раньше), дальше — по кнопке «Проверить».
  useEffect(() => {
    pingDcs()
  }, [])

  const showUpdate = !!updateInfo && updateInfo.hasUpdate && !updateInfo.dismissed && !!updateInfo.assetUrl

  const [updateDialogOpen, setUpdateDialogOpen] = useState(false)
  // «Подробнее» на главной ведёт сюда и сразу открывает окно обновления.
  const location = useLocation()
  const openUpdateRef = useRef<boolean>(Boolean((location.state as { openUpdate?: boolean } | null)?.openUpdate))
  useEffect(() => {
    if (openUpdateRef.current && updateInfo?.hasUpdate) {
      openUpdateRef.current = false
      setUpdateDialogOpen(true)
    }
  }, [updateInfo])

  /** Установка из окна обновления: ошибку показывает само окно. */
  const installUpdate = async (target?: { assetUrl: string; version: string }): Promise<void> => {
    const assetUrl = target?.assetUrl ?? updateInfo?.assetUrl
    const version = target?.version ?? updateInfo?.latest
    if (installingRef.current || !assetUrl) return
    installingRef.current = true
    setInstalling(true)
    try {
      const res = await tgwsInstallUpdate(assetUrl, version)
      toast.success(target ? 'Версия TgWsProxy установлена' : 'TgWsProxy обновлён', {
        description: `Версия ${res.installedVersion ?? version}`,
        style: POWER_ON_TOAST_STYLE
      })
      const fresh = await tgwsCheckUpdate(true).catch(() => null)
      setUpdateInfo(fresh)
      if (running) {
        try {
          await tgwsStart()
        } catch {
          /* user can retry */
        }
      }
    } finally {
      setInstalling(false)
      installingRef.current = false
    }
  }

  const dismissUpdate = (): void => {
    if (!updateInfo?.latest) return
    void tgwsDismissUpdate(updateInfo.latest).catch(() => void 0)
    setUpdateInfo({ ...updateInfo, dismissed: true })
  }

  const handleCheckUpdate = async (): Promise<void> => {
    if (checkingUpdate) return
    setCheckingUpdate(true)
    try {
      const fresh = await tgwsCheckUpdate(true)
      setUpdateInfo(fresh)
      if (fresh.hasUpdate && fresh.assetUrl) setUpdateDialogOpen(true)
      else toast.success('Установлена последняя версия TgWsProxy', { description: formatInstalledVersion(fresh.installed) })
    } catch (e) {
      toast.error('Не удалось проверить обновления', { description: e instanceof Error ? e.message : String(e) })
    } finally {
      setCheckingUpdate(false)
    }
  }

  const regeneratingRef = useRef(false)
  const [regenerating, setRegenerating] = useState(false)
  const handleRegenerateLink = async (): Promise<void> => {
    if (regeneratingRef.current || !tgws) return
    regeneratingRef.current = true
    setRegenerating(true)
    try {
      const newSecret = generateTgwsSecret()
      await patchAppConfig({ tgws: { ...tgws, secret: newSecret } })
      try {
        const updated = await tgwsGetLink()
        setLink(updated)
        const updatedShare = await tgwsGetShareLinks()
        setShareInfo(updatedShare)
      } catch {
        setLink('')
      }
      if (running) {
        await tgwsRestart().catch(() => void 0)
      }
      toast.success('Ключ и ссылка изменены', { style: POWER_ON_TOAST_STYLE })
    } finally {
      setRegenerating(false)
      regeneratingRef.current = false
    }
  }

  const handleEnableLan = async (): Promise<void> => {
    setEnablingLan(true)
    try {
      const info = await tgwsEnableLan()
      setShareInfo(info)
      if (info.lanLink) {
        toast.success('Прокси открыт для телефона', {
          description: `Адрес ПК в сети: ${info.lanIp}. Отсканируйте QR телефоном (он должен быть в той же Wi-Fi сети).`,
          style: POWER_ON_TOAST_STYLE
        })
      } else {
        toast.error('Не найдена локальная сеть', {
          description: 'Подключите ПК к Wi-Fi или кабелю роутера, к которому подключён телефон.'
        })
      }
    } catch (e) {
      toast.error('Не удалось открыть прокси для телефона', { description: e instanceof Error ? e.message : String(e) })
    } finally {
      setEnablingLan(false)
    }
  }

  /** Клавиша питания. Ошибку запуска показывает пульт (lastError), здесь — только всплывашка. */
  const toggle = async (next: boolean): Promise<void> => {
    if (pending !== null) return
    setPending(next)
    try {
      if (next) await tgwsStart()
      else await tgwsStop()
    } catch (e) {
      toast.error(next ? 'Не удалось запустить Telegram Proxy' : 'Не удалось остановить Telegram Proxy', {
        description: e instanceof Error ? e.message : String(e)
      })
    } finally {
      setPending(null)
    }
  }

  const addToTelegram = (): void => {
    if (!link) {
      toast.error('Ссылка ещё не готова', { description: 'Включите прокси и попробуйте снова.' })
      return
    }
    openTelegramLink(link).catch(() => void 0)
  }

  const copyLink = async (): Promise<void> => {
    if (!link) return
    await writeClipboard(link)
    toast.success('Ссылка скопирована', { style: POWER_ON_TOAST_STYLE })
  }

  const openSettings = (tab: TgSettingsTab): void => {
    setSettingsTab(tab)
    requestAnimationFrame(() => settingsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }))
  }

  // ---- Состояние пульта
  const busy = pending !== null || status.state === 'starting' || status.state === 'stopping'
  const starting = pending === true || (pending === null && status.state === 'starting')
  const isError = !busy && status.state === 'error'
  const tone: LzTone = busy ? 'busy' : running ? 'on' : isError ? 'error' : 'off'

  const host = tgws?.host ?? '127.0.0.1'
  const port = tgws?.port ?? 1443
  const lanOpen = host === '0.0.0.0' || !!shareInfo?.lanLink
  const address = `127.0.0.1:${port}`
  const route = tgws?.routeMode ?? 'auto'
  const viaVpn = Boolean(tgws?.viaIncy) && incyState === 'running'
  const measured = dcs.length > 0
  const dcOk = measured ? dcs.filter((d) => d.latencyMs !== null).length : null
  const version = updateInfo?.installed ?? tgws?.installedVersion

  const title = busy ? (starting ? 'Запускаем прокси…' : 'Останавливаем прокси…') : running ? 'Прокси работает' : isError ? 'Прокси не запустился' : 'Прокси выключен'
  const text = busy ? (
    <span className="inline-flex items-center gap-1.5 text-primary">
      <Loader2 className="size-3.5 animate-spin" />
      {starting ? 'Поднимаем TgWsProxy на этом компьютере' : 'Останавливаем TgWsProxy'}
    </span>
  ) : running ? (
    lanOpen ? (
      'Telegram на этом компьютере и телефоны в вашей Wi-Fi сети подключаются через прокси LAZEYKA.'
    ) : (
      'Telegram на этом компьютере подключается через прокси LAZEYKA.'
    )
  ) : isError ? (
    <span className="text-st-err-text">{status.lastError || 'TgWsProxy завершился с ошибкой. Попробуйте включить ещё раз или загляните в логи.'}</span>
  ) : (
    'Помогает, если Telegram плохо грузит фото, видео и сообщения. Включите прокси и добавьте его в Telegram одной кнопкой.'
  )

  const routeValue = `${route === 'worker' ? 'Свой Cloudflare Worker' : 'Авто'}${tgws?.viaIncy ? ', через VPN' : ''}`

  return (
    <BasePage
      title="Telegram"
      header={
        showUpdate && updateInfo ? (
          <div className="mr-1 flex items-center gap-1">
            <Button
              variant="outline"
              size="sm"
              data-tour="tg-update"
              disabled={installing}
              onClick={() => setUpdateDialogOpen(true)}
              title={formatInstalledVersion(updateInfo.installed)}
              className="h-8 gap-1.5 rounded-lg border-primary/45 text-xs"
            >
              {installing ? <Loader2 className="size-3.5 animate-spin text-primary" /> : <Sparkles className="size-3.5 text-primary" />}
              {installing ? 'Устанавливаем TgWsProxy…' : 'Обновить TgWsProxy'}
              {!installing && (
                <span className="rounded-md bg-primary px-1.5 py-px text-[10.5px] font-bold text-primary-foreground tabular-nums">v{updateInfo.latest}</span>
              )}
            </Button>
            {!installing && (
              <Button variant="ghost" size="icon" className="size-8 rounded-lg" onClick={dismissUpdate} title="Позже: не напоминать об этой версии" aria-label="Позже">
                <X className="size-3.5" />
              </Button>
            )}
          </div>
        ) : (
          <Button
            variant="outline"
            size="sm"
            onClick={() => void handleCheckUpdate()}
            disabled={checkingUpdate || installing}
            title="Проверить, вышла ли новая версия TgWsProxy"
            className="mr-1 h-8 rounded-lg text-xs"
          >
            <RefreshCw className={cn('size-3.5', checkingUpdate && 'animate-spin')} />
            {checkingUpdate ? 'Проверяем…' : 'Проверить обновления'}
          </Button>
        )
      }
    >
      <ComponentUpdateDialog
        component="tgws"
        open={updateDialogOpen}
        info={updateInfo ?? { installed: tgws?.installedVersion, latest: tgws?.installedVersion, hasUpdate: false }}
        onInstall={installUpdate}
        onLater={dismissUpdate}
        onClose={() => setUpdateDialogOpen(false)}
      />
      <div className="mx-auto flex w-full max-w-[1080px] flex-col lz-page-gap lz-page-x pb-5">
        <LzHero
          data-tour="tg-console"
          tone={tone}
          className={cn(isError && 'border-st-err/45')}
          visual={
            <ConnectDial
              tone={tone}
              pingMs={null}
              size={128}
              label={running ? 'Выключить прокси Telegram' : 'Включить прокси Telegram'}
              onPress={() => void toggle(!(running || status.state === 'starting'))}
              disabled={busy}
            />
          }
          title={
            <span className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
              {title}
              {running && status.startedAt && <Uptime since={status.startedAt} className="text-[13px] font-semibold tracking-normal text-primary" />}
            </span>
          }
          text={text}
          extra={
            <div className="mt-1 w-full">
              <ProxyRoute on={running} busy={busy} error={isError} address={address} route={route} viaVpn={viaVpn} dcOk={dcOk} dcTotal={5} />
            </div>
          }
          actions={
            <>
              <Button size="lg" onClick={addToTelegram} data-tour="tg-add" title="Telegram откроется и предложит добавить прокси" className="h-11 rounded-xl px-5 text-[14px]">
                <TelegramIcon className="size-4" />
                Добавить в Telegram
              </Button>
              <PhoneQr
                open={qrOpen}
                onOpenChange={setQrOpen}
                share={shareInfo}
                enabling={enablingLan}
                onEnable={() => void handleEnableLan()}
                onDisable={() => void tgwsDisableLan().then(setShareInfo).catch(() => void 0)}
              >
                <Button variant="outline" size="lg" data-tour="tg-qr-button" className="h-10 rounded-xl px-5 text-[13px]">
                  <Smartphone className="size-4" />
                  Показать QR
                </Button>
              </PhoneQr>
            </>
          }
          footer={
            <div className="flex flex-wrap items-stretch gap-2">
              <ConnectLink
                open={linkOpen}
                onOpenChange={setLinkOpen}
                link={link}
                onOpen={() => {
                  setLinkOpen(false)
                  addToTelegram()
                }}
                onCopy={() => void copyLink()}
                onPhone={() => {
                  setLinkOpen(false)
                  setQrOpen(true)
                }}
              >
                <StatChip
                  icon={<ShieldCheck />}
                  tone={running ? 'on' : isError ? 'error' : 'off'}
                  label="Адрес прокси"
                  value={host === '0.0.0.0' ? `0.0.0.0:${port}` : `${host}:${port}`}
                  sensitive={host === '127.0.0.1' ? undefined : 'ip'}
                  title="Подключить Telegram по ссылке"
                  onClick={() => setLinkOpen(true)}
                />
              </ConnectLink>
              <StatChip
                icon={<Smartphone />}
                tone={lanOpen ? 'on' : 'off'}
                label="Телефон"
                value={shareInfo?.lanLink ? `открыт, ${shareInfo.lanIp}` : 'только этот ПК'}
                sensitive={shareInfo?.lanLink ? 'ip' : undefined}
                title="Подключить Telegram на телефоне по QR"
                onClick={() => setQrOpen(true)}
              />
              <StatChip
                icon={<Route />}
                tone={viaVpn || route === 'worker' ? 'on' : 'off'}
                label="Маршрут"
                value={routeValue}
                title="Изменить маршрут"
                onClick={() => openSettings('route')}
                className="min-w-[180px] flex-1"
              />
              <StatChip
                icon={<Package />}
                label="Версия"
                value={`TgWsProxy ${version ?? 'встроенный'}`}
                title="Сменить или обновить версию TgWsProxy"
                onClick={() => setUpdateDialogOpen(true)}
                aside={
                  showUpdate && updateInfo ? (
                    <span className="shrink-0 rounded-md bg-primary/12 px-1.5 py-0.5 text-[11px] font-bold text-primary tabular-nums">есть v{updateInfo.latest}</span>
                  ) : undefined
                }
              />
            </div>
          }
        />

        <DcRadar dcs={dcs} pinging={pingingDcs} checkedAt={dcsAt} proxyOn={running} onCheck={pingDcs} />

        <TgSettings
          ref={settingsRef}
          tab={settingsTab}
          onTab={setSettingsTab}
          link={link}
          regenerating={regenerating}
          onRegenerate={() => void handleRegenerateLink()}
          onShowQr={() => {
            // Окно QR привязано к кнопке в пульте — сначала вернуть пульт в поле зрения.
            document.querySelector('[data-tour="tg-console"]')?.scrollIntoView({ block: 'start' })
            requestAnimationFrame(() => setQrOpen(true))
          }}
        />
      </div>
    </BasePage>
  )
}

export default TelegramPage
