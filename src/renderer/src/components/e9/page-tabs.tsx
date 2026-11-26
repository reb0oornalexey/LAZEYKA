import React, { useCallback, useState } from 'react'
import { Segmented } from '@renderer/components/lz'
import { useTourTab } from '@renderer/lib/tour-focus'
import { cn } from '@renderer/lib/utils'

/*
 * Вкладки разделов под главной плашкой (Е9): «Стример», «Диагностика»,
 * «Локальная сеть», «Информация». Выбор запоминается в localStorage, экскурсия
 * переключает вкладку по полю tab шага (lib/tour-focus).
 */

export interface PageTab<T extends string> {
  id: T
  label: string
  icon?: React.ComponentType<{ className?: string }>
  /** Строка справа от переключателя: что на этой вкладке. */
  hint?: string
}

function read<T extends string>(key: string, ids: readonly T[], fallback: T): T {
  try {
    const v = localStorage.getItem(key) as T | null
    return v && ids.includes(v) ? v : fallback
  } catch {
    return fallback
  }
}

/** Выбранная вкладка раздела: запоминается и переключается экскурсией. */
export function usePageTab<T extends string>(route: string, ids: readonly T[], fallback: T): [T, (t: T) => void] {
  const key = `lazeyka.tab.${route}`
  const [tab, setTabState] = useState<T>(() => read(key, ids, fallback))
  const setTab = useCallback(
    (t: T) => {
      setTabState(t)
      try {
        localStorage.setItem(key, t)
      } catch {
        /* хранилище недоступно — просто не запоминаем */
      }
    },
    [key]
  )
  // Экскурсия открывает вкладку, не запоминая выбор.
  useTourTab<T>(route, (t) => ids.includes(t) && setTabState(t))
  return [tab, setTab]
}

/** Строка вкладок: сегментированный переключатель и пояснение к выбранной вкладке. */
export function PageTabs<T extends string>({
  tabs,
  value,
  onChange,
  label,
  width,
  wrapLabels,
  tour,
  right
}: {
  tabs: PageTab<T>[]
  value: T
  onChange: (t: T) => void
  label: string
  /** Ширина переключателя, например 'w-[460px]'. */
  width?: string
  wrapLabels?: boolean
  tour?: string
  right?: React.ReactNode
}): React.ReactElement {
  return (
    <div className="flex shrink-0 flex-wrap items-center gap-3">
      <Segmented
        items={tabs.map((t) => ({ id: t.id, label: t.label, icon: t.icon, title: t.hint }))}
        value={value}
        onChange={onChange}
        aria-label={label}
        data-tour={tour}
        wrapLabels={wrapLabels}
        className={cn('max-w-full', width)}
      />
      <span className="lz-onwall min-w-0 text-[12px]">{tabs.find((t) => t.id === value)?.hint}</span>
      {right}
    </div>
  )
}

/** Контейнер страницы «Сигнала»: ширина и отступы как на Главной. */
export const PageColumn: React.FC<{ children: React.ReactNode; className?: string }> = ({ children, className }) => (
  <div className={cn('mx-auto flex w-full max-w-[1080px] flex-col lz-page-gap lz-page-x pb-5', className)}>{children}</div>
)
