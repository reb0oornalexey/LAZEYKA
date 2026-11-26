import React, { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Activity,
  AlarmClock,
  BellRing,
  Cable,
  ClipboardList,
  Gauge,
  Hash,
  Loader2,
  MonitorSmartphone,
  Network,
  PictureInPicture2,
  Play,
  Router,
  Square,
  TimerReset,
  Volume2,
  Wifi,
  Zap
} from 'lucide-react'
import BasePage from '@renderer/components/base/base-page'
import { Button } from '@renderer/components/ui/button'
import { Input } from '@renderer/components/ui/input'
import { cn } from '@renderer/lib/utils'
import { Hint } from '@renderer/components/prematch/hint'
import { PingChart, bucketize } from '@renderer/components/prematch/ping-chart'
import { HistoryList, ReportCard } from '@renderer/components/prematch/report-card'
import { NatCard } from '@renderer/components/prematch/nat-card'
import { PingGauge } from '@renderer/components/prematch/ping-gauge'
import { CheckSteps, STEP_LABEL, STEP_ORDER } from '@renderer/components/prematch/check-steps'
import { fmtDuration, fmtMs } from '@renderer/components/prematch/format'
import { EmptyState, LiveNumber, LzHero, LzPanel, LzSectionHead, Segmented, StatChip, type LzTone, type SegmentedItem } from '@renderer/components/lz'
import { Rows, SettingRow, SettingsGroup, SwitchRow } from '@renderer/components/settings/setting-row'
import { useTourTab } from '@renderer/lib/tour-focus'
import { initPrematchListeners, usePrematchStore } from '@renderer/store/prematch-store'
import { FACEIT_DATACENTERS, type SeriesStats, type Severity, type VerdictKind } from '@renderer/utils/prematch-api'

const SEV_STYLE: Record<Severity, string> = {
  bad: 'border-st-err/40 bg-st-err/[0.08]',
  warn: 'border-st-warn/40 bg-st-warn/[0.08]',
  info: 'border-foreground/[0.08] bg-foreground/[0.03]',
  ok: 'border-st-ok/30 bg-st-ok/[0.05]'
}
const SEV_DOT: Record<Severity, string> = { bad: 'bg-st-err', warn: 'bg-st-warn', info: 'bg-muted-foreground', ok: 'bg-st-ok' }
const VERDICT_TONE: Record<VerdictKind, LzTone> = { good: 'on', warn: 'warn', bad: 'error', unknown: 'off' }

const statLine = (s: SeriesStats | null): string =>
  !s || s.received === 0 ? 'нет ответа' : `${s.avgMs} мс, разброс ±${s.jitterMs} мс, потери ${s.lossPct}%`

type PmTab = 'check' | 'lag' | 'reports' | 'nat'

/** Поле числа в строке настройки: значение и единица справа. */
function NumControl({ label, value, min, max, unit, disabled, onChange }: { label: string; value: number; min: number; max: number; unit: string; disabled?: boolean; onChange: (v: number) => void }): React.ReactElement {
  return (
    <span className="flex items-center gap-1.5">
      <Input
        type="number"
        aria-label={label}
        min={min}
        max={max}
        value={value}
        disabled={disabled}
        onChange={(e) => {
          const n = Number(e.target.value)
          if (Number.isFinite(n)) onChange(Math.min(max, Math.max(min, Math.round(n))))
        }}
        className="h-8 w-20 rounded-lg border-foreground/[0.1] bg-foreground/[0.035] text-right text-[13px] tabular-nums"
      />
      <span className="w-6 text-[12px] text-muted-foreground">{unit}</span>
    </span>
  )
}

const PrematchPage: React.FC = () => {
  const s = usePrematchStore()
  const navigate = useNavigate()
  const [now, setNow] = useState(Date.now())
  const [tab, setTab] = useState<PmTab>('check')
  useTourTab<PmTab>('/prematch', setTab)

  useEffect(() => {
    initPrematchListeners()
  }, [])

  // Секундомер нужен только пока идёт сессия.
  useEffect(() => {
    if (!s.session) return
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [s.session?.id])

  // Пришёл новый отчёт — показать его.
  useEffect(() => {
    if (s.report) setTab('reports')
  }, [s.report?.id])

  const session = s.session
  const busy = s.checkRunning || s.starting
  const lag = s.settings?.lag
  const check = s.check

  const live = useMemo(() => {
    if (!session) return null
    const ok = session.samples.filter((v): v is number => v != null)
    const last = session.samples.length ? session.samples[session.samples.length - 1] : null
    return {
      last,
      avg: ok.length ? Math.round(ok.reduce((a, b) => a + b, 0) / ok.length) : null,
      lossPct: session.samples.length ? Math.round(((session.samples.length - ok.length) / session.samples.length) * 1000) / 10 : 0,
      chart: bucketize(session.samples, 240)
    }
  }, [session?.samples])

  const regionsPreferred = s.regions.filter((r) => r.preferred)
  const regionsOther = s.regions.filter((r) => !r.preferred)
  const elapsed = session ? fmtDuration(Math.max(0, now - session.startedAt - session.gapMs)) : ''
  // Прошлая проверка загружена из главного процесса, а хода шагов нет — показать её итог по шагам.
  const stepsView = useMemo(() => {
    if (Object.keys(s.steps).length > 0 || !check) return s.steps
    const linkText = check.link.type === 'wired' ? 'кабель' : check.link.type.startsWith('wifi') ? 'Wi-Fi' : 'не определено'
    return {
      link: { step: 'link' as const, state: 'done' as const, detail: linkText },
      gateway: { step: 'gateway' as const, state: check.gateway.ip ? ('done' as const) : ('skip' as const), detail: check.gateway.ip ? statLine(check.gateway.stats) : undefined },
      target: { step: 'target' as const, state: check.target.stats?.received ? ('done' as const) : ('fail' as const), detail: statLine(check.target.stats) },
      ...(check.load ? { load: { step: 'load' as const, state: 'done' as const, detail: check.load.verdict } } : {})
    }
  }, [s.steps, check])
  const runningStep = STEP_ORDER.find((k) => s.steps[k]?.state === 'run')

  // ── Пульт ──
  const tone: LzTone = session ? 'on' : s.checkRunning || s.starting ? 'busy' : check ? VERDICT_TONE[check.verdict.kind] : 'off'
  const gaugeMs = session ? (live?.last ?? null) : (check?.target.stats?.avgMs ?? null)
  const gaugeMode = s.checkRunning ? 'busy' : session ? (session.samples.length ? 'value' : 'busy') : check ? 'value' : 'idle'
  const title = session ? (
    <span className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
      Игровая сессия идёт
      <span className="text-[13px] font-semibold tracking-normal text-primary tabular-nums">{elapsed}</span>
    </span>
  ) : s.checkRunning ? (
    'Проверяю сеть…'
  ) : s.starting ? (
    'Запускаю сессию…'
  ) : check ? (
    check.verdict.headline
  ) : (
    'Проверьте сеть перед матчем'
  )
  const text = session
    ? `${session.label}: раз в 3 секунды один пакет на сервер, напрямую, без VPN. ${session.baselineMs == null ? 'Определяю обычный пинг по первым десяти ответам.' : `Обычный пинг в этой сессии — ${session.baselineMs} мс.`}`
    : s.checkRunning
      ? `${runningStep ? STEP_LABEL[runningStep] : 'Подготовка'}. Проверка занимает 20–30 секунд.`
      : check
        ? `Сервер ${check.target.label}: ${statLine(check.target.stats)}.${!check.viaPhysical ? ' Физический адаптер определить не удалось: при включённом VPN замер мог пройти через него.' : ''}`
        : 'За полминуты: подключение, роутер, пинг, разброс и потери до сервера. Напрямую, без VPN и только по кнопке.'

  const tabs: SegmentedItem<PmTab>[] = [
    { id: 'check', label: session ? 'Сессия' : 'Проверка', icon: session ? Activity : Wifi, title: 'Ход проверки, найденные проблемы и график сессии' },
    { id: 'lag', label: 'Сигнал о лагах', icon: BellRing, title: 'Звук и уведомление, когда связь с сервером ухудшилась' },
    { id: 'reports', label: s.history.length ? `Отчёты ${s.history.length}` : 'Отчёты', icon: ClipboardList, title: 'Отчёты о прошедших матчах' },
    { id: 'nat', label: 'NAT', icon: Network, title: 'Смогут ли другие игроки подключиться к вам напрямую' }
  ]

  const linkValue = (() => {
    const l = check?.link
    if (!l) return '—'
    if (l.type === 'wired') return 'кабель'
    if (l.type === 'wifi' || l.type === 'wifi-unknown') {
      const w = l.wifi
      return `Wi-Fi${w?.band ? ` ${w.band} ГГц` : ''}${w?.signalPct != null ? `, ${w.signalPct}%` : ''}`
    }
    return 'не определено'
  })()

  return (
    <BasePage title="Перед каткой">
      <div className="mx-auto flex w-full max-w-[1080px] flex-col lz-page-gap lz-page-x pb-5">
        <LzHero
          data-tour="prematch-goal"
          tone={tone}
          visual={
            <PingGauge
              ms={gaugeMs}
              mode={gaugeMode}
              caption={session ? 'мс сейчас' : check ? 'мс средний' : 'мс до сервера'}
              lost={Boolean(session && session.samples.length && live?.last == null)}
            />
          }
          title={title}
          text={text}
          extra={
            !session ? (
              <div className="mt-1 flex w-full flex-col gap-2">
                <Input
                  paste
                  value={s.target}
                  disabled={busy}
                  onChange={(e) => s.setTarget(e.target.value)}
                  onBlur={() => s.saveTarget()}
                  placeholder="Куда мерить: connect 162.19.141.22:27015 или 162.19.141.22"
                  className="h-9 rounded-xl border-foreground/[0.1] bg-foreground/[0.035] text-[13px] tabular-nums"
                />
                {(FACEIT_DATACENTERS.length > 0 || s.regions.length > 0) && (
                  <div className="flex flex-wrap items-center gap-1.5">
                    {FACEIT_DATACENTERS.length > 0 && <span className="text-[11.5px] text-muted-foreground">Faceit:</span>}
                    {FACEIT_DATACENTERS.map((d) => (
                      <TargetChip key={d.id} label={d.name} active={s.target === d.ip} disabled={busy} onClick={() => s.setTarget(d.ip)} />
                    ))}
                    {s.regions.length > 0 && (
                      <span className="flex items-center gap-1 text-[11.5px] text-muted-foreground">
                        Valve:
                        <Hint text="Точки Steam Datagram Relay в датацентрах Valve (CS2, Dota 2). Они отвечают на пинг, поэтому подходят, если IP игрового сервера неизвестен." />
                      </span>
                    )}
                    {regionsPreferred.map((r) => (
                      <TargetChip key={r.id} label={r.name} active={s.target === r.ip} disabled={busy} onClick={() => s.setTarget(r.ip)} />
                    ))}
                    {regionsOther.length > 0 && (
                      <select
                        aria-label="Другие регионы Valve"
                        className="h-7 w-[104px] cursor-pointer rounded-lg border border-foreground/[0.08] bg-[color:var(--popover)] px-1.5 text-[11.5px] text-foreground"
                        value=""
                        disabled={busy}
                        onChange={(e) => e.target.value && s.setTarget(e.target.value)}
                      >
                        <option value="">Другие…</option>
                        {regionsOther.map((r) => (
                          <option key={r.id} value={r.ip}>
                            {r.name}
                          </option>
                        ))}
                      </select>
                    )}
                  </div>
                )}
              </div>
            ) : undefined
          }
          actions={
            session ? (
              <Button size="lg" variant="outline" className="h-11 rounded-xl px-5 text-[14px]" onClick={() => void s.stopSession()}>
                <Square className="size-3.5 fill-current" />
                Завершить сессию
              </Button>
            ) : (
              <>
                <Button size="lg" className="h-11 rounded-xl px-5 text-[14px]" disabled={busy || !s.target.trim()} onClick={() => void s.runCheck()}>
                  {s.checkRunning ? <Loader2 className="size-4 animate-spin" /> : <Wifi className="size-4" />}
                  {s.checkRunning ? 'Проверяю…' : check ? 'Проверить ещё раз' : 'Проверить'}
                </Button>
                <Button
                  variant="outline"
                  size="lg"
                  className="h-10 rounded-xl px-5 text-[13px]"
                  disabled={busy || !s.target.trim()}
                  onClick={() => void s.startSession()}
                  title="Сессия: во время матча раз в 3 секунды на сервер отправляется один пакет. По итогам будет отчёт с пингом, потерями и графиком. Проверка перед ней не обязательна."
                >
                  {s.starting ? <Loader2 className="size-4 animate-spin" /> : <Play className="size-3.5 fill-current" />}
                  Начать сессию
                </Button>
              </>
            )
          }
          footer={
            session && live ? (
              <div className="flex flex-wrap items-stretch gap-2">
                <StatChip
                  icon={<Zap />}
                  tone={live.last == null && session.samples.length ? 'error' : 'on'}
                  label="Сейчас"
                  value={live.last == null ? (session.samples.length ? 'потеря' : '—') : <LiveNumber value={`${live.last} мс`} />}
                  title="Результат последнего замера"
                />
                <StatChip icon={<Gauge />} label="Средний" value={fmtMs(live.avg)} title="Среднее по всем ответам с начала сессии" />
                <StatChip icon={<Hash />} tone={live.lossPct > 0 ? 'warn' : 'on'} label="Потери" value={`${live.lossPct}%`} title="Доля замеров без ответа" />
                <StatChip icon={<AlarmClock />} label="Время" value={elapsed} className="min-w-[150px] flex-1" />
                <StatChip
                  icon={<BellRing />}
                  tone={session.lagAlerts > 0 ? 'warn' : lag?.enabled ? 'on' : 'off'}
                  label="Сигналов о лагах"
                  value={lag?.enabled ? String(session.lagAlerts) : 'выключены'}
                  title="Настроить сигнал о лагах"
                  onClick={() => setTab('lag')}
                />
              </div>
            ) : (
              <div className="flex flex-wrap items-stretch gap-2">
                <StatChip
                  icon={<Gauge />}
                  tone={check ? VERDICT_TONE[check.verdict.kind] : 'off'}
                  label="До сервера"
                  value={check?.target.stats?.received ? `${check.target.stats.avgMs} мс, ±${check.target.stats.jitterMs}` : '—'}
                />
                <StatChip
                  icon={<Hash />}
                  tone={check?.target.stats ? (check.target.stats.lossPct > 0 ? 'warn' : 'on') : 'off'}
                  label="Потери"
                  value={check?.target.stats ? `${check.target.stats.lossPct}%` : '—'}
                />
                <StatChip
                  icon={<Router />}
                  tone={check?.gateway.stats?.received ? 'on' : 'off'}
                  label="Роутер"
                  value={check?.gateway.ip ? statLine(check.gateway.stats).split(',')[0] : '—'}
                  title={check?.gateway.ip ? `Роутер: ${statLine(check.gateway.stats)}` : undefined}
                />
                <StatChip
                  icon={check?.link.type === 'wired' ? <Cable /> : <Wifi />}
                  tone={check ? 'on' : 'off'}
                  label="Подключение"
                  value={linkValue}
                  className="min-w-[150px] flex-1"
                />
                <StatChip
                  icon={<TimerReset />}
                  tone={s.settings?.checkLoad ? 'on' : 'off'}
                  label="Под нагрузкой"
                  value={s.settings?.checkLoad ? 'проверяется' : 'не проверяется'}
                  title="Включить или выключить проверку под нагрузкой"
                  onClick={() => setTab('check')}
                />
              </div>
            )
          }
        />

        <div className="flex shrink-0 flex-wrap items-center gap-3">
          <Segmented items={tabs} value={tab} onChange={setTab} aria-label="Разделы «Перед каткой»" data-tour="prematch-tabs" className="w-[560px]" />
          <span className="min-w-0 flex-1 truncate text-[12px] text-muted-foreground">{tabs.find((t) => t.id === tab)?.title}</span>
        </div>

        {tab === 'check' && session && live && (
          <LzPanel tone="on" glow={7} className="space-y-3 p-4">
            <LzSectionHead
              title="Пинг за сессию"
              hint="Раз в 3 секунды программа отправляет на сервер один пакет и записывает время ответа. Больше ничего не измеряется. Сессия продолжается, если окно свёрнуто в трей, и завершается сама через 6 часов."
              sub={session.baselineMs == null ? 'Определяю обычный пинг по первым десяти ответам…' : `Пунктир — обычный пинг сессии, ${session.baselineMs} мс`}
            />
            <PingChart data={live.chart} baselineMs={session.baselineMs} className="w-full" />
          </LzPanel>
        )}

        {tab === 'check' && !session && (
          <LzPanel className="space-y-4 p-4">
            <LzSectionHead
              title="Проверка перед каткой"
              hint="За 20–30 секунд проверяет по порядку: как вы подключены (кабель или Wi-Fi и какой сигнал), насколько быстро отвечает ваш роутер и каков пинг, разброс и потери до сервера. Если пинг до роутера плохой, проблема дома, а не у провайдера или сервера."
              sub="Все замеры идут напрямую, без VPN"
            />
            <CheckSteps steps={stepsView} withLoad={Boolean(s.settings?.checkLoad)} />

            {check && !s.checkRunning && check.verdict.issues.length > 0 && (
              <ul className="space-y-1.5">
                {check.verdict.issues.map((i) => (
                  <li key={i.id} className={cn('rounded-xl border px-3 py-2 text-[12.5px]', SEV_STYLE[i.severity])}>
                    <div className="flex items-start gap-2.5">
                      <span className={cn('mt-[6px] size-2 shrink-0 rounded-full', SEV_DOT[i.severity])} />
                      <div>
                        <div className="font-semibold text-foreground">{i.title}</div>
                        {i.advice && <div className="mt-0.5 text-muted-foreground">Что сделать: {i.advice}</div>}
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
            {check && !s.checkRunning && check.load && check.load.grade !== 'unknown' && (
              <p className="text-[12px] text-muted-foreground">
                Под нагрузкой: в покое {fmtMs(check.load.idleMs)}, под нагрузкой {fmtMs(check.load.loadedMs)}, скорость {check.load.downloadMbps ?? '—'} Мбит/с.
              </p>
            )}

            <Rows className="-mx-3 border-t border-foreground/[0.07]">
              <SwitchRow
                id="prematch-load"
                icon={<TimerReset />}
                title="Проверить под нагрузкой"
                desc="Скачает около 100–300 МБ и займёт ещё около 25 секунд."
                hint="Пока канал нагружен скачиванием, замеряется пинг. Если он сильно растёт, то любая загрузка в вашей сети (Steam, торрент, видео) будет вызывать лаги в игре."
                checked={Boolean(s.settings?.checkLoad)}
                disabled={busy}
                onChange={s.setCheckLoad}
              />
            </Rows>
          </LzPanel>
        )}

        {tab === 'lag' && lag && (
          <>
            <SettingsGroup
              title="Сигнал о лагах"
              hint="Работает только во время сессии. Лаг — это пинг выше обычного на заданное число мс либо несколько потерянных пакетов подряд. «Обычный» пинг — медиана первых 10 замеров сессии. Сигнал ничего не меняет в сети и VPN, он только предупреждает."
              sub="Предупреждает звуком и уведомлением, когда связь с сервером ухудшилась"
            >
              <Rows>
                <SwitchRow
                  id="prematch-lag"
                  icon={<BellRing />}
                  title="Предупреждать о лагах"
                  desc="Ничего не переключает и не меняет, только сообщает."
                  checked={lag.enabled}
                  onChange={(v) => s.patchLag({ enabled: v })}
                />
                <SettingRow
                  id="prematch-lag-spike"
                  icon={<Gauge />}
                  title="Пинг выше обычного на"
                  hint="Если ответ сервера дольше обычного пинга сессии больше чем на столько миллисекунд, это считается лагом."
                  on={lag.enabled}
                  disabled={!lag.enabled}
                  control={<NumControl label="Пинг выше обычного на" value={lag.spikeMs} min={10} max={500} unit="мс" disabled={!lag.enabled} onChange={(v) => s.patchLag({ spikeMs: v })} />}
                />
                <SettingRow
                  id="prematch-lag-loss"
                  icon={<Hash />}
                  title="Потерянных пакетов подряд"
                  hint="Сколько замеров подряд без ответа считать обрывом связи. Замер идёт раз в 3 секунды."
                  on={lag.enabled}
                  disabled={!lag.enabled}
                  control={<NumControl label="Потерянных пакетов подряд" value={lag.lossStreak} min={1} max={10} unit="шт." disabled={!lag.enabled} onChange={(v) => s.patchLag({ lossStreak: v })} />}
                />
                <SettingRow
                  id="prematch-lag-cooldown"
                  icon={<AlarmClock />}
                  title="Пауза между сигналами"
                  hint="Чтобы сигнал не звучал непрерывно, после него следующий не раньше этого времени."
                  on={lag.enabled}
                  disabled={!lag.enabled}
                  control={<NumControl label="Пауза между сигналами" value={lag.cooldownSec} min={5} max={600} unit="с" disabled={!lag.enabled} onChange={(v) => s.patchLag({ cooldownSec: v })} />}
                />
                <SwitchRow
                  id="prematch-lag-sound"
                  icon={<Volume2 />}
                  title="Звук"
                  hint="Звук берётся из настроек программы. Если окно свёрнуто в трей, звук может не прозвучать, тогда поможет системное уведомление."
                  checked={lag.sound}
                  disabled={!lag.enabled}
                  onChange={(v) => s.patchLag({ sound: v })}
                />
                <SwitchRow
                  id="prematch-lag-notify"
                  icon={<MonitorSmartphone />}
                  title="Системное уведомление"
                  hint="Всплывающее окно системы. Видно и тогда, когда программа свёрнута."
                  checked={lag.notify}
                  disabled={!lag.enabled}
                  onChange={(v) => s.patchLag({ notify: v })}
                />
              </Rows>
            </SettingsGroup>
            <SettingsGroup title="Во время матча">
              <Rows>
                <SettingRow
                  id="prematch-mini"
                  icon={<PictureInPicture2 />}
                  title="Мини-окно поверх игры"
                  desc="Маленькое окно с пингом и переключателями. Настраивается в «Настройках»."
                  control={
                    <Button size="sm" variant="outline" className="h-8 rounded-lg text-xs" onClick={() => navigate('/settings?open=overlay&focus=mini-window')}>
                      Открыть настройки
                    </Button>
                  }
                />
              </Rows>
            </SettingsGroup>
          </>
        )}

        {tab === 'reports' && (
          <>
            {s.report && <ReportCard report={s.report} onClose={s.dismissReport} />}
            {s.history.length === 0 && !s.report ? (
              <LzPanel className="p-4">
                <EmptyState
                  icon={<ClipboardList />}
                  title="Отчётов пока нет"
                  text="Отчёт появится после первой завершённой сессии: пинг, потери, скачки и график за весь матч."
                  action={
                    <Button size="sm" className="h-9 gap-1.5 rounded-xl px-4 text-xs" disabled={busy || !s.target.trim()} onClick={() => void s.startSession()}>
                      <Play className="size-3.5 fill-current" />
                      Начать сессию
                    </Button>
                  }
                />
              </LzPanel>
            ) : (
              <HistoryList items={s.history} activeId={s.report?.id} onOpen={s.openReport} onDelete={(id) => void s.deleteReport(id)} />
            )}
          </>
        )}

        {tab === 'nat' && <NatCard result={s.nat} running={s.natRunning} onRun={() => void s.runNat()} />}
      </div>
    </BasePage>
  )
}

const TargetChip: React.FC<{ label: string; active: boolean; disabled?: boolean; onClick: () => void }> = ({ label, active, disabled, onClick }) => (
  <button
    type="button"
    disabled={disabled}
    onClick={onClick}
    className={cn(
      'h-7 cursor-pointer rounded-lg border px-2.5 text-[11.5px] font-semibold transition-colors disabled:cursor-default disabled:opacity-50',
      active
        ? 'border-primary/45 bg-primary/15 text-primary'
        : 'border-foreground/[0.08] bg-foreground/[0.035] text-foreground hover:border-primary/40'
    )}
  >
    {label}
  </button>
)

export default PrematchPage
