import { useCallback, useEffect, useRef, useState } from 'react'
import { CircleHelp, Eye, EyeOff, Loader2, MonitorSmartphone, Network, Pencil } from 'lucide-react'
import { QRCodeSVG } from 'qrcode.react'
import { toast } from 'sonner'
import { Button } from '@renderer/components/ui/button'
import { Input } from '@renderer/components/ui/input'
import { Switch } from '@renderer/components/ui/switch'
import { lanHotspotSet, lanHotspotState, type HotspotInfo, type LanState } from '@renderer/utils/lan-api'
import { Card, CopyButton, Notice, PhoneVpnHint, errMsg } from './common'
import { TelegramBlock } from './telegram-block'

const MAC_TEXT = 'macOS не умеет раздавать Wi-Fi с того же Wi-Fi-адаптера; используйте раздачу через прокси.'

export function HotspotCard({ platform, state }: { platform: string; state: LanState }): React.ReactElement {
  const [info, setInfo] = useState<HotspotInfo | null>(null)
  const [loading, setLoading] = useState(platform === 'win32')
  const [busy, setBusy] = useState(false)
  const [showPass, setShowPass] = useState(false)
  const [showCheck, setShowCheck] = useState(false)
  const [showProxy, setShowProxy] = useState(false)
  const [editing, setEditing] = useState(false)
  const [ssid, setSsid] = useState('')
  const [pass, setPass] = useState('')
  const alive = useRef(true)

  const read = useCallback(async () => {
    try {
      const i = await lanHotspotState()
      if (alive.current) setInfo(i)
    } catch (e) {
      if (alive.current) toast.error(errMsg(e))
    } finally {
      if (alive.current) setLoading(false)
    }
  }, [])

  useEffect(() => {
    alive.current = true
    if (platform === 'win32') void read()
    return () => {
      alive.current = false
    }
  }, [platform, read])

  // Число клиентов обновляется раз в 8 секунд, только пока раздача включена и окно видно.
  const on = info?.on ?? false
  useEffect(() => {
    if (!on) return
    const t = setInterval(() => {
      if (document.visibilityState === 'visible' && !busy) void read()
    }, 8000)
    return () => clearInterval(t)
  }, [on, busy, read])

  const run = async (arg: { on?: boolean; ssid?: string; password?: string }): Promise<void> => {
    setBusy(true)
    try {
      const i = await lanHotspotSet(arg)
      setInfo(i)
      setEditing(false)
    } catch (e) {
      toast.error(errMsg(e))
    } finally {
      setBusy(false)
    }
  }

  if (platform !== 'win32') {
    return (
      <Card title="Раздать Wi-Fi" hint="Компьютер создаёт свою сеть Wi-Fi, к которой можно подключить телевизор, приставку или телефон гостя.">
        <Notice tone="info">{MAC_TEXT}</Notice>
      </Card>
    )
  }

  return (
    <Card
      title="Раздать Wi-Fi"
      tour="lan-hotspot"
      hint="Компьютер создаёт свою сеть Wi-Fi (мобильный хот-спот Windows). Удобно для телевизора, приставки или телефона гостя, где нет настройки прокси. Работает независимо от главного выключателя."
      right={
        loading ? (
          <Loader2 className="size-4 animate-spin text-muted-foreground" />
        ) : info?.supported ? (
          <Switch checked={info.on} disabled={busy} onCheckedChange={(v) => void run({ on: v })} aria-label="Раздать Wi-Fi" />
        ) : null
      }
    >
      {loading ? (
        <p className="text-xs text-muted-foreground">Читаю состояние раздачи…</p>
      ) : !info?.supported ? (
        <Notice tone="info">{info?.reason ?? 'Раздача Wi-Fi недоступна.'}</Notice>
      ) : (
        <div className="space-y-3">
          <p className="text-[11px] leading-relaxed text-muted-foreground">
            Для телевизора, приставки или телефона гостя: подключите устройство к этой сети Wi-Fi.
          </p>
          {/* QR не задаёт высоту левой колонки: он небольшой и прижат к верху, а слева — всё нужное. */}
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
            <div className="min-w-0 flex-1 space-y-3">
              {editing ? (
                <div className="space-y-2 rounded-xl border border-foreground/[0.08] bg-foreground/[0.03] p-3">
                  <div className="grid gap-2 sm:grid-cols-2">
                    <label className="space-y-1">
                      <span className="text-[11px] text-muted-foreground">Имя сети</span>
                      <Input value={ssid} onChange={(e) => setSsid(e.target.value)} placeholder="Имя сети" className="h-8 text-xs" maxLength={32} />
                    </label>
                    <label className="space-y-1">
                      <span className="text-[11px] text-muted-foreground">Пароль (8–63 символа)</span>
                      <Input value={pass} onChange={(e) => setPass(e.target.value)} placeholder="Пароль" className="h-8 text-xs" maxLength={63} />
                    </label>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Button size="sm" className="h-8 text-xs" disabled={busy} onClick={() => void run({ ssid, password: pass })}>
                      {busy && <Loader2 className="size-3.5 animate-spin" />}
                      Сохранить
                    </Button>
                    <Button size="sm" variant="ghost" className="h-8 text-xs" onClick={() => setEditing(false)}>
                      Отмена
                    </Button>
                    {info.on && <span className="text-[11px] text-muted-foreground">Раздача на секунду выключится и включится снова.</span>}
                  </div>
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-2">
                  <Field label="Имя сети">
                    <span data-sensitive="ip" className="truncate">{info.ssid || '—'}</span>
                  </Field>
                  <Field label="Пароль">
                    <span data-sensitive="ip" className="truncate font-mono">{showPass ? info.password || '—' : '••••••••'}</span>
                    <button
                      type="button"
                      aria-label={showPass ? 'Скрыть пароль' : 'Показать пароль'}
                      className="shrink-0 text-muted-foreground hover:text-foreground"
                      onClick={() => setShowPass((v) => !v)}
                    >
                      {showPass ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
                    </button>
                  </Field>
                </div>
              )}

              <div data-tour="lan-hotspot-devices" className="rounded-xl bg-foreground/[0.04] px-3 py-2 text-xs">
                <div className="flex items-center gap-1.5">
                  <MonitorSmartphone className="size-3.5 text-muted-foreground" />
                  {info.on ? (
                    <span>
                      Подключено устройств: <b>{info.clients}</b>
                    </span>
                  ) : (
                    <span className="text-muted-foreground">Раздача выключена</span>
                  )}
                </div>
                {info.on && info.devices.length > 0 && (
                  <ul data-sensitive="ip" className="mt-1.5 space-y-0.5 text-[11px] text-muted-foreground">
                    {info.devices.slice(0, 8).map((d) => (
                      <li key={d.mac || d.name} className="flex justify-between gap-3">
                        <span className="truncate text-foreground/90">{d.name || 'Без имени'}</span>
                        <span className="shrink-0 font-mono">{d.mac}</span>
                      </li>
                    ))}
                    {info.devices.length > 8 && <li>и ещё {info.devices.length - 8}</li>}
                  </ul>
                )}
              </div>

              {!editing && (
                <div className="flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-8 text-xs"
                    disabled={busy}
                    onClick={() => {
                      setSsid(info.ssid)
                      setPass(info.password)
                      setEditing(true)
                    }}
                  >
                    <Pencil className="size-3.5" />
                    Изменить имя и пароль
                  </Button>
                  <Button
                    size="sm"
                    variant={showProxy ? 'secondary' : 'outline'}
                    className="h-8 text-xs"
                    data-tour="lan-hotspot-proxy"
                    aria-expanded={showProxy}
                    onClick={() => setShowProxy((v) => !v)}
                  >
                    <Network className="size-3.5" />
                    Адрес прокси для устройства
                  </Button>
                  <Button size="sm" variant={showCheck ? 'secondary' : 'outline'} className="h-8 text-xs" aria-expanded={showCheck} onClick={() => setShowCheck((v) => !v)}>
                    <CircleHelp className="size-3.5" />
                    Как проверить
                  </Button>
                </div>
              )}
            </div>

            {info.on && info.wifiQr && !editing && (
              <div className="flex shrink-0 items-center gap-2.5 self-center sm:w-[112px] sm:flex-col sm:items-center sm:self-start">
                <div data-sensitive="qr" className="rounded-xl bg-white p-2">
                  <QRCodeSVG value={info.wifiQr} size={96} level="M" />
                </div>
                <span className="text-[11px] leading-snug text-muted-foreground sm:text-center">QR для подключения к этой сети Wi-Fi</span>
              </div>
            )}
          </div>

          {showProxy && <HotspotProxyInfo state={state} hotspotOn={info.on} />}
          {showCheck && (
            <ol className="list-decimal space-y-1 rounded-xl border border-foreground/[0.08] bg-foreground/[0.03] p-3 pl-7 text-xs leading-relaxed">
              <li>Подключите телефон или другое устройство к раздаваемой сети Wi-Fi.</li>
              <li>Откройте в браузере устройства сайт 2ip.ru и запомните показанный IP-адрес.</li>
              <li>Откройте тот же сайт в браузере на компьютере и сравните адреса.</li>
              <li>Если адреса совпадают — трафик устройства идёт тем же путём, что и компьютера (с VPN или без, как у компьютера). Если нет — устройство выходит напрямую.</li>
            </ol>
          )}

          {info.on && state.enabled && state.hotspot && !state.firewallRule && (
            <div data-tour="lan-hotspot-firewall">
              <Notice tone="info">
                Windows обычно считает раздаваемую сеть Wi-Fi общедоступной и может не пускать её устройства к пульту и прокси. Если они не открываются, нажмите
                «Разрешить в брандмауэре» на вкладке «Настройки».
              </Notice>
            </div>
          )}
          {info.on && state.zapretOn && !state.vpn.on && (
            <div data-tour="lan-hotspot-zapret-warning">
              <Notice tone="warn">
                Windows передаёт трафик устройств через точку доступа. LAZEYKA не подтверждает, что текущая стратегия Zapret обрабатывает этот транзитный трафик. Для браузера можно настроить прокси по адресу точки доступа ниже.
              </Notice>
            </div>
          )}
          {info.on && state.vpn.on && state.vpn.mode !== 'tun' && (
            <div data-tour="lan-hotspot-vpn-warning">
              <Notice tone="warn">VPN сейчас в режиме без TUN: он действует только на программы компьютера, устройства этой сети идут мимо него. Включите режим TUN или пропишите на устройстве прокси.</Notice>
            </div>
          )}
          {info.on && (
            <Notice tone="warn">
              Устройства получают интернет компьютера. Пойдёт ли их трафик через VPN, зависит от режима: в режиме TUN обычно да, но это нужно проверить на вашей системе.
            </Notice>
          )}
        </div>
      )}
    </Card>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }): React.ReactElement {
  return (
    <div className="min-w-0 rounded-xl bg-foreground/[0.04] px-3 py-2">
      <div className="text-[11px] text-muted-foreground">{label}</div>
      <div className="flex min-w-0 items-center gap-1.5 text-xs font-bold">{children}</div>
    </div>
  )
}

/** Адрес прокси для устройств, подключённых к раздаваемому Wi-Fi: адрес компьютера в той сети (обычно 192.168.137.1). */
function HotspotProxyInfo({ state, hotspotOn }: { state: LanState; hotspotOn: boolean }): React.ReactElement {
  const h = state.hotspot
  if (!state.enabled) return <Notice tone="info">Включите «Локальную сеть» кнопкой сверху: без неё прокси не запущен.</Notice>
  if (!hotspotOn) return <Notice tone="info">Сначала включите раздачу Wi-Fi.</Notice>
  if (!h) return <Notice tone="info">Адрес раздаваемой сети ещё не появился. Подождите несколько секунд: страница обновится сама.</Notice>
  if (!h.proxy) return <Notice tone="info">Раздача на устройства выключена на вкладке «Настройки»: включите её, чтобы появился прокси.</Notice>
  return (
    <div className="space-y-3 rounded-xl border border-foreground/[0.08] bg-foreground/[0.03] p-3">
      <p className="text-xs leading-relaxed">
        В настройках прокси на устройстве, подключённом к этой сети Wi-Fi, впишите адрес компьютера в ЭТОЙ сети. Адрес домашней сети с вкладки «Раздача» здесь не подойдёт.
      </p>
      <div className="flex flex-col gap-4 md:flex-row md:items-start">
        <div className="min-w-0 flex-1 space-y-2">
          <div>
            <div className="text-[11px] text-muted-foreground">Адрес</div>
            <div data-sensitive="ip" className="break-all font-mono text-xl font-black">{h.proxy.host}</div>
          </div>
          <div>
            <div className="text-[11px] text-muted-foreground">Порт</div>
            <div data-sensitive="ip" className="font-mono text-xl font-black">{h.proxy.port}</div>
          </div>
          <div className="flex flex-wrap gap-2">
            <CopyButton text={h.proxy.host} label="Адрес" />
            <CopyButton text={String(h.proxy.port)} label="Порт" />
          </div>
          <p className="text-[11px] text-muted-foreground">HTTP и SOCKS5 на одном порту. {h.proxy.authRequired ? 'Включён пароль.' : 'Пароль не задан.'}</p>
        </div>
        {h.setupUrl && (
          <div className="flex flex-col items-center gap-1.5">
            <div data-sensitive="qr" className="rounded-xl bg-white p-2.5">
              <QRCodeSVG value={h.setupUrl} size={120} level="M" />
            </div>
            <span className="max-w-[170px] text-center text-[11px] text-muted-foreground">QR откроет страницу с адресом и инструкцией (устройство должно быть в этой сети Wi-Fi)</span>
          </div>
        )}
      </div>
      <PhoneVpnHint text={state.phoneVpnHint} />
      {h.telegram && <TelegramBlock links={h.telegram} hint={state.telegramHint} authRequired={h.proxy.authRequired} tour="lan-hotspot-telegram" />}
    </div>
  )
}
