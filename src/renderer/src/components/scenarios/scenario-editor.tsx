import React, { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { toast } from 'sonner'
import { Check, Keyboard, Link2, Loader2, Pencil, Play, Plus, Sparkles, X } from 'lucide-react'
import { LzSectionHead } from '@renderer/components/lz'
import { Button } from '@renderer/components/ui/button'
import { HotkeyInput } from '@renderer/components/hotkeys-card'
import { EmojiGlyph, ScenarioIcon, ScenarioIconPicker } from '@renderer/components/scenario-icon'
import type { FullScenario } from '@renderer/lib/scenario-extra'
import { cn, pluralRu } from '@renderer/lib/utils'
import { ACTION_BY_ID, chipsOf, getValue, setValue, stepsOf, withOrder, TEMPLATES, type ActionId } from './actions'
import { ActionPalette } from './action-palette'
import { StepCard, type StepData } from './step-card'
import { ScenarioTile, StepChipView } from './scenario-tile'
import './scenarios.css'

interface Props {
  initial: FullScenario
  data: StepData
  onClose: () => void
  /** Сохранить; run — сразу запустить. Возвращает false, если не сохранилось. */
  onSave: (s: FullScenario, run: boolean) => Promise<boolean>
  onCopyLink: (id: string) => void
}

type Sheet = null | 'palette' | 'icons'

/**
 * Конструктор сценария «Когда… → Сделать…». Слева — как запускать (кнопка,
 * горячая клавиша, ссылка) и живой предпросмотр плитки. Справа — шаги по
 * порядку выполнения на линии сигнала; новые берутся из палитры действий.
 * Новый сценарий начинается с выбора шаблона или чистого листа.
 */
export const ScenarioEditor: React.FC<Props> = ({ initial, data, onClose, onSave, onCopyLink }) => {
  const [s, setS] = useState<FullScenario>(initial)
  const isNew = !initial.id
  const [stage, setStage] = useState<'start' | 'build'>(isNew && !initial.name && stepsOf(initial).length === 0 ? 'start' : 'build')
  const [sheet, setSheet] = useState<Sheet>(null)
  const [flash, setFlash] = useState<ActionId | null>(null)
  const [saving, setSaving] = useState<null | 'save' | 'run'>(null)
  const nameRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLOListElement>(null)
  const dialogRef = useRef<HTMLDivElement>(null)

  // Фокус — внутрь окна: клавиатура работает в конструкторе, а не на странице под ним.
  useEffect(() => dialogRef.current?.focus(), [])
  const steps = stepsOf(s)
  const dirty = useMemo(() => JSON.stringify(s) !== JSON.stringify(initial), [s, initial])
  const ctx = { nodes: data.nodes, dns: data.dns }

  // Esc: сначала закрывает палитру или выбор значка, потом окно. Во время записи клавиши HotkeyInput
  // ловит Esc раньше (на погружении) и останавливает событие — окно не закроется.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return
      if (sheet) setSheet(null)
      else onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [sheet, onClose])

  useEffect(() => {
    if (!flash) return
    listRef.current?.querySelector(`[data-step="${flash}"]`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
    const t = setTimeout(() => setFlash(null), 1000)
    return () => clearTimeout(t)
  }, [flash])

  // Свой порядок шагов: перетаскивание и стрелки. Новый шаг встаёт в конец — как его и видно в списке.
  const [drag, setDrag] = useState<{ id: ActionId; over: ActionId | null; where: 'before' | 'after' } | null>(null)
  const moveTo = (id: ActionId, target: ActionId, where: 'before' | 'after'): void => {
    if (id === target) return
    const rest = steps.filter((x) => x !== id)
    const at = rest.indexOf(target) + (where === 'after' ? 1 : 0)
    rest.splice(at, 0, id)
    setS(withOrder(s, rest))
  }
  const moveBy = (id: ActionId, delta: -1 | 1): void => {
    const i = steps.indexOf(id)
    const j = i + delta
    if (i < 0 || j < 0 || j >= steps.length) return
    const next = [...steps]
    ;[next[i], next[j]] = [next[j], next[i]]
    setS(withOrder(s, next))
    setFlash(id)
  }

  const pick = (id: ActionId): void => {
    if (getValue(s, id) === 'keep') setS(withOrder(setValue(s, id, ACTION_BY_ID[id].initial), [...steps, id]))
    setSheet(null)
    setStage('build')
    setFlash(id)
  }

  const save = async (run: boolean): Promise<void> => {
    if (!s.name.trim()) {
      toast.error('Назовите сценарий', { description: 'Название видно на плитке и в уведомлении после запуска.' })
      nameRef.current?.focus()
      return
    }
    setSaving(run ? 'run' : 'save')
    try {
      await onSave({ ...s, name: s.name.trim() }, run)
    } finally {
      setSaving(null)
    }
  }

  return createPortal(
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/55 p-4 backdrop-blur-sm"
      onMouseDown={(e) => {
        // Случайный щелчок мимо окна не теряет изменения: закрывает только нетронутое.
        if (e.target === e.currentTarget && !dirty) onClose()
      }}
    >
      <div
        ref={dialogRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label={isNew ? 'Новый сценарий' : 'Изменить сценарий'}
        className="sc-dialog-in flex h-[min(90vh,780px)] outline-none w-[min(1080px,100%)] flex-col overflow-hidden rounded-[calc(var(--radius)+10px)] border border-border bg-[color:var(--popover)] text-popover-foreground shadow-2xl"
      >
        {/* Шапка: значок и название — так сценарий будет выглядеть везде. */}
        <div className="flex shrink-0 items-center gap-4 border-b border-foreground/[0.07] px-6 py-4">
          <button
            type="button"
            title="Сменить значок"
            aria-label="Сменить значок"
            data-tour="scenario-icon"
            onClick={() => setSheet(sheet === 'icons' ? null : 'icons')}
            className={cn(
              'group relative flex size-14 shrink-0 cursor-pointer items-center justify-center rounded-2xl border bg-foreground/[0.045] transition-colors',
              sheet === 'icons' ? 'border-primary/60' : 'border-foreground/[0.1] hover:border-primary/45'
            )}
          >
            <ScenarioIcon icon={s.icon} emoji={s.emoji} className="size-9 text-[32px]" />
            <span className="absolute -bottom-1 -right-1 flex size-5 items-center justify-center rounded-full border border-border bg-[color:var(--popover)] text-muted-foreground transition-colors group-hover:text-primary">
              <Pencil className="size-2.5" />
            </span>
          </button>
          <div className="min-w-0 flex-1">
            <input
              ref={nameRef}
              value={s.name}
              maxLength={40}
              onChange={(e) => setS({ ...s, name: e.target.value })}
              placeholder={stage === 'start' ? 'Новый сценарий' : 'Название сценария'}
              aria-label="Название сценария"
              className="w-full rounded-lg border border-transparent bg-transparent px-1.5 py-0.5 text-[22px] font-extrabold tracking-[-0.01em] text-[color:var(--text-title)] outline-none placeholder:text-muted-foreground/60 hover:border-foreground/[0.08] focus:border-primary/45"
            />
            <div className="px-1.5 text-[12px] text-muted-foreground">
              {stage === 'start'
                ? 'Возьмите готовый набор или соберите свой — потом всё можно поменять'
                : steps.length
                  ? `${steps.length} ${pluralRu(steps.length, 'шаг', 'шага', 'шагов')} — выполняются сверху вниз`
                  : 'Добавьте действия, которые сценарий сделает одной кнопкой'}
            </div>
          </div>
          <button
            type="button"
            aria-label="Закрыть"
            onClick={onClose}
            className="flex size-9 shrink-0 cursor-pointer items-center justify-center rounded-xl text-muted-foreground hover:bg-foreground/[0.06] hover:text-foreground"
          >
            <X className="size-4" />
          </button>
        </div>

        <div className="grid min-h-0 flex-1 grid-cols-[320px_minmax(0,1fr)]">
          {/* Когда */}
          <aside className="min-h-0 space-y-3 overflow-y-auto border-r border-foreground/[0.07] px-5 py-4">
            <LzSectionHead title="Когда" hint="Сценарий запускается любым из этих способов. Горячая клавиша работает и когда окно свёрнуто в трей." />
            <Trigger icon={<Play className="fill-current" />} title="Кнопкой" text="Круглая кнопка ▶ на плитке" right={<Check className="size-4 text-primary" strokeWidth={3} />} />
            <Trigger icon={<Keyboard />} title="Горячей клавишей" text="Из любой программы, даже когда окно в трее" data-tour="scenario-hotkey">
              <div className="-mx-1 mt-1.5 flex justify-start [&>span>button]:justify-start">
                <HotkeyInput value={s.hotkey} onChange={(v) => setS((x) => ({ ...x, hotkey: v }))} />
              </div>
            </Trigger>
            <Trigger
              icon={<Link2 />}
              title="Ссылкой"
              text={s.id ? 'Для кнопки Stream Deck или ярлыка на рабочем столе' : 'Ссылка появится после сохранения'}
              right={
                <Button size="sm" variant="outline" className="h-7 shrink-0 rounded-lg px-2.5 text-[11.5px]" disabled={!s.id} onClick={() => onCopyLink(s.id)}>
                  Копировать
                </Button>
              }
            />
            <div className="pt-2">
              <div className="mb-2 text-[12px] text-muted-foreground">Так сценарий будет выглядеть</div>
              <ScenarioTile s={{ ...s, name: s.name || 'Новый сценарий' }} ctx={ctx} preview />
            </div>
          </aside>

          {/* Сделать */}
          <section className="relative flex min-h-0 flex-col">
            {stage === 'start' ? (
              <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4" data-tour="scenario-templates">
                <LzSectionHead title="С чего начать" hint="Шаблон только заполняет конструктор: ничего не включается, пока вы не сохраните и не запустите сценарий." />
                <div className="mt-3 grid grid-cols-2 gap-2.5">
                  {TEMPLATES.map((t) => {
                    const built = t.build(data.strategies)
                    return (
                      <button
                        key={t.key}
                        type="button"
                        onClick={() => {
                          setS({ ...built, id: s.id, hotkey: s.hotkey, name: s.name.trim() ? s.name : built.name })
                          setStage('build')
                        }}
                        className="group flex min-w-0 cursor-pointer flex-col gap-2 rounded-2xl border border-foreground/[0.08] bg-foreground/[0.03] p-3.5 text-left transition-colors hover:border-primary/45 hover:bg-foreground/[0.05]"
                      >
                        <span className="flex items-start gap-2.5">
                          <EmojiGlyph emoji={built.emoji} className="size-8 text-[26px]" />
                          <span className="min-w-0">
                            <span className="block truncate text-[14.5px] font-bold text-foreground">{built.name}</span>
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
                  <button
                    type="button"
                    onClick={() => {
                      setStage('build')
                      setTimeout(() => nameRef.current?.focus(), 0)
                    }}
                    className="col-span-2 flex cursor-pointer items-center justify-center gap-2 rounded-2xl border border-dashed border-foreground/20 p-3.5 text-[13px] font-semibold text-muted-foreground transition-colors hover:border-primary/50 hover:text-primary"
                  >
                    <Plus className="size-4" />С чистого листа
                  </button>
                </div>
              </div>
            ) : (
              <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4" data-tour="scenario-extra">
                <LzSectionHead
                  title="Сделать"
                  hint="Шаги выполняются сверху вниз в этом порядке. Порядок можно менять: перетащите шаг за ручку ⋮⋮ или нажмите стрелки ▲▼. Если шаг не получился, остальные всё равно выполнятся, а в уведомлении будет видно, что пошло не так."
                  right={
                    steps.length > 0 && (
                      <Button size="sm" variant="outline" className="h-8 rounded-xl" onClick={() => setSheet('palette')} data-tour="scenario-add">
                        <Plus className="size-3.5" />
                        Добавить действие
                      </Button>
                    )
                  }
                />
                {steps.length === 0 ? (
                  <button
                    type="button"
                    onClick={() => setSheet('palette')}
                    data-tour="scenario-add"
                    className="mt-3 flex w-full cursor-pointer flex-col items-center gap-2 rounded-2xl border border-dashed border-foreground/20 px-6 py-10 text-center transition-colors hover:border-primary/50"
                  >
                    <span className="flex size-12 items-center justify-center rounded-full border border-dashed border-primary/50 text-primary">
                      <Plus className="size-5" />
                    </span>
                    <span className="text-[14px] font-bold text-foreground">Добавить первое действие</span>
                    <span className="max-w-[44ch] text-[12px] leading-snug text-muted-foreground">
                      Zapret, VPN, ExitLag, Telegram, DNS, режим стримера, мини-окно, раздача, «Перед каткой» и Discord
                    </span>
                  </button>
                ) : (
                  <ol ref={listRef} className="mt-3">
                    {steps.map((id, i) => (
                      <StepCard
                        key={id}
                        id={id}
                        index={i}
                        last={i === steps.length - 1}
                        s={s}
                        data={data}
                        flash={flash === id}
                        onChange={setS}
                        onRemove={() => setS(withOrder(setValue(s, id, 'keep'), steps.filter((x) => x !== id)))}
                        reorder={{
                          first: i === 0,
                          dragging: drag?.id === id,
                          over: drag && drag.id !== id && drag.over === id ? drag.where : null,
                          onMove: (d) => moveBy(id, d),
                          onDragStart: () => setDrag({ id, over: null, where: 'before' }),
                          onDragOver: (where) => setDrag((x) => (x ? { ...x, over: id, where } : x)),
                          onDrop: () => {
                            if (drag) moveTo(drag.id, id, drag.where)
                            setDrag(null)
                          },
                          onDragEnd: () => setDrag(null)
                        }}
                      />
                    ))}
                    <li className="relative pl-12">
                      <button
                        type="button"
                        onClick={() => setSheet('palette')}
                        className="flex h-11 w-full cursor-pointer items-center gap-2 rounded-2xl border border-dashed border-foreground/15 px-3.5 text-[12.5px] font-semibold text-muted-foreground transition-colors hover:border-primary/50 hover:text-primary"
                      >
                        <Plus className="size-4" />
                        Добавить действие
                      </button>
                    </li>
                  </ol>
                )}
              </div>
            )}

            {sheet === 'palette' && <ActionPalette s={s} onPick={pick} onClose={() => setSheet(null)} />}
            {sheet === 'icons' && (
              <div className="sc-sheet-in absolute inset-0 z-10 flex flex-col bg-[color:var(--popover)]" data-tour="scenario-icon-picker">
                <div className="flex shrink-0 items-center justify-between gap-2 px-5 pb-2 pt-4">
                  <LzSectionHead title="Значок" hint="Эмодзи, значок программы или игры, простой значок в цвет темы или картинка из файла." />
                  <Button size="sm" className="h-8 rounded-xl" onClick={() => setSheet(null)}>
                    Готово
                  </Button>
                </div>
                <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-5">
                  <ScenarioIconPicker icon={s.icon} emoji={s.emoji} onChange={(v) => setS((x) => ({ ...x, ...v, icon: v.icon }))} />
                </div>
              </div>
            )}
          </section>
        </div>

        <div className="flex shrink-0 items-center gap-2 border-t border-foreground/[0.07] px-6 py-3">
          <span className="mr-auto flex min-w-0 items-center gap-1.5 truncate text-[12px] text-muted-foreground">
            {dirty ? (
              <>
                <Sparkles className="size-3.5 shrink-0 text-primary" />
                Есть несохранённые изменения
              </>
            ) : isNew ? (
              'Сценарий ещё не сохранён'
            ) : (
              'Изменений нет'
            )}
          </span>
          <Button variant="ghost" onClick={onClose}>
            Отмена
          </Button>
          <Button variant="outline" disabled={saving !== null || steps.length === 0} onClick={() => void save(true)} title="Сохранить и сразу выполнить шаги">
            {saving === 'run' ? <Loader2 className="size-4 animate-spin" /> : <Play className="size-4" />}
            Сохранить и запустить
          </Button>
          <Button disabled={saving !== null} onClick={() => void save(false)}>
            {saving === 'save' ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}
            Сохранить
          </Button>
        </div>
      </div>
    </div>,
    document.body
  )
}

const Trigger: React.FC<{
  icon: React.ReactNode
  title: string
  text: string
  right?: React.ReactNode
  children?: React.ReactNode
  'data-tour'?: string
}> = ({ icon, title, text, right, children, ...rest }) => (
  <div data-tour={rest['data-tour']} className="rounded-xl border border-foreground/[0.08] bg-foreground/[0.03] p-3">
    <div className="flex items-center gap-2.5">
      <span className="flex size-8 shrink-0 items-center justify-center rounded-[10px] bg-primary/12 text-primary [&_svg]:size-4">{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block text-[13px] font-bold text-foreground">{title}</span>
        <span className="block text-[11.5px] leading-snug text-muted-foreground">{text}</span>
      </span>
      {right}
    </div>
    {children}
  </div>
)

export default ScenarioEditor
