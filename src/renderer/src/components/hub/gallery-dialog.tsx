import React, { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'
import { LayoutGrid, RefreshCw, Search } from 'lucide-react'
import { Button } from '@renderer/components/ui/button'
import { Input } from '@renderer/components/ui/input'
import { cn } from '@renderer/lib/utils'
import { useHubStore } from '@renderer/store/hub-store'
import { likesOf, useGallerySocial, type GallerySort } from '@renderer/store/gallery-social-store'
import type { GalleryItem } from '@renderer/utils/hub-api'
import { HubModal } from './modal'
import { Tile } from './gallery-tile'

/** Сколько плиток добавляется при прокрутке к концу. */
const STEP = 24

type Filter = 'all' | 'wall' | 'colors'

/** Сегментированный переключатель в стиле программы. */
function Segmented<T extends string>({ value, onChange, items, label }: { value: T; onChange: (v: T) => void; items: [T, string][]; label: string }): React.JSX.Element {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex rounded-lg border border-border bg-card/60 p-0.5">
      {items.map(([v, text]) => (
        <button
          key={v}
          type="button"
          role="radio"
          aria-checked={value === v}
          onClick={() => onChange(v)}
          className={cn(
            'cursor-pointer rounded-md px-2.5 py-1 text-xs transition-colors',
            value === v ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'
          )}
        >
          {text}
        </button>
      ))}
    </div>
  )
}

/**
 * «Вся галерея»: большое окно с сеткой. Плитки добавляются порциями по 24 при прокрутке,
 * превью грузятся только для видимых плиток. Поиск по названию и автору, порядок «Популярные» (по
 * лайкам) / «Новые» / «Избранные» (запоминается), фильтр по обоям. onPick получает и весь показанный
 * список — по нему стрелки листают темы в окне темы.
 */
export const GalleryDialog: React.FC<{ open: boolean; onClose: () => void; onPick: (i: GalleryItem, list: GalleryItem[]) => void }> = ({ open, onClose, onPick }) => {
  const gallery = useHubStore((s) => s.gallery)
  const loading = useHubStore((s) => s.galleryLoading)
  const loadGallery = useHubStore((s) => s.loadGallery)
  const [query, setQuery] = useState('')
  const sort = useGallerySocial((s) => s.sort)
  const setSort = useGallerySocial((s) => s.setSort)
  const fav = useGallerySocial((s) => s.fav)
  const counts = useGallerySocial((s) => s.counts)
  const loadSocial = useGallerySocial((s) => s.load)
  const [filter, setFilter] = useState<Filter>('all')
  const [shown, setShown] = useState(STEP)
  const sentinel = useRef<HTMLDivElement>(null)
  const q = useDeferredValue(query.trim().toLowerCase())

  useEffect(() => {
    if (!open) return
    void loadGallery(false, 'full')
    void loadSocial()
  }, [open, loadGallery, loadSocial])

  const list = useMemo(() => {
    let l = gallery?.themes ?? []
    if (q) l = l.filter((t) => t.name.toLowerCase().includes(q) || t.author.toLowerCase().includes(q))
    if (filter === 'wall') l = l.filter((t) => t.hasWallpaper)
    if (filter === 'colors') l = l.filter((t) => !t.hasWallpaper)
    if (sort === 'fav') l = l.filter((t) => fav[t.id])
    // «Популярные»: больше лайков — выше, при равенстве новее — выше. Без счётчиков (старый Hub) — как «Новые».
    if (sort === 'popular') return [...l].sort((a, b) => (likesOf(b, counts) ?? 0) - (likesOf(a, counts) ?? 0) || b.at - a.at)
    return [...l].sort((a, b) => b.at - a.at)
    // counts не в зависимостях: порядок не прыгает под курсором после лайка, обновится при смене сортировки или списка.
  }, [gallery, q, sort, filter, fav])

  // Новый поиск/сортировка — снова первая порция.
  useEffect(() => setShown(STEP), [q, sort, filter, open])

  useEffect(() => {
    const el = sentinel.current
    if (!open || !el || typeof IntersectionObserver === 'undefined') return
    const io = new IntersectionObserver((e) => {
      if (e.some((x) => x.isIntersecting)) setShown((n) => n + STEP)
    }, { rootMargin: '300px' })
    io.observe(el)
    return () => io.disconnect()
  }, [open, list.length, shown])

  const pick = useCallback((i: GalleryItem) => onPick(i, list), [onPick, list])
  const full = gallery?.complete === true
  const total = gallery?.total ?? 0
  const visible = list.slice(0, shown)

  return (
    <HubModal
      open={open}
      onClose={onClose}
      icon={LayoutGrid}
      title="Галерея тем"
      subtitle={full ? `Тем: ${total}${q || filter !== 'all' || sort === 'fav' ? ` · найдено: ${list.length}` : ''}` : 'Загружаю список…'}
      className="h-[92vh] max-h-[92vh] max-w-5xl"
    >
      <div className="sticky top-0 z-10 -mx-6 flex flex-wrap items-center gap-2 border-b border-border/50 bg-background/95 px-6 pb-3 backdrop-blur">
        <div className="relative min-w-[200px] flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Поиск по названию или автору" className="pl-9" aria-label="Поиск тем" />
        </div>
        <div data-tour="theme-gallery-sort">
          <Segmented<GallerySort> label="Порядок" value={sort} onChange={setSort} items={[['popular', 'Популярные'], ['new', 'Новые'], ['fav', 'Избранные']]} />
        </div>
        <Segmented label="Фильтр" value={filter} onChange={setFilter} items={[['all', 'Все'], ['wall', 'С обоями'], ['colors', 'Только цвета']]} />
        <Button size="sm" variant="ghost" onClick={() => void loadGallery(true, 'full')} disabled={loading} title="Запросить свежий список с сервера">
          <RefreshCw className={cn(loading && 'animate-spin')} /> Обновить
        </Button>
      </div>

      {gallery?.error && <p className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">{gallery.error}</p>}
      {gallery?.stale && <p className="px-1 text-[11px] text-st-warn-text">Нет связи с галереей: показан сохранённый список.</p>}
      {full && list.length === 0 && (
        <div className="flex flex-col items-center gap-1 py-16 text-center text-sm text-muted-foreground">
          <LayoutGrid className="mb-1 size-6 opacity-50" />
          {total === 0 ? (
            'Тем пока нет. Станьте первым: «Поделиться темой» в «Оформлении».'
          ) : sort === 'fav' && !q && filter === 'all' ? (
            <>
              В избранном пока ничего. Откройте тему и нажмите «В избранное» — она появится здесь.
            </>
          ) : (
            'Ничего не найдено. Измените поиск или фильтр.'
          )}
        </div>
      )}
      {visible.length > 0 && (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(170px,1fr))] gap-2">
          {visible.map((t) => (
            <Tile key={t.id} item={t} onOpen={pick} />
          ))}
        </div>
      )}
      {shown < list.length && <div ref={sentinel} className="h-8" aria-hidden />}
    </HubModal>
  )
}
