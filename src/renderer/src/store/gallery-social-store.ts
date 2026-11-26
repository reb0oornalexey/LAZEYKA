import { create } from 'zustand'
import { toast } from 'sonner'
import { useHubStore } from '@renderer/store/hub-store'
import type { GalleryItem } from '@renderer/utils/hub-api'
import { galleryFav, galleryLike, gallerySocial, galleryWallpaper } from '@renderer/utils/gallery-social-api'

/** Порядок в «Вся галерея»: популярные (по лайкам), новые, только избранные. */
export type GallerySort = 'popular' | 'new' | 'fav'
const SORT_KEY = 'lazeyka.gallery.sort'
const readSort = (): GallerySort => {
  try {
    const v = localStorage.getItem(SORT_KEY)
    return v === 'popular' || v === 'new' || v === 'fav' ? v : 'popular'
  } catch {
    return 'popular'
  }
}

/** Сколько обоев держать в памяти окна (картинки до 3 МБ). */
const WALLS_KEPT = 6

interface SocialStore {
  loaded: boolean
  liked: Record<string, true>
  fav: Record<string, true>
  /** Число лайков из ответа сервера на свой лайк (до следующей загрузки списка). */
  counts: Record<string, number>
  /** Идёт запрос лайка этой темы. */
  busy: Record<string, true>
  sort: GallerySort
  /** Обои для вкладки «Только обои»: data-URL, null — не вышло, нет ключа — не просили. */
  walls: Record<string, string | null>
  load: () => Promise<void>
  setSort: (s: GallerySort) => void
  toggleLike: (item: GalleryItem) => Promise<void>
  toggleFav: (id: string) => Promise<void>
  loadWall: (id: string) => void
}

const asSet = (ids: string[]): Record<string, true> => Object.fromEntries(ids.map((id) => [id, true as const]))
let wallOrder: string[] = []
const wallAsked = new Set<string>()

export const useGallerySocial = create<SocialStore>((set, get) => ({
  loaded: false,
  liked: {},
  fav: {},
  counts: {},
  busy: {},
  sort: readSort(),
  walls: {},
  load: async () => {
    if (get().loaded) return
    try {
      const s = await gallerySocial()
      set({ loaded: true, liked: asSet(s.liked), fav: asSet(s.fav) })
    } catch {
      set({ loaded: true })
    }
  },
  setSort: (sort) => {
    set({ sort })
    try {
      localStorage.setItem(SORT_KEY, sort)
    } catch {
      /* не запомнилось — не страшно */
    }
  },
  toggleLike: async (item) => {
    const id = item.id
    if (get().busy[id]) return
    const was = Boolean(get().liked[id])
    const before = likesOf(item, get().counts)
    // Сердечко меняется сразу; если сервер не принял — возвращается как было.
    set((s) => ({
      busy: { ...s.busy, [id]: true },
      liked: was ? omit(s.liked, id) : { ...s.liked, [id]: true },
      counts: before === null ? s.counts : { ...s.counts, [id]: Math.max(0, before + (was ? -1 : 1)) }
    }))
    let ok = false
    try {
      const r = await galleryLike(id, !was)
      if (r.ok) {
        ok = true
        set((s) => ({ liked: r.liked ? { ...s.liked, [id]: true } : omit(s.liked, id), counts: { ...s.counts, [id]: r.likes } }))
      } else {
        toast.error(was ? 'Не удалось убрать лайк' : 'Не удалось поставить лайк', { description: r.message })
      }
    } catch (e) {
      toast.error('Не удалось поставить лайк', { description: e instanceof Error ? e.message : String(e) })
    } finally {
      set((s) => ({
        busy: omit(s.busy, id),
        ...(ok
          ? {}
          : {
              liked: was ? { ...s.liked, [id]: true } : omit(s.liked, id),
              counts: before === null ? omit(s.counts, id) : { ...s.counts, [id]: before }
            })
      }))
    }
  },
  toggleFav: async (id) => {
    const on = !get().fav[id]
    set((s) => ({ fav: on ? { ...s.fav, [id]: true } : omit(s.fav, id) }))
    try {
      const s = await galleryFav(id, on)
      set({ fav: asSet(s.fav) })
    } catch (e) {
      set((s) => ({ fav: on ? omit(s.fav, id) : { ...s.fav, [id]: true } }))
      toast.error('Не удалось изменить избранное', { description: e instanceof Error ? e.message : String(e) })
    }
  },
  loadWall: (id) => {
    if (wallAsked.has(id)) return
    wallAsked.add(id)
    galleryWallpaper(id)
      .catch(() => null)
      .then((url) => {
        set((s) => {
          const order = [...wallOrder.filter((x) => x !== id), id]
          const next = { ...s.walls, [id]: url }
          while (order.length > WALLS_KEPT) {
            const old = order.shift() as string
            delete next[old]
            wallAsked.delete(old)
          }
          wallOrder = order
          return { walls: next }
        })
        // Не скачались — при следующем открытии можно попробовать снова.
        if (url === null) wallAsked.delete(id)
      })
  }
}))

function omit<T>(o: Record<string, T>, k: string): Record<string, T> {
  if (!(k in o)) return o
  const n = { ...o }
  delete n[k]
  return n
}

/** Лайков у темы с учётом своего последнего нажатия. null — счётчик неизвестен. */
export function likesOf(item: GalleryItem, counts: Record<string, number>): number | null {
  const c = counts[item.id]
  if (typeof c === 'number') return c
  return item.likes
}

// Новый список с сервера уже содержит свежие числа (и свой лайк) — временные числа больше не нужны.
useHubStore.subscribe((s, prev) => {
  if (s.gallery !== prev.gallery && Object.keys(useGallerySocial.getState().counts).length) useGallerySocial.setState({ counts: {} })
})

/** Можно ли сейчас лайкать: есть связь с галереей и сервер сообщает счётчики. Иначе — текст подсказки. */
export function likeBlockedReason(item: GalleryItem, stale: boolean, error: boolean): string | null {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return 'Нет подключения к интернету: лайк сейчас не отправить.'
  if (stale || error) return 'Нет связи с галереей: лайк сейчас не отправить. Нажмите «Обновить», когда связь появится.'
  if (item.likes === null) return 'Сервер галереи пока не сообщает лайки: список загружен с запасного адреса. Нажмите «Обновить».'
  return null
}
