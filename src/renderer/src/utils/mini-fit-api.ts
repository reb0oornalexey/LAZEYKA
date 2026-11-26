/** Размер мини-окна по содержимому (канал mini:fit). Окно само растёт вокруг якоря: решает главный процесс. */
interface IpcResult {
  ok: boolean
  message?: string
}

export async function miniFit(width: number, height: number): Promise<void> {
  const res = (await window.electron.ipcRenderer.invoke('mini:fit', { width, height })) as IpcResult
  if (!res?.ok) throw new Error(res?.message ?? 'IPC mini:fit failed')
}
