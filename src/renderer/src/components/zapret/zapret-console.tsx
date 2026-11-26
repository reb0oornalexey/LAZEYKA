import React from 'react'
import { Compass, Gamepad2, Loader2, Network, Package, Repeat2, Server, Sparkles, WandSparkles, Wand2 } from 'lucide-react'
import { Button } from '@renderer/components/ui/button'
import { LzHero, StatChip, type LzTone } from '@renderer/components/lz'
import { Uptime } from '@renderer/components/incy/incy-console'
import { cn } from '@renderer/lib/utils'
import type { StrategyTestResult } from '@renderer/utils/ipc'
import { ZapretDial } from './zapret-dial'
import { ScoreCells } from './score-cells'
import { useZapretMeta } from './zapret-meta'

const GAME_LABEL = { off: 'выключен', all: 'TCP и UDP', tcp: 'только TCP', udp: 'только UDP' } as const
const MAC_LABEL = { unsupported: 'не поддерживается', not_installed: 'не установлена', needs_update: 'нужно обновить', ready: 'установлена' } as const

interface Props {
  status: CoreStatus
  /** Нажата клавиша, ответа ещё нет: true — включаем, false — выключаем. */
  pending: boolean | null
  isMac: boolean
  /** Имя выбранной стратегии для людей (без .bat), своя — без префикса. */
  strategy: string | null
  own: boolean
  score: StrategyTestResult | null
  /** Идёт проверка всех стратегий, автоподбор или проверка из конструктора. */
  labBusy: boolean
  busyReason: string
  picking: boolean
  catalogAutopick?: boolean
  testRunning: boolean
  checking: boolean
  version: string | null
  update: { latest: string } | null
  onToggle: () => void
  onChange: () => void
  onAutopick: () => void
  onVersions: () => void
  onSettings: () => void
}

/**
 * Пульт Zapret («Сигнал»): клавиша питания со шкалой баллов, состояние крупно,
 * выбранная стратегия с делениями последней проверки, «Сменить» и
 * «Подобрать автоматически», внизу — чипы: сборка, служба, Game Filter, IPset,
 * автопилот и игровой режим (только то, что программа уже знает).
 */
export const ZapretConsole: React.FC<Props> = ({
  status,
  pending,
  isMac,
  strategy,
  own,
  score,
  labBusy,
  busyReason,
  picking,
  catalogAutopick,
  testRunning,
  checking,
  version,
  update,
  onToggle,
  onChange,
  onAutopick,
  onVersions,
  onSettings
}) => {
  const meta = useZapretMeta()
  const running = status.state === 'running'
  const verifying = status.state === 'starting' && status.phase === 'verifying'
  const busy = pending !== null || status.state === 'starting' || status.state === 'stopping'
  const stopping = pending === false || (pending === null && status.state === 'stopping')
  const isError = !busy && status.state === 'error'
  const tone: LzTone = busy ? 'busy' : running ? 'on' : isError ? 'error' : 'off'

  const title = busy
    ? stopping
      ? 'Останавливаем Zapret…'
      : verifying
        ? 'Запущен, проверяю…'
        : status.phase === 'waiting'
          ? 'Жду сеть…'
          : status.phase === 'retrying'
            ? 'Повторный запуск…'
            : 'Запускаем Zapret…'
    : running
      ? 'Zapret работает'
      : isError
        ? 'Zapret не запустился'
        : 'Zapret выключен'

  const level = score && score.totalCount > 0 ? score.okCount / score.totalCount : null

  // Строка под стратегией: что происходит сейчас или что значат деления.
  const note = labBusy ? (
    <span className="inline-flex items-center gap-1.5 text-primary">
      <Loader2 className="size-3.5 animate-spin" />
      {busyReason}
    </span>
  ) : busy && status.detail ? (
    <span className="inline-flex items-center gap-1.5 text-primary">
      <Loader2 className="size-3.5 animate-spin" />
      {status.detail}
    </span>
  ) : (isError || (!running && !busy)) && status.lastError ? (
    <span className="text-st-err-text">{status.lastError}</span>
  ) : !strategy ? (
    isMac ? (
      'Выберите стратегию в каталоге ниже — после этого Zapret можно включить.'
    ) : (
      'Выберите стратегию в каталоге или нажмите «Подобрать автоматически»: программа сама найдёт рабочую для вашей сети.'
    )
  ) : score ? (
    `Последняя проверка этой стратегии: открылось ${score.okCount} из ${score.totalCount} сайтов.`
  ) : (
    'Эту стратегию ещё не проверяли. «Проверить все» в каталоге покажет, сколько сайтов она открывает.'
  )

  const svc = meta.service
  const ap = meta.autopilot
  const gm = meta.gameMode
  const ipset = meta.ipset

  return (
    <LzHero
      data-tour="zapret-console"
      tone={tone}
      className={cn('shrink-0', isError && 'border-st-err/45')}
      visual={
        <ZapretDial
          tone={tone}
          level={level}
          label={running ? 'Выключить Zapret' : 'Включить Zapret'}
          onPress={onToggle}
          disabled={busy || labBusy}
        />
      }
      title={
        <span className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
          {title}
          {running && status.startedAt && <Uptime since={status.startedAt} className="text-[13px] font-semibold tracking-normal text-primary" />}
        </span>
      }
      extra={
        <div className="-mt-1 w-full min-w-0">
          <span className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1.5">
            <span className="flex min-w-0 items-center gap-2">
              <span className="text-[12px] text-muted-foreground">Стратегия</span>
              {strategy ? (
                <span className="truncate text-[17px] font-bold leading-tight text-foreground" title={strategy}>
                  {strategy}
                </span>
              ) : (
                <span className="rounded-lg border border-dashed border-foreground/25 px-2 py-0.5 text-[13px] font-semibold text-muted-foreground">не выбрана</span>
              )}
              {own && <span className="shrink-0 rounded-md bg-primary/12 px-1.5 py-px text-[11px] font-semibold text-primary">своя</span>}
            </span>
            {strategy && (
              <span className="flex items-center gap-2">
                <ScoreCells ok={score?.okCount ?? null} total={score?.totalCount ?? null} dim={!running} className="w-[150px]" size="md" />
                {score && (
                  <span
                    className={cn(
                      'text-[12.5px] font-bold tabular-nums',
                      score.okCount === score.totalCount ? 'text-primary' : score.okCount === 0 ? 'text-st-err-text' : 'text-st-warn-text'
                    )}
                  >
                    {score.okCount} из {score.totalCount}
                  </span>
                )}
              </span>
            )}
          </span>
          <p className="mt-1.5 max-w-[64ch] text-[12.5px] leading-relaxed text-muted-foreground">{note}</p>
        </div>
      }
      actions={
        <>
          {(!isMac || catalogAutopick) && (
            <Button
              size="lg"
              onClick={onAutopick}
              disabled={testRunning || checking}
              data-tour="zapret-autopick"
              title={catalogAutopick
                ? 'Проверить стратегии Flowseal и выбрать ту, с которой открывается больше всего сайтов'
                : 'Программа сама поймёт, что именно блокирует провайдер, и проверит несколько подходящих приёмов. Обычно до минуты-двух.'}
              className="h-11 rounded-xl px-5 text-[14px]"
            >
              {picking ? <Wand2 className="size-4 animate-pulse" /> : <WandSparkles className="size-4" />}
              {picking ? 'Идёт подбор…' : 'Подобрать автоматически'}
            </Button>
          )}
          <Button
            variant="outline"
            size="lg"
            onClick={onChange}
            disabled={labBusy}
            data-tour="zapret-change"
            title="Открыть каталог на выбранной стратегии"
            className={cn('rounded-xl px-5 text-[13px]', isMac ? 'h-11' : 'h-10')}
          >
            <Repeat2 className="size-4" />
            Сменить стратегию
          </Button>
        </>
      }
      footer={
        <div className="flex flex-wrap items-stretch gap-2 [&>*]:min-w-[136px] [&>*]:flex-1">
          <StatChip
            icon={<Package />}
            label="Сборка"
            value={version ? `Zapret ${version}` : 'встроенная'}
            title="Все версии сборки — можно поставить любую"
            onClick={onVersions}
            className="min-w-[200px]! flex-[1.25]!"
            aside={
              update ? (
                <span title={`Вышла версия ${update.latest}`} className="inline-flex shrink-0 items-center gap-1 rounded-md bg-primary/12 px-1.5 py-0.5 text-[11px] font-bold text-primary tabular-nums">
                  <Sparkles className="size-3" />
                  {update.latest}
                </span>
              ) : undefined
            }
          />
          {isMac
            ? meta.mac && (
                <StatChip
                  icon={<Server />}
                  tone={meta.mac.state === 'ready' ? 'on' : meta.mac.state === 'needs_update' ? 'warn' : 'off'}
                  label="Служба macOS"
                  value={MAC_LABEL[meta.mac.state]}
                  title="Установить, обновить или удалить службу"
                  onClick={onSettings}
                />
              )
            : svc?.installed && (
                <StatChip
                  icon={<Server />}
                  tone={svc.running ? 'on' : 'warn'}
                  label="Служба Windows"
                  value={svc.running ? 'работает' : 'остановлена'}
                  title={svc.strategyName ? `Стратегия службы: ${svc.strategyName}` : 'Служба Zapret в Windows'}
                  onClick={onSettings}
                />
              )}
          {!isMac && meta.gameFilter && (
            <StatChip
              icon={<Gamepad2 />}
              tone={meta.gameFilter === 'off' ? 'off' : 'on'}
              label="Game Filter"
              value={GAME_LABEL[meta.gameFilter]}
              title="Игровые порты — настроить"
              onClick={onSettings}
            />
          )}
          {ipset && (
            <StatChip
              icon={<Network />}
              tone={ipset.mode === 'none' ? 'off' : 'on'}
              label="IPset"
              value={ipset.mode === 'none' ? 'выключен' : ipset.mode === 'any' ? 'все IP' : `список, ${ipset.lines.toLocaleString('ru-RU')} IP`}
              title="К каким IP применяется обход — настроить"
              onClick={onSettings}
            />
          )}
          {(ap?.enabled || gm?.enabled) && (
            <StatChip
              icon={<Compass />}
              tone={ap?.enabled && (ap.lastStatus === 'degraded' || ap.lastStatus === 'switching') ? 'warn' : 'on'}
              label={ap?.enabled && gm?.enabled ? 'Автопилот и игры' : ap?.enabled ? 'Автопилот' : 'Игровой режим'}
              value={[
                ap?.enabled
                  ? ap.lastStatus === 'degraded'
                    ? 'ищет замену'
                    : ap.lastStatus === 'switching'
                      ? 'переключает'
                      : 'следит'
                  : null,
                gm?.enabled ? (gm.activeGameDetected ? `игра ${gm.activeGameDetected}` : 'ждёт игру') : null
              ]
                .filter(Boolean)
                .join(', ')}
              title="Автопилот стратегий и игровой режим — настроить"
              onClick={onSettings}
              className="min-w-0 flex-1"
            />
          )}
        </div>
      }
    />
  )
}

export default ZapretConsole
