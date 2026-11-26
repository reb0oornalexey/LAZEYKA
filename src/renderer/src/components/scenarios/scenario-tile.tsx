import React, { useEffect, useState } from 'react'
import { Link2, Pencil, Play, RotateCw, Trash2 } from 'lucide-react'
import { LzPanel } from '@renderer/components/lz'
import { ScenarioIcon } from '@renderer/components/scenario-icon'
import type { FullScenario } from '@renderer/lib/scenario-extra'
import { cn, pluralRu } from '@renderer/lib/utils'
import { platform } from '@renderer/utils/init'
import { ACTION_BY_ID, chipsOf, type Ctx, type StepChip } from './actions'
import './scenarios.css'

const isMac = platform === 'darwin'

export type LastRun = { id: string; at: number; ok: boolean } | null

function capLabel(part: string): string {
  if (part === 'CommandOrControl' || part === 'Control') return isMac ? '⌃' : 'Ctrl'
  if (part === 'Command' || part === 'Super' || part === 'Meta') return isMac ? '⌘' : 'Win'
  if (part === 'Alt') return isMac ? '⌥' : 'Alt'
  if (part === 'Shift') return isMac ? '⇧' : 'Shift'
  if (part === 'Space') return 'Пробел'
  return part
}

/** Горячая клавиша строкой для текста: «Ctrl + Alt + 1». */
export function hotkeyText(hotkey: string): string {
  return hotkey.split('+').map(capLabel).join(' + ')
}

/** Горячая клавиша клавишами: «Ctrl + Alt + 1». */
export const Keys: React.FC<{ hotkey: string; className?: string }> = ({ hotkey, className }) => (
  <span className={cn('inline-flex items-center gap-1', className)} aria-label={`Горячая клавиша ${hotkey}`}>
    {hotkey.split('+').map((p, i) => (
      <kbd
        key={i}
        className="inline-flex h-[22px] min-w-[22px] items-center justify-center rounded-md border border-foreground/[0.12] border-b-foreground/25 bg-foreground/[0.05] px-1.5 font-sans text-[11px] font-bold text-foreground/85 [border-bottom-width:2px]"
      >
        {capLabel(p)}
      </kbd>
    ))}
  </span>
)

/** Чип шага: значок действия, название и подробность. Включение — значок цвета темы, выключение — серый. */
export const StepChipView: React.FC<{ chip: StepChip; className?: string }> = ({ chip, className }) => {
  const Icon = ACTION_BY_ID[chip.id].icon
  return (
    <span
      className={cn(
        'inline-flex h-6 min-w-0 max-w-full items-center gap-1.5 rounded-md border border-foreground/[0.08] bg-foreground/[0.035] px-1.5 text-[11.5px]',
        className
      )}
    >
      <Icon className={cn('size-3.5 shrink-0', chip.tone === 'off' ? 'text-muted-foreground opacity-70' : 'text-primary')} />
      <span className={cn('shrink-0 font-semibold', chip.tone === 'off' ? 'text-muted-foreground' : 'text-foreground/90')}>{chip.label}</span>
      {chip.detail && (
        <span data-sensitive={chip.sensitive} className="truncate text-muted-foreground">
          {chip.detail}
        </span>
      )}
    </span>
  )
}

interface Props {
  s: FullScenario
  ctx: Ctx
  last?: LastRun
  running?: boolean
  /** Другой сценарий сейчас применяется. */
  blocked?: boolean
  onRun?: () => void
  onEdit?: () => void
  onLink?: () => void
  onDelete?: () => void
  onHover?: (h: boolean) => void
  highlighted?: boolean
  /** Предпросмотр в конструкторе: без кнопок и нажатий. */
  preview?: boolean
  className?: string
}

const MAX_CHIPS = 4

/**
 * Плитка сценария. Слева крупный значок, название и клавиши; справа круглая
 * кнопка запуска. Ниже — что сделает сценарий, чипами по шагам. Последний
 * запущенный сценарий горит полосой сверху, применяемый — бегущим светом.
 */
export const ScenarioTile: React.FC<Props> = ({
  s,
  ctx,
  last,
  running,
  blocked,
  onRun,
  onEdit,
  onLink,
  onDelete,
  onHover,
  highlighted,
  preview,
  className
}) => {
  const chips = chipsOf(s, ctx)
  const shown = chips.slice(0, MAX_CHIPS)
  const more = chips.length - shown.length
  const isLast = !!last && last.id === s.id
  const lit = isLast && last.ok && !running
  const warn = isLast && !last.ok && !running
  const [confirm, setConfirm] = useState(false)
  useEffect(() => {
    if (!confirm) return
    const t = setTimeout(() => setConfirm(false), 3500)
    return () => clearTimeout(t)
  }, [confirm])

  const time = isLast ? new Date(last.at).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }) : ''
  const status = running
    ? 'Применяю…'
    : lit
      ? `Применён в ${time}`
      : warn
        ? `Не всё получилось в ${time}`
        : chips.length
          ? `${chips.length} ${pluralRu(chips.length, 'шаг', 'шага', 'шагов')}`
          : 'Шагов пока нет'

  return (
    <LzPanel
      tone={lit ? 'on' : warn ? 'warn' : 'off'}
      glow={11}
      role={preview ? undefined : 'button'}
      tabIndex={preview ? undefined : 0}
      aria-label={preview ? undefined : `${s.name}: изменить`}
      onClick={preview ? undefined : onEdit}
      onKeyDown={(e) => {
        if (preview || e.target !== e.currentTarget) return
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onEdit?.()
        }
      }}
      onMouseEnter={() => onHover?.(true)}
      onMouseLeave={() => onHover?.(false)}
      className={cn(
        'group flex min-w-0 flex-col p-4 transition-[border-color] duration-300',
        !preview && 'cursor-pointer',
        warn ? 'border-st-warn/45' : lit || highlighted ? 'border-primary/40' : !preview && 'hover:border-primary/35',
        className
      )}
    >
      {/* Полоса сигнала сверху: последний запуск. */}
      {(lit || warn) && (
        <span
          aria-hidden
          className={cn('lz-ignite absolute inset-x-5 top-0 h-[3px] rounded-b-full', lit ? 'bg-primary' : 'bg-st-warn')}
          style={lit ? { boxShadow: '0 0 14px color-mix(in oklab, var(--primary) 70%, transparent)' } : undefined}
        />
      )}
      {running && (
        <span aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
          <span
            className="lz-sweep absolute inset-y-0 left-0 w-1/4"
            style={{ background: 'linear-gradient(90deg, transparent, color-mix(in oklab, var(--primary) 22%, transparent), transparent)' }}
          />
        </span>
      )}

      <div className="flex items-start gap-3">
        <span className="flex size-12 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-foreground/[0.08] bg-foreground/[0.045]">
          <ScenarioIcon icon={s.icon} emoji={s.emoji} className="size-8 text-[28px]" />
        </span>
        <div className="min-w-0 flex-1 pt-0.5">
          <div className="truncate text-[16px] font-bold leading-tight text-[color:var(--text-title)]">{s.name || 'Без названия'}</div>
          <div className="mt-1.5 flex h-[22px] items-center">
            {s.hotkey ? (
              <Keys hotkey={s.hotkey} />
            ) : (
              <span className="text-[11.5px] text-muted-foreground">Без горячей клавиши</span>
            )}
          </div>
        </div>
        <RunButton running={!!running} lit={lit} disabled={preview || blocked} name={s.name} onRun={onRun} again={isLast} />
      </div>

      <div className="mt-3 flex flex-wrap gap-1">
        {shown.map((c) => (
          <StepChipView key={c.id} chip={c} />
        ))}
        {more > 0 && (
          <span
            className="inline-flex h-6 items-center rounded-md border border-dashed border-foreground/15 px-1.5 text-[11.5px] font-semibold text-muted-foreground"
            title={chips
              .slice(MAX_CHIPS)
              .map((c) => `${c.label}${c.detail ? ` · ${c.detail}` : ''}`)
              .join('\n')}
          >
            ещё {more}
          </span>
        )}
        {chips.length === 0 && (
          <span className="inline-flex h-6 items-center rounded-md border border-dashed border-foreground/15 px-1.5 text-[11.5px] text-muted-foreground">
            ничего не меняет
          </span>
        )}
      </div>

      <div className="mt-auto flex min-h-7 items-center justify-between gap-2 pt-2.5">
        <span
          className={cn(
            'flex min-w-0 items-center gap-1.5 truncate text-[11.5px]',
            lit ? 'font-semibold text-primary' : warn ? 'font-semibold text-st-warn-text' : 'text-muted-foreground'
          )}
        >
          {(lit || warn || running) && (
            <span aria-hidden className={cn('relative size-1.5 shrink-0 rounded-full', lit && 'lz-beacon text-primary', lit || running ? 'bg-primary' : 'bg-st-warn')} />
          )}
          {status}
        </span>
        {!preview && (
          <span
            className="flex shrink-0 items-center gap-0.5 opacity-60 transition-opacity duration-200 group-hover:opacity-100 group-focus-within:opacity-100"
            onClick={(e) => e.stopPropagation()}
            onKeyDown={stopActivate}
          >
            <TileBtn label="Изменить" onClick={onEdit}>
              <Pencil />
            </TileBtn>
            <TileBtn label="Скопировать ссылку сценария — для кнопки Stream Deck или ярлыка на рабочем столе" onClick={onLink}>
              <Link2 />
            </TileBtn>
            {confirm ? (
              <button
                type="button"
                onClick={() => {
                  setConfirm(false)
                  onDelete?.()
                }}
                className="h-7 cursor-pointer rounded-lg bg-st-err/15 px-2 text-[11.5px] font-semibold text-st-err-text transition-colors hover:bg-st-err/25"
              >
                Удалить?
              </button>
            ) : (
              <TileBtn label="Удалить" onClick={() => setConfirm(true)}>
                <Trash2 />
              </TileBtn>
            )}
          </span>
        )}
      </div>
    </LzPanel>
  )
}

/** Enter и пробел на кнопке не должны открывать плитку; остальные клавиши (Esc) идут дальше. */
function stopActivate(e: React.KeyboardEvent): void {
  if (e.key === 'Enter' || e.key === ' ') e.stopPropagation()
}

const TileBtn: React.FC<{ label: string; onClick?: () => void; children: React.ReactNode }> = ({ label, onClick, children }) => (
  <button
    type="button"
    title={label}
    aria-label={label}
    onClick={onClick}
    className="flex size-7 cursor-pointer items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-foreground/[0.07] hover:text-foreground [&_svg]:size-3.5"
  >
    {children}
  </button>
)

/** Круглая кнопка запуска. У последнего применённого сценария залита цветом темы. */
const RunButton: React.FC<{ running: boolean; lit: boolean; again: boolean; disabled?: boolean; name: string; onRun?: () => void }> = ({
  running,
  lit,
  again,
  disabled,
  name,
  onRun
}) => {
  const label = running ? `«${name}» применяется` : again ? `Применить «${name}» снова` : `Запустить «${name}»`
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled || running}
      onClick={(e) => {
        e.stopPropagation()
        onRun?.()
      }}
      onKeyDown={stopActivate}
      className={cn(
        'sc-run relative flex size-11 shrink-0 cursor-pointer items-center justify-center rounded-full border-2 transition-[background-color,border-color,box-shadow,color,transform] duration-300 disabled:cursor-default',
        lit
          ? 'border-transparent bg-primary text-primary-foreground'
          : running
            ? 'border-primary/30 bg-primary/10 text-primary'
            : 'border-primary/45 bg-primary/10 text-primary hover:border-transparent hover:bg-primary hover:text-primary-foreground disabled:border-foreground/15 disabled:bg-foreground/[0.04] disabled:text-muted-foreground'
      )}
      style={lit ? { boxShadow: '0 0 0 4px color-mix(in oklab, var(--primary) 16%, transparent), 0 6px 20px color-mix(in oklab, var(--primary) 40%, transparent)' } : undefined}
    >
      {running && (
        <span
          aria-hidden
          className="lz-spin absolute -inset-[3px] rounded-full border-2 border-transparent"
          style={{ borderTopColor: 'var(--primary)', borderRightColor: 'color-mix(in oklab, var(--primary) 40%, transparent)' }}
        />
      )}
      {again && !running ? <RotateCw className="size-[18px]" strokeWidth={2.4} /> : <Play className="ml-0.5 size-[18px] fill-current" strokeWidth={2.2} />}
    </button>
  )
}

export default ScenarioTile
