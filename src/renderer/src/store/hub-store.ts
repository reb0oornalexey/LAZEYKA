import { useEffect } from 'react'
import { create } from 'zustand'
import { toast } from 'sonner'
import { playSound } from '@renderer/lib/sound'
import {
  hubAck,
  hubDismissAnnounce,
  hubGalleryList,
  hubGalleryPreview,
  hubInbox,
  hubMarkRepliesRead,
  hubNoteRemove,
  hubNotesClear,
  hubNotesRead,
  onHubInbox,
  onHubNotify,
  type GalleryView,
  type HubAnnounce,
  type HubInbox,
  type HubNote
} from '@renderer/utils/hub-api'
import { hubCheckNow, hubPendingThemes, type PendingTheme } from '@renderer/utils/hub-extra-api'
import type { LocalClaim } from '@renderer/utils/hub-donations-api'

interface HubStore {
  /** Самое новое из показываемых объявлений. */
  announce: HubAnnounce | null
  /** Все показываемые объявления, новые сверху. */
  announces: HubAnnounce[]
  /** Центр уведомлений, новые сверху. */
  notes: HubNote[]
  unread: number
  loaded: boolean
  /** Свои заявки «Я отправил пожертвование», новые сверху. */
  claims: LocalClaim[]
  /** Ник для заявок с прошлого раза. */
  claimNick: string

  gallery: GalleryView | null
  galleryLoading: boolean
  /** Превью тем: data-URL, null — не загрузилось, нет ключа — ещё не просили. */
  previews: Record<string, string | null>
  /** Мои темы, ожидающие решения автора. */
  pending: PendingTheme[]
  checking: boolean
  /** Панель колокольчика открыта (её открывает и «Открыть» во всплывающем сообщении). */
  bellOpen: boolean
  /** Сообщение, которое надо показать и подсветить при открытии панели. */
  focusNote: string | null
  openBell: (focus?: string) => void
  setBellOpen: (open: boolean) => void
  /** Открытое окно одного уведомления (id) или null. */
  openNote: string | null
  showNote: (id: string) => void
  closeNote: () => void

  applyInbox: (v: HubInbox) => void
  /** Закрыть объявление: id — это одно, без id — все. */
  dismissAnnounce: (id?: string) => Promise<void>
  markRepliesRead: () => Promise<void>
  /** ids — только эти, без аргумента — все. */
  markNotesRead: (ids?: string[]) => Promise<void>
  removeNote: (id: string) => Promise<void>
  clearNotes: () => Promise<void>
  /** «Понятно» у предупреждения: плашка уходит сразу, сервер узнаёт о прочтении. */
  ackWarning: (id: string) => Promise<void>
  /** mode 'head' — самые новые темы, 'full' — весь список. */
  loadGallery: (force?: boolean, mode?: 'head' | 'full') => Promise<void>
  loadPreview: (id: string) => void
  loadPending: () => Promise<void>
  /** Кнопка «Проверить»: спросить сервер сразу. true — сервер ответил. */
  checkNow: () => Promise<boolean>
}

const requestedPreviews = new Set<string>()
const PREVIEWS_KEPT = 60
let previewOrder: string[] = []

export const useHubStore = create<HubStore>((set, get) => ({
  announce: null,
  announces: [],
  notes: [],
  unread: 0,
  loaded: false,
  claims: [],
  claimNick: '',
  gallery: null,
  galleryLoading: false,
  previews: {},
  pending: [],
  checking: false,
  bellOpen: false,
  focusNote: null,
  openBell: (focus) => set({ bellOpen: true, focusNote: focus ?? null }),
  setBellOpen: (open) => set(open ? { bellOpen: true } : { bellOpen: false, focusNote: null }),
  openNote: null,
  showNote: (id) => set({ openNote: id, bellOpen: false, focusNote: null }),
  closeNote: () => set({ openNote: null }),

  applyInbox: (v) => {
    // Прежний main присылал одно поле announce.
    const announces = Array.isArray(v.announces) ? v.announces : v.announce ? [v.announce] : []
    set({
      announce: announces[0] ?? null,
      announces,
      notes: Array.isArray(v.notes) ? v.notes : [],
      unread: v.unread,
      loaded: true,
      claims: Array.isArray(v.claims) ? v.claims : [],
      claimNick: typeof v.claimNick === 'string' ? v.claimNick : ''
    })
    // Список «на проверке» приходит вместе с тем же опросом: подтягиваем его.
    void get().loadPending()
  },

  loadPending: async () => {
    try {
      const next = await hubPendingThemes()
      const had = get().pending.length
      set({ pending: next })
      // Тема ушла из «на проверке» (одобрена или отклонена): обновляем галерею, чтобы она сразу появилась.
      if (next.length < had && get().gallery) void get().loadGallery(true, get().gallery?.complete ? 'full' : 'head')
    } catch {
      /* не критично */
    }
  },

  checkNow: async () => {
    if (get().checking) return true
    set({ checking: true })
    try {
      const r = await hubCheckNow()
      get().applyInbox(r.inbox)
      return r.reached
    } catch {
      return false
    } finally {
      set({ checking: false })
    }
  },

  dismissAnnounce: async (id) => {
    // Скрываем сразу; main запомнит id и больше его не покажет.
    const left = id ? get().announces.filter((a) => a.id !== id) : []
    set({ announces: left, announce: left[0] ?? null })
    try {
      await hubDismissAnnounce(id)
    } catch {
      /* закрытие не критично */
    }
  },

  markRepliesRead: async () => {
    if (get().unread === 0) return
    try {
      get().applyInbox(await hubMarkRepliesRead())
    } catch {
      /* повторится при следующем показе */
    }
  },

  markNotesRead: async (ids) => {
    const unreadIds = new Set(get().notes.filter((n) => !n.read).map((n) => n.id))
    if (ids ? !ids.some((id) => unreadIds.has(id)) : unreadIds.size === 0) return
    try {
      get().applyInbox(await hubNotesRead(ids))
    } catch {
      /* повторится */
    }
  },

  removeNote: async (id) => {
    set((s) => ({ notes: s.notes.filter((n) => n.id !== id) }))
    try {
      get().applyInbox(await hubNoteRemove(id))
    } catch {
      /* вернётся при следующем обновлении */
    }
  },

  ackWarning: async (id) => {
    set((s) => ({ notes: s.notes.map((n) => (n.id === id ? { ...n, ack: true, read: true } : n)) }))
    try {
      get().applyInbox(await hubAck(id))
    } catch {
      /* main повторит при следующей проверке */
    }
  },

  clearNotes: async () => {
    set({ notes: [], unread: 0 })
    try {
      get().applyInbox(await hubNotesClear())
    } catch {
      /* noop */
    }
  },

  loadGallery: async (force = false, mode = 'head') => {
    // При обновлении компактного блока сохраняем уже загруженный полный список.
    if (mode === 'head' && get().gallery?.complete) mode = 'full'
    if (get().galleryLoading && !force) return
    set({ galleryLoading: true })
    if (force) {
      // «Обновить»: превью, которые не загрузились, пробуем ещё раз.
      for (const [id, url] of Object.entries(get().previews)) if (url === null) requestedPreviews.delete(id)
    }
    void get().loadPending()
    try {
      const g = await hubGalleryList(force, mode)
      // Ответ «только начало» не заменяет уже загруженный полный список, если тот свежий.
      const cur = get().gallery
      if (!(g.complete === false && cur?.complete && !force)) set({ gallery: g })
    } catch (e) {
      set({
        gallery: {
          themes: [],
          total: 0,
          complete: false,
          updated: null,
          fetchedAt: 0,
          stale: false,
          empty: false,
          error: e instanceof Error ? e.message : String(e)
        }
      })
    } finally {
      set({ galleryLoading: false })
    }
  },

  loadPreview: (id) => {
    if (requestedPreviews.has(id)) return
    requestedPreviews.add(id)
    hubGalleryPreview(id)
      .then((url) =>
        set((s) => {
          // В памяти держим не больше PREVIEWS_KEPT картинок: остальные лежат в кэше на диске
          // и подгружаются снова, когда плитка опять попадёт на экран.
          const order = previewOrder.filter((x) => x !== id)
          order.push(id)
          const next = { ...s.previews, [id]: url }
          while (order.length > PREVIEWS_KEPT) {
            const old = order.shift() as string
            delete next[old]
            requestedPreviews.delete(old)
          }
          previewOrder = order
          return { previews: next }
        })
      )
      .catch(() => {
        requestedPreviews.delete(id)
        set((s) => ({ previews: { ...s.previews, [id]: null } }))
      })
  }
}))

const KIND_TITLE: Record<HubNote['kind'], string> = {
  reply: 'Ответ автора',
  theme_ok: 'Тема одобрена',
  theme_no: 'Тема не прошла проверку',
  announce: 'Объявление',
  warn: 'Предупреждение',
  ban: 'Отправка отключена',
  don_ok: 'Пожертвование подтверждено',
  don_no: 'Заявка отклонена'
}

/** Ключ события: источник и номер на сервере (как noteKey в main/core/hub-notes.ts). */
const noteKey = (n: HubNote): string => `${n.kind === 'announce' || n.id.startsWith('a') ? 'announce' : 'reply'}:${n.id.replace(/^[ra]/, '')}`
/** Уже показанные в этом окне события: второе такое же событие не даёт второго сообщения и звука. */
const shownKeys: string[] = []
const SHOWN_KEPT = 100

/** Только что пришло новое: всплывающее сообщение в любом разделе и мягкий сигнал (группа «оповещения»). */
function showFresh(incoming: HubNote[]): void {
  const fresh = incoming.filter((n) => !shownKeys.includes(noteKey(n)))
  if (!fresh.length) return
  for (const n of fresh) shownKeys.push(noteKey(n))
  shownKeys.splice(0, Math.max(0, shownKeys.length - SHOWN_KEPT))
  // Звук учитывает общую громкость, громкость оповещений и «без звука» (lib/sound.ts).
  playSound(undefined, true, 'messages')
  // «Открыть» раскрывает колокольчик и подсвечивает это сообщение — раньше вело наверх страницы
  // поддержки, где ответ был не виден, и казалось, что кнопка ничего не делает.
  // «Открыть»: одно сообщение — окно с ним целиком; несколько — список в колокольчике.
  const open = {
    label: 'Открыть',
    onClick: () => (fresh.length === 1 ? useHubStore.getState().showNote(fresh[0].id) : useHubStore.getState().openBell())
  }
  if (fresh.length === 1) {
    const n = fresh[0]
    const title =
      n.kind === 'reply'
        ? `${KIND_TITLE.reply}: ${n.title}`
        : n.kind === 'announce'
          ? `${n.emoji ? n.emoji + ' ' : ''}${n.title || KIND_TITLE.announce}`
          : n.kind === 'theme_ok' || n.kind === 'theme_no'
            ? `${KIND_TITLE[n.kind]}: ${n.title.replace(/^Тема /, '')}`
            : n.title || KIND_TITLE[n.kind]
    toast(title, { description: n.text.length > 160 ? n.text.slice(0, 160) + '…' : n.text, action: open, duration: 12000 })
  } else {
    toast(`Новых уведомлений: ${fresh.length}`, { description: 'Нажмите «Открыть» — они в колокольчике в шапке окна.', action: open, duration: 12000 })
  }
}

let refs = 0
let detach: (() => void) | null = null

/**
 * Подписать хранилище на события main. Можно вызывать из нескольких мест
 * (App, баннер, значок в меню): подписка одна, снимается, когда ушёл последний.
 * Возвращает функцию отписки — удобно для useEffect.
 */
export function attachHubStore(): () => void {
  refs++
  if (refs === 1) {
    const off = onHubInbox((v) => useHubStore.getState().applyInbox(v))
    const offNotify = onHubNotify(showFresh)
    hubInbox()
      .then((v) => useHubStore.getState().applyInbox(v))
      .catch(() => undefined)
    detach = () => {
      off()
      offNotify()
    }
  }
  let done = false
  return () => {
    if (done) return
    done = true
    refs--
    if (refs === 0 && detach) {
      detach()
      detach = null
    }
  }
}

/** Есть ли непрочитанные уведомления — для значка на пункте меню «Поддержка». */
export function useHasUnreadReplies(): boolean {
  useEffect(() => attachHubStore(), [])
  return useHubStore((s) => s.unread > 0)
}

/** Число непрочитанных уведомлений (счётчик в левом меню). */
export function useUnreadCount(): number {
  useEffect(() => attachHubStore(), [])
  return useHubStore((s) => s.unread)
}
