import { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { Keyboard, Volume2, X } from 'lucide-react'
import { SOUNDS, playSound, setCurrentSound } from '@renderer/lib/sound'
import { Card, CardContent, CardHeader, CardTitle } from '@renderer/components/ui/card'
import { Switch } from '@renderer/components/ui/switch'
import { cn } from '@renderer/lib/utils'
import { useAppConfig } from '@renderer/hooks/use-app-config'
import { platform } from '@renderer/utils/init'
import { appReloadShortcuts, scenariosList, scenariosSave, type Scenario } from '@renderer/utils/ipc'

const isMac = platform === 'darwin'

type HotkeyField =
  | 'incyToggleShortcut'
  | 'incyBestNodeShortcut'
  | 'exitlagToggleShortcut'
  | 'zapretToggleShortcut'
  | 'zapretRestartShortcut'
  | 'tgwsToggleShortcut'
  | 'showWindowShortcut'

const ROWS: { field: HotkeyField; title: string; hint: string; winOnly?: boolean }[] = [
  { field: 'incyToggleShortcut', title: 'VPN (INCY)', hint: 'Подключить / отключить' },
  { field: 'incyBestNodeShortcut', title: 'Лучший узел', hint: 'Перейти на рабочий быстрый узел' },
  { field: 'exitlagToggleShortcut', title: 'ExitLag', hint: 'VPN только для игр — вкл / выкл' },
  { field: 'zapretToggleShortcut', title: 'Zapret', hint: 'Включить / выключить' },
  { field: 'zapretRestartShortcut', title: 'Перезапуск Zapret', hint: 'Если сайт перестал открываться' },
  { field: 'tgwsToggleShortcut', title: 'Telegram-прокси', hint: 'Включить / выключить', winOnly: true },
  { field: 'showWindowShortcut', title: 'Окно LAZEYKA', hint: 'Показать поверх всех окон' }
]

/** Строка таблицы: встроенное действие или сценарий. */
interface Row {
  key: string
  title: string
  hint: string
  value?: string
}

/** Подпись клавиши на «колпачке». */
function capLabel(part: string): string {
  if (part === 'CommandOrControl' || part === 'Control') return isMac ? '⌃ Ctrl' : 'Ctrl'
  if (part === 'Command' || part === 'Super' || part === 'Meta') return isMac ? '⌘ Cmd' : 'Win'
  if (part === 'Alt') return isMac ? '⌥ Option' : 'Alt'
  if (part === 'Shift') return isMac ? '⇧ Shift' : 'Shift'
  if (part === 'Space') return 'Пробел'
  if (part === 'Up') return '↑'
  if (part === 'Down') return '↓'
  if (part === 'Left') return '←'
  if (part === 'Right') return '→'
  return part
}

function Keycap({ children, live = false }: { children: React.ReactNode; live?: boolean }): React.ReactElement {
  return (
    <kbd
      className={cn(
        'inline-flex h-7 min-w-7 items-center justify-center rounded-lg border border-b-[3px] px-2 font-sans text-[11px] font-bold tracking-wide shadow-sm transition-all',
        live
          ? 'border-primary/70 border-b-primary bg-primary/15 text-primary animate-in zoom-in-90 duration-150'
          : 'border-border border-b-foreground/25 bg-gradient-to-b from-card to-background text-foreground'
      )}
    >
      {children}
    </kbd>
  )
}

/** Код клавиши → имя для Electron accelerator. null — клавиша-модификатор или неподходящая. */
function keyName(e: KeyboardEvent): string | null {
  const c = e.code
  if (/^Key[A-Z]$/.test(c)) return c.slice(3)
  if (/^Digit[0-9]$/.test(c)) return c.slice(5)
  if (/^F([1-9]|1[0-9]|2[0-4])$/.test(c)) return c
  if (/^Numpad[0-9]$/.test(c)) return `num${c.slice(6)}`
  const map: Record<string, string> = {
    Space: 'Space',
    ArrowUp: 'Up',
    ArrowDown: 'Down',
    ArrowLeft: 'Left',
    ArrowRight: 'Right',
    Home: 'Home',
    End: 'End',
    PageUp: 'PageUp',
    PageDown: 'PageDown',
    Insert: 'Insert',
    Delete: 'Delete',
    Backquote: '`',
    Minus: '-',
    Equal: '=',
    BracketLeft: '[',
    BracketRight: ']',
    Semicolon: ';',
    Quote: "'",
    Comma: ',',
    Period: '.',
    Slash: '/'
  }
  return map[c] ?? null
}

function modsOf(e: KeyboardEvent): string[] {
  const m: string[] = []
  if (e.ctrlKey) m.push('Control')
  if (e.metaKey) m.push(isMac ? 'Command' : 'Super')
  if (e.altKey) m.push('Alt')
  if (e.shiftKey) m.push('Shift')
  return m
}

/**
 * Горячие клавиши. Нажали «Назначить» — зажимаете модификаторы, и они
 * загораются на экране «колпачками» (Alt, Ctrl, Shift…), затем любая клавиша —
 * сочетание сохраняется. Esc — отмена, Backspace — убрать сочетание.
 * Кроме встроенных действий — у каждого сценария может быть своя клавиша.
 */
export default function HotkeysCard(): React.ReactElement {
  const { appConfig, patchAppConfig } = useAppConfig()
  const [scenarios, setScenarios] = useState<Scenario[]>([])
  const [recording, setRecording] = useState<string | null>(null)
  const [liveMods, setLiveMods] = useState<string[]>([])
  const [busy, setBusy] = useState<string[]>([])
  const recRef = useRef<string | null>(null)
  recRef.current = recording

  useEffect(() => {
    scenariosList().then(setScenarios).catch(() => void 0)
  }, [])

  const rows: Row[] = [
    ...ROWS.filter((r) => !(r.winOnly && isMac)).map((r) => ({
      key: `cfg:${r.field}`,
      title: r.title,
      hint: r.hint,
      value: appConfig?.[r.field] as string | undefined
    })),
    ...scenarios.map((s) => ({ key: `sc:${s.id}`, title: `${s.emoji} ${s.name}`, hint: 'Запустить сценарий', value: s.hotkey }))
  ]

  const save = async (key: string, accel: string | undefined): Promise<void> => {
    // Одно сочетание — одно действие: снимаем его с других строк.
    const cfgPatch: Record<string, string | undefined> = {}
    let list = scenarios
    for (const r of rows) {
      const isTarget = r.key === key
      if (!isTarget && !(accel && r.value === accel)) continue
      const next = isTarget ? accel : undefined
      if (r.key.startsWith('cfg:')) cfgPatch[r.key.slice(4)] = next
      else {
        const sc = list.find((x) => `sc:${x.id}` === r.key)
        if (sc) list = await scenariosSave({ ...sc, hotkey: next }).catch(() => list)
      }
    }
    if (Object.keys(cfgPatch).length) await patchAppConfig(cfgPatch as never)
    setScenarios(list)
    const failed = await appReloadShortcuts().catch(() => [] as string[])
    setBusy(failed)
    if (accel && failed.includes(accel)) {
      toast.error('Сочетание занято другой программой', { description: 'Выберите другое — система не дала его LAZEYKA.' })
    }
  }

  useEffect(() => {
    if (!recording) return
    const onDown = (e: KeyboardEvent): void => {
      e.preventDefault()
      e.stopPropagation()
      const key = recRef.current
      if (!key) return
      if (e.code === 'Escape') {
        setRecording(null)
        setLiveMods([])
        return
      }
      if ((e.code === 'Backspace' || e.code === 'Delete') && !e.ctrlKey && !e.altKey && !e.metaKey && !e.shiftKey) {
        setRecording(null)
        setLiveMods([])
        void save(key, undefined)
        return
      }
      const mods = modsOf(e)
      setLiveMods(mods)
      const k = keyName(e)
      if (!k) return // пока зажаты только модификаторы
      const isFn = /^F\d+$/.test(k)
      if (mods.length === 0 && !isFn) {
        toast.info('Добавьте Ctrl, Alt или Shift', { description: 'Без модификатора клавиша мешала бы печатать.' })
        return
      }
      setRecording(null)
      setLiveMods([])
      void save(key, [...mods, k].join('+'))
    }
    const onUp = (e: KeyboardEvent): void => setLiveMods(modsOf(e))
    window.addEventListener('keydown', onDown, true)
    window.addEventListener('keyup', onUp, true)
    return () => {
      window.removeEventListener('keydown', onDown, true)
      window.removeEventListener('keyup', onUp, true)
    }
  }, [recording])

  return (
    <Card className="cyber-card">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Keyboard className="h-4 w-4 text-primary" />
          Горячие клавиши
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-1">
        <p className="pb-2 text-xs text-muted-foreground">
          Работают из любой программы, даже когда LAZEYKA свёрнута в трей. Сочетание — модификаторы (Ctrl, Alt, Shift
          {isMac ? ', Cmd' : ', Win'}) плюс буква, цифра или F1–F24: одни модификаторы без клавиши система не регистрирует.
        </p>
        {rows.map((r, i) => {
          const isRec = recording === r.key
          const firstScenario = r.key.startsWith('sc:') && !rows[i - 1]?.key.startsWith('sc:')
          return (
            <div key={r.key}>
              {firstScenario && <div className="px-3 pb-1 pt-3 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Сценарии</div>}
              <div
                className={cn(
                  'flex items-center gap-3 rounded-xl px-3 py-2.5 transition-colors',
                  isRec ? 'bg-primary/[0.08] ring-1 ring-primary/40' : 'hover:bg-foreground/[0.025]'
                )}
              >
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-semibold text-foreground">{r.title}</div>
                  <div className="text-[11px] text-muted-foreground">{r.hint}</div>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setLiveMods([])
                    setRecording(isRec ? null : r.key)
                  }}
                  className="flex min-h-9 min-w-[11rem] cursor-pointer items-center justify-end gap-1.5 rounded-xl px-2 py-1"
                  title={isRec ? 'Esc — отмена, Backspace — убрать' : 'Нажмите, чтобы назначить'}
                >
                  {isRec ? (
                    liveMods.length ? (
                      <>
                        {liveMods.map((m) => (
                          <Keycap key={m} live>
                            {capLabel(m)}
                          </Keycap>
                        ))}
                        <span className="text-sm font-bold text-primary">+</span>
                        <span className="h-7 w-7 animate-pulse rounded-lg border border-dashed border-primary/60" />
                      </>
                    ) : (
                      <span className="animate-pulse text-xs font-semibold text-primary">Нажмите сочетание…</span>
                    )
                  ) : r.value ? (
                    r.value.split('+').map((p, j, arr) => (
                      <span key={j} className="flex items-center gap-1.5">
                        <Keycap>{capLabel(p)}</Keycap>
                        {j < arr.length - 1 && <span className="text-xs text-muted-foreground">+</span>}
                      </span>
                    ))
                  ) : (
                    <span className="rounded-lg border border-dashed border-border px-3 py-1.5 text-xs text-muted-foreground">Назначить</span>
                  )}
                </button>
                {r.value && !isRec ? (
                  <button
                    type="button"
                    title="Убрать"
                    className="cursor-pointer rounded-md p-1 text-muted-foreground hover:bg-foreground/[0.06] hover:text-foreground"
                    onClick={() => void save(r.key, undefined)}
                  >
                    <X className="size-3.5" />
                  </button>
                ) : (
                  <span className="w-[22px]" />
                )}
                {r.value && busy.includes(r.value) && <span className="text-[10px] font-semibold text-st-err-text">занято</span>}
              </div>
            </div>
          )
        })}
        <label className="mt-2 flex cursor-pointer items-center justify-between gap-3 rounded-xl border border-border/60 px-3 py-2.5">
          <span>
            <span className="block text-sm font-semibold text-foreground">Звук при срабатывании</span>
            <span className="block text-[11px] text-muted-foreground">Короткий сигнал — слышно, что клавиша сработала, даже в полноэкранной игре.</span>
          </span>
          <Switch checked={appConfig?.hotkeySound !== false} onCheckedChange={(v) => void patchAppConfig({ hotkeySound: v }).then(() => appReloadShortcuts())} />
        </label>
        {appConfig?.hotkeySound !== false && (
          <div className="mt-2 rounded-xl border border-border/60 px-3 py-2.5">
            <div className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-foreground">
              <Volume2 className="size-4" /> Какой звук
              <span className="ml-1 text-[11px] font-normal text-muted-foreground">нажмите, чтобы послушать и выбрать</span>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {SOUNDS.map((s) => {
                const active = (appConfig?.hotkeySoundId ?? 'chime') === s.id
                return (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => {
                      playSound(s.id, true)
                      setCurrentSound(s.id)
                      void patchAppConfig({ hotkeySoundId: s.id }).then(() => appReloadShortcuts())
                    }}
                    className={cn(
                      'cursor-pointer rounded-lg border px-2.5 py-1 text-xs transition-colors',
                      active
                        ? 'border-primary bg-primary/15 font-semibold text-foreground'
                        : 'border-border/60 text-muted-foreground hover:border-foreground/30 hover:text-foreground'
                    )}
                  >
                    {s.name}
                  </button>
                )
              })}
            </div>
          </div>
        )}
        {scenarios.length === 0 && (
          <p className="px-3 pt-2 text-[11px] text-muted-foreground">Создайте сценарий на вкладке «Сценарии» — здесь можно будет назначить ему клавишу.</p>
        )}
      </CardContent>
    </Card>
  )
}

/**
 * Поле «горячая клавиша» для других экранов (например, редактор сценария):
 * тот же набор с подсветкой зажатых клавиш, что и в настройках.
 */
export function HotkeyInput({ value, onChange }: { value?: string; onChange: (v: string | undefined) => void }): React.ReactElement {
  const [rec, setRec] = useState(false)
  const [mods, setMods] = useState<string[]>([])
  useEffect(() => {
    if (!rec) return
    const down = (e: KeyboardEvent): void => {
      e.preventDefault()
      e.stopPropagation()
      if (e.code === 'Escape') {
        setRec(false)
        setMods([])
        return
      }
      if ((e.code === 'Backspace' || e.code === 'Delete') && !e.ctrlKey && !e.altKey && !e.metaKey && !e.shiftKey) {
        setRec(false)
        setMods([])
        onChange(undefined)
        return
      }
      const m = modsOf(e)
      setMods(m)
      const k = keyName(e)
      if (!k) return
      if (m.length === 0 && !/^F\d+$/.test(k)) {
        toast.info('Добавьте Ctrl, Alt или Shift')
        return
      }
      setRec(false)
      setMods([])
      onChange([...m, k].join('+'))
    }
    const up = (e: KeyboardEvent): void => setMods(modsOf(e))
    window.addEventListener('keydown', down, true)
    window.addEventListener('keyup', up, true)
    return () => {
      window.removeEventListener('keydown', down, true)
      window.removeEventListener('keyup', up, true)
    }
  }, [rec, onChange])
  return (
    <span className="flex items-center gap-1.5">
      <button
        type="button"
        onClick={() => {
          setMods([])
          setRec((r) => !r)
        }}
        title={rec ? 'Esc — отмена, Backspace — убрать' : 'Нажмите, чтобы назначить'}
        className={cn(
          'flex min-h-9 min-w-[9rem] cursor-pointer items-center justify-end gap-1.5 rounded-xl px-2 py-1',
          rec && 'bg-primary/[0.08] ring-1 ring-primary/40'
        )}
      >
        {rec ? (
          mods.length ? (
            <>
              {mods.map((m) => (
                <Keycap key={m} live>
                  {capLabel(m)}
                </Keycap>
              ))}
              <span className="text-sm font-bold text-primary">+</span>
              <span className="h-7 w-7 animate-pulse rounded-lg border border-dashed border-primary/60" />
            </>
          ) : (
            <span className="animate-pulse text-xs font-semibold text-primary">Нажмите сочетание…</span>
          )
        ) : value ? (
          value.split('+').map((p, j, arr) => (
            <span key={j} className="flex items-center gap-1.5">
              <Keycap>{capLabel(p)}</Keycap>
              {j < arr.length - 1 && <span className="text-xs text-muted-foreground">+</span>}
            </span>
          ))
        ) : (
          <span className="rounded-lg border border-dashed border-border px-3 py-1.5 text-xs text-muted-foreground">Назначить</span>
        )}
      </button>
      {value && !rec && (
        <button type="button" title="Убрать" className="cursor-pointer rounded-md p-1 text-muted-foreground hover:bg-foreground/[0.06]" onClick={() => onChange(undefined)}>
          <X className="size-3.5" />
        </button>
      )}
    </span>
  )
}
