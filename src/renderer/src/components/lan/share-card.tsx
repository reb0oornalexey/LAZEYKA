import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useTgwsStore } from '@renderer/store/tgws-store'
import { tgwsGetShareLinks, type TgwsShareInfo } from '@renderer/utils/ipc'
import { QRCodeSVG } from 'qrcode.react'
import { cn } from '@renderer/lib/utils'
import { Button } from '@renderer/components/ui/button'
import { lanCheckYouTubeProxy, type LanState } from '@renderer/utils/lan-api'
import { Card, CopyButton, Notice, PhoneVpnHint } from './common'
import { TelegramBlock } from './telegram-block'

export function ShareCard({ state }: { state: LanState }): React.ReactElement {
  const [tab, setTab] = useState(state.guides[0]?.id ?? 'ios')
  const guide = state.guides.find((g) => g.id === tab) ?? state.guides[0]
  const [checking, setChecking] = useState(false)
  const [showPhoneCheck, setShowPhoneCheck] = useState(false)
  const [checkResult, setCheckResult] = useState<Awaited<ReturnType<typeof lanCheckYouTubeProxy>>>([])
  const [checkError, setCheckError] = useState<string | null>(null)
  const checkProxy = async (): Promise<void> => {
    setChecking(true)
    setCheckResult([])
    setCheckError(null)
    try {
      setCheckResult(await lanCheckYouTubeProxy())
    } catch (error) {
      setCheckError(error instanceof Error ? error.message : String(error))
    } finally {
      setChecking(false)
    }
  }
  const tgws = useTgwsStore((store) => store.status.state)
  const [tgwsShare, setTgwsShare] = useState<TgwsShareInfo | null>(null)
  useEffect(() => {
    setTgwsShare(null)
    if (tgws !== 'running') return
    let active = true
    void tgwsGetShareLinks().then((info) => {
      if (active) setTgwsShare(info)
    }).catch(() => void 0)
    return () => { active = false }
  }, [tgws])
  const phoneCheckUrl = 'http://lazeyka-proxy-check.invalid/'
  const p = state.proxy
  const s = state.stats
  const devices = s?.devices.filter((address) => address !== p?.host) ?? []
  return (
    <Card
      title="Раздача на устройства"
      tour="lan-share"
      hint="Компьютер работает прокси-сервером: устройства в вашей сети выходят в интернет через него. Соединения открывает компьютер. Проверка ниже покажет, проходит ли трафик через прокси с текущими настройками ПК."
    >
      {!state.enabled ? (
        <p className="text-xs text-muted-foreground">Включите раздел сверху, чтобы получить адрес и порт.</p>
      ) : !p ? (
        <p className="text-xs text-muted-foreground">Раздача на устройства выключена на вкладке «Настройки».</p>
      ) : (
        <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <div className="min-w-0 space-y-3">
          <div className="flex items-center gap-4 rounded-xl border border-foreground/[0.08] bg-foreground/[0.03] p-3">
            <div className="min-w-0 flex-1 space-y-2">
              <div className="flex flex-wrap gap-x-6 gap-y-1">
                <div>
                  <div className="text-[11px] text-muted-foreground">Адрес</div>
                  <div data-sensitive="ip" className="break-all text-[20px] font-extrabold tabular-nums">{p.host}</div>
                </div>
                <div>
                  <div className="text-[11px] text-muted-foreground">Порт</div>
                  <div data-sensitive="ip" className="text-[20px] font-extrabold tabular-nums">{p.port}</div>
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                <CopyButton text={p.host} label="Адрес" />
                <CopyButton text={String(p.port)} label="Порт" />
              </div>
              <p className="text-[11px] text-muted-foreground">
                HTTP и SOCKS5 на одном порту. {p.authRequired ? 'Включён пароль.' : 'Пароль не задан.'}
                {devices.length > 0 && (
                  <span data-sensitive="ip"> Устройства: {devices.join(', ')}.</span>
                )}
              </p>
            </div>
            {state.setupUrl && (
              <div className="flex shrink-0 flex-col items-center gap-1.5" title="QR откроет на телефоне страницу с адресом и инструкцией">
                <div data-sensitive="qr" className="rounded-xl bg-white p-2">
                  <QRCodeSVG value={state.setupUrl} size={104} level="M" />
                </div>
                <span className="max-w-[120px] text-center text-[10.5px] leading-tight text-muted-foreground">страница с инструкцией</span>
              </div>
            )}
          </div>
          <div className="lz-control-surface space-y-2 rounded-xl border p-3">
            <div className="text-xs font-semibold">Проверка подключения устройства</div>
            <p className="text-xs">Укажите адрес и порт в настройках Wi-Fi телефона. Затем проверьте в браузере, что телефон действительно использует прокси. Приложение YouTube может пользоваться другим маршрутом.</p>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="outline" disabled={!p.active} aria-expanded={showPhoneCheck} onClick={() => setShowPhoneCheck((value) => !value)}>
                {showPhoneCheck ? 'Скрыть QR' : 'QR для проверки телефона'}
              </Button>
              <CopyButton text={phoneCheckUrl} label="Адрес проверки" />
            </div>
            {showPhoneCheck && (
              <div className="flex flex-wrap items-center gap-3">
                <QRCodeSVG value={phoneCheckUrl} size={100} level="M" className="rounded-lg bg-white p-2" />
                <p className="min-w-40 flex-1 text-xs">Откройте адрес по HTTP на телефоне. Должно появиться сообщение «браузер подключён к прокси компьютера». Если браузер переключился на HTTPS, введите адрес с <code>http://</code>.</p>
              </div>
            )}
            <p className="text-xs">{devices.length ? 'Есть недавние подключения к прокси. Проверьте, что среди них есть адрес вашего устройства.' : 'Прокси пока не видит подключений устройств.'}</p>
            <Button size="sm" variant="outline" disabled={!p.active || checking} onClick={() => void checkProxy()}>
              {checking ? 'Проверяю…' : 'Проверить YouTube через этот прокси'}
            </Button>
            <p className="text-[11px]">Проверка идёт с компьютера через тот же прокси и показывает ответ сайта и сервера видео. Воспроизведение на телефоне проверяется отдельно.</p>
            {checkError && <p className="text-xs text-st-err-text" role="status">{checkError}</p>}
            {checkResult.length > 0 && (
              <ul className="space-y-1 text-xs" role="status">
                {checkResult.map((r) => (
                  <li key={r.label}><span className={r.ok ? 'text-st-ok-text' : 'text-st-err-text'}>{r.label}</span> — {r.detail}</li>
                ))}
              </ul>
            )}
          </div>
          <PhoneVpnHint text={state.phoneVpnHint} />

          {!p.authRequired && (
            <Notice tone="warn">Пароля нет: прокси пустит любое устройство из локальной сети. В чужой сети включите пароль на вкладке «Настройки».</Notice>
          )}

          {tgws === 'running' && (
            tgwsShare?.lanLink && tgwsShare.httpLanLink ? (
              <TelegramBlock
                links={{ tg: tgwsShare.lanLink, https: tgwsShare.httpLanLink }}
                title="Telegram через TGWS на ПК"
                hint="Подключает Telegram на телефоне к запущенному TGWS. В настройках Wi-Fi прокси задавать не нужно."
                authRequired={false}
                tour="lan-tgws-telegram"
              />
            ) : (
              <div className="lz-control-surface space-y-2 rounded-xl border p-3">
                <p className="text-xs">TGWS запущен. Чтобы телефон мог подключиться, откройте прокси для локальной сети в разделе Telegram.</p>
                <Button size="sm" variant="outline" asChild><Link to="/telegram">Открыть Telegram</Link></Button>
              </div>
            )
          )}
          {state.telegram && <TelegramBlock links={state.telegram} title="Telegram через SOCKS5" hint={state.telegramHint} authRequired={p.authRequired} tour="lan-share-telegram" />}
          </div>

          <div className="min-w-0 space-y-3">
          <div data-tour="lan-share-guides">
            <div className="mb-2 flex flex-wrap gap-1.5">
              {state.guides.map((g) => (
                <button
                  key={g.id}
                  type="button"
                  onClick={() => setTab(g.id)}
                  className={cn(
                    'cursor-pointer rounded-lg px-2.5 py-1 text-xs font-semibold transition-colors',
                    g.id === tab ? 'bg-primary text-primary-foreground' : 'bg-foreground/[0.06] text-muted-foreground hover:text-foreground'
                  )}
                >
                  {g.title}
                </button>
              ))}
            </div>
            {guide && (
              <div className="rounded-xl border border-foreground/[0.08] bg-foreground/[0.03] p-3">
                <ol className="list-decimal space-y-1 pl-5 text-xs leading-relaxed">
                  {guide.steps.map((st, i) => (
                    <li key={i}>{st}</li>
                  ))}
                </ol>
                {guide.note && <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">{guide.note}</p>}
                {guide.ignores && (
                  <p className="mt-2 text-[11px] leading-relaxed text-st-warn-text">Что не заработает: {guide.ignores}</p>
                )}
              </div>
            )}
          </div>
          <p className="text-[11px] leading-relaxed text-muted-foreground">{state.honestNote}</p>
          <p data-tour="lan-share-quic" className="text-[11px] leading-relaxed text-muted-foreground">{state.quicHint}</p>
          </div>
        </div>
      )}
    </Card>
  )
}
