import React, { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { ChevronDown, Eye, Layers, LayoutPanelTop, Pin, PictureInPicture2, ScanEye, CircleDot } from 'lucide-react'
import { Button } from '@renderer/components/ui/button'
import { Segmented, type SegmentedItem } from '@renderer/components/lz'
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
import { RangeField, Rows, SettingRow, SettingsGroup, SwitchRow } from './setting-row'

/*
 * Настройки → «Мини-окно поверх игры» на языке «Сигнал». Та же логика, что в
 * components/mini-window-card.tsx (карточку по-прежнему показывает «Перед
 * каткой»): показ, вид (индикатор / панель), закрепление и прозрачность.
 * Состояние берётся из главного процесса и обновляется событием mini:changed.
 */

const HINT =
  'Маленькое окно поверх остальных. Это обычное окно программы: в игру оно не встраивается, поэтому античиту не за что его считать вмешательством. Поверх игры в эксклюзивном полноэкранном режиме его не видно — подробности ниже, в «Не видно поверх игры?».'

const GAMES: { name: string; where: string }[] = [
  { name: 'CS2', where: 'Settings → Video → Display Mode: любой режим со словом «Windowed», не просто «Fullscreen»' },
  { name: 'Dota 2', where: 'Settings → Video → Display Mode: «Borderless Window» вместо «Exclusive Fullscreen»' },
  { name: 'Valorant', where: 'Settings → Video → General → Display Mode: «Windowed Fullscreen»' },
  { name: 'Fortnite', where: 'Settings → Display → Window Mode: «Windowed Fullscreen»' },
  { name: 'Apex Legends', where: 'Settings → Video → Display Mode: «Borderless Window»' }
]

const MODES: SegmentedItem<MiniMode>[] = [
  { id: 'indicator', label: 'Индикатор', icon: CircleDot, title: 'Только то, что включено, зелёными точками. Без кнопок' },
  { id: 'panel', label: 'Панель', icon: LayoutPanelTop, title: 'Переключатели служб и пинг игровой сессии' }
]

export const MiniWindowGroup: React.FC<{ hotkey?: string; onOpenKeys?: () => void }> = ({ hotkey, onOpenKeys }) => {
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

  const fail = (e: unknown): void => {
    toast.error('Не удалось изменить мини-окно', { description: e instanceof Error ? e.message : String(e) })
  }

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

  const toggle = async (next: boolean): Promise<void> => {
    if (busy) return
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
    <SettingsGroup
      data-tour="mini-window"
      title="Мини-окно поверх игры"
      hint={HINT}
      sub={open ? (indicator ? 'Показано: индикатор' : 'Показано: панель') : 'Скрыто'}
    >
      <Rows>
        <SwitchRow
          id="mini-show"
          icon={<PictureInPicture2 />}
          title="Показывать мини-окно"
          desc={
            <>
              Маленькое окно с переключателями поверх остальных.{' '}
              {hotkey ? (
                <>Клавиша: {hotkey.split('+').join(' + ')}</>
              ) : (
                onOpenKeys && (
                  <button type="button" onClick={onOpenKeys} className="cursor-pointer font-medium text-primary underline-offset-2 hover:underline">
                    Назначить клавишу
                  </button>
                )
              )}
            </>
          }
          checked={open}
          disabled={busy}
          onChange={(v) => void toggle(v)}
        />
        <SettingRow
          id="mini-mode"
          data-tour="mini-window-modes"
          icon={<Layers />}
          on
          title="Вид"
          desc={indicator ? 'Только то, что включено, зелёными точками. Без кнопок.' : 'Переключатели служб и пинг игровой сессии.'}
          control={<Segmented size="sm" className="w-[230px]" items={MODES} value={st.mode} onChange={(m) => m !== st.mode && apply({ mode: m })} aria-label="Вид мини-окна" />}
        />
        {indicator && (
          <SwitchRow
            id="mini-lock"
            icon={<Pin />}
            title="Закрепить на месте"
            hint="Закреплённый индикатор пропускает клики сквозь себя, поэтому не мешает в игре. Чтобы передвинуть его, снимите закрепление, перетащите за плашку и закрепите снова."
            desc="Клики проходят сквозь индикатор"
            checked={st.locked}
            onChange={(v) => apply({ locked: v })}
          />
        )}
        <SettingRow
          id="mini-opacity"
          icon={<Eye />}
          on={opacity < MINI_MAX_OPACITY}
          title="Прозрачность"
          desc={indicator ? 'Для индикатора и панели запоминается отдельно' : 'Для панели и индикатора запоминается отдельно'}
          below={
            <RangeField
              label="Прозрачность мини-окна"
              min={indicator ? MINI_IND_MIN_OPACITY : MINI_MIN_OPACITY}
              max={MINI_MAX_OPACITY}
              value={opacity}
              onChange={changeOpacity}
            />
          }
        />
        <div data-setting="mini-help" data-tour="mini-window-fullscreen-help" className="px-3 py-3">
          <div className="rounded-xl border border-foreground/[0.08]">
            <button
              type="button"
              onClick={() => setHelpOpen((v) => !v)}
              aria-expanded={helpOpen}
              className="flex w-full cursor-pointer items-center justify-between gap-2 px-3 py-2.5 text-left text-[12.5px] font-semibold text-foreground"
            >
              Не видно поверх игры?
              <ChevronDown className={cn('size-3.5 text-muted-foreground transition-transform', helpOpen && 'rotate-180')} />
            </button>
            {helpOpen && (
              <div className="space-y-2 border-t border-foreground/[0.07] px-3 pt-2 pb-3 text-[12px] leading-relaxed text-muted-foreground">
                <p>
                  Мини-окно — обычное окно поверх остальных. В игру оно не встраивается, поэтому и банить за него не за что. Обратная сторона: в
                  эксклюзивном полноэкранном режиме игра занимает экран целиком, и обычные окна поверх неё не видны. Так же ведут себя прицелы и
                  другие окна-накладки без встраивания.
                </p>
                <p>
                  Что делать: в настройках игры выберите «Полноэкранный в окне» или «Без рамки» (Borderless). Многие игры на DirectX 11/12 в Windows
                  10/11 и в обычном «полноэкранном» режиме пропускают окна поверх — тогда ничего менять не нужно.
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
                    {checking ? 'Рамка мини-окна мигает 5 секунд — переключитесь в игру и посмотрите.' : 'Покажет мини-окно и на 5 секунд подсветит его рамку.'}
                  </span>
                </div>
              </div>
            )}
          </div>
        </div>
      </Rows>
    </SettingsGroup>
  )
}

export default MiniWindowGroup
