/**
 * Лайки, избранное и обои для просмотра в галерее тем (В15–В16).
 * Типы повторяют src/main/core/gallery-social.ts (renderer не импортирует код main).
 */
interface IpcResult<T> {
  ok: boolean
  value?: T
  message?: string
}

async function invoke<T>(channel: string, ...args: unknown[]): Promise<T> {
  const res = (await window.electron.ipcRenderer.invoke(channel, ...args)) as IpcResult<T>
  if (!res || !res.ok) throw new Error(res?.message ?? `IPC ${channel} failed`)
  return res.value as T
}

export interface GallerySocial {
  /** Темы, которые лайкнула эта установка. */
  liked: string[]
  /** Избранное — только на этом компьютере. */
  fav: string[]
}

export type LikeResult =
  | { ok: true; id: string; likes: number; liked: boolean }
  | { ok: false; error: 'network' | 'too_often' | 'blocked' | 'not_found' | 'unsupported' | 'server'; message: string }

export const gallerySocial = (): Promise<GallerySocial> => invoke('gallery:social')
/** Один запрос на Hub, только по нажатию. */
export const galleryLike = (id: string, on: boolean): Promise<LikeResult> => invoke('gallery:like', id, on)
/** Без сети. */
export const galleryFav = (id: string, on: boolean): Promise<GallerySocial> => invoke('gallery:fav', id, on)
/** Обои темы (data-URL) для вкладки «Только обои»; null — нет или не скачались. */
export const galleryWallpaper = (id: string): Promise<string | null> => invoke('gallery:wallpaper', id)
