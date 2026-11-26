/** «Проверить» мини-окно: подсветка рамки на несколько секунд (канал mini:flash, событие mini:flash). */
interface IpcResult {
  ok: boolean
  message?: string
}

/** Открыть мини-окно (если закрыто) и подсветить его рамку. */
export async function miniFlash(): Promise<void> {
  const res = (await window.electron.ipcRenderer.invoke('mini:flash')) as IpcResult
  if (!res?.ok) throw new Error(res?.message ?? 'IPC mini:flash failed')
}

/** Для самого мини-окна: пришла команда подсветиться на ms миллисекунд. Возвращает отписку. */
export function onMiniFlash(cb: (ms: number) => void): () => void {
  const listener = (_e: unknown, ms: unknown): void => cb(Number(ms) > 0 ? Number(ms) : 5000)
  const offIpc = window.electron.ipcRenderer.on('mini:flash', listener)
  return () => {
    offIpc()
  }
}
