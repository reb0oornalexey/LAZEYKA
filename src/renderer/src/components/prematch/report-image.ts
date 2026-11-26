import type { MatchReport, VerdictKind } from '@renderer/utils/prematch-api'
import { fmtDateTime, fmtDuration } from './format'
import { niceScale } from './ping-chart'

const W = 1200
const H = 675
const FONT = '"Segoe UI", "SF Pro Text", system-ui, -apple-system, Arial, sans-serif'
const COLORS: Record<VerdictKind, string> = { good: '#34d399', warn: '#fbbf24', bad: '#f87171', unknown: '#94a3b8' }

function wrap(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const words = text.split(/\s+/)
  const lines: string[] = []
  let line = ''
  for (const w of words) {
    const test = line ? `${line} ${w}` : w
    if (ctx.measureText(test).width > maxWidth && line) {
      lines.push(line)
      line = w
    } else {
      line = test
    }
  }
  if (line) lines.push(line)
  return lines
}

/**
 * Карточка отчёта на <canvas>: тёмный фон, надпись LAZEYKA, цель, цифры, график.
 * IP пользователя на картинке нет — только адрес цели, который он сам указал.
 * Возвращает PNG как dataURL.
 */
export function renderReportImage(r: MatchReport): string {
  const canvas = document.createElement('canvas')
  canvas.width = W
  canvas.height = H
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Не удалось создать изображение')

  const bg = ctx.createLinearGradient(0, 0, W, H)
  bg.addColorStop(0, '#0b0f14')
  bg.addColorStop(1, '#111827')
  ctx.fillStyle = bg
  ctx.fillRect(0, 0, W, H)

  // Шапка.
  ctx.textBaseline = 'alphabetic'
  ctx.fillStyle = '#e5e7eb'
  ctx.font = `800 34px ${FONT}`
  ctx.fillText('LAZEYKA', 48, 30 + 34)
  ctx.fillStyle = '#94a3b8'
  ctx.font = `500 18px ${FONT}`
  ctx.fillText('Отчёт о матче', 48, 100)
  ctx.textAlign = 'right'
  ctx.fillText(fmtDateTime(r.startedAt), W - 48, 64)
  ctx.textAlign = 'left'

  // Цель.
  ctx.fillStyle = '#cbd5e1'
  ctx.font = `600 22px ${FONT}`
  ctx.fillText(`Сервер: ${r.target.label}`, 48, 140)

  // Вердикт.
  const color = COLORS[r.verdict.kind]
  ctx.fillStyle = color
  ctx.font = `700 26px ${FONT}`
  const vLines = wrap(ctx, r.verdict.text, W - 96).slice(0, 2)
  vLines.forEach((l, i) => ctx.fillText(l, 48, 184 + i * 32))

  // Плитки с цифрами.
  const st = r.stats
  const tiles: [string, string][] = [
    ['Средний пинг', st.avgMs == null ? '—' : `${st.avgMs} мс`],
    ['Мин / макс', st.minMs == null ? '—' : `${st.minMs} / ${st.maxMs}`],
    ['Джиттер', st.jitterMs == null ? '—' : `±${st.jitterMs} мс`],
    ['Потери', `${st.lossPct}%`],
    ['Скачки', String(st.spikes)],
    ['Длительность', fmtDuration(r.durationMs)]
  ]
  const tileY = 252
  const gap = 14
  const tw = (W - 96 - gap * (tiles.length - 1)) / tiles.length
  tiles.forEach(([label, value], i) => {
    const x = 48 + i * (tw + gap)
    ctx.fillStyle = 'rgba(255,255,255,0.05)'
    ctx.beginPath()
    ctx.roundRect(x, tileY, tw, 92, 14)
    ctx.fill()
    ctx.fillStyle = '#94a3b8'
    ctx.font = `500 15px ${FONT}`
    ctx.fillText(label, x + 16, tileY + 30)
    ctx.fillStyle = '#f1f5f9'
    ctx.font = `700 26px ${FONT}`
    ctx.fillText(value, x + 16, tileY + 68)
  })

  // График.
  const cx = 48
  const cy = 372
  const cw = W - 96
  const ch = 220
  const left = cx + 40
  const iw = cw - 40
  const maxVal = Math.max(0, ...r.seriesMax.map((v) => v ?? 0), r.baselineMs ?? 0)
  const { top, ticks } = niceScale(maxVal)
  const yOf = (v: number): number => cy + ch - (Math.min(v, top) / top) * ch
  const n = r.series.length
  const xOf = (i: number): number => left + (n <= 1 ? iw / 2 : (i / (n - 1)) * iw)

  ctx.font = `400 13px ${FONT}`
  ctx.lineWidth = 1
  for (const t of ticks) {
    ctx.strokeStyle = 'rgba(255,255,255,0.08)'
    ctx.beginPath()
    ctx.moveTo(left, yOf(t))
    ctx.lineTo(left + iw, yOf(t))
    ctx.stroke()
    ctx.fillStyle = '#64748b'
    ctx.textAlign = 'right'
    ctx.fillText(String(t), left - 8, yOf(t) + 4)
  }
  ctx.textAlign = 'left'
  const barW = Math.max(2, Math.min(8, iw / Math.max(n, 1)))
  ctx.fillStyle = 'rgba(248,113,113,0.35)'
  r.seriesLost.forEach((c, i) => {
    if (c > 0) ctx.fillRect(xOf(i) - barW / 2, cy, barW, ch)
  })
  if (r.baselineMs != null) {
    ctx.setLineDash([6, 5])
    ctx.strokeStyle = 'rgba(148,163,184,0.6)'
    ctx.beginPath()
    ctx.moveTo(left, yOf(r.baselineMs))
    ctx.lineTo(left + iw, yOf(r.baselineMs))
    ctx.stroke()
    ctx.setLineDash([])
  }
  const line = (arr: (number | null)[], stroke: string, width: number): void => {
    ctx.strokeStyle = stroke
    ctx.lineWidth = width
    ctx.lineJoin = 'round'
    ctx.beginPath()
    let pen = false
    arr.forEach((v, i) => {
      if (v == null) {
        pen = false
        return
      }
      if (pen) ctx.lineTo(xOf(i), yOf(v))
      else ctx.moveTo(xOf(i), yOf(v))
      pen = true
    })
    ctx.stroke()
  }
  line(r.seriesMax, 'rgba(96,165,250,0.35)', 1.2)
  line(r.series, '#60a5fa', 2.4)

  // Подвал.
  ctx.fillStyle = '#64748b'
  ctx.font = `400 15px ${FONT}`
  ctx.fillText('Пинг в мс. Красные полосы: потерянные пакеты. Замер напрямую, без VPN.', 48, H - 28)
  ctx.textAlign = 'right'
  ctx.fillText(`Замеров: ${st.sent}, ${r.method === 'a2s' ? 'запрос игрового сервера' : 'ICMP-пинг'}`, W - 48, H - 28)
  ctx.textAlign = 'left'

  return canvas.toDataURL('image/png')
}
