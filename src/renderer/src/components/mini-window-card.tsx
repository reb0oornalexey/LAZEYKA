import React, { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { ChevronDown, PictureInPicture2, ScanEye } from 'lucide-react'
import { Button } from '@renderer/components/ui/button'
import { Switch } from '@renderer/components/ui/switch'
import { Hint } from '@renderer/components/prematch/hint'
import { cn } from '@renderer/lib/utils'
import {
  MINI_IND_MIN_OPACITY,
  MINI_MAX_OPACITY,
  MINI_MIN_OPACITY,
  miniClose,
  miniOpen,
  miniSetSettings,
  miniState,
  onMiniChanged,
  type MiniMode,
  type MiniSettings
} from '@renderer/utils/mini-api'
import { miniFlash } from '@renderer/utils/mini-flash-api'

const HINT =
  'Маленькое окно поверх остальных. Это обычное окно программы: в игру оно не встраивается, поэтому античиту не за что его считать вмешательством. Поверх игры в эксклюзивном полноэкранном режиме его не видно — подробности ниже, в «Не видно поверх игры?».'

/**
 * Где в играх режим «в окне без рамки». Названия — как в английской версии игры:
 * в русской они переведены по-разному, поэтому указываем оригинал.
 */
const GAMES: { name: string; where: string }[] = [
  { name: 'CS2', where: 'Settings → Video → Display Mode: любой режим со словом «Windowed», не просто «Fullscreen»' },
  { name: 'Dota 2', where: 'Settings → Video → Display Mode: «Borderless Window» вместо «Exclusive Fullscreen»' },
  { name: 'Valorant', where: 'Settings → Video → General → Display Mode: «Windowed Fullscreen»' },
  { name: 'Fortnite', where: 'Settings → Display → Window Mode: «Windowed Fullscreen»' },
  { name: 'Apex Legends', where: 'Settings → Video → Display Mode: «Borderless Window»' }
]

const MODES: { id: MiniMode; title: string; text: string }[] = [
  { id: 'indicator', title: 'Индикатор', text: 'Только то, что включено, зелёными точками. Без кнопок.' },
  { id: 'panel', title: 'Панель', text: 'Переключатели служб и пинг игровой сессии.' }
]

/**
 * Карточка «Мини-окно»: показ, вид (индикатор или панель), закрепление и прозрачность.
 * Состояние берётся из главного процесса и обновляется событием mini:changed.
 */
export default function MiniWindowCard(): React.ReactElement {
  const [open, setOpen] = useState(false)
  const [st, setSt] = useState<MiniSettings>({ opacity: MINI_MAX_OPACITY, mode: 'panel', locked: true, indOpacity: 90 })
  const [busy, setBusy] = useState(false)
  const [helpOpen, setHelpOpen] = useState(false)
  const [checking, setChecking] = useState(false)
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const checkTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    miniState()
      .then((s) => {
        setOpen(s.open)
        setSt({ opacity: s.opacity, mode: s.mode, locked: s.locked, indOpacity: s.indOpacity })
      })
      .catch(() => void 0)
    const off = onMiniChanged((s) => {
      setOpen(s.open)
      setSt((p) => ({ ...p, mode: s.mode, locked: s.locked }))
    })
    return () => {
      off()
      if (saveTimer.current) clearTimeout(saveTimer.current)
      if (checkTimer.current) clearTimeout(checkTimer.current)
    }
  }, [])

  /** Открыть окно (если закрыто) и 5 секунд подсвечивать его рамку. */
  const check = async (): Promise<void> => {
    setChecking(true)
    try {
      await miniFlash()
      if (checkTimer.current) clearTimeout(checkTimer.current)
      checkTimer.current = setTimeout(() => setChecking(false), 5000)
    } catch (e) {
      setChecking(false)
      fail(e)
    }
  }

  const fail = (e: unknown): void => {
    toast.error('Не удалось изменить мини-окно', { description: e instanceof Error ? e.message : String(e) })
  }

  const toggle = async (next: boolean): Promise<void> => {
    setBusy(true)
    try {
      const s = next ? await miniOpen() : await miniClose()
      setOpen(next ? s.open : false)
    } catch (e) {
      fail(e)
    } finally {
      setBusy(false)
    }
  }

  const apply = (patch: Partial<MiniSettings>): void => {
    setSt((p) => ({ ...p, ...patch }))
    miniSetSettings(patch).catch(fail)
  }

  const indicator = st.mode === 'indicator'
  const opacity = indicator ? st.indOpacity : st.opacity

  const changeOpacity = (v: number): void => {
    setSt((p) => (indicator ? { ...p, indOpacity: v } : { ...p, opacity: v }))
    if (saveTimer.current) clearTimeout(saveTimer.current)
    // Окно меняется сразу, на диск пишем, когда ползунок остановился.
    saveTimer.current = setTimeout(() => {
      miniSetSettings(indicator ? { indOpacity: v } : { opacity: v }).catch(() => void 0)
    }, 150)
  }

  return (
    <div data-tour="mini-window" className="rounded-xl border border-border bg-card/40 p-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <PictureInPicture2 className="size-4 text-primary" />
          <span className="text-sm font-semibold text-foreground">Мини-окно поверх игры</span>
          <Hint text={HINT} />
        </div>
        <Switch checked={open} disabled={busy} onCheckedChange={(v) => void toggle(v)} />
      </div>

      <div data-tour="mini-window-modes" className="mt-3 grid grid-cols-2 gap-2">
        {MODES.map((m) => (
          <button
            key={m.id}
            type="button"
            onClick={() => st.mode !== m.id && apply({ mode: m.id })}
            className={cn(
              'cursor-pointer rounded-lg border p-2.5 text-left transition-colors',
              st.mode === m.id ? 'border-primary bg-primary/10' : 'border-border hover:border-primary/40'
            )}
          >
            <span className="block text-xs font-bold text-foreground">{m.title}</span>
            <span className="mt-0.5 block text-[11px] leading-snug text-muted-foreground">{m.text}</span>
          </button>
        ))}
      </div>

      {indicator && (
        <label className="mt-3 flex cursor-pointer items-center justify-between gap-3 text-xs">
          <span className="flex items-center gap-1.5 font-medium text-foreground">
            Закрепить на месте
            <Hint text="Закреплённый индикатор пропускает клики сквозь себя, поэтому не мешает в игре. Чтобы передвинуть его, снимите закрепление, перетащите за плашку и закрепите снова." />
          </span>
          <Switch checked={st.locked} onCheckedChange={(v) => apply({ locked: v })} />
        </label>
      )}

      <label className="mt-3 flex items-center gap-3 text-xs text-muted-foreground">
        <span className="shrink-0">Прозрачность</span>
        <input
          type="range"
          min={indicator ? MINI_IND_MIN_OPACITY : MINI_MIN_OPACITY}
          max={MINI_MAX_OPACITY}
          step={5}
          value={opacity}
          onChange={(e) => changeOpacity(Number(e.target.value))}
          className="h-1 w-full cursor-pointer accent-[color:var(--primary)]"
        />
        <span className="w-9 shrink-0 text-right tabular-nums text-foreground">{opacity}%</span>
      </label>
      <p className="mt-2 text-[11px] leading-snug text-muted-foreground">
        Показать или скрыть окно можно горячей клавишей: Настройки → Горячие клавиши → «Мини-окно».
      </p>

      <div data-tour="mini-window-fullscreen-help" className="mt-3 rounded-lg border border-border/70 bg-background/40">
        <button
          type="button"
          onClick={() => setHelpOpen((v) => !v)}
          aria-expanded={helpOpen}
          className="flex w-full cursor-pointer items-center justify-between gap-2 px-3 py-2 text-left text-xs font-semibold text-foreground"
        >
          Не видно поверх игры?
          <ChevronDown className={cn('size-3.5 text-muted-foreground transition-transform', helpOpen && 'rotate-180')} />
        </button>
        {helpOpen && (
          <div className="space-y-2 border-t border-border/60 px-3 pb-3 pt-2 text-[11px] leading-snug text-muted-foreground">
            <p>
              Мини-окно — обычное окно поверх остальных. В игру оно не встраивается, поэтому и банить за него не за что.
              Обратная сторона: в эксклюзивном полноэкранном режиме игра занимает экран целиком, и обычные окна поверх
              неё не видны. Так же ведут себя прицелы и другие окна-накладки без встраивания.
            </p>
            <p>
              Что делать: в настройках игры выберите «Полноэкранный в окне» или «Без рамки» (Borderless). Многие игры
              на DirectX 11/12 в Windows 10/11 и в обычном «полноэкранном» режиме пропускают окна поверх — тогда
              ничего менять не нужно.
            </p>
            <ul className="space-y-1">
              {GAMES.map((g) => (
                <li key={g.name}>
                  <span className="font-semibold text-foreground">{g.name}:</span> {g.where}
                </li>
              ))}
            </ul>
            <p>Названия пунктов — как в английской версии игры, в русской они могут звучать иначе.</p>
            <div data-tour="mini-window-check" className="flex items-center gap-3 pt-1">
              <Button size="sm" variant="outline" disabled={checking} onClick={() => void check()}>
                <ScanEye />
                Проверить
              </Button>
              <span>
                {checking
                  ? 'Рамка мини-окна мигает 5 секунд — переключитесь в игру и посмотрите.'
                  : 'Покажет мини-окно и на 5 секунд подсветит его рамку.'}
              </span>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
