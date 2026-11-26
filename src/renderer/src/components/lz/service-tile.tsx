import React from 'react'
import { ChevronRight, Power } from 'lucide-react'
import { cn } from '@renderer/lib/utils'
import { LzPanel } from './panel'
import { LiveNumber } from './live-number'
import { TONE_TEXT, type LzTone } from './tone'

export interface ModuleChip {
  icon?: React.ReactNode
  /** Подпись для подсказки и чтения с экрана (в самом чипе её не видно). */
  label: string
  value: React.ReactNode
  title?: string
  sensitive?: string
  tone?: LzTone
}

interface Props {
  icon: React.ReactNode
  title: string
  tone: LzTone
  /** Главное состояние крупно: «Работает», «Запуск…», «Ошибка». */
  statusText: string
  /** Живые цифры рядом с состоянием: время работы. */
  uptime?: string
  checked: boolean
  onToggle: (next: boolean) => void
  disabled?: boolean
  /** Занятое состояние можно прервать кнопкой. */
  cancelable?: boolean
  /** «Служба дышит»: живой элемент из реальных данных раздела. */
  live?: React.ReactNode
  /** Вторичные сведения компактными чипами. */
  chips: ModuleChip[]
  /** Текст ошибки или пояснение фазы. */
  note?: React.ReactNode
  /** Низ модуля: «нужно действие» или предупреждение (кнопка во всю ширину). */
  footer?: React.ReactNode
  onOpen: () => void
  onHoverChange?: (hover: boolean) => void
  highlighted?: boolean
  className?: string
  'data-tour'?: string
}

/**
 * Модуль службы (язык «Сигнал»). Включённая служба «заливает» модуль светом
 * слева направо, выключенная — матовая. Справа сверху — круглая кнопка питания,
 * в центре — состояние крупно и живые цифры, ниже — живой элемент службы и чипы.
 * Нажатие на модуль открывает раздел, кнопка питания — включает и выключает.
 */
export const ServiceTile: React.FC<Props> = ({
  icon,
  title,
  tone,
  statusText,
  uptime,
  checked,
  onToggle,
  disabled,
  cancelable,
  live,
  chips,
  note,
  footer,
  onOpen,
  onHoverChange,
  highlighted,
  className,
  ...rest
}) => {
  const on = tone === 'on'
  const busy = tone === 'busy'
  const err = tone === 'error'
  const powerDisabled = disabled || (busy && !cancelable)
  return (
    <LzPanel
      role="link"
      tabIndex={0}
      aria-label={`${title}: ${statusText}. Открыть раздел`}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) {
          e.preventDefault()
          onOpen()
        }
      }}
      onMouseEnter={() => onHoverChange?.(true)}
      onMouseLeave={() => onHoverChange?.(false)}
      data-tour={rest['data-tour']}
      className={cn(
        'group @container flex min-w-0 cursor-pointer flex-col p-4 transition-[border-color,box-shadow] duration-300',
        err ? 'border-st-err/55' : on ? 'border-primary/40' : cn('hover:border-primary/35', highlighted && 'border-primary/40'),
        className
      )}
    >
      {/* Заливка состояния: включено — свет слева направо, ошибка — красный край. */}
      {on && (
        <div
          aria-hidden
          className="lz-fill pointer-events-none absolute inset-0"
          style={{
            background:
              'radial-gradient(130% 120% at 0% 0%, color-mix(in oklab, var(--primary) 26%, transparent), color-mix(in oklab, var(--primary) 9%, transparent) 55%, transparent 85%)'
          }}
        />
      )}
      {err && (
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0"
          style={{ background: 'linear-gradient(90deg, color-mix(in oklab, var(--st-err) 16%, transparent), transparent 55%)' }}
        />
      )}
      {busy && (
        <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
          <div
            className="lz-sweep absolute inset-y-0 left-0 w-1/4"
            style={{ background: 'linear-gradient(90deg, transparent, color-mix(in oklab, var(--primary) 22%, transparent), transparent)' }}
          />
        </div>
      )}

      {/* Шапка: значок и название — тихо; кнопка питания — главная. */}
      <div className="flex items-start gap-2.5">
        <div
          className={cn(
            'mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-[10px] transition-colors duration-300 [&_svg]:size-[18px]',
            on ? 'bg-primary/15 text-primary' : err ? 'bg-st-err/12 text-st-err-text' : 'bg-foreground/[0.06] text-muted-foreground'
          )}
        >
          {icon}
        </div>
        <div className="flex min-w-0 flex-1 items-center gap-1 pt-1.5 text-[14px] font-semibold text-foreground/85">
          <span className="truncate">{title}</span>
          <ChevronRight className="size-3.5 shrink-0 text-muted-foreground opacity-0 transition-[opacity,transform] duration-200 group-hover:translate-x-0.5 group-hover:opacity-100" />
        </div>
        <PowerButton
          checked={checked}
          tone={tone}
          disabled={powerDisabled}
          label={checked ? `Выключить ${title}` : `Включить ${title}`}
          onToggle={onToggle}
        />
      </div>

      {/* Главное состояние крупно */}
      <div className="mt-3 flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-1">
        <span className={cn('truncate text-[22px] font-extrabold leading-none tracking-[-0.01em]', on || busy ? 'text-[color:var(--text-title)]' : TONE_TEXT[tone])}>
          {statusText}
        </span>
        {uptime && <LiveNumber value={uptime} className="shrink-0 text-[13px] font-semibold text-primary" />}
      </div>

      {live && <div className="mt-3">{live}</div>}

      {chips.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {chips.map((c) => (
            <span
              key={c.label}
              title={c.title ?? `${c.label}: ${typeof c.value === 'string' ? c.value : ''}`}
              aria-label={`${c.label}: ${typeof c.value === 'string' ? c.value : ''}`}
              className={cn(
                'inline-flex max-w-full min-w-0 items-center gap-1.5 rounded-lg border px-2 py-1 text-[11.5px] font-semibold',
                c.tone === 'warn'
                  ? 'border-st-warn/40 bg-st-warn/10 text-st-warn-text'
                  : 'border-foreground/[0.08] bg-foreground/[0.04] text-foreground/90'
              )}
            >
              {c.icon && <span className="flex shrink-0 text-muted-foreground [&_svg]:size-3.5">{c.icon}</span>}
              <span data-sensitive={c.sensitive} className="truncate">
                {c.value}
              </span>
            </span>
          ))}
        </div>
      )}

      {note && <div className={cn('mt-2.5 line-clamp-2 text-[11.5px] leading-snug', err ? 'text-st-err-text' : 'text-muted-foreground')}>{note}</div>}
      {footer && (
        <div className="mt-3" onClick={(e) => e.stopPropagation()}>
          {footer}
        </div>
      )}
    </LzPanel>
  )
}

/** Круглая кнопка питания: светится, когда служба работает; кольцо крутится при запуске. */
const PowerButton: React.FC<{
  checked: boolean
  tone: LzTone
  disabled?: boolean
  label: string
  onToggle: (next: boolean) => void
}> = ({ checked, tone, disabled, label, onToggle }) => {
  const busy = tone === 'busy'
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={(e) => {
        e.stopPropagation()
        onToggle(!checked)
      }}
      onKeyDown={(e) => e.stopPropagation()}
      className={cn(
        'relative flex size-12 shrink-0 cursor-pointer items-center justify-center rounded-full border-2 transition-[background-color,border-color,box-shadow,color] duration-300 disabled:cursor-not-allowed disabled:opacity-55',
        checked && !busy
          ? 'border-transparent bg-primary text-primary-foreground'
          : tone === 'error'
            ? 'border-st-err/50 bg-st-err/10 text-st-err-text hover:bg-st-err/15'
            : 'border-foreground/15 bg-foreground/[0.04] text-muted-foreground hover:border-primary/50 hover:text-primary'
      )}
      style={
        checked && !busy
          ? { boxShadow: '0 0 0 4px color-mix(in oklab, var(--primary) 18%, transparent), 0 6px 22px color-mix(in oklab, var(--primary) 45%, transparent)' }
          : undefined
      }
    >
      {busy && (
        <span
          aria-hidden
          className="lz-spin absolute -inset-[3px] rounded-full border-2 border-transparent"
          style={{ borderTopColor: 'var(--primary)', borderRightColor: 'color-mix(in oklab, var(--primary) 40%, transparent)' }}
        />
      )}
      <Power className="size-5" strokeWidth={2.4} />
    </button>
  )
}

export default ServiceTile
