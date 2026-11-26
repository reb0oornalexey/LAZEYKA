import React, { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Bell, EyeOff, Globe, Hash, Link2, QrCode, Radio, Server } from 'lucide-react'
import { Button } from '@renderer/components/ui/button'
import { LiveNumber, LzHero, LzPanel, LzSectionHead, Segmented, StatChip, StatusRing, type LzTone, type RingSegment } from '@renderer/components/lz'
import { SettingsGroup, SwitchRow, Rows } from '@renderer/components/settings/setting-row'
import { cn } from '@renderer/lib/utils'
import { useStreamerStore } from '@renderer/store/streamer-store'
import { SENSITIVE_CATEGORIES, type SensitiveCategory, type StreamerModeSetting } from '@renderer/utils/streamer-api'
import { DiscordIcon } from './icons'

const MODES: { id: StreamerModeSetting; label: string; hint: string; short: string }[] = [
  { id: 'off', label: 'Выключен', hint: 'Ничего не скрывается.', short: 'Ничего не скрывается' },
  { id: 'on', label: 'Включён', hint: 'Отмеченные данные скрыты всегда, пока вы не выключите режим.', short: 'Скрыто, пока вы не выключите режим' },
  {
    id: 'auto',
    label: 'Авто',
    hint: 'Режим включается сам, пока запущена программа для стримов: OBS, Streamlabs, TikTok LIVE Studio, XSplit, Twitch Studio, vMix (на Mac: OBS, Streamlabs, Ecamm Live). Список запущенных программ проверяется раз в 15 секунд, и только в этом режиме.',
    short: 'Включается сам, пока запущен OBS или другая программа для стримов'
  }
]

/** Порядок категорий = порядок дуг в кольце = порядок строк ниже. */
export const CATEGORY: Record<SensitiveCategory, { label: string; hint: string; icon: React.ComponentType<{ className?: string }>; sample: string; what: string }> = {
  ip: { label: 'IP-адреса', hint: 'Ваш внешний IP, адреса серверов, содержимое журнала.', icon: Globe, sample: '203.0.113.42', what: 'Внешний IP' },
  node: { label: 'Названия серверов и подписок', hint: 'Как называются ваши узлы и подписки в INCY.', icon: Server, sample: 'Стокгольм 02', what: 'Узел' },
  link: { label: 'Ссылки и ключи', hint: 'Ссылки подписок, секрет и ссылка Telegram-прокси, адрес Worker.', icon: Link2, sample: 'https://example.com/sub/abc123', what: 'Ссылка подписки' },
  qr: { label: 'QR-коды', hint: 'QR-коды подключения.', icon: QrCode, sample: '', what: 'QR-код' },
  id: { label: 'Номер установки', hint: 'Номер вашей установки программы в «Информации» и на главной.', icon: Hash, sample: '48213', what: 'Номер установки' }
}

/**
 * Пульт «Стримера»: кольцо из пяти дуг — по одной на то, что можно размыть,
 * в том же порядке, что и строки на вкладке «Что скрывать». Горят дуги того,
 * что размыто прямо сейчас. Справа — режим (выключен, включён, авто).
 */
export const StreamerHero: React.FC<{ active?: SensitiveCategory | null }> = ({ active }) => {
  const navigate = useNavigate()
  const state = useStreamerStore((s) => s.state)
  const patch = useStreamerStore((s) => s.patchSettings)
  if (!state) return null
  const { settings } = state
  const on = state.active
  const waiting = !on && settings.mode === 'auto'
  const chosen = SENSITIVE_CATEGORIES.filter((c) => settings.categories[c])
  const tone: LzTone = on ? 'on' : 'off'

  const segments: RingSegment[] = SENSITIVE_CATEGORIES.map((c) => {
    const Icon = CATEGORY[c].icon
    return { key: c, label: CATEGORY[c].label, tone: on && settings.categories[c] ? 'on' : 'off', icon: <Icon /> }
  })

  const title = on ? 'Режим стримера включён' : waiting ? 'Ждёт программу для стримов' : 'Режим стримера выключен'
  const text = on
    ? `Работает, потому что ${state.reasonText}. Отмеченное размыто в окне программы, на работу сети режим не влияет.`
    : waiting
      ? 'Включится сам, как только вы запустите OBS, Streamlabs или другую программу для стримов, и выключится после неё.'
      : 'Ничего не скрывается. Включите режим перед эфиром, чтобы зрители не увидели ваш IP, названия серверов и ссылки подписок.'

  const discord = state.discord
  const discordText = !discord.enabled ? 'выключен' : discord.link === 'connected' ? 'показывается' : 'ждёт Discord'

  return (
    <LzHero
      data-tour="streamer-mode"
      tone={tone}
      visual={
        <StatusRing segments={segments} active={active} halo={on ? 'on' : null} pulse={on} size={136}>
          <div className="flex flex-col items-center leading-none">
            <EyeOff className={cn('mb-1 size-4', on ? 'text-primary' : 'text-muted-foreground')} />
            <LiveNumber value={chosen.length} className="text-[30px] font-extrabold text-[color:var(--text-title)]" />
            <span className="mt-0.5 text-[10.5px] text-muted-foreground">из 5</span>
          </div>
        </StatusRing>
      }
      title={title}
      text={text}
      actions={
        <div className="w-[300px]">
          <Segmented
            items={MODES.map((m) => ({ id: m.id, label: m.label, title: m.hint }))}
            value={settings.mode}
            onChange={(m) => void patch({ mode: m })}
            aria-label="Режим стримера"
            className="[&_button]:h-9 [&_button]:text-[13px]"
          />
          <p className="mt-2 px-1 text-[11px] leading-snug text-muted-foreground">{MODES.find((m) => m.id === settings.mode)?.short}</p>
        </div>
      }
      footer={
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          <StatChip icon={<EyeOff />} tone={on && chosen.length ? 'on' : 'off'} label="Размывается" value={on ? `${chosen.length} из 5` : `${chosen.length} из 5, когда включён`} />
          <StatChip
            icon={<Radio />}
            tone={settings.mode === 'off' ? 'off' : 'on'}
            label="Включение"
            value={settings.mode === 'auto' ? (state.program ?? 'по программе для стримов') : settings.mode === 'on' ? 'вручную' : 'выключено'}
          />
          <StatChip icon={<Bell />} tone={settings.hideNotifications ? 'on' : 'off'} label="Уведомления" value={settings.hideNotifications ? 'без текста' : 'как обычно'} />
          <StatChip
            icon={<DiscordIcon className="size-4" />}
            tone={discord.enabled && discord.link === 'connected' ? 'on' : 'off'}
            label="Статус в Discord"
            value={discordText}
            title="Строка «Играет в LAZEYKA» в профиле Discord. Настраивается в «Настройках», раздел «Поверх игры и Discord»"
            onClick={() => navigate('/settings?open=overlay&focus=discord-status')}
          />
        </div>
      }
    />
  )
}

/** Вкладка «Что скрывать»: строки категорий и пример того, как увидят зрители. */
export const HidePanel: React.FC<{ onHover: (c: SensitiveCategory | null) => void }> = ({ onHover }) => {
  const state = useStreamerStore((s) => s.state)
  const patch = useStreamerStore((s) => s.patchSettings)
  const [demo, setDemo] = useState(false)
  if (!state) return null
  const { settings } = state
  const showBlur = state.active || demo
  const demoClass = showBlur ? cn('streamer-mode', SENSITIVE_CATEGORIES.filter((c) => settings.categories[c]).map((c) => `sm-hide-${c}`)) : ''

  return (
    <div className="grid items-start gap-3 lg:grid-cols-[minmax(0,1fr)_340px]">
      <SettingsGroup
        title="Что размывать"
        hint="Размывает в окне программы IP, названия серверов и ссылки подписок, чтобы зрители не увидели лишнего. На работу сети не влияет."
        sub="Действует, пока режим включён"
      >
        <Rows>
          {SENSITIVE_CATEGORIES.map((c) => {
            const Icon = CATEGORY[c].icon
            return (
              <div key={c} onMouseEnter={() => onHover(c)} onMouseLeave={() => onHover(null)}>
                <SwitchRow
                  id={`streamer-${c}`}
                  icon={<Icon />}
                  title={CATEGORY[c].label}
                  hint={CATEGORY[c].hint}
                  checked={settings.categories[c]}
                  onChange={(v) => void patch({ categories: { [c]: v } })}
                />
              </div>
            )
          })}
          <SwitchRow
            id="streamer-notifications"
            icon={<Bell />}
            title="Скрывать текст системных уведомлений"
            hint="Пока режим активен, в уведомлениях Windows или macOS вместо текста будет только название программы."
            checked={settings.hideNotifications}
            onChange={(v) => void patch({ hideNotifications: v })}
          />
        </Rows>
      </SettingsGroup>

      <LzPanel className="p-4">
        <LzSectionHead
          title="Как увидят зрители"
          hint="Пример с выдуманными данными. Так же размывается всё отмеченное в окне программы."
          right={
            !state.active && (
              <Button size="sm" variant="outline" className="h-8 text-xs" onClick={() => setDemo((v) => !v)}>
                {demo ? 'Убрать пример' : 'Показать пример'}
              </Button>
            )
          }
        />
        <div className={cn('mt-3 space-y-1.5', demoClass)}>
          {(['ip', 'node', 'link', 'id'] as const).map((c) => {
            const Icon = CATEGORY[c].icon
            return (
              <div key={c} className="flex items-center gap-2.5 rounded-xl border border-foreground/[0.07] bg-foreground/[0.03] px-3 py-2">
                <Icon className="size-3.5 shrink-0 text-muted-foreground" />
                <div className="min-w-0 flex-1">
                  <div className="text-[11px] text-muted-foreground">{CATEGORY[c].what}</div>
                  <div data-sensitive={c} className={cn('truncate text-[12.5px] font-semibold', c !== 'node' && 'font-mono')}>
                    {CATEGORY[c].sample}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
        <p className="mt-3 text-[11.5px] leading-relaxed text-muted-foreground">
          {state.active ? 'Режим сейчас включён: так это и выглядит на трансляции.' : 'Нажмите «Показать пример», чтобы увидеть размытие, не включая режим.'}
        </p>
      </LzPanel>
    </div>
  )
}

/** Старое имя: страница раньше показывала одну карточку режима. */
export const ModeCard = StreamerHero
