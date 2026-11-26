/** Вызовы главного процесса для карточки «Stream Deck» (каналы streamdeck:*). */
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

export interface StreamDeckInfo {
  platform: string
  /** file — есть готовый файл; folder — соберём из папки; none — плагина в программе нет. */
  source: 'file' | 'folder' | 'none'
  elgatoFound: boolean
}

export interface StreamDeckResult {
  status: 'opened' | 'not-found' | 'error' | 'revealed'
  message: string
  file?: string
}

export const streamDeckInfo = (): Promise<StreamDeckInfo> => invoke('streamdeck:info')
export const streamDeckInstall = (force = false): Promise<StreamDeckResult> => invoke('streamdeck:install', force)
export const streamDeckReveal = (): Promise<StreamDeckResult> => invoke('streamdeck:reveal')
/** Подписанные ссылки этой установки: действие (`zapret/off`, `scenario/<id>`) → `lazeyka://…?k=…`. */
export const streamDeckLinks = (actions: string[]): Promise<Record<string, string>> => invoke('streamdeck:links', actions)
/** Выпустить новый секрет: прежние ссылки и установленный плагин начнут спрашивать подтверждение. */
export const streamDeckRotateKey = (): Promise<boolean> => invoke('streamdeck:rotateKey')

/** `lazeyka://zapret/off` → `zapret/off` (действие, которое подписывает программа). */
export function actionOf(url: string): string {
  return url.replace(/^lazeyka:\/\//, '').replace(/[?#].*$/, '')
}

export interface DeepLinkRow {
  /** Что делает кнопка. */
  title: string
  hint: string
  links: { label: string; url: string }[]
  /** Только Windows. */
  winOnly?: boolean
}

const trio = (base: string): { label: string; url: string }[] => [
  { label: 'Включить', url: `lazeyka://${base}/on` },
  { label: 'Выключить', url: `lazeyka://${base}/off` },
  { label: 'Переключить', url: `lazeyka://${base}/toggle` }
]

/** Кнопки плагина и их ссылки. Те же команды разбирает src/main/core/deeplink.ts. */
export const DEEPLINK_ROWS: DeepLinkRow[] = [
  {
    title: 'VPN (INCY)',
    hint: 'Подключает или отключает VPN на выбранном сейчас узле.',
    links: [
      { label: 'Подключить', url: 'lazeyka://connect' },
      { label: 'Отключить', url: 'lazeyka://disconnect' },
      { label: 'Переключить', url: 'lazeyka://toggle' }
    ]
  },
  { title: 'Zapret', hint: 'Включает или выключает обход блокировок Zapret с выбранной стратегией.', links: trio('zapret') },
  { title: 'Telegram-прокси', hint: 'Включает или выключает встроенный прокси для Telegram.', links: trio('telegram'), winOnly: true },
  { title: 'ExitLag', hint: 'Режим «VPN только для игр из списка». Список задаётся на странице ExitLag.', links: trio('exitlag') },
  { title: 'Мини-окно', hint: 'Показывает или скрывает маленькое окно поверх остальных.', links: [{ label: 'Показать или скрыть', url: 'lazeyka://mini' }] }
]
