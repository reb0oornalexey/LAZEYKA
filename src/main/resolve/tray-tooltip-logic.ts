/** Е6: текст подсказки значка в трее. Чистая логика без Electron. */

export interface TrayTooltipInput {
  zapret: string
  tgws: string
  incy: string
  /** Telegram-прокси есть только на Windows. */
  hasTgws: boolean
  node?: string | null
  pingMs?: number | null
  /** Режим стримера скрывает название узла. */
  hideNode?: boolean
}

/** Windows обрезает подсказку значка до 127 знаков. */
export const TRAY_TOOLTIP_MAX = 127

const word = (st: string, on: string): string =>
  st === 'running' ? on : st === 'starting' || st === 'connecting' ? 'запуск…' : st === 'error' ? 'ошибка' : 'выкл.'

/** Чистая сборка текста подсказки. */
export function buildTrayTooltip(i: TrayTooltipInput): string {
  const lines = ['LAZEYKA']
  let vpn = `VPN: ${word(i.incy, 'вкл.')}`
  if (i.incy === 'running') {
    const node = i.hideNode ? '' : (i.node ?? '').trim()
    const ping = typeof i.pingMs === 'number' && i.pingMs > 0 ? `${Math.round(i.pingMs)} мс` : ''
    const extra = [node, ping].filter(Boolean).join(', ')
    if (extra) vpn += ` — ${extra}`
  }
  lines.push(`Zapret: ${word(i.zapret, 'вкл.')}`)
  if (i.hasTgws) lines.push(`Telegram: ${word(i.tgws, 'вкл.')}`)
  lines.push(vpn)
  let text = lines.join('\n')
  if (text.length > TRAY_TOOLTIP_MAX) text = text.slice(0, TRAY_TOOLTIP_MAX - 1) + '…'
  return text
}
