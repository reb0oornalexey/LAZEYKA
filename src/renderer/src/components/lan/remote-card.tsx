import { useState } from 'react'
import { ChevronDown, ExternalLink, Smartphone } from 'lucide-react'
import { QRCodeSVG } from 'qrcode.react'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { Button } from '@renderer/components/ui/button'
import { cn } from '@renderer/lib/utils'
import { lanOpenRemote, type LanState } from '@renderer/utils/lan-api'
import logo from '@renderer/assets/logo.png'
import { Card, CopyButton, Notice, PhoneVpnHint, errMsg } from './common'

type Os = 'ios' | 'android'

const INSTALL_STEPS: Record<Os, string[]> = {
  ios: [
    'Отсканируйте QR камерой и откройте ссылку в Safari.',
    'Нажмите «Поделиться» внизу экрана.',
    'Выберите «На экран „Домой“» и нажмите «Добавить».'
  ],
  android: [
    'Отсканируйте QR и откройте ссылку в Chrome.',
    'Нажмите меню (три точки) в правом верхнем углу.',
    'Выберите «Добавить на гл. экран» или «Установить приложение».'
  ]
}

/** Мини-превью пульта: как он выглядит на телефоне (рисунок, без связи с программой). */
function PhonePreview(): React.ReactElement {
  const tiles: { name: string; on: boolean }[] = [
    { name: 'Zapret', on: true },
    { name: 'VPN', on: true },
    { name: 'Telegram', on: false },
    { name: 'ExitLag', on: false }
  ]
  return (
    <div aria-hidden className="w-[132px] shrink-0 rounded-[22px] border border-border bg-[#0a0c0f] p-2 shadow-sm">
      <div className="mb-1.5 flex items-center gap-1.5 px-0.5">
        <img src={logo} alt="" className="size-4 rounded-[5px]" />
        <span className="text-[8px] font-bold tracking-wider text-white/90">LAZEYKA</span>
        <span className="ml-auto rounded-full bg-white/10 px-1 text-[6px] text-white/70">12 мс</span>
      </div>
      <div className="mb-1.5 rounded-lg bg-[#12161b] px-1.5 py-1.5">
        <div className="text-[8px] font-bold text-[#4ce896]">Защита включена</div>
        <div className="text-[6px] text-white/50">Работает: Zapret, VPN</div>
      </div>
      <div className="grid grid-cols-2 gap-1">
        {tiles.map((t) => (
          <div key={t.name} className={cn('rounded-md border px-1 py-1.5', t.on ? 'border-[#4ce896]/40 bg-[#4ce896]/10' : 'border-white/5 bg-[#12161b]')}>
            <div className={cn('mb-1 h-1.5 w-3 rounded-full', t.on ? 'bg-[#4ce896]' : 'bg-white/15')} />
            <div className="text-[7px] font-bold text-white/90">{t.name}</div>
            <div className={cn('text-[6px]', t.on ? 'text-[#4ce896]' : 'text-white/40')}>{t.on ? 'Включено' : 'Выключено'}</div>
          </div>
        ))}
      </div>
      <div className="mt-1.5 flex justify-around border-t border-white/5 pt-1 text-[6px] text-white/40">
        <span className="text-[#4ce896]">Пульт</span>
        <span>Подключение</span>
        <span>Ещё</span>
      </div>
    </div>
  )
}

export function RemoteCard({ state }: { state: LanState }): React.ReactElement {
  const navigate = useNavigate()
  const url = state.remoteUrl
  const [installOpen, setInstallOpen] = useState(false)
  const [os, setOs] = useState<Os>('ios')
  const [opening, setOpening] = useState(false)

  const openHere = async (): Promise<void> => {
    setOpening(true)
    try {
      await lanOpenRemote()
    } catch (e) {
      toast.error('Не удалось открыть пульт', { description: errMsg(e) })
    } finally {
      setOpening(false)
    }
  }

  return (
    <Card
      title="Пульт с телефона"
      tour="lan-remote"
      hint="Страница на телефоне, где можно включать и выключать Zapret, VPN, Telegram-прокси и ExitLag, выбирать сервер VPN и DNS и запускать сценарии. Работает только в вашей локальной сети и только по коду из QR."
    >
      {!state.enabled ? (
        <p className="text-xs text-muted-foreground">Включите раздел сверху, чтобы появился QR-код. Пока он выключен, компьютер никого не слушает.</p>
      ) : !url ? (
        <p className="text-xs text-muted-foreground">Пульт выключен на вкладке «Настройки».</p>
      ) : (
        <div className="space-y-4">
          <div className="flex flex-col items-center gap-5 md:flex-row">
            <div data-sensitive="qr" className="shrink-0 rounded-2xl bg-white p-3.5">
              <QRCodeSVG value={url} size={168} level="M" />
            </div>
            <div className="min-w-0 flex-1 space-y-3">
              <p className="text-xs leading-relaxed text-muted-foreground">
                Наведите камеру телефона на код. Телефон должен быть в той же сети Wi-Fi, что и компьютер. Код доступа лежит в ссылке:
                не показывайте этот QR посторонним. Если код попал не в те руки, нажмите «Сменить код» на вкладке «Настройки».
              </p>
              <div data-sensitive="ip" className="break-all rounded-xl bg-foreground/[0.05] px-3 py-2 font-mono text-xs">
                {state.address}:{state.settings.hubPort}
              </div>
              <div className="flex flex-wrap gap-2">
                <CopyButton text={url} label="Скопировать ссылку" />
                <Button
                  size="sm"
                  variant="outline"
                  className="h-8 text-xs"
                  disabled={opening}
                  onClick={() => void openHere()}
                  data-tour="lan-remote-open-here"
                >
                  <ExternalLink className="size-3.5" />
                  Открыть пульт в браузере на этом компьютере
                </Button>
                <Button size="sm" variant="outline" className="h-8 text-xs" onClick={() => navigate('/telegram')}>
                  <Smartphone className="size-3.5" />
                  QR для Telegram на телефоне → вкладка Telegram
                </Button>
              </div>
              <PhoneVpnHint text={state.phoneVpnHint} />
            </div>
          </div>

          <div data-tour="lan-remote-install" className="rounded-xl border border-foreground/[0.08] bg-foreground/[0.03]">
            <button
              type="button"
              className="flex w-full items-center gap-3 px-3 py-2.5 text-left"
              onClick={() => setInstallOpen((v) => !v)}
              aria-expanded={installOpen}
            >
              <img src={logo} alt="" className="size-8 shrink-0 rounded-lg" />
              <div className="min-w-0 flex-1">
                <div className="text-xs font-bold">Пульт можно установить как приложение</div>
                <div className="text-[11px] text-muted-foreground">Значок LAZEYKA на экране телефона открывает пульт без адресной строки</div>
              </div>
              <ChevronDown className={cn('size-4 shrink-0 text-muted-foreground transition-transform', installOpen && 'rotate-180')} />
            </button>
            {installOpen && (
              <div className="flex flex-col gap-4 border-t border-border px-3 py-3 sm:flex-row">
                <PhonePreview />
                <div className="min-w-0 flex-1 space-y-2.5">
                  <div className="inline-flex rounded-lg bg-foreground/[0.06] p-0.5" role="tablist">
                    {(['ios', 'android'] as const).map((k) => (
                      <button
                        key={k}
                        type="button"
                        role="tab"
                        aria-selected={os === k}
                        onClick={() => setOs(k)}
                        className={cn('rounded-md px-3 py-1 text-xs font-semibold transition-colors', os === k ? 'bg-background shadow-sm' : 'text-muted-foreground')}
                      >
                        {k === 'ios' ? 'iPhone' : 'Android'}
                      </button>
                    ))}
                  </div>
                  <ol className="list-decimal space-y-1 pl-4 text-xs leading-relaxed">
                    {INSTALL_STEPS[os].map((s) => (
                      <li key={s}>{s}</li>
                    ))}
                  </ol>
                  <p className="text-[11px] leading-relaxed text-muted-foreground">
                    Пока пульт открыт, на телефоне появляются события: обрыв VPN, остановка Zapret, выполненный сценарий. Уведомлений при закрытом
                    пульте не будет: для них телефону нужен защищённый адрес (https), а пульт работает внутри домашней сети по обычному http.
                  </p>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
      {state.enabled && url && state.networkCategory === 'public' && !state.firewallRule && (
        <div className="mt-3">
          <Notice tone="warn">Сеть компьютера в Windows помечена как «Общедоступная»: брандмауэр может не пускать устройства. Нажмите «Разрешить в брандмауэре» на вкладке «Настройки».</Notice>
        </div>
      )}
    </Card>
  )
}
