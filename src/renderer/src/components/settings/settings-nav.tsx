import React, { useEffect, useRef } from 'react'
import { CornerDownLeft, Search, SearchX, X } from 'lucide-react'
import { Button } from '@renderer/components/ui/button'
import { EmptyState, LzPanel } from '@renderer/components/lz'
import { cn, pluralRu } from '@renderer/lib/utils'
import { GROUPS, splitMatches, type CatalogEntry, type GroupDef, type SettingsGroupId } from './settings-catalog'

/*
 * Навигация «Настроек» (Е5): поиск сверху и список групп. У каждой группы —
 * живая строка состояния («3 из 9», «скрыто»). Пока идёт поиск, у групп
 * видно число совпадений, а справа вместо группы — список найденного.
 */

export const Highlight: React.FC<{ text: string; query: string }> = ({ text, query }) => (
  <>
    {splitMatches(text, query).map((p, i) =>
      p.hit ? (
        <mark key={i} className="rounded-[3px] bg-primary/25 px-[1px] text-foreground">
          {p.t}
        </mark>
      ) : (
        <React.Fragment key={i}>{p.t}</React.Fragment>
      )
    )}
  </>
)

interface NavProps {
  groups: GroupDef[]
  active: SettingsGroupId
  status: Partial<Record<SettingsGroupId, { text: string; on: boolean }>>
  query: string
  results: CatalogEntry[]
  onQuery: (q: string) => void
  onSelect: (g: SettingsGroupId) => void
  /** Enter в поле поиска — перейти к первому найденному. */
  onSubmit: () => void
}

export const SettingsNav: React.FC<NavProps> = ({ groups, active, status, query, results, onQuery, onSelect, onSubmit }) => {
  const input = useRef<HTMLInputElement>(null)
  const searching = query.trim().length > 0

  // Ctrl+F (⌘F) — к поиску по настройкам, пока открыт раздел.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if ((e.ctrlKey || e.metaKey) && !e.altKey && e.code === 'KeyF') {
        e.preventDefault()
        input.current?.focus()
        input.current?.select()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const counts = new Map<SettingsGroupId, number>()
  for (const r of results) counts.set(r.group, (counts.get(r.group) ?? 0) + 1)

  return (
    <LzPanel className="sticky top-0 p-2" data-tour="settings-nav">
      <label className="relative mb-1.5 block">
        <Search aria-hidden className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
        <input
          ref={input}
          data-tour="settings-search"
          type="search"
          value={query}
          placeholder="Поиск по настройкам"
          aria-label="Поиск по настройкам"
          onChange={(e) => onQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') onSubmit()
            if (e.key === 'Escape' && query) {
              e.preventDefault()
              onQuery('')
            }
          }}
          className="h-9 w-full rounded-xl border border-foreground/[0.1] bg-foreground/[0.035] pr-8 pl-9 text-[13px] text-foreground outline-none placeholder:text-muted-foreground focus:border-primary/50 [&::-webkit-search-cancel-button]:hidden"
        />
        {searching ? (
          <button
            type="button"
            aria-label="Очистить поиск"
            onClick={() => onQuery('')}
            className="absolute top-1/2 right-2 flex size-5 -translate-y-1/2 cursor-pointer items-center justify-center rounded-md text-muted-foreground hover:bg-foreground/[0.08] hover:text-foreground"
          >
            <X className="size-3.5" />
          </button>
        ) : (
          <kbd className="pointer-events-none absolute top-1/2 right-2.5 -translate-y-1/2 font-sans text-[10.5px] text-muted-foreground/70">Ctrl F</kbd>
        )}
      </label>

      <nav className="flex flex-col gap-0.5" aria-label="Группы настроек">
        {groups.map((g) => {
          const Icon = g.icon
          const isActive = !searching && g.id === active
          const st = status[g.id]
          const n = counts.get(g.id) ?? 0
          const dim = searching && n === 0
          return (
            <button
              key={g.id}
              type="button"
              data-group={g.id}
              aria-current={isActive ? 'page' : undefined}
              onClick={() => onSelect(g.id)}
              className={cn(
                'relative flex w-full cursor-pointer items-center gap-2.5 overflow-hidden rounded-xl px-2.5 py-2 text-left transition-colors',
                isActive ? 'bg-primary/10' : 'hover:bg-foreground/[0.045]',
                dim && 'opacity-45'
              )}
            >
              {/* Полоса сигнала у активной группы. */}
              <span aria-hidden className={cn('absolute top-2 bottom-2 left-0 w-[3px] rounded-r-full bg-primary transition-opacity', isActive ? 'opacity-100' : 'opacity-0')} />
              <span
                className={cn(
                  'flex size-7 shrink-0 items-center justify-center rounded-lg [&_svg]:size-4',
                  isActive ? 'text-primary' : 'text-muted-foreground'
                )}
              >
                <Icon />
              </span>
              <span className="min-w-0 flex-1">
                <span className={cn('block truncate text-[13px] font-semibold leading-tight', isActive ? 'text-foreground' : 'text-foreground/85')}>{g.title}</span>
                {st && !searching && (
                  <span className="mt-0.5 flex items-center gap-1.5 truncate text-[11px] leading-tight text-muted-foreground">
                    <span aria-hidden className={cn('size-1.5 shrink-0 rounded-full', st.on ? 'bg-primary' : 'bg-muted-foreground/45')} />
                    <span className="truncate">{st.text}</span>
                  </span>
                )}
              </span>
              {searching && n > 0 && (
                <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1.5 text-[10.5px] font-bold text-primary-foreground tabular-nums">{n}</span>
              )}
            </button>
          )
        })}
      </nav>
    </LzPanel>
  )
}

interface ResultsProps {
  query: string
  results: CatalogEntry[]
  onPick: (r: CatalogEntry) => void
  onClear: () => void
}

/** Найденные настройки: название и пояснение с подсветкой, группа справа. Нажатие — открыть группу и подсветить строку. */
export const SearchResults: React.FC<ResultsProps> = ({ query, results, onPick, onClear }) => {
  const titleOf = new Map(GROUPS.map((g) => [g.id, g]))
  if (!results.length) {
    return (
      <LzPanel className="p-4">
        <EmptyState
          icon={<SearchX />}
          title={`По запросу «${query.trim()}» ничего нет`}
          text="Попробуйте другое слово: «трей», «звук», «клавиша», «обновления», «Discord»."
          action={
            <Button size="sm" variant="outline" onClick={onClear}>
              Очистить поиск
            </Button>
          }
        />
      </LzPanel>
    )
  }
  return (
    <LzPanel className="px-2 pt-4 pb-2" data-tour="settings-search-results">
      <div className="flex items-center justify-between gap-3 px-3 pb-2">
        <div className="text-[14px] font-bold text-[color:var(--text-title)]">
          Найдено {results.length} {pluralRu(results.length, 'настройка', 'настройки', 'настроек')}
        </div>
        <div className="flex items-center gap-1.5 text-[11.5px] text-muted-foreground">
          <CornerDownLeft className="size-3.5" /> Enter — к первой
        </div>
      </div>
      <div className="divide-y divide-foreground/[0.06]">
        {results.map((r, i) => {
          const g = titleOf.get(r.group)
          const Icon = g?.icon
          return (
            <button
              key={r.id}
              type="button"
              onClick={() => onPick(r)}
              className={cn(
                'group/res flex w-full cursor-pointer items-center gap-3.5 rounded-xl px-3 py-2.5 text-left transition-colors hover:bg-foreground/[0.04]',
                i === 0 && 'bg-primary/[0.05]'
              )}
            >
              <span aria-hidden className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-foreground/[0.05] text-muted-foreground [&_svg]:size-[18px]">
                {Icon && <Icon />}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13.5px] font-semibold text-foreground">
                  <Highlight text={r.title} query={query} />
                </span>
                <span className="block truncate text-[12px] text-muted-foreground">
                  <Highlight text={r.desc} query={query} />
                </span>
              </span>
              <span className="shrink-0 rounded-lg border border-foreground/[0.08] bg-foreground/[0.035] px-2 py-1 text-[11px] text-muted-foreground transition-colors group-hover/res:border-primary/40 group-hover/res:text-foreground">
                {g?.title}
              </span>
            </button>
          )
        })}
      </div>
    </LzPanel>
  )
}
