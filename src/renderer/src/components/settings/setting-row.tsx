import React from 'react'
import { Switch } from '@renderer/components/ui/switch'
import { Hint } from '@renderer/components/prematch/hint'
import { LzPanel, LzSectionHead } from '@renderer/components/lz'
import { cn } from '@renderer/lib/utils'
import './settings.css'

/*
 * Единая «строка настройки» раздела «Настройки» (Е5): значок, название,
 * короткое пояснение, «i» с подробной подсказкой, элемент управления справа.
 * Включённая настройка «горит»: значок в цвете темы. Выключенная — матовая.
 *
 * У каждой строки есть id (data-setting): по нему поиск и ссылки находят
 * строку, раскрывают её группу и подсвечивают её.
 */

type DataAttrs = { [k: `data-${string}`]: string | undefined }

interface RowProps extends DataAttrs {
  /** Ключ строки для поиска (совпадает с id в settings-catalog.ts). */
  id: string
  icon: React.ReactNode
  title: React.ReactNode
  desc?: React.ReactNode
  hint?: string
  /** Элемент справа (переключатель, кнопка, выпадашка). */
  control?: React.ReactNode
  /** Состояние «включено» — значок горит цветом темы. */
  on?: boolean
  /** Нажатие на строку (вне кнопок) переключает настройку. */
  onToggle?: () => void
  disabled?: boolean
  /** Под строкой: дополнительный блок во всю ширину (ползунок, пояснение). */
  below?: React.ReactNode
  className?: string
}

export const SettingRow: React.FC<RowProps> = ({ id, icon, title, desc, hint, control, on, onToggle, disabled, below, className, ...rest }) => {
  const clickable = Boolean(onToggle) && !disabled
  return (
    <div
      {...rest}
      data-setting={id}
      onClick={
        clickable
          ? (e) => {
              // Кнопки, ссылки и поля внутри строки работают сами.
              if ((e.target as HTMLElement).closest('button, a, input, select, textarea, [role="switch"], [data-no-toggle]')) return
              onToggle?.()
            }
          : undefined
      }
      className={cn('px-3 py-3', clickable && 'cursor-pointer', className)}
    >
      <div className="flex items-center gap-3.5">
        <span
          aria-hidden
          className={cn(
            'flex size-9 shrink-0 items-center justify-center rounded-xl transition-colors duration-300 [&_svg]:size-[18px]',
            on ? 'bg-primary/12 text-primary' : 'bg-foreground/[0.05] text-muted-foreground'
          )}
        >
          {icon}
        </span>
        <div className={cn('min-w-0 flex-1', disabled && 'opacity-60')}>
          <div className="flex items-center gap-1.5 text-[13.5px] font-semibold leading-snug text-foreground">
            <span className="min-w-0">{title}</span>
            {hint && <Hint text={hint} />}
          </div>
          {desc && <div className="mt-0.5 max-w-[62ch] text-[12px] leading-snug text-muted-foreground">{desc}</div>}
        </div>
        {control && <div className="flex shrink-0 items-center gap-2">{control}</div>}
      </div>
      {below && <div className="mt-2 max-w-[640px] pl-[50px]">{below}</div>}
    </div>
  )
}

interface SwitchRowProps extends Omit<RowProps, 'control' | 'on' | 'onToggle'> {
  checked: boolean
  onChange: (v: boolean) => void
  /** Справа перед переключателем — короткий статус. */
  aside?: React.ReactNode
}

/** Строка с переключателем: нажатие в любом месте строки переключает. */
export const SwitchRow: React.FC<SwitchRowProps> = ({ checked, onChange, aside, disabled, title, ...rest }) => (
  <SettingRow
    {...rest}
    title={title}
    disabled={disabled}
    on={checked && !disabled}
    onToggle={() => onChange(!checked)}
    control={
      <>
        {aside}
        <Switch checked={checked} disabled={disabled} onCheckedChange={onChange} aria-label={typeof title === 'string' ? title : undefined} />
      </>
    }
  />
)

/** Список строк с тонкими разделителями. */
export const Rows: React.FC<{ children: React.ReactNode; className?: string } & DataAttrs> = ({ children, className, ...rest }) => (
  <div {...rest} className={cn('divide-y divide-foreground/[0.06]', className)}>
    {children}
  </div>
)

/** Подзаголовок внутри группы — обычным регистром, мелко. */
export const SubHead: React.FC<{ children: React.ReactNode; className?: string }> = ({ children, className }) => (
  <div className={cn('px-3 pt-4 pb-1 text-[12px] font-semibold text-muted-foreground', className)}>{children}</div>
)

interface GroupProps extends DataAttrs {
  title: string
  hint?: string
  sub?: React.ReactNode
  right?: React.ReactNode
  children: React.ReactNode
  className?: string
}

/** Карточка группы настроек: заголовок с «i» и строки. */
export const SettingsGroup: React.FC<GroupProps> = ({ title, hint, sub, right, children, className, ...rest }) => (
  <LzPanel {...rest} className={cn('px-2 pt-4 pb-2', className)}>
    <LzSectionHead title={title} hint={hint} sub={sub} right={right} className="px-3 pb-1.5" />
    {children}
  </LzPanel>
)

/** Ползунок «Сигнала» с подписью значения справа. */
export const RangeField: React.FC<{
  value: number
  min?: number
  max: number
  step?: number
  disabled?: boolean
  label: string
  onChange: (v: number) => void
  suffix?: string
}> = ({ value, min = 0, max, step = 5, disabled, label, onChange, suffix = '%' }) => {
  const pct = max > min ? ((value - min) / (max - min)) * 100 : 0
  return (
    <div className="flex min-w-0 flex-1 items-center gap-3">
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        aria-label={label}
        onChange={(e) => onChange(Number(e.target.value))}
        className="st-range"
        style={{ ['--st-fill' as string]: `${pct}%` }}
      />
      <span className="w-11 shrink-0 text-right text-[12.5px] font-semibold tabular-nums text-foreground">
        {value}
        {suffix && <span className="text-muted-foreground">{suffix}</span>}
      </span>
    </div>
  )
}

export default SettingRow
