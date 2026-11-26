import React, { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion } from 'motion/react'
import { toast } from 'sonner'
import { Check, CircleCheck, CircleX, Loader2, Power, Save, Square, Wand2, X } from 'lucide-react'
import { Button } from '@renderer/components/ui/button'
import { Input } from '@renderer/components/ui/input'
import { LiveNumber, type LzTone } from '@renderer/components/lz'
import { ScoreCells } from '@renderer/components/zapret/score-cells'
import { cn, POWER_ON_BANNER_STYLE } from '@renderer/lib/utils'
import { useZapretLab } from '@renderer/store/zapret-lab-store'
import {
  isAutopickRunning,
  labActivate,
  labAutopickStart,
  labAutopickStop,
  labSave,
  type AutopickState
} from '@renderer/utils/zapret-lab-api'

const NAME_RE = /^[\p{L}\p{N}][\p{L}\p{N} ._+,-]*$/u

const PHASES: { id: AutopickState['phase'][]; label: string; text: string }[] = [
  { id: ['diagnose'], label: 'Что именно блокируется', text: 'Без Zapret, несколько секунд' },
  { id: ['families'], label: 'Подходящие приёмы', text: 'Проверяю только приёмы против найденной блокировки' },
  { id: ['refine'], label: 'Уточнение и перепроверка', text: 'Проверяю варианты настроек и повторяю тест лучших кандидатов' }
]

type ArcState = 'done' | 'now' | 'wait' | 'fail'

/** Дуга кольца шагов: k-я из трёх, по часовой стрелке от верха. */
function arcD(c: number, r: number, k: number): string {
  const gap = 14
  const a0 = -90 + k * 120 + gap / 2
  const a1 = a0 + 120 - gap
  const pt = (deg: number): string => {
    const a = (deg * Math.PI) / 180
    return `${(c + r * Math.cos(a)).toFixed(2)} ${(c + r * Math.sin(a)).toFixed(2)}`
  }
  return `M ${pt(a0)} A ${r} ${r} 0 0 1 ${pt(a1)}`
}

/**
 * Прибор автоподбора: три дуги — три шага подбора, в том же порядке, что и
 * список шагов справа. Пройденный шаг горит, текущий бежит пунктиром, будущий
 * матовый. В центре — номер проверки или итог.
 */
const PhaseRing: React.FC<{ states: ArcState[]; center: React.ReactNode; sub: string; tone: LzTone }> = ({ states, center, sub, tone }) => {
  const size = 132
  const c = size / 2
  const r = c - 8
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      {tone === 'on' && (
        <div
          aria-hidden
          className="lz-breathe pointer-events-none absolute inset-[16%] rounded-full"
          style={{ background: 'radial-gradient(circle, color-mix(in oklab, var(--primary) 26%, transparent), transparent 70%)' }}
        />
      )}
      <svg aria-hidden className="absolute inset-0" width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        {states.map((st, k) => (
          <g key={k}>
            <path d={arcD(c, r, k)} fill="none" stroke="var(--foreground)" strokeOpacity={0.1} strokeWidth={7} strokeLinecap="round" />
            {st !== 'wait' && (
              <path
                d={arcD(c, r, k)}
                fill="none"
                stroke={st === 'fail' ? 'var(--st-err)' : 'var(--primary)'}
                strokeWidth={7}
                strokeLinecap={st === 'now' ? 'butt' : 'round'}
                pathLength={100}
                className={cn(st === 'now' && 'lz-arc-busy')}
                style={st === 'done' ? { filter: 'drop-shadow(0 0 5px color-mix(in oklab, var(--primary) 55%, transparent))' } : undefined}
              />
            )}
          </g>
        ))}
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
        <div className={cn('leading-none font-extrabold tabular-nums', typeof center === 'string' && center.length > 3 ? 'text-[24px]' : 'text-[30px]', tone === 'error' ? 'text-st-err-text' : tone === 'warn' ? 'text-st-warn-text' : tone === 'off' ? 'text-muted-foreground' : 'text-[color:var(--text-title)]')}>
          {center}
        </div>
        <div className="mt-1 text-[11px] text-muted-foreground">{sub}</div>
      </div>
    </div>
  )
}

function phaseIndex(p: AutopickState['phase']): number {
  if (p === 'diagnose') return 0
  if (p === 'families') return 1
  if (p === 'refine') return 2
  return 3
}

const VERDICT_TONE: Record<string, string> = {
  ok: 'text-st-ok-text',
  sni: 'text-st-err-text',
  stall: 'text-st-warn-text'
}

/** Окно автоподбора: прогресс по шагам, «Остановить», итог с «Сохранить как…» и «Включить». */
const ZapretAutopickDialog: React.FC = () => {
  const { autopick: s, autopickOpen, setAutopickOpen, refreshCustom } = useZapretLab()
  const [name, setName] = useState('')
  const [busy, setBusy] = useState<'save' | 'enable' | null>(null)
  const [savedFile, setSavedFile] = useState<string | null>(null)
  const [stopping, setStopping] = useState(false)
  const running = isAutopickRunning(s)

  useEffect(() => {
    if (s?.phase === 'done' && s.suggestedName) {
      setName(s.suggestedName)
      setSavedFile(null)
    }
    if (!isAutopickRunning(s)) setStopping(false)
  }, [s?.phase, s?.suggestedName, s?.finishedAt])

  if (typeof document === 'undefined') return null

  const close = (): void => {
    if (!running) setAutopickOpen(false)
  }

  const save = async (): Promise<string | null> => {
    if (!s?.model) return null
    if (savedFile) return savedFile
    const n = name.replace(/\s+/g, ' ').trim()
    if (!NAME_RE.test(n) || n.length > 40) {
      toast.error('Название не подходит', { description: 'До 40 символов: буквы, цифры, пробел и . _ + , -' })
      return null
    }
    const saved = await labSave({ name: n, model: s.model, origin: 'autopick', basedOn: 'автоподбор' })
    await refreshCustom()
    setSavedFile(saved.file)
    return saved.file
  }

  const onSave = async (): Promise<void> => {
    setBusy('save')
    try {
      const f = await save()
      if (f) toast.success('Стратегия сохранена', { style: POWER_ON_BANNER_STYLE, description: 'Она в каталоге с пометкой «своя».' })
    } catch (e) {
      toast.error('Не удалось сохранить', { description: e instanceof Error ? e.message : String(e) })
    } finally {
      setBusy(null)
    }
  }

  const onEnable = async (): Promise<void> => {
    setBusy('enable')
    try {
      const f = await save()
      if (!f) return
      await labActivate(f)
      toast.success('Zapret включён с подобранной стратегией', { style: POWER_ON_BANNER_STYLE })
      setAutopickOpen(false)
    } catch (e) {
      toast.error('Не удалось включить', { description: e instanceof Error ? e.message : String(e) })
    } finally {
      setBusy(null)
    }
  }

  const restart = (): void => {
    void labAutopickStart().catch((e) => toast.error('Автоподбор не запущен', { description: e instanceof Error ? e.message : String(e) }))
  }

  const pi = s ? phaseIndex(s.phase) : 0
  const elapsed = s?.startedAt ? Math.round(((s.finishedAt ?? Date.now()) - s.startedAt) / 1000) : 0

  const failed = s?.phase === 'error'
  const arcStates: ArcState[] = PHASES.map((_, i) => {
    if (!s) return 'wait'
    if (s.phase === 'done') return 'done'
    if (running) return i < pi ? 'done' : i === pi ? 'now' : 'wait'
    // Остановлен или ошибка: пройденные горят, на месте остановки — красная (ошибка) или пустая.
    const last = s.tries.length > 0 ? 1 : s.diag?.length ? 0 : -1
    return i <= last ? 'done' : failed && i === last + 1 ? 'fail' : 'wait'
  })
  const ringTone: LzTone =
    s?.phase === 'done'
      ? s.outcome === 'found' || s.outcome === 'not-needed'
        ? 'on'
        : s.outcome === 'partial'
          ? 'warn'
          : 'off'
      : failed
        ? 'error'
        : running
          ? 'busy'
          : 'off'
  const best = s?.result ?? null
  const center = running ? (
    <LiveNumber value={String(Math.max(0, s?.step ?? 0))} />
  ) : s?.phase === 'done' && best ? (
    `${best.okChecks}/${best.totalChecks}`
  ) : s?.phase === 'done' ? (
    <Check className="mx-auto size-8" />
  ) : (
    '—'
  )
  const centerSub = running
    ? s?.totalSteps
      ? `проверка из ${s.totalSteps}`
      : 'готовлюсь'
    : s?.phase === 'done'
      ? best
        ? 'проверок прошло'
        : `за ${elapsed} с`
      : s?.phase === 'stopped'
        ? 'остановлен'
        : 'не удалось'

  const outcomeTitle =
    s?.outcome === 'found'
      ? 'Найдена рабочая стратегия'
      : s?.outcome === 'partial'
        ? 'Найдена стратегия, которая открывает не всё'
        : s?.outcome === 'not-needed'
          ? 'Zapret для этих сайтов не нужен'
          : s?.outcome === 'unfixable'
            ? 'Zapret тут не поможет'
            : 'Подобрать не получилось'

  return createPortal(
    <AnimatePresence>
      {autopickOpen && s && (
        <motion.div
          key="zapret-autopick"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) close()
          }}
        >
          <motion.div
            initial={{ opacity: 0, y: 12, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.98 }}
            transition={{ duration: 0.2, ease: 'easeOut' }}
            role="dialog"
            aria-modal="true"
            aria-label="Автоподбор стратегии"
            className="relative flex max-h-[88vh] w-full max-w-[680px] flex-col overflow-hidden rounded-[calc(var(--radius)+10px)] border border-border bg-popover text-popover-foreground shadow-2xl"
            data-tour="zapret-autopick-dialog"
          >
            {/* Свет состояния сверху */}
            {ringTone !== 'off' && (
              <div
                aria-hidden
                className="pointer-events-none absolute inset-x-0 top-0 h-40"
                style={{
                  background: `radial-gradient(120% 100% at 30% -20%, color-mix(in oklab, ${ringTone === 'error' ? 'var(--st-err)' : ringTone === 'warn' ? 'var(--st-warn)' : 'var(--primary)'} 14%, transparent), transparent 70%)`
                }}
              />
            )}
            {!running && (
              <button
                type="button"
                className="absolute top-4 right-4 z-[1] cursor-pointer rounded-lg p-1 text-muted-foreground hover:bg-foreground/[0.06] hover:text-foreground"
                onClick={close}
                aria-label="Закрыть"
              >
                <X className="size-4" />
              </button>
            )}

            <div className="relative flex items-center gap-6 px-6 pt-6 pb-5">
              <PhaseRing states={arcStates} center={center} sub={centerSub} tone={ringTone} />
              <div className="min-w-0 flex-1">
                <h2 className="text-[22px] leading-tight font-extrabold tracking-[-0.01em] text-[color:var(--text-title)]">
                  {running ? 'Подбираю стратегию…' : s.phase === 'done' ? outcomeTitle : s.phase === 'stopped' ? 'Подбор остановлен' : 'Подбор не удался'}
                </h2>
                <p className="mt-1 text-[12.5px] leading-relaxed text-muted-foreground">
                  {running
                    ? 'Zapret на время подбора выключен, потом вернётся как был. Обычно до минуты-двух.'
                    : s.phase === 'stopped'
                      ? 'Zapret возвращён в прежнее состояние.'
                      : s.phase === 'error'
                        ? 'Zapret возвращён в прежнее состояние. Причина — ниже.'
                        : `Готово за ${elapsed} с.`}
                </p>
                <ol className="mt-3 space-y-1.5">
                  {PHASES.map((p, i) => {
                    const st = arcStates[i]
                    return (
                      <li key={p.label} className="flex items-center gap-2.5 text-[12.5px]">
                        <span
                          className={cn(
                            'flex size-5 shrink-0 items-center justify-center rounded-full border text-[10.5px] font-bold tabular-nums',
                            st === 'done'
                              ? 'border-primary bg-primary text-primary-foreground'
                              : st === 'now'
                                ? 'border-primary/60 text-primary'
                                : st === 'fail'
                                  ? 'border-st-err/60 text-st-err-text'
                                  : 'border-foreground/20 text-muted-foreground'
                          )}
                        >
                          {st === 'done' ? <Check className="size-3" strokeWidth={3} /> : st === 'now' ? <Loader2 className="size-3 animate-spin" /> : i + 1}
                        </span>
                        <span className={cn('font-semibold whitespace-nowrap', st === 'wait' ? 'text-muted-foreground' : 'text-foreground')}>{p.label}</span>
                      </li>
                    )
                  })}
                </ol>
              </div>
            </div>

            <div className="custom-scrollbar relative min-h-0 flex-1 space-y-4 overflow-y-auto border-t border-foreground/[0.07] px-6 py-4">
              {running && (
                <div>
                  <div className="flex items-baseline justify-between gap-3 text-[12.5px]">
                    <span className="min-w-0 truncate font-semibold text-foreground">
                      {s.phase === 'diagnose' || s.tries.length === 0 ? (s.current ?? 'Готовлюсь…') : PHASES[Math.min(pi, 2)].text}
                    </span>
                    <span className="shrink-0 text-muted-foreground tabular-nums">прошло {elapsed} с</span>
                  </div>
                  {s.totalSteps > 1 && (
                    <div className="mt-2 flex h-1.5 gap-[3px]" aria-hidden>
                      {Array.from({ length: s.totalSteps }, (_, i) => (
                        <span
                          key={i}
                          className={cn(
                            'flex-1 overflow-hidden rounded-full',
                            i < s.step - 1 ? 'bg-primary' : i === s.step - 1 ? 'lz-rail-flow text-primary/70' : 'bg-foreground/10'
                          )}
                        />
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* Итог */}
              {s.phase === 'done' && (
                <section
                  className={cn(
                    'rounded-xl border p-3.5',
                    s.outcome === 'found' ? 'border-primary/40 bg-primary/[0.08]' : s.outcome === 'partial' ? 'border-st-warn/40 bg-st-warn/[0.08]' : 'border-foreground/[0.08] bg-foreground/[0.03]'
                  )}
                >
                  {s.modelLabel && <div className="text-[13px] font-bold text-foreground">{s.modelLabel}</div>}
                  {s.why && <p className="mt-1 text-[12.5px] leading-relaxed text-muted-foreground">{s.why}</p>}
                  {s.result && !s.result.allOpen && (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {s.result.targets.map((t) => (
                        <span
                          key={t.id}
                          className={cn(
                            'inline-flex items-center gap-1 rounded-lg border px-2 py-0.5 text-[11.5px] font-semibold',
                            t.ok ? 'border-foreground/[0.08] bg-foreground/[0.03] text-foreground' : 'border-st-err/30 bg-st-err/[0.07] text-st-err-text'
                          )}
                        >
                          {t.ok ? <CircleCheck className="size-3 text-primary" /> : <CircleX className="size-3" />}
                          {t.label}
                        </span>
                      ))}
                    </div>
                  )}
                  {s.model && (
                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      <Input
                        value={name}
                        maxLength={40}
                        disabled={!!savedFile || !!busy}
                        onChange={(e) => setName(e.target.value)}
                        className="h-9 min-w-0 flex-1 text-sm"
                        aria-label="Название стратегии"
                      />
                      <Button size="sm" variant="outline" className="h-9 rounded-lg text-xs" disabled={!!busy || !!savedFile} onClick={() => void onSave()}>
                        {busy === 'save' ? <Loader2 className="size-3.5 animate-spin" /> : savedFile ? <Check className="size-3.5" /> : <Save className="size-3.5" />}
                        {savedFile ? 'Сохранена' : 'Сохранить как'}
                      </Button>
                      <Button size="sm" className="h-9 rounded-lg px-4 text-xs" disabled={!!busy} onClick={() => void onEnable()}>
                        {busy === 'enable' ? <Loader2 className="size-3.5 animate-spin" /> : <Power className="size-3.5" />}
                        Включить
                      </Button>
                    </div>
                  )}
                  {s.outcome === 'nothing' && (
                    <p className="mt-2 text-[12px] text-muted-foreground">
                      Подбор проверяет доступные приёмы, уточняет настройки и повторно проверяет до трёх лучших вариантов. Встроенные стратегии сборки проверяет «Проверить все» на вкладке «Стратегии» — это дольше, но полнее.
                    </p>
                  )}
                </section>
              )}

              {/* Диагноз: лента сайтов */}
              {s.diag && s.diag.length > 0 && (
                <section>
                  <div className="mb-2 text-[12.5px] font-semibold text-foreground">
                    Без Zapret <span className="font-normal text-muted-foreground">что открывается напрямую</span>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {s.diag.map((d) => {
                      const ok = d.verdict === 'ok'
                      return (
                        <span
                          key={d.id}
                          title={d.text}
                          className={cn(
                            'flex min-w-0 flex-auto flex-col rounded-lg border px-2.5 py-1.5',
                            ok
                              ? 'border-foreground/[0.08] bg-foreground/[0.03]'
                              : d.verdict === 'stall'
                                ? 'border-st-warn/35 bg-st-warn/[0.07]'
                                : 'border-st-err/35 bg-st-err/[0.07]'
                          )}
                        >
                          <span className="flex items-center gap-1.5 text-[12px] font-semibold text-foreground">
                            <span className={cn('size-1.5 shrink-0 rounded-full', ok ? 'bg-primary' : d.verdict === 'stall' ? 'bg-st-warn' : 'bg-st-err')} />
                            {d.label}
                          </span>
                          {!ok && (
                            <span className={cn('mt-0.5 max-w-[34ch] text-[11px] leading-snug', VERDICT_TONE[d.verdict] ?? 'text-muted-foreground')}>{d.text}</span>
                          )}
                        </span>
                      )
                    })}
                  </div>
                </section>
              )}

              {/* Попытки */}
              {s.tries.length > 0 && (
                <section>
                  <div className="mb-2 text-[12.5px] font-semibold text-foreground">
                    Проверено <span className="font-normal text-muted-foreground tabular-nums">{s.tries.length}</span>
                  </div>
                  <ul className="space-y-1">
                    {s.tries.map((t, i) => (
                      <li
                        key={i}
                        className={cn(
                          'flex items-center gap-2.5 rounded-lg border px-2.5 py-1.5 text-[12.5px]',
                          t.allOpen ? 'border-primary/40 bg-primary/[0.07]' : 'border-foreground/[0.07] bg-foreground/[0.025]'
                        )}
                      >
                        {t.allOpen ? <CircleCheck className="size-4 shrink-0 text-primary" /> : <CircleX className="size-4 shrink-0 text-muted-foreground" />}
                        <span className="min-w-0 flex-1 truncate text-foreground" title={t.error}>
                          {t.label}
                          {t.error && <span className="text-st-err-text">, не запустилась</span>}
                        </span>
                        <ScoreCells ok={t.okChecks} total={t.totalChecks} />
                        <span className="w-10 shrink-0 text-right text-[11.5px] font-bold text-muted-foreground tabular-nums">
                          {t.okChecks}/{t.totalChecks}
                        </span>
                      </li>
                    ))}
                    {running && s.phase !== 'diagnose' && (
                      <li className="flex items-center gap-2.5 rounded-lg border border-dashed border-primary/40 px-2.5 py-1.5 text-[12.5px] text-primary">
                        <Loader2 className="size-4 shrink-0 animate-spin" />
                        <span className="min-w-0 flex-1 truncate">{s.current ?? 'следующий приём'}</span>
                      </li>
                    )}
                  </ul>
                </section>
              )}

              {s.phase === 'error' && s.message && <div className="rounded-xl border border-st-err/40 bg-st-err/[0.08] p-3 text-[12.5px] text-st-err-text">{s.message}</div>}
            </div>

            <div className="relative flex justify-end gap-2 border-t border-foreground/[0.07] px-6 py-3.5">
              {running ? (
                <Button
                  size="sm"
                  variant="outline"
                  className="h-9 rounded-lg text-xs"
                  disabled={stopping}
                  onClick={() => {
                    setStopping(true)
                    void labAutopickStop()
                  }}
                >
                  {stopping ? <Loader2 className="size-3.5 animate-spin" /> : <Square className="size-3.5" />}
                  {stopping ? 'Останавливаю…' : 'Остановить'}
                </Button>
              ) : (
                <>
                  <Button size="sm" variant="ghost" className="h-9 rounded-lg text-xs" onClick={restart}>
                    <Wand2 className="size-3.5" /> Подобрать заново
                  </Button>
                  <Button size="sm" variant="outline" className="h-9 rounded-lg text-xs" onClick={close}>
                    Закрыть
                  </Button>
                </>
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body
  )
}

export default ZapretAutopickDialog
