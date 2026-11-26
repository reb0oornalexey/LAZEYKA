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

export interface DnsProbeItem {
  target: string
  kind: 'ipv4' | 'ipv6' | 'doh'
  /** Время ответа в мс; null — нет ответа. */
  ms: number | null
}

/** Проверить введённые адреса и шаблон DoH до сохранения (по кнопке «Проверить»). */
export const dnsProbeCheck = (input: {
  ipv4: string[]
  ipv6: string[]
  doh: string
}): Promise<DnsProbeItem[]> => invoke('dnsProbe:check', input)
