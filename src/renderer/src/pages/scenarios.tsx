import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Check, CheckCircle2, Keyboard, Loader2, Pencil, Play, Plus, RotateCw, Trash2, X } from 'lucide-react'
import { HotkeyInput } from '@renderer/components/hotkeys-card'
import { ScenarioIcon, ScenarioIconPicker } from '@renderer/components/scenario-icon'
import { playChime } from '@renderer/lib/sound'
import { SCENARIO_EVENT, SCENARIO_LAST_KEY, type ScenarioEventDetail } from '@renderer/lib/scenario-events'
import BasePage from '@renderer/components/base/base-page'
import { Button } from '@renderer/components/ui/button'
import { Input } from '@renderer/components/ui/input'
import { cn, POWER_ON_BANNER_STYLE } from '@renderer/lib/utils'
import { platform } from '@renderer/utils/init'
import {
  dnsProvidersInstant,
  incyGetNodes,
  incyGetSettings,
  scenariosApply,
  scenariosDelete,
  scenariosList,
  scenariosSave,
  zapretListStrategies,
  type DohProvider,
  type IncyNode,
  type Scenario,
  type ScenarioToggle
} from '@renderer/utils/ipc'

const isMac = platform === 'darwin'
const LAST_KEY = SCENARIO_LAST_KEY

type LastRun = { id: string; at: number; ok: boolean } | null

function readLast(): LastRun {
  try {
    const j = JSON.parse(localStorage.getItem(LAST_KEY) ?? 'null') as LastRun
    return j && typeof j.id === 'string' ? j : null
  } catch {
    return null
  }
}

const EMPTY: Scenario = { id: '', name: '', emoji: '🎮', zapret: 'keep', incy: 'keep', exitlag: 'keep', tgws: 'keep', dns: 'keep' }

function Seg({ value, onChange, labels }: { value: ScenarioToggle; onChange: (v: ScenarioToggle) => void; labels?: [string, string, string] }): React.ReactElement {
  const l = labels ?? ['Не трогать', 'Включить', 'Выключить']
  return (
    <div className="inline-flex rounded-lg border border-border bg-card/40 p-0.5">
      {(['keep', 'on', 'off'] as ScenarioToggle[]).map((v, i) => (
        <button
          key={v}
          type="button"
          onClick={() => onChange(v)}
          className={cn(
            'cursor-pointer rounded-md px-2.5 py-1 text-[11px] font-semibold transition-colors',
            value === v
              ? v === 'on'
                ? 'bg-st-ok/20 text-st-ok-text'
                : v === 'off'
                  ? 'bg-st-err/15 text-st-err-text'
                  : 'bg-foreground/[0.08] text-foreground'
              : 'text-muted-foreground hover:text-foreground'
          )}
        >
          {l[i]}
        </button>
      ))}
    </div>
  )
}

function describe(s: Scenario, nodes: IncyNode[], dns: DohProvider[]): string[] {
  const out: string[] = []
  if (s.zapret !== 'keep') out.push(s.zapret === 'on' ? `Zapret${s.zapretStrategy ? ` · ${s.zapretStrategy.replace(/\.bat$/i, '')}` : ''}` : 'Zapret выкл.')
  if (s.exitlag !== 'keep') out.push(s.exitlag === 'on' ? `ExitLag${s.exitlagApps?.length ? ` · ${s.exitlagApps.length} прил.` : ''}` : 'ExitLag выкл.')
  if (s.incy !== 'keep') out.push(s.incy === 'on' ? `VPN · ${nodes.find((n) => n.id === s.incyNodeId)?.name ?? 'выбранный узел'}` : 'VPN выкл.')
  if (s.tgws !== 'keep' && !isMac) out.push(s.tgws === 'on' ? 'Telegram' : 'Telegram выкл.')
  if (s.dns !== 'keep') out.push(s.dns === 'dhcp' ? 'DNS стандартный' : `DNS · ${dns.find((d) => d.id === s.dns)?.name ?? s.dns}`)
  return out.length ? out : ['ничего не меняет']
}

/**
 * Сценарии: одна кнопка — несколько действий. Например «Игры»: Zapret со
 * стратегией для Discord, ExitLag только для игры, Telegram выключен.
 */
export default function ScenariosPage(): React.ReactElement {
  const [list, setList] = useState<Scenario[]>([])
  const [edit, setEdit] = useState<Scenario | null>(null)
  const [running, setRunning] = useState<string | null>(null)
  const [last, setLast] = useState<LastRun>(readLast)
  const [strategies, setStrategies] = useState<{ file: string; title: string }[]>([])
  const [nodes, setNodes] = useState<IncyNode[]>([])
  const [dns, setDns] = useState<DohProvider[]>([])
  const [currentApps, setCurrentApps] = useState<string[]>([])

  const load = useCallback(async () => {
    setList(await scenariosList().catch(() => []))
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
    zapretListStrategies().then(setStrategies).catch(() => void 0)
    incyGetNodes().then(setNodes).catch(() => void 0)
    dnsProvidersInstant().then(setDns).catch(() => void 0)
    incyGetSettings().then((s) => setCurrentApps(s.perAppProcesses ?? [])).catch(() => void 0)
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
        toast.error(`«${s.name}»: не всё получилось`, { description: bad.map((b) => `${b.what}: ${b.message}`).join('\n'), duration: 12000 })
      } else {
        toast.success(`${s.emoji} ${s.name} — готово`, {
          description: steps.map((x) => `${x.what}: ${x.message ?? 'ок'}`).join(' · '),
          style: POWER_ON_BANNER_STYLE
        })
      }
    } catch (e) {
      playChime(false)
      toast.error('Сценарий не запущен', { description: e instanceof Error ? e.message : String(e) })
    } finally {
      setRunning(null)
    }
  }

  const save = async (): Promise<void> => {
    if (!edit) return
    if (!edit.name.trim()) {
      toast.error('Назовите сценарий')
      return
    }
    setList(await scenariosSave(edit))
    setEdit(null)
  }

  const templates: Scenario[] = [
    { ...EMPTY, name: 'Игры', emoji: '🎮', zapret: 'on', exitlag: 'on', incy: 'on', tgws: 'off' },
    { ...EMPTY, name: 'Работа', emoji: '💼', zapret: 'on', exitlag: 'off', incy: 'on', tgws: 'on' },
    { ...EMPTY, name: 'Всё выключить', emoji: '🌙', zapret: 'off', exitlag: 'off', incy: 'off', tgws: 'off' }
  ]

  return (
    <BasePage title="Сценарии">
      <div className="px-4 pb-6 space-y-4">
        <p className="text-xs text-muted-foreground">
          Сценарий включает и выключает нужное одной кнопкой: Zapret со своей стратегией, VPN с выбранным узлом, ExitLag для
          игры, Telegram и DNS.
        </p>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {list.map((s) => {
            const isLast = last?.id === s.id
            return (
            <div
              key={s.id}
              className={cn(
                'ui-card group relative flex flex-col gap-3 rounded-2xl border bg-card p-4 transition-colors',
                isLast && last?.ok ? 'border-st-ok/60 shadow-[0_0_24px_-6px_color-mix(in_srgb,var(--st-ok)_45%,transparent)]' : isLast ? 'border-st-warn/60' : 'border-border hover:border-primary/35'
              )}
            >
              {isLast && (
                <span className={cn('absolute right-3 top-3 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold', last?.ok ? 'bg-st-ok/15 text-st-ok-text' : 'bg-st-warn/15 text-st-warn-text')}>
                  <CheckCircle2 className="size-3" />
                  {last?.ok ? 'Применён' : 'С ошибками'} · {new Date(last!.at).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}
                </span>
              )}
              <div className="flex items-start gap-3">
                <span className="flex size-11 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-border bg-background/60">
                  <ScenarioIcon icon={s.icon} emoji={s.emoji} />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-bold text-foreground">{s.name}</div>
                  <div className="mt-1 flex flex-wrap gap-1">
                    {describe(s, nodes, dns).map((d) => (
                      <span key={d} className="rounded-md border border-border bg-background/50 px-1.5 py-px text-[10px] text-muted-foreground">
                        {d}
                      </span>
                    ))}
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-1.5">
                <Button size="sm" variant={isLast ? 'outline' : 'default'} className="flex-1 text-xs" disabled={running !== null} onClick={() => void run(s)}>
                  {running === s.id ? <Loader2 className="size-3.5 animate-spin" /> : isLast ? <RotateCw className="size-3.5" /> : <Play className="size-3.5" />}
                  {running === s.id ? 'Применяю…' : isLast ? 'Применить снова' : 'Запустить'}
                </Button>
                {s.hotkey && (
                  <span className="inline-flex items-center gap-1 rounded-md border border-border px-1.5 py-1 font-mono text-[10px] text-muted-foreground" title="Горячая клавиша">
                    <Keyboard className="size-3" />
                    {s.hotkey}
                  </span>
                )}
                <Button size="icon-sm" variant="ghost" title="Изменить" onClick={() => setEdit({ ...s })}>
                  <Pencil className="size-3.5" />
                </Button>
                <Button size="icon-sm" variant="ghost" title="Удалить" onClick={() => void scenariosDelete(s.id).then(setList)}>
                  <Trash2 className="size-3.5" />
                </Button>
              </div>
            </div>
            )
          })}

          <button
            type="button"
            onClick={() => setEdit({ ...EMPTY })}
            className="ui-glow flex min-h-[8.5rem] cursor-pointer flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-border text-sm font-semibold text-muted-foreground transition-colors hover:border-primary/50 hover:text-primary"
          >
            <Plus className="size-5" />
            Новый сценарий
          </button>
        </div>

        {list.length === 0 && (
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            Начать с шаблона:
            {templates.map((t) => (
              <Button key={t.name} size="sm" variant="outline" className="text-xs" onClick={() => setEdit({ ...t })}>
                {t.emoji} {t.name}
              </Button>
            ))}
          </div>
        )}

        {edit && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm" onMouseDown={(e) => e.target === e.currentTarget && setEdit(null)}>
            <div className="max-h-[92vh] w-full max-w-xl space-y-4 overflow-y-auto rounded-2xl border border-border/70 bg-background p-5 shadow-2xl">
              <div className="flex items-center justify-between">
                <div className="text-lg font-black">{edit.id ? 'Изменить сценарий' : 'Новый сценарий'}</div>
                <button type="button" className="cursor-pointer rounded-lg p-1 text-muted-foreground hover:bg-foreground/[0.06]" onClick={() => setEdit(null)}>
                  <X className="size-4" />
                </button>
              </div>

              <div className="flex items-center gap-2">
                <span className="flex size-9 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-border bg-background/60">
                  <ScenarioIcon icon={edit.icon} emoji={edit.emoji} className="size-6 text-xl" />
                </span>
                <Input value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} placeholder="Название" className="h-8 flex-1 text-sm" />
              </div>
              <ScenarioIconPicker
                icon={edit.icon}
                emoji={edit.emoji}
                onChange={(v) => setEdit({ ...edit, ...v, icon: v.icon })}
              />

              <div className="space-y-3 rounded-xl border border-border bg-card/40 p-3">
                <Row title="Zapret">
                  <Seg value={edit.zapret} onChange={(v) => setEdit({ ...edit, zapret: v })} />
                </Row>
                {edit.zapret === 'on' && (
                  <select
                    value={edit.zapretStrategy ?? ''}
                    onChange={(e) => setEdit({ ...edit, zapretStrategy: e.target.value || undefined })}
                    className="h-8 w-full rounded-lg border border-border bg-background px-2 text-xs"
                  >
                    <option value="">Текущая стратегия</option>
                    {strategies.map((s) => (
                      <option key={s.file} value={s.file}>
                        {s.title}
                      </option>
                    ))}
                  </select>
                )}

                <Row title="ExitLag (VPN только для игр)">
                  <Seg value={edit.exitlag} onChange={(v) => setEdit({ ...edit, exitlag: v })} />
                </Row>
                {edit.exitlag === 'on' && (
                  <div className="flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
                    <span className="truncate">
                      {edit.exitlagApps?.length ? `Список: ${edit.exitlagApps.join(', ')}` : 'Текущий список с вкладки ExitLag'}
                    </span>
                    <Button size="sm" variant="ghost" className="h-7 shrink-0 text-[11px]" onClick={() => setEdit({ ...edit, exitlagApps: [...currentApps] })}>
                      Запомнить текущий ({currentApps.length})
                    </Button>
                  </div>
                )}

                <Row title="VPN (INCY)">
                  <Seg value={edit.incy} onChange={(v) => setEdit({ ...edit, incy: v })} labels={['Не трогать', 'Подключить', 'Отключить']} />
                </Row>
                {edit.incy === 'on' && (
                  <select
                    value={edit.incyNodeId ?? ''}
                    onChange={(e) => setEdit({ ...edit, incyNodeId: e.target.value || undefined })}
                    className="h-8 w-full rounded-lg border border-border bg-background px-2 text-xs"
                  >
                    <option value="">Выбранный сейчас узел</option>
                    {nodes.map((n) => (
                      <option key={n.id} value={n.id}>
                        {n.name}
                      </option>
                    ))}
                  </select>
                )}

                {!isMac && (
                  <Row title="Telegram-прокси">
                    <Seg value={edit.tgws} onChange={(v) => setEdit({ ...edit, tgws: v })} />
                  </Row>
                )}

                <Row title="Горячая клавиша">
                  <HotkeyInput value={edit.hotkey} onChange={(v) => setEdit((e) => (e ? { ...e, hotkey: v } : e))} />
                </Row>

                <Row title="DNS">
                  <select value={edit.dns} onChange={(e) => setEdit({ ...edit, dns: e.target.value })} className="h-8 rounded-lg border border-border bg-background px-2 text-xs">
                    <option value="keep">Не трогать</option>
                    <option value="dhcp">Стандартный (DHCP)</option>
                    {dns.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.name}
                      </option>
                    ))}
                  </select>
                </Row>
              </div>

              <div className="flex justify-end gap-2">
                <Button variant="ghost" onClick={() => setEdit(null)}>
                  Отмена
                </Button>
                <Button onClick={() => void save()}>
                  <Check className="size-4" />
                  Сохранить
                </Button>
              </div>
            </div>
          </div>
        )}
      </div>
    </BasePage>
  )
}

function Row({ title, children }: { title: string; children: React.ReactNode }): React.ReactElement {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <span className="text-xs font-semibold text-foreground">{title}</span>
      {children}
    </div>
  )
}
