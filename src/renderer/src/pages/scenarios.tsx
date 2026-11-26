import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { History, Keyboard, Plus, RotateCw, Sparkles } from 'lucide-react'
import { LiveNumber, LzHero, LzPanel, LzSectionHead, StatChip, StatusRing, type LzTone, type RingSegment } from '@renderer/components/lz'
import { ScenarioIcon, EmojiGlyph } from '@renderer/components/scenario-icon'
import { hotkeyText, ScenarioTile, StepChipView, type LastRun } from '@renderer/components/scenarios/scenario-tile'
import { ScenarioEditor } from '@renderer/components/scenarios/scenario-editor'
import { BLANK, chipsOf, TEMPLATES } from '@renderer/components/scenarios/actions'
import type { StepData } from '@renderer/components/scenarios/step-card'
import type { FullScenario } from '@renderer/lib/scenario-extra'
import { playChime } from '@renderer/lib/sound'
import { SCENARIO_EVENT, SCENARIO_LAST_KEY, type ScenarioEventDetail } from '@renderer/lib/scenario-events'
import BasePage from '@renderer/components/base/base-page'
import { streamDeckLinks } from '@renderer/utils/streamdeck-api'
import { Button } from '@renderer/components/ui/button'
import { cn, pluralRu, POWER_ON_BANNER_STYLE } from '@renderer/lib/utils'
import {
  dnsProvidersInstant,
  incyGetNodes,
  incyGetSettings,
  scenariosApply,
  scenariosDelete,
  scenariosList,
  scenariosSave,
  zapretListStrategies,
  type Scenario
} from '@renderer/utils/ipc'

const LAST_KEY = SCENARIO_LAST_KEY
/** Сколько сценариев помещается дугами в кольцо; со значками — до восьми. */
const RING_MAX = 10

function readLast(): LastRun {
  try {
    const j = JSON.parse(localStorage.getItem(LAST_KEY) ?? 'null') as LastRun
    return j && typeof j.id === 'string' ? j : null
  } catch {
    return null
  }
}

function hhmm(at: number): string {
  return new Date(at).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })
}

/**
 * Сценарии: одна кнопка — несколько действий. Например «Перед каткой»: Zapret
 * со стратегией для Discord, ExitLag только для игры, замер пинга и индикатор
 * поверх игры. Наверху — кольцо: по дуге на сценарий, горит последний
 * запущенный; ниже — плитки с кнопкой запуска; создание и правка — в конструкторе.
 */
export default function ScenariosPage(): React.ReactElement {
  const navigate = useNavigate()
  const [list, setList] = useState<FullScenario[]>([])
  const [loaded, setLoaded] = useState(false)
  const [edit, setEdit] = useState<FullScenario | null>(null)
  const [running, setRunning] = useState<string | null>(null)
  const [last, setLast] = useState<LastRun>(readLast)
  const [hot, setHot] = useState<string | null>(null)
  const [data, setData] = useState<StepData>({ strategies: [], nodes: [], dns: [], currentApps: [] })

  const load = useCallback(async () => {
    setList(await scenariosList().catch(() => []))
    setLoaded(true)
  }, [])

  // Запуск горячей клавишей: та же отметка, что и при нажатии кнопки.
  useEffect(() => {
    const on = (e: Event): void => {
      const d = (e as CustomEvent<ScenarioEventDetail>).detail
      if (d.kind === 'running') setRunning(d.id)
      else {
        setRunning(null)
        setLast({ id: d.id, at: d.at, ok: d.ok })
      }
    }
    window.addEventListener(SCENARIO_EVENT, on)
    return () => window.removeEventListener(SCENARIO_EVENT, on)
  }, [])

  useEffect(() => {
    void load()
    zapretListStrategies()
      .then((strategies) => setData((d) => ({ ...d, strategies })))
      .catch(() => void 0)
    incyGetNodes()
      .then((nodes) => setData((d) => ({ ...d, nodes })))
      .catch(() => void 0)
    dnsProvidersInstant()
      .then((dns) => setData((d) => ({ ...d, dns })))
      .catch(() => void 0)
    incyGetSettings()
      .then((s) => setData((d) => ({ ...d, currentApps: s.perAppProcesses ?? [] })))
      .catch(() => void 0)
  }, [load])

  const run = async (s: Scenario): Promise<void> => {
    setRunning(s.id)
    try {
      const steps = await scenariosApply(s.id)
      const bad = steps.filter((x) => !x.ok)
      const lr = { id: s.id, at: Date.now(), ok: bad.length === 0 }
      setLast(lr)
      try {
        localStorage.setItem(LAST_KEY, JSON.stringify(lr))
      } catch {
        /* noop */
      }
      playChime(bad.length === 0)
      if (bad.length) {
        toast.error(`«${s.name}»: не всё получилось`, {
          description: bad.map((b) => `${b.what}: ${b.message}`).join('\n'),
          duration: 12000
        })
      } else {
        toast.success(`${s.emoji} ${s.name} — готово`, {
          description: steps.map((x) => `${x.what}: ${x.message ?? 'ок'}`).join(' · '),
          style: POWER_ON_BANNER_STYLE
        })
      }
    } catch (e) {
      playChime(false)
      toast.error('Сценарий не запущен', {
        description: e instanceof Error ? e.message : String(e)
      })
    } finally {
      setRunning(null)
    }
  }

  const copyLink = (id: string): void => {
    // Ссылка с кодом этой установки — выполняется без подтверждения.
    void streamDeckLinks([`scenario/${id}`])
      .then((m) => m[`scenario/${id}`] ?? `lazeyka://scenario/${id}`)
      .catch(() => `lazeyka://scenario/${id}`)
      .then((url) => navigator.clipboard.writeText(url))
      .then(
        () => toast.success('Ссылка сценария скопирована', { description: 'Вставьте её в кнопку Stream Deck («Открыть сайт») или в ярлык.' }),
        () => toast.error('Не удалось скопировать')
      )
  }

  const remove = async (s: FullScenario): Promise<void> => {
    setList(await scenariosDelete(s.id))
    toast(`«${s.name}» удалён`, {
      action: { label: 'Вернуть', onClick: () => void scenariosSave(s).then(setList) }
    })
  }

  const save = async (s: FullScenario, andRun: boolean): Promise<boolean> => {
    try {
      const next = (await scenariosSave(s)) as FullScenario[]
      setList(next)
      setEdit(null)
      // Новый сценарий главный процесс добавляет в конец списка.
      const saved = s.id ? next.find((x) => x.id === s.id) : next[next.length - 1]
      if (andRun && saved) void run(saved)
      else toast.success(`«${s.name}» сохранён`)
      return true
    } catch (e) {
      toast.error('Сценарий не сохранён', { description: e instanceof Error ? e.message : String(e) })
      return false
    }
  }

  const ctx = { nodes: data.nodes, dns: data.dns }
  const lastScenario = last ? list.find((s) => s.id === last.id) : undefined
  const runningScenario = running ? list.find((s) => s.id === running) : undefined
  const withKeys = list.filter((s) => s.hotkey).length

  // Главная плашка: состояние словами.
  let tone: LzTone = 'off'
  let title: string
  let text: string
  if (runningScenario) {
    tone = 'busy'
    title = `Применяю «${runningScenario.name}»…`
    text = 'Шаги выполняются по порядку. Когда закончу, покажу, что получилось.'
  } else if (lastScenario && last) {
    tone = last.ok ? 'on' : 'warn'
    title = last.ok ? `«${lastScenario.name}» применён` : `«${lastScenario.name}» применён не полностью`
    text = last.ok
      ? `Последний запуск в ${hhmm(last.at)}. Сценарий можно запустить кнопкой на плитке${lastScenario.hotkey ? ` или клавишами ${hotkeyText(lastScenario.hotkey)}` : ''}.`
      : `Часть шагов в ${hhmm(last.at)} не получилась — что именно, видно в уведомлениях и в журнале. Остальные шаги выполнены.`
  } else if (list.length) {
    title = `${list.length} ${pluralRu(list.length, 'сценарий готов', 'сценария готовы', 'сценариев готовы')}`
    text = 'Сценарий делает несколько действий одной кнопкой, горячей клавишей или с кнопки Stream Deck.'
  } else {
    title = 'Одна кнопка вместо десяти'
    text = 'Сценарий включает и выключает нужное за раз: Zapret, VPN с узлом, ExitLag, Telegram, DNS, режим стримера, мини-окно, раздачу, «Перед каткой» и Discord.'
  }

  const ringList = list.slice(0, RING_MAX)
  const segments: RingSegment[] = ringList.map((s) => ({
    key: s.id,
    label: s.name,
    tone: running === s.id ? 'busy' : last?.id === s.id && !running ? (last.ok ? 'on' : 'warn') : 'off',
    icon: list.length <= 8 ? <ScenarioIcon icon={s.icon} emoji={s.emoji} className="size-3.5 text-[11px]" /> : undefined
  }))

  return (
    <BasePage title="Сценарии">
      <div className="mx-auto flex w-full max-w-[1080px] flex-col lz-page-gap lz-page-x pb-5">
        <LzHero
          tone={tone}
          data-tour="scenario-hero"
          visual={
            <StatusRing size={150} waves segments={segments} active={hot} halo={tone === 'off' ? null : tone === 'warn' ? 'warn' : 'on'} pulse={false}>
              <div className="flex items-baseline gap-1 leading-none">
                <LiveNumber value={list.length} className="text-[38px] font-extrabold tracking-tight text-[color:var(--text-title)]" />
              </div>
              <span className="mt-1 text-[11px] font-medium text-muted-foreground">
                {pluralRu(list.length, 'сценарий', 'сценария', 'сценариев')}
              </span>
            </StatusRing>
          }
          title={title}
          text={text}
          extra={
            lastScenario && !running ? (
              <button
                type="button"
                onClick={() => void run(lastScenario)}
                className="inline-flex cursor-pointer items-center gap-1.5 text-[12.5px] font-semibold text-primary hover:underline"
              >
                <RotateCw className="size-3.5" />
                Применить «{lastScenario.name}» снова
              </button>
            ) : undefined
          }
          actions={
            <Button size="lg" className="h-11 rounded-xl px-5" onClick={() => setEdit({ ...BLANK })} data-tour="scenario-new">
              <Plus className="size-4" />
              Новый сценарий
            </Button>
          }
          footer={
            <div className="grid grid-cols-3 gap-2">
              <StatChip icon={<Sparkles />} label="Сценариев" value={<LiveNumber value={list.length} />} />
              <StatChip
                icon={<Keyboard />}
                label="С горячей клавишей"
                value={list.length ? `${withKeys} из ${list.length}` : 'пока нет'}
                title="Все горячие клавиши программы — в Настройках"
                onClick={() => navigate('/settings')}
              />
              <StatChip
                icon={<History />}
                label="Последний запуск"
                tone={lastScenario && last ? (last.ok ? 'on' : 'warn') : undefined}
                value={lastScenario && last ? `${lastScenario.name} · ${hhmm(last.at)}` : 'ещё не было'}
              />
            </div>
          }
        />

        {list.length > 0 && (
          <div className="grid grid-cols-1 gap-3 md:grid-cols-3" data-tour="scenario-list">
            {list.map((s) => (
              <ScenarioTile
                key={s.id}
                s={s}
                ctx={ctx}
                last={last}
                running={running === s.id}
                blocked={running !== null && running !== s.id}
                highlighted={hot === s.id}
                onHover={(h) => setHot(h ? s.id : null)}
                onRun={() => void run(s)}
                onEdit={() => setEdit({ ...s })}
                onLink={() => copyLink(s.id)}
                onDelete={() => void remove(s)}
              />
            ))}
            <button
              type="button"
              onClick={() => setEdit({ ...BLANK })}
              className="ui-glow flex min-h-[168px] cursor-pointer flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-foreground/15 text-muted-foreground transition-colors hover:border-primary/50 hover:text-primary"
            >
              <span className="flex size-11 items-center justify-center rounded-full border border-dashed border-current">
                <Plus className="size-5" />
              </span>
              <span className="text-[13.5px] font-semibold">Новый сценарий</span>
              <span className="text-[11.5px] text-muted-foreground">с нуля или из шаблона</span>
            </button>
          </div>
        )}

        {loaded && list.length === 0 && (
          <LzPanel className="p-4" data-tour="scenario-templates">
            <LzSectionHead
              title="Готовые сценарии"
              hint="Шаблон открывается в конструкторе: можно поменять шаги, значок и клавишу. Ничего не включится, пока вы не сохраните и не запустите сценарий."
              sub="Возьмите любой и поправьте под себя"
            />
            <div className="mt-3 grid grid-cols-1 gap-2.5 md:grid-cols-3">
              {TEMPLATES.map((t) => {
                const built = t.build(data.strategies)
                return (
                  <button
                    key={t.key}
                    type="button"
                    onClick={() => setEdit(built)}
                    className={cn(
                      'group flex min-w-0 cursor-pointer flex-col gap-2.5 rounded-2xl border border-foreground/[0.08] bg-foreground/[0.03] p-3.5 text-left transition-colors',
                      'hover:border-primary/45 hover:bg-foreground/[0.05]'
                    )}
                  >
                    <span className="flex items-center gap-3">
                      <span className="flex size-11 shrink-0 items-center justify-center rounded-xl border border-foreground/[0.08] bg-foreground/[0.045]">
                        <EmojiGlyph emoji={built.emoji} className="size-7 text-[24px]" />
                      </span>
                      <span className="min-w-0">
                        <span className="block truncate text-[15px] font-bold text-[color:var(--text-title)]">{built.name}</span>
                        <span className="line-clamp-2 text-[11.5px] leading-snug text-muted-foreground">{t.about}</span>
                      </span>
                    </span>
                    <span className="flex flex-wrap gap-1">
                      {chipsOf(built, ctx).map((c) => (
                        <StepChipView key={c.id} chip={c} className="h-6 text-[11px]" />
                      ))}
                    </span>
                  </button>
                )
              })}
            </div>
          </LzPanel>
        )}
      </div>

      {edit && <ScenarioEditor initial={edit} data={data} onClose={() => setEdit(null)} onSave={save} onCopyLink={copyLink} />}
    </BasePage>
  )
}
