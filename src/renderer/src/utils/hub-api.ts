/**
 * LAZEYKA Hub: типы и вызовы IPC. Типы повторяют те, что отдаёт
 * src/main/core/hub-client.ts и theme-gallery.ts (renderer не импортирует код main).
 */

import type { LocalClaim } from './hub-donations-api'

interface IpcResult<T> {
  ok: boolean
  value?: T
  message?: string
}

async function invoke<T>(channel: string, ...args: unknown[]): Promise<T> {
  const res = (await window.electron.ipcRenderer.invoke(channel, ...args)) as IpcResult<T>
  if (!res || !res.ok) {
    throw new Error(res?.message ?? `IPC ${channel} failed`)
  }
  return res.value as T
}

// ---- Типы ---------------------------------------------------------------------------------------

export type HubNoteKind = 'reply' | 'theme_ok' | 'theme_no' | 'announce' | 'warn' | 'ban' | 'don_ok' | 'don_no'

/** Цвет акцента объявления — ключ набора DON_PALETTE. */
export type AccentKey = 'gray' | 'violet' | 'gold' | 'blue' | 'cyan' | 'green' | 'orange' | 'red' | 'pink'

/** Уведомление: ответ автора, решение по теме, объявление, предупреждение или ответ по заявке. */
export interface HubNote {
  id: string
  kind: HubNoteKind
  title: string
  text: string
  at: number
  read: boolean
  /** warn / ban: жёлтое или красное. */
  lvl?: 'yellow' | 'red'
  /** id заявки у don_ok / don_no. */
  ref?: string
  /** warn / ban: «Понятно» нажато. */
  ack?: boolean
  ackPending?: boolean
  /** Объявление: эмодзи и цвет акцента. */
  emoji?: string
  accent?: AccentKey
}

export interface HubAnnounce {
  id: string
  text: string
  at: number
  until: number
  /** Дополнение: id объявления, которое оно дополняет, и время того объявления. */
  re?: string
  reAt?: number
  emoji?: string
  accent?: AccentKey
}

export interface HubInbox {
  /** Самое новое из показываемых (для мест, где ждут одно). */
  announce: HubAnnounce | null
  /** Все показываемые объявления: активные, не закрытые, новые сверху. */
  announces: HubAnnounce[]
  /** Новые сверху. */
  notes: HubNote[]
  unread: number
  /** Свои заявки о пожертвовании (старый main не присылает). */
  claims?: LocalClaim[]
  claimNick?: string
}

export type HubSendResult =
  | { ok: true; code?: string; warnings?: string[] }
  | { ok: false; error: string; message: string; retryAfterSec?: number; offerSave: boolean }

export interface BuiltReport {
  text: string
  bytes: number
}

export interface GalleryItem {
  id: string
  name: string
  author: string
  at: number
  hasWallpaper: boolean
  /** Лайков на сервере; null — счётчик неизвестен (старый Hub или запасной адрес). */
  likes: number | null
}

export interface GalleryView {
  themes: GalleryItem[]
  /** Всего тем в галерее (в themes может быть только начало). */
  total: number
  /** В themes весь список. */
  complete: boolean
  updated: number | string | null
  fetchedAt: number
  stale: boolean
  empty: boolean
  error?: string
}

export interface InstallResult {
  themeJson: string
  bgImage: string
  name: string
  author: string
  warning?: string
}

export interface ShareThemeInput {
  name: string
  author: string
  /** Результат exportTheme() из useAppearanceStore. */
  theme: string
  /** Текущее значение settings.bgImage. */
  bgImage: string
}

// ---- Вызовы --------------------------------------------------------------------------------------

/** Объявление и ответы из памяти main. refresh = true — спросить сервер прямо сейчас. */
export const hubInbox = (refresh = false): Promise<HubInbox> => invoke('hub:inbox', refresh)
/** Закрыть объявление: id — это одно, без id — все показанные. */
export const hubDismissAnnounce = (id?: string): Promise<void> => invoke('hub:dismissAnnounce', id)
export const hubMarkRepliesRead = (): Promise<HubInbox> => invoke('hub:markRepliesRead')
/** Отметить прочитанными: ids — только эти, без аргумента — все. */
export const hubNotesRead = (ids?: string[]): Promise<HubInbox> => invoke('hub:notesRead', ids)
export const hubNoteRemove = (id: string): Promise<HubInbox> => invoke('hub:noteRemove', id)
export const hubNotesClear = (): Promise<HubInbox> => invoke('hub:notesClear')
/** «Понятно» у предупреждения: плашка уходит, сервер узнаёт, что прочитано. */
export const hubAck = (id: string): Promise<HubInbox> => invoke('hub:ack', id)
/** full = false — без служб и журнала: только версия и система. */
export const hubBuildReport = (full = true): Promise<BuiltReport> => invoke('hub:buildReport', full)
export const hubSendReport = (note: string): Promise<HubSendResult> => invoke('hub:sendReport', note)
export const hubSaveReport = (note: string): Promise<{ saved: boolean; path?: string }> => invoke('hub:saveReport', note)
export const hubSendIdea = (text: string): Promise<HubSendResult> => invoke('hub:sendIdea', text)
/** mode 'head' — только самые новые (блок в «Оформлении»), 'full' — весь список. */
export const hubGalleryList = (force = false, mode: 'head' | 'full' = 'full'): Promise<GalleryView> => invoke('hub:galleryList', force, mode)
export const hubGalleryPreview = (id: string): Promise<string | null> => invoke('hub:galleryPreview', id)
export const hubGalleryInstall = (id: string): Promise<InstallResult> => invoke('hub:galleryInstall', id)
/** Снимок окна для превью темы (data-URL JPEG). */
export const hubCapturePreview = (): Promise<string> => invoke('hub:capturePreview')
export const hubShareTheme = (input: ShareThemeInput): Promise<HubSendResult> => invoke('hub:shareTheme', input)

/*
 * Отписка — только функцией, которую вернул on(). Прежний removeListener(channel, listener) не срабатывал:
 * при contextIsolation функция, переданная через contextBridge, каждый раз приходит в preload новой обёрткой,
 * и preload не находил слушателя. В режиме разработки React.StrictMode монтирует эффекты дважды —
 * оставался второй слушатель hub:notify, и каждое уведомление показывалось два раза.
 */

/** Подписка на событие `hub:inbox`; возвращает функцию отписки. */
export function onHubInbox(cb: (payload: HubInbox) => void): () => void {
  const listener = (_e: unknown, payload: HubInbox): void => cb(payload)
  return window.electron.ipcRenderer.on('hub:inbox', listener)
}

/** Новые уведомления (только что пришли): для всплывающего сообщения и звука. */
export function onHubNotify(cb: (fresh: HubNote[]) => void): () => void {
  const listener = (_e: unknown, payload: HubNote[]): void => cb(Array.isArray(payload) ? payload : [])
  return window.electron.ipcRenderer.on('hub:notify', listener)
}
