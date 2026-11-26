import React from 'react'
import { AppWindow, Download, EyeOff, Keyboard, Loader2, Lock, MonitorUp, RotateCw, Send, Sparkles, Upload } from 'lucide-react'
import { Button } from '@renderer/components/ui/button'
import { Switch } from '@renderer/components/ui/switch'
import { LzPanel, StatChip, type LzTone } from '@renderer/components/lz'
import { cn } from '@renderer/lib/utils'
import type { AppUpdateInfo } from '@renderer/utils/ipc'
import type { SettingsGroupId } from './settings-catalog'
import './settings.css'

/*
 * Пульт «Настроек» (Е5): прибор раздела — цепочка запуска. Четыре шага в том
 * порядке, в каком они происходят: система запускает LAZEYKA → окно или трей →
 * Zapret → Telegram-прокси. Каждый шаг — крупная плитка-переключатель.
 * Включённый шаг горит полосой сверху, связка к нему — точками цвета темы;
 * выключенный матовый, связка пунктиром. Внизу чипы: обновления, трей,
 * горячие клавиши, профиль.
 */

interface StepProps {
  id: string
  tour?: string
  icon: React.ReactNode
  title: string
  state: string
  checked: boolean
  tone: LzTone
  disabled?: boolean
  hint: string
  onChange: (v: boolean) => void
}

const Step: React.FC<StepProps> = ({ id, tour, icon, title, state, checked, tone, disabled, hint, onChange }) => {
  const lit = tone === 'on'
  return (
    <div
      data-setting={id}
      data-tour={tour}
      title={hint}
      onClick={(e) => {
        if (disabled || (e.target as HTMLElement).closest('[role="switch"]')) return
        onChange(!checked)
      }}
      className={cn(
        'group/step relative min-w-0 flex-1 cursor-pointer overflow-hidden rounded-2xl border px-3.5 pt-3.5 pb-3 transition-colors duration-300',
        lit
          ? 'border-primary/40 bg-primary/[0.07]'
          : tone === 'warn'
            ? 'border-st-warn/45 bg-st-warn/[0.06]'
            : 'border-foreground/[0.08] bg-foreground/[0.03] hover:border-foreground/[0.16]',
        disabled && 'cursor-not-allowed opacity-60'
      )}
    >
      {/* Полоса сигнала сверху: горит у включённого шага. */}
      <span
        aria-hidden
        className={cn(
          'absolute inset-x-0 top-0 h-[3px] transition-opacity duration-300',
          lit ? 'lz-ignite bg-primary opacity-100' : tone === 'warn' ? 'bg-st-warn opacity-100' : 'opacity-0'
        )}
      />
      <div className="flex items-center justify-between gap-2">
        <span
          aria-hidden
          className={cn(
            'flex size-9 items-center justify-center rounded-xl transition-colors duration-300 [&_svg]:size-[18px]',
            lit ? 'bg-primary text-primary-foreground shadow-[0_0_18px_-4px_var(--primary)]' : 'bg-foreground/[0.06] text-muted-foreground'
          )}
        >
          {icon}
        </span>
        <Switch checked={checked} disabled={disabled} onCheckedChange={onChange} aria-label={title} />
      </div>
      <div className="mt-2.5 truncate text-[15px] font-bold leading-tight text-foreground">{title}</div>
      <div className={cn('mt-0.5 truncate text-[12px]', tone === 'warn' ? 'text-st-warn-text' : lit ? 'text-primary' : 'text-muted-foreground')}>{state}</div>
    </div>
  )
}

/** Связка между шагами: точки — следующий шаг включён, пунктир — нет. */
const Link: React.FC<{ on: boolean }> = ({ on }) => (
  <span
    aria-hidden
    className={cn('h-2 w-5 shrink-0 self-center', on ? 'st-link-on text-primary' : 'border-t border-dashed border-foreground/20')}
  />
)

interface Props {
  cfg: AppConfig | undefined
  isMac: boolean
  version: string
  update: AppUpdateInfo | null
  checking: boolean
  hotkeys: { assigned: number; total: number }
  onPatch: (p: Partial<AppConfig>) => void
  onCheckUpdate: () => void
  onExport: () => void
  onImport: () => void
  onOpen: (g: SettingsGroupId, focus?: string) => void
}

export const LaunchHero: React.FC<Props> = ({ cfg, isMac, version, update, checking, hotkeys, onPatch, onCheckUpdate, onExport, onImport, onOpen }) => {
  const linux = window.api.platform === 'linux'
  const os = isMac ? 'macOS' : linux ? 'Linux' : 'Windows'
  const auto = cfg?.autoLaunch ?? false
  const silent = cfg?.silentStart ?? false
  const tray = !(cfg?.disableTray ?? false)
  const zapret = !linux && (cfg?.zapret?.autoStart ?? false)
  const tg = cfg?.tgws?.autoStart ?? false
  const silentBroken = silent && !tray

  const services = [zapret && 'Zapret', tg && 'Telegram-прокси'].filter(Boolean) as string[]
  const title = auto ? `Запускается вместе с ${os}` : 'Запускается вручную'
  const when = auto ? `При входе в ${os}` : 'Когда вы откроете программу,'
  const win = silent && tray ? 'откроется сразу в трее без окна' : 'откроет окно'
  const text =
    `${when} LAZEYKA ${win}${services.length ? ` и включит ${services.join(' и ')}` : ''}.` +
    (silentBroken ? ' Запуск без окна работает только со значком в трее.' : '')

  const updAuto = cfg?.autoCheckUpdate ?? true
  let updValue = updAuto ? 'проверяются сами' : 'проверка выключена'
  let updTone: LzTone = updAuto ? 'on' : 'off'
  if (update?.hasUpdate) {
    updValue = `вышла ${update.latest ?? 'новая версия'}`
    updTone = 'warn'
  } else if (update) {
    updValue = 'последняя версия'
  }

  return (
    <LzPanel hero tone={auto ? 'on' : 'off'} glow={auto ? 13 : 0} data-tour="settings-hero">
      <div className="flex flex-wrap items-center gap-x-6 gap-y-3 px-6 pt-5 pb-4">
        <div className="min-w-[260px] flex-1">
          <h2 className="text-[24px] font-extrabold leading-[1.15] tracking-[-0.01em] text-[color:var(--text-title)]">{title}</h2>
          <p className="mt-1.5 max-w-[62ch] text-[13px] leading-relaxed text-muted-foreground">{text}</p>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1.5">
          <Button
            size="lg"
            variant={update?.hasUpdate ? 'default' : 'outline'}
            className="h-11 gap-2 rounded-xl px-5"
            disabled={checking}
            onClick={onCheckUpdate}
            title="Спросить GitHub, вышла ли новая версия LAZEYKA"
          >
            {checking ? <Loader2 className="size-4 animate-spin" /> : update?.hasUpdate ? <Sparkles className="size-4" /> : <RotateCw className="size-4" />}
            {checking ? 'Проверяем…' : update?.hasUpdate ? `Обновить до ${update.latest ?? 'новой версии'}` : 'Проверить обновления'}
          </Button>
          <span className="pr-1 text-[11.5px] text-muted-foreground tabular-nums">Установлена версия {version || '…'}</span>
        </div>
      </div>

      <div data-tour="settings-launch-chain" className="flex items-stretch px-4 pb-4">
        <Step
          id="hero-autoLaunch"
          tour="settings-autolaunch"
          icon={<MonitorUp />}
          title={`Вместе с ${os}`}
          state={auto ? 'запускать при входе' : 'запуск вручную'}
          checked={auto}
          tone={auto ? 'on' : 'off'}
          hint={`LAZEYKA запускается сама при входе в ${os}`}
          onChange={(v) => onPatch({ autoLaunch: v })}
        />
        <Link on={silent && tray} />
        <Step
          id="hero-silentStart"
          icon={silent ? <EyeOff /> : <AppWindow />}
          title="Без окна"
          state={silentBroken ? 'нужен значок в трее' : silent ? 'сразу в трей' : 'откроется окно'}
          checked={silent}
          tone={silentBroken ? 'warn' : silent ? 'on' : 'off'}
          hint="Программа стартует сразу в трее, окно не открывается. Работает только со значком в трее"
          onChange={(v) => onPatch({ silentStart: v })}
        />
        {!linux && <>
        <Link on={zapret} />
        <Step
          id="hero-zapret"
          icon={<Lock />}
          title="Zapret"
          state={zapret ? 'включится сам' : 'не включать'}
          checked={zapret}
          tone={zapret ? 'on' : 'off'}
          hint="Обход блокировок включается сам, когда запускается программа"
          onChange={(v) => onPatch({ zapret: { ...cfg!.zapret!, autoStart: v } })}
        />
        </>}
        <Link on={tg} />
        <Step
          id="hero-tgws"
          icon={<Send />}
          title="Telegram-прокси"
          state={tg ? 'включится сам' : 'не включать'}
          checked={tg}
          tone={tg ? 'on' : 'off'}
          hint="Прокси Telegram включается сам, когда запускается программа"
          onChange={(v) => onPatch({ tgws: { ...cfg!.tgws!, autoStart: v } })}
        />
      </div>

      <div className="grid grid-cols-2 gap-2 border-t border-foreground/[0.07] px-4 py-3 lg:grid-cols-4">
        <StatChip
          icon={<Sparkles />}
          label="Обновления"
          tone={updTone}
          value={updValue}
          title="Открыть настройки обновлений"
          onClick={() => onOpen('updates')}
        />
        <StatChip
          icon={<AppWindow />}
          label="Значок в трее"
          tone={tray ? 'on' : 'off'}
          value={tray ? 'показан' : 'скрыт, «×» закрывает'}
          title="Открыть настройки окна и трея"
          onClick={() => onOpen('launch', 'tray')}
        />
        <StatChip
          icon={<Keyboard />}
          label="Горячие клавиши"
          tone={hotkeys.assigned ? 'on' : 'off'}
          value={hotkeys.assigned ? `${hotkeys.assigned} из ${hotkeys.total}` : 'не назначены'}
          title="Открыть горячие клавиши"
          onClick={() => onOpen('keys')}
        />
        <div className="flex min-w-0 items-center gap-2.5 rounded-xl border border-foreground/[0.08] bg-foreground/[0.035] py-1.5 pr-1.5 pl-3" data-tour="settings-hero-profile">
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[11px] leading-tight text-muted-foreground">Профиль .lazeyka</span>
            <span className="block truncate text-[13.5px] font-semibold leading-snug text-foreground">все настройки</span>
          </span>
          <Button size="icon-sm" variant="ghost" className="rounded-lg" title="Сохранить профиль в файл" aria-label="Сохранить профиль в файл" onClick={onExport}>
            <Download className="size-4" />
          </Button>
          <Button size="icon-sm" variant="ghost" className="rounded-lg" title="Загрузить профиль из файла" aria-label="Загрузить профиль из файла" onClick={onImport}>
            <Upload className="size-4" />
          </Button>
        </div>
      </div>
    </LzPanel>
  )
}

export default LaunchHero
