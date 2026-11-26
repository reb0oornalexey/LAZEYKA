import React, { useState } from 'react'
import { ChevronDown, Gauge, Loader2, MessageSquareText, RefreshCw } from 'lucide-react'
import { Button } from '@renderer/components/ui/button'
import { cn } from '@renderer/lib/utils'
import { DiscordBrandIcon } from '@renderer/components/service-icons'
import { useStreamerStore } from '@renderer/store/streamer-store'
import { streamerDiscordRetry, type DiscordStatusExtra } from '@renderer/utils/discord-status-api'
import { Rows, SettingsGroup, SwitchRow } from '@renderer/components/settings/setting-row'

const time = (ms: number): string => new Date(ms).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })

const PRIVACY =
  'Друзья увидят только название программы, одну из фраз «VPN подключён», «Защита включена» или «Защита выключена» и, если разрешено, пинг. Названия серверов, адреса и ссылки в Discord не отправляются. Пока Discord открыт, программа его не опрашивает: строка обновляется только когда меняется состояние защиты (не чаще раза в 15 секунд), пинг — не чаще раза в минуту и только при заметной разнице.'

/**
 * Настройки → «Статус в Discord».
 * Показывает не «связь есть», а что именно сделал Discord: подтвердил приём активности или вернул ошибку.
 */
export const DiscordCard: React.FC = () => {
  const state = useStreamerStore((s) => s.state)
  const patch = useStreamerStore((s) => s.patchSettings)
  const [busy, setBusy] = useState(false)
  const [helpOpen, setHelpOpen] = useState(false)
  if (!state) return null
  const { settings } = state
  const discord = state.discord as typeof state.discord & DiscordStatusExtra
  const activity = discord.activity ?? 'none'

  let tone: 'ok' | 'err' | 'muted' = 'muted'
  let text: string
  let sub: string | null = null
  if (!settings.discordEnabled) {
    text = 'Выключено'
    sub = 'Строки в профиле Discord нет.'
  } else if (discord.link !== 'connected') {
    text = discord.error ? `Нет связи с Discord: ${discord.error}` : 'Discord не запущен или не отвечает'
    sub = 'Когда Discord запустится, статус появится в течение двух минут (программа заглядывает в локальный канал Discord раз в 2 минуты). Чтобы не ждать, нажмите «Проверить снова».'
  } else if (activity === 'confirmed') {
    tone = 'ok'
    text = 'Активность отправлена, Discord подтвердил'
    sub = [discord.user ? `Профиль: ${discord.user}` : '', discord.confirmedAt ? `в ${time(discord.confirmedAt)}` : ''].filter(Boolean).join(', ') || null
  } else if (activity === 'error') {
    tone = 'err'
    text = `Discord не принял активность: ${discord.error ?? 'причина неизвестна'}`
    sub = 'Сама программа не повторяет: попробует снова, когда изменится состояние защиты, или по кнопке «Проверить снова».'
  } else if (activity === 'sending') {
    text = 'Отправляю активность, жду ответ Discord…'
  } else {
    text = 'Связь с Discord есть, активность ещё не отправлена'
  }

  const retry = async (): Promise<void> => {
    setBusy(true)
    try {
      await streamerDiscordRetry()
    } catch {
      /* итог придёт событием состояния */
    } finally {
      setBusy(false)
    }
  }

  return (
    <SettingsGroup
      data-tour="discord-status"
      title="Статус в Discord"
      hint="В вашем профиле Discord появится строка «Играет в LAZEYKA» с состоянием защиты. Выключается одним переключателем, строка при этом сразу пропадает."
      sub="Строка «Играет в LAZEYKA» в вашем профиле"
      right={
        settings.discordEnabled ? (
          <Button size="sm" variant="outline" className="gap-1.5" disabled={busy} onClick={() => void retry()}>
            {busy ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />}
            Проверить снова
          </Button>
        ) : undefined
      }
    >
      <Rows>
        <SwitchRow
          id="discord-show"
          icon={<DiscordBrandIcon className={cn(!settings.discordEnabled && 'opacity-60 grayscale')} />}
          title="Показывать в Discord"
          hint={`Программа связывается только с запущенным на этом компьютере Discord, в интернет для этого ничего не отправляется. ${PRIVACY}`}
          desc="Только название программы и состояние защиты. Серверы, адреса и ссылки не отправляются"
          checked={settings.discordEnabled}
          onChange={(v) => void patch({ discordEnabled: v })}
        />
        <SwitchRow
          id="discord-ping"
          icon={<Gauge />}
          title="Показывать пинг"
          hint="Добавит к строке время отклика текущего узла INCY, например «пинг 34 мс». Название и адрес узла не передаются."
          desc="Например, «пинг 34 мс». Название узла не передаётся"
          checked={settings.discordShowPing}
          disabled={!settings.discordEnabled}
          onChange={(v) => void patch({ discordShowPing: v })}
        />

        <div data-setting="discord-check" className="px-3 py-3">
          <div className="flex items-start gap-3.5">
            <span
              aria-hidden
              className={cn(
                'flex size-9 shrink-0 items-center justify-center rounded-xl [&_svg]:size-[18px]',
                tone === 'ok' ? 'bg-primary/12 text-primary' : tone === 'err' ? 'bg-st-err/12 text-st-err-text' : 'bg-foreground/[0.05] text-muted-foreground'
              )}
            >
              <MessageSquareText />
            </span>
            <div className="min-w-0 flex-1">
              <div className={cn('text-[13.5px] font-semibold leading-snug', tone === 'err' ? 'text-st-err-text' : 'text-foreground')}>{text}</div>
              {sub && <div className="mt-0.5 max-w-[66ch] text-[12px] leading-snug text-muted-foreground">{sub}</div>}
            </div>
            {discord.preview && (
              <div className="w-[220px] shrink-0 rounded-xl border border-foreground/[0.08] bg-foreground/[0.035] px-3 py-2 text-[12px] leading-snug" title="Так строку увидят друзья">
                <div className="mb-1 text-[11px] text-muted-foreground">Так увидят друзья</div>
                <div className="flex items-center gap-2.5">
                  <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-foreground/[0.06]">
                    <DiscordBrandIcon className="size-5" />
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate font-bold text-foreground">LAZEYKA</span>
                    <span className="block truncate text-muted-foreground">{discord.preview.details}</span>
                    {discord.preview.state && <span className="block truncate text-muted-foreground">{discord.preview.state}</span>}
                  </span>
                </div>
              </div>
            )}
          </div>

          <div className="mt-3 ml-[50px] rounded-xl border border-foreground/[0.08]">
            <button
              type="button"
              onClick={() => setHelpOpen((v) => !v)}
              aria-expanded={helpOpen}
              className="flex w-full cursor-pointer items-center justify-between gap-2 px-3 py-2 text-left text-[12px] font-semibold text-foreground"
            >
              Discord подтвердил, а в профиле пусто?
              <ChevronDown className={cn('size-3.5 text-muted-foreground transition-transform', helpOpen && 'rotate-180')} />
            </button>
            {helpOpen && (
              <div className="space-y-1.5 border-t border-foreground/[0.07] px-3 pt-2 pb-3 text-[12px] leading-relaxed text-muted-foreground">
                <p>Активность не видна при статусе «Невидимый». Выберите другой статус: в сети, не беспокоить, не активен.</p>
                <p>
                  Проверьте также «Настройки Discord → Конфиденциальность активности → Отображать текущую активность в статусе» — переключатель
                  должен быть включён.
                </p>
                <p>Программа не может узнать ни статус, ни этот переключатель, поэтому подтверждение Discord означает только «принято».</p>
              </div>
            )}
          </div>
        </div>
      </Rows>
    </SettingsGroup>
  )
}
