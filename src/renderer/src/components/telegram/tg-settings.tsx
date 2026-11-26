import React, { useState } from 'react'
import { toast } from 'sonner'
import { Cloud, Copy, ExternalLink, KeyRound, Link2, Loader2, MoreVertical, Plug, Route, Smartphone, Wand2 } from 'lucide-react'
import { useTgwsStore } from '@renderer/store/tgws-store'
import { useIncyStore } from '@renderer/store/incy-store'
import { useAppConfig } from '@renderer/hooks/use-app-config'
import { platform } from '@renderer/utils/init'
import { Button } from '@renderer/components/ui/button'
import { Input } from '@renderer/components/ui/input'
import { Switch } from '@renderer/components/ui/switch'
import { Hint } from '@renderer/components/prematch/hint'
import { LzPanel, LzSectionHead, Segmented, type SegmentedItem } from '@renderer/components/lz'
import ReloadTgwsIcon from '@renderer/components/reload-tgws-icon'
import { POWER_ON_BANNER_STYLE, cn } from '@renderer/lib/utils'
import { incyReapplyTunnel, openExternalUrl, openTelegramLink, tgwsCheckWorkers, tgwsRestart, writeClipboard, type TgwsWorkerCheck } from '@renderer/utils/ipc'

/*
 * Настройки прокси Telegram — одна панель с тремя вкладками вместо трёх
 * карточек подряд: «Ссылка» (ссылка, ключ, как добавить вручную),
 * «Соединение» (хост, порт, секрет), «Маршрут» (авто / свой Worker, VPN INCY).
 * Логика сохранения перенесена из pages/telegram.tsx без изменений.
 */

export type TgSettingsTab = 'link' | 'conn' | 'route'

const TABS: SegmentedItem<TgSettingsTab>[] = [
  { id: 'link', label: 'Ссылка', icon: Link2, title: 'Ссылка для Telegram и секретный ключ' },
  { id: 'conn', label: 'Соединение', icon: Plug, title: 'Хост, порт и секретный ключ прокси' },
  { id: 'route', label: 'Маршрут', icon: Route, title: 'Каким путём прокси соединяется с Telegram' }
]

const ROUTE_ITEMS: SegmentedItem<'auto' | 'worker'>[] = [
  { id: 'auto', label: 'Авто', icon: Wand2, title: 'Прямой WebSocket к Telegram. Если не вышло — ваш Worker, затем общий CF-прокси' },
  { id: 'worker', label: 'Свой Cloudflare Worker', icon: Cloud, title: 'Все соединения идут через ваш Worker, прямой WebSocket выключен' }
]

const field = 'h-9 rounded-xl border-foreground/[0.1] bg-foreground/[0.035] text-[13px] tabular-nums'

const FieldLabel: React.FC<{ children: React.ReactNode; hint?: string }> = ({ children, hint }) => (
  <div className="mb-1.5 flex items-center gap-1.5 text-[12px] font-semibold text-foreground/85">
    {children}
    {hint && <Hint text={hint} />}
  </div>
)

interface Props {
  tab: TgSettingsTab
  onTab: (t: TgSettingsTab) => void
  link: string
  regenerating: boolean
  onRegenerate: () => void
  onShowQr: () => void
}

export const TgSettings = React.forwardRef<HTMLDivElement, Props>(({ tab, onTab, link, regenerating, onRegenerate, onShowQr }, ref) => {
  const status = useTgwsStore((s) => s.status)
  const incyOn = useIncyStore((s) => s.status.state === 'running')
  const { appConfig, patchAppConfig } = useAppConfig()
  const tgws = appConfig?.tgws

  const [workerDraft, setWorkerDraft] = useState<string | null>(null)
  // Черновик параметров соединения. Раньше каждое нажатие клавиши сразу
  // сохранялось (а при вводе секрета — ещё и генерировало случайный ключ),
  // и прокси продолжал работать со старыми значениями.
  const [hostDraft, setHostDraft] = useState<string | null>(null)
  const [portDraft, setPortDraft] = useState<string | null>(null)
  const [secretDraft, setSecretDraft] = useState<string | null>(null)
  const connDirty = hostDraft !== null || portDraft !== null || secretDraft !== null

  const handleSaveConnection = async (): Promise<void> => {
    const host = (hostDraft ?? tgws?.host ?? '127.0.0.1').trim() || '127.0.0.1'
    const port = Number(portDraft ?? tgws?.port ?? 1443)
    const secret = (secretDraft ?? tgws?.secret ?? '').trim().toLowerCase()
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      toast.error('Порт должен быть числом от 1 до 65535')
      return
    }
    if (!/^[0-9a-f]{32}$/.test(secret)) {
      toast.error('Секрет — ровно 32 шестнадцатеричных символа (0–9, a–f)')
      return
    }
    try {
      await patchAppConfig({ tgws: { ...tgws!, host, port, secret } })
      setHostDraft(null)
      setPortDraft(null)
      setSecretDraft(null)
      if (status.state === 'running') {
        await tgwsRestart()
        toast.success('Параметры сохранены, Telegram Proxy перезапущен', { style: POWER_ON_BANNER_STYLE })
      } else {
        toast.success('Параметры сохранены')
      }
    } catch (e) {
      toast.error('Не удалось применить параметры', { description: e instanceof Error ? e.message : String(e) })
    }
  }

  /** Пускать TgWsProxy через VPN INCY. Туннель переподключается сам, если поднят. */
  const handleToggleViaIncy = async (v: boolean): Promise<void> => {
    await patchAppConfig({ tgws: { ...tgws!, viaIncy: v } })
    const reapplied = await incyReapplyTunnel().catch(() => false)
    toast.success(v ? 'Telegram пойдёт через VPN INCY' : 'Telegram идёт по обычным правилам INCY', {
      description: reapplied ? 'Туннель INCY переподключается, чтобы применить.' : 'Начнёт действовать, когда INCY будет подключён.'
    })
  }

  /** Маршрут Telegram: авто (как у Flowseal) или всё через свой Worker. */
  const handleSetRouteMode = async (mode: 'auto' | 'worker'): Promise<void> => {
    if (mode === 'worker' && !(workerDraft ?? tgws?.cfproxyWorkerDomain ?? '').trim()) {
      toast.error('Сначала укажите домен своего Cloudflare Worker ниже и сохраните его')
      return
    }
    const value = (workerDraft ?? tgws?.cfproxyWorkerDomain ?? '').trim()
    await patchAppConfig({ tgws: { ...tgws!, routeMode: mode, cfproxyWorkerDomain: value } })
    setWorkerDraft(null)
    if (status.state === 'running') {
      try {
        await tgwsRestart()
        toast.success(mode === 'worker' ? 'Telegram идёт через ваш Cloudflare Worker' : 'Маршрут Telegram: авто', {
          description: 'Telegram Proxy перезапущен.'
        })
      } catch (e) {
        toast.error('Маршрут сохранён, но прокси не перезапустился', {
          description: e instanceof Error ? e.message : String(e)
        })
      }
    } else {
      toast.success('Маршрут сохранён — применится при запуске Telegram Proxy')
    }
  }

  const [workerChecks, setWorkerChecks] = useState<TgwsWorkerCheck[] | null>(null)
  const [checkingWorker, setCheckingWorker] = useState(false)
  const handleCheckWorker = async (): Promise<void> => {
    if (checkingWorker) return
    setCheckingWorker(true)
    setWorkerChecks(null)
    try {
      const res = await tgwsCheckWorkers()
      setWorkerChecks(res)
      if (res.length === 0) toast.info('Домен Worker не указан')
    } catch (e) {
      toast.error('Проверка не удалась', { description: e instanceof Error ? e.message : String(e) })
    } finally {
      setCheckingWorker(false)
    }
  }

  /** Сохранить свой Cloudflare Worker и перезапустить прокси, если он работает. */
  const handleSaveWorker = async (): Promise<void> => {
    const value = (workerDraft ?? tgws?.cfproxyWorkerDomain ?? '').trim()
    await patchAppConfig({
      tgws: { ...tgws!, cfproxyWorkerDomain: value, routeMode: value ? tgws?.routeMode : 'auto' }
    })
    setWorkerDraft(null)
    setWorkerChecks(null)
    if (status.state === 'running') {
      try {
        await tgwsRestart()
        toast.success('Cloudflare Worker сохранён, Telegram Proxy перезапущен')
      } catch (e) {
        toast.error('Worker сохранён, но прокси не перезапустился', {
          description: e instanceof Error ? e.message : String(e)
        })
      }
    } else {
      toast.success('Cloudflare Worker сохранён')
    }
  }

  const routeMode = tgws?.routeMode ?? 'auto'

  return (
    <LzPanel ref={ref} data-tour="tg-settings" className="p-4">
      <LzSectionHead
        title="Настройки прокси"
        hint="Обычно здесь ничего менять не нужно: прокси работает с настройками по умолчанию. Ссылка — чтобы добавить прокси в Telegram вручную. Соединение — адрес, порт и ключ. Маршрут — для случаев, когда провайдер режет Telegram."
        right={<Segmented items={TABS} value={tab} onChange={onTab} size="sm" aria-label="Раздел настроек" className="w-[360px]" />}
      />

      <div className="mt-4">
        {tab === 'link' && (
          <div data-tour="tg-link" className="space-y-3">
            <div>
              <FieldLabel hint="Ссылка содержит адрес прокси и секретный ключ. Отправлять её другим людям не нужно: она работает только на этом компьютере (для телефона — QR).">
                Ссылка для Telegram
              </FieldLabel>
              <div className="flex items-center gap-2">
                <Input
                  readOnly
                  data-sensitive="link"
                  value={link || 'Запустите прокси для получения ссылки…'}
                  className={cn(field, 'flex-1 select-all font-mono text-xs')}
                  onClick={(e) => (e.target as HTMLInputElement).select()}
                />
                <Button
                  size="icon-sm"
                  variant="outline"
                  className="rounded-xl"
                  disabled={!link}
                  onClick={async () => {
                    if (!link) return
                    await writeClipboard(link)
                    toast.success('Ссылка скопирована', { style: POWER_ON_BANNER_STYLE })
                  }}
                  title="Скопировать ссылку"
                >
                  <Copy className="size-4" />
                </Button>
                <Button
                  size="icon-sm"
                  variant="outline"
                  className="rounded-xl"
                  disabled={!link}
                  onClick={() => link && openTelegramLink(link).catch(() => void 0)}
                  title="Открыть в Telegram"
                >
                  <ExternalLink className="size-4" />
                </Button>
                <Button size="icon-sm" variant="outline" className="rounded-xl" onClick={onRegenerate} disabled={regenerating} title="Сгенерировать новый секретный ключ">
                  {regenerating ? <Loader2 className="size-4 animate-spin" /> : <ReloadTgwsIcon className="size-4" />}
                </Button>
              </div>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-foreground/[0.07] bg-foreground/[0.03] px-3 py-2.5">
              <p className="inline-flex flex-wrap items-center gap-x-1 gap-y-0.5 text-[12px] text-muted-foreground">
                Вручную: Telegram
                <span className="opacity-70">&rarr;</span>
                Настройки
                <span className="opacity-70">&rarr;</span>
                Продвинутые настройки
                <span className="opacity-70">&rarr;</span>
                Тип соединения
                <span className="opacity-70">&rarr;</span>
                <MoreVertical className="-mx-1 size-3.5 translate-y-px" />
                <span>и вставьте ссылку. Или нажмите</span>
                <ExternalLink className="size-3.5 translate-y-px" />
                <span>, и Telegram добавит прокси сам.</span>
              </p>
              <Button size="sm" variant="outline" className="h-8 rounded-lg text-xs" onClick={onShowQr}>
                <Smartphone className="size-3.5" />
                QR для телефона
              </Button>
            </div>
          </div>
        )}

        {tab === 'conn' && (
          <div data-tour="tg-connection" className="space-y-3">
            <div className="grid grid-cols-1 gap-3 md:grid-cols-[minmax(0,1fr)_160px]">
              <div>
                <FieldLabel hint="127.0.0.1 — прокси доступен только этому компьютеру. 0.0.0.0 — ещё и устройствам в вашей Wi-Fi сети (так включает доступ кнопка «Показать QR»).">
                  Хост
                </FieldLabel>
                <Input paste data-sensitive="ip" value={hostDraft ?? tgws?.host ?? ''} onChange={(e) => setHostDraft(e.target.value)} placeholder="127.0.0.1" className={field} />
              </div>
              <div>
                <FieldLabel hint="Номер порта, на котором прокси ждёт Telegram. Меняйте, только если этот порт занят другой программой.">Порт</FieldLabel>
                <Input type="number" value={portDraft ?? String(tgws?.port ?? 1443)} onChange={(e) => setPortDraft(e.target.value)} className={field} />
              </div>
            </div>
            <div>
              <FieldLabel hint="Ключ MTProto: 32 символа 0–9 и a–f. Telegram без него к прокси не подключится. Новый ключ можно получить кнопкой на вкладке «Ссылка».">
                <KeyRound className="size-3.5 text-muted-foreground" />
                Секретный ключ
              </FieldLabel>
              <Input paste data-sensitive="link" value={secretDraft ?? tgws?.secret ?? ''} onChange={(e) => setSecretDraft(e.target.value)} className={cn(field, 'font-mono text-xs')} />
            </div>
            <div className="flex items-center justify-between gap-3">
              <p className="text-[12px] text-muted-foreground">После сохранения работающий прокси перезапустится с новыми параметрами.</p>
              <div className="flex gap-2">
                {connDirty && (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-8 rounded-lg text-xs"
                    onClick={() => {
                      setHostDraft(null)
                      setPortDraft(null)
                      setSecretDraft(null)
                    }}
                  >
                    Отменить
                  </Button>
                )}
                <Button size="sm" className="h-8 rounded-lg text-xs" disabled={!connDirty} onClick={() => void handleSaveConnection()}>
                  Сохранить
                </Button>
              </div>
            </div>
          </div>
        )}

        {tab === 'route' && (
          <div data-tour="tg-route" className="space-y-4">
            <div>
              <FieldLabel hint="Авто (как у Flowseal): прямой WebSocket к Telegram, если не вышло — ваш Worker, затем общий CF-прокси. Свой Cloudflare Worker: все соединения идут через ваш Worker, прямой WebSocket выключен. Нужен, когда провайдер режет Telegram.">
                Каким путём прокси идёт к Telegram
              </FieldLabel>
              <Segmented items={ROUTE_ITEMS} value={routeMode} onChange={(m) => void handleSetRouteMode(m)} aria-label="Маршрут Telegram" className="max-w-[520px]" />
            </div>

            <div>
              <FieldLabel
                hint={`Бесплатный способ Flowseal: свой Worker на Cloudflare (домен вида имя.аккаунт.workers.dev). Несколько доменов — через запятую. ${
                  platform !== 'darwin' ? 'Домены Cloudflare (workers.dev, cloudflare.com, cloudflare.dev) LAZEYKA сама добавит в список Zapret, как требует инструкция. ' : ''
                }Кнопка «Проверить» делает то же рукопожатие, что и TgWsProxy.`}
              >
                Свой Cloudflare Worker
              </FieldLabel>
              <div className="flex gap-2">
                <Input
                  paste
                  value={workerDraft ?? tgws?.cfproxyWorkerDomain ?? ''}
                  onChange={(e) => setWorkerDraft(e.target.value)}
                  placeholder="my-worker.example.workers.dev"
                  className={cn(field, 'font-mono text-xs')}
                />
                <Button size="sm" onClick={() => void handleSaveWorker()} disabled={workerDraft === null} className="h-9 shrink-0 rounded-xl text-xs">
                  Сохранить
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => void handleCheckWorker()}
                  disabled={checkingWorker || !(tgws?.cfproxyWorkerDomain ?? '').trim()}
                  className="h-9 shrink-0 rounded-xl text-xs"
                >
                  {checkingWorker ? <Loader2 className="size-3.5 animate-spin" /> : 'Проверить'}
                </Button>
              </div>
              {workerChecks && workerChecks.length > 0 && (
                <div className="mt-2 space-y-1">
                  {workerChecks.map((c) => (
                    <div
                      key={c.domain}
                      className={cn(
                        'rounded-lg border px-2.5 py-1.5 text-[11.5px]',
                        c.ok ? 'border-st-ok/30 bg-st-ok/10 text-st-ok-text' : 'border-st-err/30 bg-st-err/10 text-st-err-text'
                      )}
                    >
                      <span className="font-mono font-semibold">{c.domain}</span> — {c.ok ? `работает, ${c.ms} мс. ` : ''}
                      {c.detail}
                    </div>
                  ))}
                </div>
              )}
              <button
                type="button"
                className="mt-1.5 cursor-pointer text-[12px] font-medium text-primary underline-offset-2 hover:underline"
                onClick={() => void openExternalUrl('https://github.com/Flowseal/tg-ws-proxy/blob/main/docs/RU/CfWorker.md')}
              >
                Как сделать свой Worker (инструкция Flowseal)
              </button>
            </div>

            <label data-tour="tg-via-incy" className="flex cursor-pointer items-center justify-between gap-4 rounded-xl border border-foreground/[0.08] bg-foreground/[0.03] px-3 py-2.5">
              <span className="text-[12.5px] leading-relaxed">
                <span className="flex items-center gap-1.5 font-semibold text-foreground">
                  Пускать прокси через VPN INCY
                  <Hint text="Когда INCY подключён, соединения TgWsProxy (в том числе к Worker) выходят через VPN — и при полном VPN, и в режиме ExitLag. Пока INCY отключён, не действует." />
                </span>
                <span className="text-muted-foreground">
                  {!incyOn
                    ? 'Не действует, пока INCY отключён.'
                    : tgws?.viaIncy
                      ? 'Действует: INCY подключён, прокси выходит через VPN.'
                      : 'INCY подключён. Включите, чтобы прокси выходил через VPN.'}
                </span>
              </span>
              <Switch checked={Boolean(tgws?.viaIncy)} onCheckedChange={(v) => void handleToggleViaIncy(v)} />
            </label>
          </div>
        )}
      </div>
    </LzPanel>
  )
})
TgSettings.displayName = 'TgSettings'

export default TgSettings
