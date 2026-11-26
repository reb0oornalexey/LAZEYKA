import React from 'react'
import { ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react'
import { Button } from '@renderer/components/ui/button'
import { cn } from '@renderer/lib/utils'
import { DON_METHOD_ICONS, DON_METHOD_NAMES, guessMethodIcon, type DonMethod, type DonMethodIcon } from '@renderer/utils/hub-donations-api'
import { Hint } from '@renderer/components/prematch/hint'
import { inputClass } from './admin-section'
import { MethodIcon } from './pay-icons'

export const METHODS_MAX = 6

/** Строка редактора: то, что ввёл автор (ссылка может быть ещё недописанной). */
export interface MethodRow {
  name: string
  url: string
  icon: DonMethodIcon
  /** Значок выбран вручную — не угадывать по ссылке. */
  manual?: boolean
}

export const urlOk = (u: string): boolean => {
  try {
    const x = new URL(u.trim())
    return x.protocol === 'https:' && !x.username && !x.password && x.hostname.includes('.')
  } catch {
    return false
  }
}

export const rowsFromMethods = (m: DonMethod[]): MethodRow[] => m.map((x) => ({ ...x, manual: true }))
export const methodsFromRows = (rows: MethodRow[]): DonMethod[] =>
  rows.filter((r) => r.name.trim() && urlOk(r.url)).map((r) => ({ name: r.name.trim().slice(0, 32), url: r.url.trim(), icon: r.icon }))
export const rowsValid = (rows: MethodRow[]): boolean => rows.every((r) => r.name.trim().length > 0 && urlOk(r.url))

/**
 * Способы оплаты у сбора: до 6 штук — название, ссылка https, значок, порядок. Значок угадывается по
 * ссылке (DonationAlerts, Boosty, CryptoBot…), пока автор не выберет его сам.
 */
export const MethodsEditor: React.FC<{ rows: MethodRow[]; onChange: (rows: MethodRow[]) => void; defaultLink?: string }> = ({ rows, onChange, defaultLink }) => {
  const set = (i: number, patch: Partial<MethodRow>): void => onChange(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)))
  const move = (i: number, d: -1 | 1): void => {
    const j = i + d
    if (j < 0 || j >= rows.length) return
    const next = [...rows]
    ;[next[i], next[j]] = [next[j], next[i]]
    onChange(next)
  }
  const add = (url = ''): void => {
    const icon = url ? guessMethodIcon(url) : 'link'
    onChange([...rows, { name: url ? DON_METHOD_NAMES[icon] : '', url, icon }])
  }
  return (
    <div className="space-y-2" data-tour="admin-don-methods">
      <div className="flex items-center gap-1.5 text-[11px] font-semibold text-foreground/90">
        Способы оплаты
        <span className="rounded bg-foreground/[0.06] px-1 py-px text-[9.5px] font-medium text-muted-foreground">
          {rows.length}/{METHODS_MAX}
        </span>
        <Hint text="Кнопка «Поддержать» в «Поддержке»: если способ один — сразу открывается ссылка, если несколько — человек выбирает из списка. Первый способ — основной (его видят старые версии программы)." />
      </div>
      {rows.length === 0 && (
        <div className="rounded-xl border border-dashed border-border px-3 py-4 text-center text-[11px] text-muted-foreground">Способов нет — кнопки «Поддержать» не будет. Добавьте хотя бы один.</div>
      )}
      {rows.map((r, i) => {
        const bad = r.url.trim().length > 0 && !urlOk(r.url)
        return (
          <div key={i} className="space-y-2 rounded-xl border border-border/70 bg-background/30 p-2.5">
            <div className="grid gap-2 sm:grid-cols-[minmax(0,10rem)_minmax(0,1fr)_auto] sm:items-center">
              <div className="flex items-center gap-2">
                <MethodIcon icon={r.icon} className="size-6" />
                <input className={cn(inputClass, 'h-8')} value={r.name} onChange={(e) => set(i, { name: e.target.value.slice(0, 32) })} placeholder="Название" aria-label="Название способа" />
              </div>
              <input
                className={cn(inputClass, 'h-8 font-mono', bad && 'border-st-err/70')}
                value={r.url}
                spellCheck={false}
                onChange={(e) => {
                  const url = e.target.value.slice(0, 300)
                  const icon = r.manual ? r.icon : guessMethodIcon(url)
                  // Название подставляется, пока автор его не менял (пусто или совпадает с прежней догадкой).
                  const autoName = !r.name.trim() || r.name === DON_METHOD_NAMES[r.icon]
                  set(i, { url, icon, ...(autoName && icon !== 'link' ? { name: DON_METHOD_NAMES[icon] } : {}) })
                }}
                placeholder="https://"
                aria-label="Ссылка"
              />
              <div className="flex items-center gap-0.5">
                <Button size="icon-xs" variant="ghost" onClick={() => move(i, -1)} disabled={i === 0} aria-label="Выше" title="Выше">
                  <ArrowUp />
                </Button>
                <Button size="icon-xs" variant="ghost" onClick={() => move(i, 1)} disabled={i === rows.length - 1} aria-label="Ниже" title="Ниже">
                  <ArrowDown />
                </Button>
                <Button size="icon-xs" variant="ghost" onClick={() => onChange(rows.filter((_, j) => j !== i))} aria-label="Убрать способ" title="Убрать" className="hover:text-st-err-text">
                  <Trash2 />
                </Button>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-1">
              <span className="mr-1 text-[10.5px] text-muted-foreground">Значок:</span>
              {DON_METHOD_ICONS.map((k) => (
                <button
                  key={k}
                  type="button"
                  title={DON_METHOD_NAMES[k]}
                  aria-label={DON_METHOD_NAMES[k]}
                  onClick={() => set(i, { icon: k, manual: true })}
                  className={cn('inline-flex size-7 cursor-pointer items-center justify-center rounded-lg border transition-colors', r.icon === k ? 'border-primary/70 bg-primary/12' : 'border-transparent hover:bg-foreground/[0.06]')}
                >
                  <MethodIcon icon={k} className="size-4.5" />
                </button>
              ))}
            </div>
            {bad && <p className="text-[10.5px] text-st-err-text">Только адрес, начинающийся с https://</p>}
          </div>
        )
      })}
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="outline" onClick={() => add()} disabled={rows.length >= METHODS_MAX}>
          <Plus /> Способ
        </Button>
        {defaultLink && !rows.some((r) => r.url === defaultLink) && rows.length < METHODS_MAX && (
          <Button size="sm" variant="ghost" onClick={() => add(defaultLink)} title={defaultLink}>
            <MethodIcon icon={guessMethodIcon(defaultLink)} className="size-4" /> Добавить {DON_METHOD_NAMES[guessMethodIcon(defaultLink)]}
          </Button>
        )}
      </div>
    </div>
  )
}
