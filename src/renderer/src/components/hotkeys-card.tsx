import { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { AppWindow, Crosshair, Gamepad2, Globe, Lock, PictureInPicture2, RefreshCw, RotateCw, Send, Volume2, VolumeX, X, Zap } from 'lucide-react'
import { allSounds, getCategorySound } from '@renderer/lib/sound'
import { LzPanel, LzSectionHead } from '@renderer/components/lz'
import { ScenarioIcon } from '@renderer/components/scenario-icon'
import { Switch } from '@renderer/components/ui/switch'
import { Hint } from '@renderer/components/prematch/hint'
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
  | 'prematchToggleShortcut'
  | 'miniWindowShortcut'
  | 'muteSoundsShortcut'
  | 'restartAppShortcut'

const ROWS: { field: HotkeyField; title: string; hint: string; icon: React.ReactNode; winOnly?: boolean; tip?: string }[] = [
  { field: 'incyToggleShortcut', title: 'VPN (INCY)', hint: 'Подключить / отключить', icon: <Globe /> },
  { field: 'incyBestNodeShortcut', title: 'Лучший узел', hint: 'Перейти на рабочий быстрый узел', icon: <Zap /> },
  { field: 'exitlagToggleShortcut', title: 'ExitLag', hint: 'VPN только для игр — вкл / выкл', icon: <Gamepad2 /> },
  { field: 'zapretToggleShortcut', title: 'Zapret', hint: 'Включить / выключить', icon: <Lock /> },
  { field: 'zapretRestartShortcut', title: 'Перезапуск Zapret', hint: 'Если сайт перестал открываться', icon: <RotateCw /> },
  { field: 'tgwsToggleShortcut', title: 'Telegram-прокси', hint: 'Включить / выключить', icon: <Send />, winOnly: true },
  { field: 'showWindowShortcut', title: 'Показать / спрятать LAZEYKA', hint: 'Окно спереди — прячется в трей, иначе открывается поверх всех окон. Работает и в игре', icon: <AppWindow /> },
  { field: 'prematchToggleShortcut', title: 'Перед каткой', hint: 'Начать сессию (последняя цель) или завершить', icon: <Crosshair /> },
  { field: 'miniWindowShortcut', title: 'Мини-окно', hint: 'Показать / скрыть окно с переключателями', icon: <PictureInPicture2 /> },
  { field: 'muteSoundsShortcut', title: 'Без звука', hint: 'Выключить / включить все звуки программы, придёт короткое уведомление', icon: <VolumeX />, tip: 'Переключает «Без звука» из раздела «Звуки»: молчат звуки действий, сообщений и сигналов о лагах. На звук игры и системы не влияет. По умолчанию клавиша не назначена.' },
  { field: 'restartAppShortcut', title: 'Перезапустить LAZEYKA', hint: 'Программа закроется и откроется снова, службы перезапустятся', icon: <RefreshCw />, tip: 'Полный перезапуск LAZEYKA, как кнопка «Перезапустить» в «Профиль и сброс». Включённые службы на время перезапуска остановятся. Назначьте сочетание, которое трудно нажать случайно в игре.' }
]

/** Строка таблицы: встроенное действие или сценарий. */
interface Row {
  key: string
  title: string
  hint: string
  icon: React.ReactNode
  value?: string
  tip?: string
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
export default function HotkeysCard({ onOpenSounds }: { onOpenSounds?: () => void } = {}): React.ReactElement {
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
      icon: r.icon,
      value: appConfig?.[r.field] as string | undefined,
      tip: r.tip
    })),
    ...scenarios.map((s) => ({
      key: `sc:${s.id}`,
      title: s.name,
      hint: 'Запустить сценарий',
      icon: <ScenarioIcon icon={(s as { icon?: string }).icon} emoji={s.emoji} className="size-5 text-[17px]" />,
      value: s.hotkey
    }))
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

  /** Значок колпачков сочетания или «Назначить». */
  const keysView = (r: Row, isRec: boolean): React.ReactElement =>
    isRec ? (
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
      <>
        {r.value.split('+').map((p, j, arr) => (
          <span key={j} className="flex items-center gap-1.5">
            <Keycap>{capLabel(p)}</Keycap>
            {j < arr.length - 1 && <span className="text-xs text-muted-foreground">+</span>}
          </span>
        ))}
      </>
    ) : (
      <span className="rounded-lg border border-dashed border-foreground/20 px-3 py-1.5 text-xs text-muted-foreground transition-colors group-hover/hk:border-primary/50 group-hover/hk:text-foreground">
        Назначить
      </span>
    )

  const renderRow = (r: Row, setting: string): React.ReactElement => {
    const isRec = recording === r.key
    const isBusy = Boolean(r.value && busy.includes(r.value))
    return (
      <div
        key={r.key}
        data-setting={setting}
        className={cn('flex items-center gap-3.5 rounded-xl px-3 py-2.5 transition-colors', isRec && 'bg-primary/[0.08] ring-1 ring-primary/40')}
      >
        <span
          aria-hidden
          className={cn(
            'flex size-9 shrink-0 items-center justify-center rounded-xl text-[17px] transition-colors duration-300 [&_svg]:size-[18px]',
            r.value ? 'bg-primary/12 text-primary' : 'bg-foreground/[0.05] text-muted-foreground'
          )}
        >
          {r.icon}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 text-[13.5px] font-semibold text-foreground">
            <span className="truncate">{r.title}</span>
            {r.tip && <Hint text={r.tip} />}
          </div>
          <div className={cn('line-clamp-2 text-[12px] leading-snug', isBusy ? 'text-st-err-text' : 'text-muted-foreground')}>
            {isBusy ? 'Сочетание занято другой программой — выберите другое' : r.hint}
          </div>
        </div>
        <button
          type="button"
          onClick={() => {
            setLiveMods([])
            setRecording(isRec ? null : r.key)
          }}
          className="group/hk flex min-h-9 min-w-[11rem] cursor-pointer items-center justify-end gap-1.5 rounded-xl px-2 py-1"
          title={isRec ? 'Esc — отмена, Backspace — убрать' : 'Нажмите, чтобы назначить'}
        >
          {keysView(r, isRec)}
        </button>
        {r.value && !isRec ? (
          <button
            type="button"
            title="Убрать сочетание"
            aria-label="Убрать сочетание"
            className="cursor-pointer rounded-md p-1 text-muted-foreground hover:bg-foreground/[0.06] hover:text-foreground"
            onClick={() => void save(r.key, undefined)}
          >
            <X className="size-3.5" />
          </button>
        ) : (
          <span className="w-[22px]" />
        )}
      </div>
    )
  }

  const builtIn = rows.filter((r) => r.key.startsWith('cfg:'))
  const scRows = rows.filter((r) => r.key.startsWith('sc:'))
  const assigned = rows.filter((r) => r.value).length
  const soundOn = appConfig?.hotkeySound !== false

  return (
    <div className="space-y-3">
      <LzPanel className="px-2 pt-4 pb-2">
        <LzSectionHead
          className="px-3 pb-1.5"
          title="Горячие клавиши"
          hint={`Работают из любой программы, даже когда LAZEYKA свёрнута в трей. Сочетание — модификаторы (Ctrl, Alt, Shift${isMac ? ', Cmd' : ', Win'}) плюс буква, цифра или F1–F24: одни модификаторы без клавиши система не регистрирует. Esc — отмена, Backspace — убрать сочетание.`}
          sub={`Назначено ${assigned} из ${rows.length}. Нажмите на поле справа и зажмите сочетание`}
        />
        <div className="space-y-0.5">{builtIn.map((r) => renderRow(r, `hk-${r.key.slice(4)}`))}</div>
      </LzPanel>

      <LzPanel className="px-2 pt-4 pb-2">
        <LzSectionHead
          className="px-3 pb-1.5"
          title="Сценарии"
          hint="У каждого сценария может быть своё сочетание: нажали — сценарий применился."
          sub={scRows.length ? `Своё сочетание для каждого сценария` : undefined}
        />
        {scRows.length ? (
          <div data-setting="hk-scenarios" className="space-y-0.5">
            {scRows.map((r, i) => renderRow(r, i === 0 ? 'hk-scenarios-first' : `hk-sc-${i}`))}
          </div>
        ) : (
          <p data-setting="hk-scenarios" className="px-3 pt-1 pb-3 text-[12px] text-muted-foreground">
            Сценариев пока нет. Создайте сценарий в разделе «Сценарии» — здесь можно будет назначить ему клавишу.
          </p>
        )}
      </LzPanel>

      <LzPanel className="px-2 py-1">
        <div
          data-setting="hotkeySound"
          onClick={(e) => {
            if ((e.target as HTMLElement).closest('button, [role="switch"]')) return
            void patchAppConfig({ hotkeySound: !soundOn }).then(() => appReloadShortcuts())
          }}
          className="flex cursor-pointer items-center gap-3.5 px-3 py-3"
        >
          <span
            aria-hidden
            className={cn(
              'flex size-9 shrink-0 items-center justify-center rounded-xl transition-colors duration-300',
              soundOn ? 'bg-primary/12 text-primary' : 'bg-foreground/[0.05] text-muted-foreground'
            )}
          >
            <Volume2 className="size-[18px]" />
          </span>
          <div className="min-w-0 flex-1">
            <div className="text-[13.5px] font-semibold text-foreground">Звук при срабатывании</div>
            <div className="text-[12px] text-muted-foreground">
              {soundOn ? (
                <>
                  Короткий сигнал «{allSounds().find((s) => s.id === getCategorySound('actions'))?.name ?? 'Звон (стандартный)'}» — слышно даже в полноэкранной игре.{' '}
                  {onOpenSounds && (
                    <button type="button" onClick={onOpenSounds} className="cursor-pointer font-medium text-primary underline-offset-2 hover:underline">
                      Выбрать звук
                    </button>
                  )}
                </>
              ) : (
                'Короткий сигнал — слышно, что клавиша сработала, даже в полноэкранной игре.'
              )}
            </div>
          </div>
          <Switch checked={soundOn} onCheckedChange={(v) => void patchAppConfig({ hotkeySound: v }).then(() => appReloadShortcuts())} aria-label="Звук при срабатывании" />
        </div>
      </LzPanel>
    </div>
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
