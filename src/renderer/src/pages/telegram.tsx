import { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { QRCodeSVG } from 'qrcode.react'
import { useTgwsStore } from '@renderer/store/tgws-store'
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
  tgwsPingDataCenters,
  type TgwsUpdateInfo,
  type TgwsShareInfo,
  type TelegramDCPing
} from '@renderer/utils/ipc'
import { useAppConfig } from '@renderer/hooks/use-app-config'
import { Button } from '@renderer/components/ui/button'
import { Input } from '@renderer/components/ui/input'
import { Label } from '@renderer/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle } from '@renderer/components/ui/card'
import {
  Copy,
  ExternalLink,
  MoreVertical,
  Download,
  Loader2,
  Sparkles,
  QrCode,
  Wifi,
  Smartphone,
  RefreshCw,
  Server
} from 'lucide-react'
import TelegramIcon from '@renderer/components/telegram-icon'
import ReloadTgwsIcon from '@renderer/components/reload-tgws-icon'
import BasePage from '@renderer/components/base/base-page'
import SwitcherCard from '@renderer/components/switcher-card'
import { cn, POWER_ON_BANNER_STYLE, formatInstalledVersion } from '@renderer/lib/utils'

const POWER_ON_TOAST_STYLE = POWER_ON_BANNER_STYLE

function generateTgwsSecret(): string {
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
}

const TelegramPage: React.FC = () => {
  const status = useTgwsStore((s) => s.status)
  const { appConfig, patchAppConfig } = useAppConfig()
  const [link, setLink] = useState('')
  const [shareInfo, setShareInfo] = useState<TgwsShareInfo | null>(null)
  const [showQr, setShowQr] = useState(false)
  const [qrMode, setQrMode] = useState<'local' | 'lan'>('lan')
  const [dcs, setDcs] = useState<TelegramDCPing[]>([])
  const [pingingDcs, setPingingDcs] = useState(false)

  const tgws = appConfig?.tgws

  useEffect(() => {
    tgwsGetLink().then(setLink).catch(() => setLink(''))
    tgwsGetShareLinks().then(setShareInfo).catch(() => setShareInfo(null))
  }, [tgws?.host, tgws?.port, tgws?.secret, status.state])

  const running = status.state === 'running'

  // ---- Auto-update banner
  const [updateInfo, setUpdateInfo] = useState<TgwsUpdateInfo | null>(null)
  const [installing, setInstalling] = useState(false)
  const installingRef = useRef(false)

  useEffect(() => {
    tgwsCheckUpdate(false).then(setUpdateInfo).catch(() => setUpdateInfo(null))
  }, [])

  const handlePingDcs = async (): Promise<void> => {
    if (pingingDcs) return
    setPingingDcs(true)
    try {
      const results = await tgwsPingDataCenters()
      setDcs(results)
    } catch {
      toast.error('Не удалось замерить задержку датацентров')
    } finally {
      setPingingDcs(false)
    }
  }

  useEffect(() => {
    void handlePingDcs()
  }, [])

  const showBanner = !!updateInfo && updateInfo.hasUpdate && !updateInfo.dismissed && !!updateInfo.assetUrl

  const installUpdate = async (): Promise<void> => {
    if (installingRef.current || !updateInfo?.assetUrl) return
    installingRef.current = true
    setInstalling(true)
    const tId = toast.loading('Скачиваем TgWsProxy…', {
      description: updateInfo.assetName ?? `v${updateInfo.latest}`
    })
    try {
      const res = await tgwsInstallUpdate(updateInfo.assetUrl, updateInfo.latest)
      const mb = (res.sizeBytes / (1024 * 1024)).toFixed(1)
      toast.success('TgWsProxy обновлён', {
        id: tId,
        description: `Версия ${res.installedVersion ?? updateInfo.latest} — ${mb} МБ`,
        style: POWER_ON_TOAST_STYLE
      })
      const fresh = await tgwsCheckUpdate(true).catch(() => null)
      setUpdateInfo(fresh)
      if (running) {
        try { await tgwsStart() } catch { /* user can retry */ }
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      toast.error('Не удалось обновить TgWsProxy', { id: tId, description: msg })
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

  const activeQrLink = qrMode === 'lan' && shareInfo?.lanLink
    ? shareInfo.lanLink
    : (shareInfo?.localLink || link)

  const activeHttpLink = qrMode === 'lan' && shareInfo?.httpLanLink
    ? shareInfo.httpLanLink
    : (shareInfo?.httpLink || '')

  return (
    <BasePage title="Telegram">
      <div className="px-4 pb-6 space-y-4">
        {showBanner && updateInfo && (
          <div className={cn(
            'relative flex items-center gap-3 rounded-2xl border border-primary/30 bg-primary/10 backdrop-blur-xl px-4 py-3 shadow-[0_0_15px_rgba(99,102,241,0.15)] transition',
            installing && 'pointer-events-none opacity-80'
          )}>
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary/20 text-primary shadow-[0_0_10px_rgba(99,102,241,0.25)]">
              {installing
                ? <Loader2 className="h-4 w-4 animate-spin" />
                : <Sparkles className="h-4 w-4" />}
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-sm font-medium text-foreground">
                {installing
                  ? 'Устанавливаем TgWsProxy…'
                  : `Доступно обновление TgWsProxy — v${updateInfo.latest}`}
              </div>
              <div className="text-xs text-muted-foreground truncate">
                {installing
                  ? 'Останавливаем прокси, перезаписываем бинарник…'
                  : formatInstalledVersion(updateInfo.installed)}
              </div>
            </div>
            {!installing && (
              <div className="flex shrink-0 items-center gap-2">
                <Button variant="ghost" size="sm" onClick={dismissUpdate}>
                  Позже
                </Button>
                <Button size="sm" onClick={() => { void installUpdate() }}>
                  <Download className="h-3.5 w-3.5" />
                  Обновить
                </Button>
              </div>
            )}
          </div>
        )}

        <SwitcherCard
          icon={TelegramIcon}
          title="Telegram"
          subtitle={`${tgws?.host ?? '127.0.0.1'}:${tgws?.port ?? 1443}`}
          version={tgws?.installedVersion ?? updateInfo?.installed}
          status={status}
          onToggle={(v) => (v ? tgwsStart() : tgwsStop()).catch(() => void 0)}
          footer={running ? null : 'Нажмите для запуска'}
        />

        {/* Connection Link & Quick Share */}
        <Card className="cyber-card">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
            <div>
              <CardTitle className="text-base font-bold flex items-center gap-2">
                <TelegramIcon className="size-5 text-sky-700 dark:text-sky-400" />
                <span>Ссылка для подключения Telegram</span>
              </CardTitle>
              <p className="text-xs text-muted-foreground mt-0.5">
                Защищённый MTProto прокси с маскировкой под WebSocket трафик.
              </p>
            </div>
            <div className="flex items-center gap-1.5">
              <Button
                size="sm"
                variant="outline"
                className={cn(
                  'h-8 text-xs gap-1.5 rounded-xl border-border/80 transition-all',
                  showQr && 'bg-primary/15 border-primary/40 text-primary shadow-[0_0_12px_rgba(99,102,241,0.25)]'
                )}
                onClick={() => setShowQr((v) => !v)}
              >
                <QrCode className="size-3.5" />
                <span>QR-код</span>
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center gap-2">
              <div className="relative flex-1">
                <Input
                  readOnly
                  value={link || 'Запустите прокси для получения ссылки…'}
                  placeholder="Запустите прокси для получения ссылки"
                  className="font-mono text-xs pr-9 bg-background/50 border-border/70 rounded-xl select-all"
                  onClick={(e) => (e.target as HTMLInputElement).select()}
                />
              </div>
              <Button
                size="icon-sm"
                variant="outline"
                className="rounded-xl cursor-pointer hover:border-primary/50 hover:text-primary transition-colors"
                onClick={async () => {
                  if (!link) return
                  await writeClipboard(link)
                  toast.success('Ссылка скопирована', { style: POWER_ON_TOAST_STYLE })
                }}
                title="Скопировать ссылку"
              >
                <Copy className="size-4" />
              </Button>
              <Button
                size="icon-sm"
                variant="outline"
                className="rounded-xl cursor-pointer hover:border-sky-500/50 hover:text-sky-700 dark:hover:text-sky-400 transition-colors"
                onClick={() => link && openTelegramLink(link).catch(() => void 0)}
                title="Открыть в Telegram"
              >
                <ExternalLink className="size-4" />
              </Button>
              <Button
                size="icon-sm"
                variant="outline"
                className="rounded-xl cursor-pointer hover:border-primary/50 hover:text-primary transition-colors"
                onClick={handleRegenerateLink}
                disabled={regenerating}
                title="Сгенерировать новый секретный ключ"
              >
                {regenerating
                  ? <Loader2 className="size-4 animate-spin" />
                  : <ReloadTgwsIcon className="size-4" />}
              </Button>
            </div>

            {/* QR Code Section */}
            {showQr && (
              <div className="rounded-2xl border border-border/80 bg-background/60 backdrop-blur-xl p-5 animate-in fade-in zoom-in-95">
                <div className="flex flex-col md:flex-row items-center gap-6">
                  <div className="rounded-2xl bg-white p-3.5 shadow-[0_0_25px_rgba(255,255,255,0.15)] shrink-0">
                    <QRCodeSVG
                      value={activeQrLink}
                      size={150}
                      level="M"
                      includeMargin={false}
                    />
                  </div>

                  <div className="flex-1 space-y-3 min-w-0">
                    <div>
                      <div className="text-sm font-bold text-foreground flex items-center gap-2">
                        <Smartphone className="size-4 text-primary" />
                        Подключение смартфона через Wi-Fi
                      </div>
                      <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
                        Отсканируйте камерой телефона для моментального добавления прокси в официальное приложение Telegram.
                      </p>
                    </div>

                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => setQrMode('lan')}
                        className={cn(
                          'rounded-xl border px-3 py-1.5 text-xs font-semibold transition-all flex items-center gap-1.5 cursor-pointer',
                          qrMode === 'lan'
                            ? 'border-primary/50 bg-primary/20 text-primary shadow-[0_0_12px_rgba(99,102,241,0.2)]'
                            : 'border-border/60 text-muted-foreground hover:bg-foreground/[0.04]'
                        )}
                      >
                        <Wifi className="size-3.5" />
                        Локальная сеть ({shareInfo?.lanIp || 'Wi-Fi'})
                      </button>
                      <button
                        onClick={() => setQrMode('local')}
                        className={cn(
                          'rounded-xl border px-3 py-1.5 text-xs font-semibold transition-all flex items-center gap-1.5 cursor-pointer',
                          qrMode === 'local'
                            ? 'border-primary/50 bg-primary/20 text-primary shadow-[0_0_12px_rgba(99,102,241,0.2)]'
                            : 'border-border/60 text-muted-foreground hover:bg-foreground/[0.04]'
                        )}
                      >
                        Этот ПК (127.0.0.1)
                      </button>
                    </div>

                    <div className="flex flex-wrap gap-2 pt-1">
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-8 text-xs gap-1.5 rounded-xl cursor-pointer hover:border-primary/50"
                        onClick={async () => {
                          await writeClipboard(activeQrLink)
                          toast.success('tg:// ссылка скопирована', { style: POWER_ON_TOAST_STYLE })
                        }}
                      >
                        <Copy className="size-3.5" />
                        Скопировать tg://
                      </Button>
                      {activeHttpLink && (
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-8 text-xs gap-1.5 rounded-xl cursor-pointer hover:bg-foreground/[0.06]"
                          onClick={async () => {
                            await writeClipboard(activeHttpLink)
                            toast.success('t.me ссылка скопирована', { style: POWER_ON_TOAST_STYLE })
                          }}
                        >
                          <ExternalLink className="size-3.5" />
                          Скопировать t.me/proxy
                        </Button>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            )}

            <p className="text-xs text-muted-foreground inline-flex flex-wrap items-center gap-x-1 gap-y-0.5">
              Вставьте ссылку в Telegram
              <span className="opacity-70">&rarr;</span>
              Настройки
              <span className="opacity-70">&rarr;</span>
              Продвинутые настройки
              <span className="opacity-70">&rarr;</span>
              Тип соединения
              <span className="opacity-70">&rarr;</span>
              <MoreVertical className="size-3.5 translate-y-px -mx-1.5" />
              <span>или нажмите</span>
              <ExternalLink className="size-3.5 translate-y-px" />
              <span>для мгновенного подключения.</span>
            </p>
          </CardContent>
        </Card>

        {/* Telegram Data Centers Ping Monitor */}
        <Card className="cyber-card">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
            <div>
              <CardTitle className="text-base font-bold flex items-center gap-2">
                <Server className="size-4.5 text-primary" />
                <span>Датацентры Telegram (DC1 - DC5)</span>
              </CardTitle>
              <p className="text-xs text-muted-foreground mt-0.5">
                Мониторинг задержки прямого подключения к узлам Telegram.
              </p>
            </div>
            <Button
              size="sm"
              variant="outline"
              onClick={() => { void handlePingDcs() }}
              disabled={pingingDcs}
              className="h-8 text-xs gap-1.5 rounded-xl cursor-pointer border-border/80 hover:border-primary/50 hover:text-primary transition-all"
            >
              {pingingDcs ? <Loader2 className="size-3.5 animate-spin text-primary" /> : <RefreshCw className="size-3.5" />}
              <span>Замерить задержку</span>
            </Button>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
              {(dcs.length > 0 ? dcs : [
                { dc: 1, name: 'DC1 (Pluto)', location: 'США (Майами)', ip: '149.154.175.50', port: 443, latencyMs: null, status: 'offline' as const },
                { dc: 2, name: 'DC2 (Venus)', location: 'Европа (Амстердам)', ip: '149.154.167.51', port: 443, latencyMs: null, status: 'offline' as const },
                { dc: 3, name: 'DC3 (Aurora)', location: 'США (Майами)', ip: '149.154.175.100', port: 443, latencyMs: null, status: 'offline' as const },
                { dc: 4, name: 'DC4 (Vesta)', location: 'Европа (Амстердам)', ip: '149.154.167.91', port: 443, latencyMs: null, status: 'offline' as const },
                { dc: 5, name: 'DC5 (Flora)', location: 'Азия (Сингапур)', ip: '91.108.56.165', port: 443, latencyMs: null, status: 'offline' as const }
              ]).map((d) => {
                const isGood = d.latencyMs !== null && d.latencyMs < 100
                const isMedium = d.latencyMs !== null && d.latencyMs >= 100 && d.latencyMs < 200
                const isBad = d.latencyMs !== null && d.latencyMs >= 200

                return (
                  <div
                    key={d.dc}
                    className={cn(
                      'rounded-xl border p-3 flex flex-col justify-between transition-all duration-200 bg-card/60 backdrop-blur-md',
                      isGood && 'border-emerald-500/30 hover:border-emerald-500/50 shadow-[0_0_15px_-4px_rgba(16,185,129,0.15)]',
                      isMedium && 'border-amber-500/30 hover:border-amber-500/50',
                      isBad && 'border-rose-500/30 hover:border-rose-500/50',
                      d.latencyMs === null && 'border-border/60'
                    )}
                  >
                    <div>
                      <div className="flex items-center justify-between mb-1">
                        <span className="font-bold text-xs text-foreground font-mono">{d.name}</span>
                        {d.latencyMs !== null ? (
                          <span className={cn(
                            'rounded-full px-2 py-0.5 text-[10px] font-mono font-bold border',
                            isGood && 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border-emerald-500/30',
                            isMedium && 'bg-amber-500/15 text-amber-700 dark:text-amber-400 border-amber-500/30',
                            isBad && 'bg-rose-500/15 text-rose-700 dark:text-rose-400 border-rose-500/30'
                          )}>
                            {d.latencyMs} мс
                          </span>
                        ) : pingingDcs ? (
                          <span className="text-[10px] text-primary font-mono animate-pulse">пинг…</span>
                        ) : (
                          <span className="text-[10px] text-muted-foreground/60 font-mono">—</span>
                        )}
                      </div>
                      <div className="text-[11px] text-muted-foreground">{d.location}</div>
                    </div>
                    <div className="mt-3 pt-2 border-t border-border/40 text-[10px] font-mono text-muted-foreground/70 truncate" title={`${d.ip}:${d.port}`}>
                      {d.ip}
                    </div>
                  </div>
                )
              })}
            </div>
          </CardContent>
        </Card>

        {/* Parameters */}
        <Card className="cyber-card">
          <CardHeader>
            <CardTitle className="text-base font-bold">Параметры соединения</CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-x-4 gap-y-4">
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Хост</Label>
              <Input
                value={tgws?.host ?? ''}
                onChange={(e) => patchAppConfig({ tgws: { ...tgws!, host: e.target.value } })}
                placeholder="127.0.0.1"
                className="rounded-xl bg-background/50 border-border/70 font-mono text-xs"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Порт</Label>
              <Input
                type="number"
                value={tgws?.port ?? 1443}
                onChange={(e) =>
                  patchAppConfig({ tgws: { ...tgws!, port: Number(e.target.value) || 1443 } })
                }
                className="rounded-xl bg-background/50 border-border/70 font-mono text-xs"
              />
            </div>
            <div className="md:col-span-2 space-y-1.5">
              <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Секретный ключ (32-hex MTProto)</Label>
              <Input
                value={tgws?.secret ?? ''}
                onChange={(e) => patchAppConfig({ tgws: { ...tgws!, secret: e.target.value.trim() } })}
                className="font-mono text-xs rounded-xl bg-background/50 border-border/70"
              />
            </div>
          </CardContent>
        </Card>

        {status.lastError && (
          <Card className="border-rose-500/40 bg-rose-950/20 backdrop-blur-xl">
            <CardContent className="pt-4">
              <p className="text-xs text-rose-700 dark:text-rose-400 font-mono">{status.lastError}</p>
            </CardContent>
          </Card>
        )}
      </div>
    </BasePage>
  )
}

export default TelegramPage
