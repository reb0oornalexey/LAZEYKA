import React, { useMemo, useState } from 'react'
import { Loader2, Monitor, RefreshCw } from 'lucide-react'
import { Button } from '@renderer/components/ui/button'
import { LiveNumber, LzPanel, LzSectionHead } from '@renderer/components/lz'
import { SignalBars } from '@renderer/components/incy/signal'
import { cn } from '@renderer/lib/utils'
import type { TelegramDCPing } from '@renderer/utils/ipc'
import './telegram.css'

/*
 * Датацентры Telegram — радар. В центре этот компьютер, вокруг пять
 * датацентров: чем быстрее ответ, тем ближе точка к центру (шкала
 * логарифмическая, кольца 25 / 50 / 100 / 200 мс). Слева направо — с запада
 * на восток: Майами, Амстердам, Сингапур. Пока прокси работает, по линиям
 * к доступным датацентрам бегут точки. Справа — те же пять «станций»
 * строками; наведение на строку подсвечивает точку на радаре и наоборот.
 * Только реальные данные: замер задержки (tgws:pingDataCenters).
 */

/** Список на случай, когда замера ещё не было (совпадает с главным процессом). */
export const DC_FALLBACK: TelegramDCPing[] = [
  { dc: 1, name: 'DC1 (Pluto)', location: 'США (Майами)', ip: '149.154.175.50', port: 443, latencyMs: null, status: 'offline' },
  { dc: 2, name: 'DC2 (Venus)', location: 'Европа (Амстердам)', ip: '149.154.167.51', port: 443, latencyMs: null, status: 'offline' },
  { dc: 3, name: 'DC3 (Aurora)', location: 'США (Майами)', ip: '149.154.175.100', port: 443, latencyMs: null, status: 'offline' },
  { dc: 4, name: 'DC4 (Vesta)', location: 'Европа (Амстердам)', ip: '149.154.167.91', port: 443, latencyMs: null, status: 'offline' },
  { dc: 5, name: 'DC5 (Flora)', location: 'Азия (Сингапур)', ip: '91.108.56.165', port: 443, latencyMs: null, status: 'offline' }
]

/** Угол точки на радаре (градусы, 180 — запад, 0 — восток). */
const ANGLE: Record<number, number> = { 1: 163, 3: 145, 2: 106, 4: 80, 5: 30 }
const CITY_ANGLE: { name: string; deg: number }[] = [
  { name: 'Майами', deg: 154 },
  { name: 'Амстердам', deg: 93 },
  { name: 'Сингапур', deg: 20 }
]

const W = 520
const H = 262
const CX = W / 2
const CY = H - 22
const R = 212
const R0 = 34
/** Датацентр не ответил — точка у самого края, но не на подписях городов. */
const R_DOWN = R * 0.9
const RINGS = [25, 50, 100, 200]

/** Задержка → расстояние от центра (логарифмически, 10…400 мс). */
function radiusOf(ms: number): number {
  const f = Math.min(1, Math.max(0, Math.log(ms / 10) / Math.log(40)))
  return R0 + (R - R0) * f
}

function polar(r: number, deg: number): { x: number; y: number } {
  const a = (deg * Math.PI) / 180
  return { x: CX + r * Math.cos(a), y: CY - r * Math.sin(a) }
}

/** «DC2 (Venus)» → Venus; «Европа (Амстердам)» → Амстердам. */
function parts(d: TelegramDCPing): { code: string; nick: string; city: string; region: string } {
  const nick = /\(([^)]+)\)/.exec(d.name)?.[1] ?? d.name
  const m = /^(.*?)\s*\(([^)]+)\)\s*$/.exec(d.location)
  return { code: `DC${d.dc}`, nick, city: m ? m[2] : d.location, region: m ? m[1] : '' }
}

type DcState = 'ok' | 'slow' | 'down' | 'unknown'
function stateOf(d: TelegramDCPing, measured: boolean): DcState {
  if (!measured) return 'unknown'
  if (d.latencyMs === null) return 'down'
  return d.status === 'slow' ? 'slow' : 'ok'
}

const STATE_WORD: Record<DcState, string> = { ok: 'доступен', slow: 'медленно', down: 'недоступен', unknown: 'не проверен' }

/** Цвет состояния: доступен — цвет темы (как всё работающее), медленно — жёлтый, нет ответа — красный. */
function colorOf(s: DcState): string {
  if (s === 'ok') return 'var(--primary)'
  if (s === 'slow') return 'var(--st-warn)'
  if (s === 'down') return 'var(--st-err)'
  return 'var(--muted-foreground)'
}

interface Props {
  dcs: TelegramDCPing[]
  pinging: boolean
  checkedAt: number | null
  proxyOn: boolean
  onCheck: () => void
}

export const DcRadar: React.FC<Props> = ({ dcs, pinging, checkedAt, proxyOn, onCheck }) => {
  const measured = dcs.length > 0
  const list = measured ? dcs : DC_FALLBACK
  const [hot, setHot] = useState<number | null>(null)

  const reachable = list.filter((d) => measured && d.latencyMs !== null)
  const best = useMemo(
    () => reachable.reduce<TelegramDCPing | null>((b, d) => (b === null || (d.latencyMs ?? 1e9) < (b.latencyMs ?? 1e9) ? d : b), null),
    [reachable]
  )

  const sub = pinging
    ? 'Замеряем задержку до пяти датацентров…'
    : !measured
      ? 'Задержку ещё не замеряли'
      : reachable.length === 0
        ? 'Напрямую не отвечает ни один. Прокси подключается через WebSocket'
        : `Отвечают напрямую ${reachable.length} из ${list.length}${best ? `, ближе всех ${parts(best).code} (${best.latencyMs} мс)` : ''}`

  const time = checkedAt ? new Date(checkedAt).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }) : null

  return (
    <LzPanel data-tour="tg-datacenters" className="p-4">
      <LzSectionHead
        title="Датацентры Telegram"
        hint="Серверы Telegram стоят в пяти датацентрах: в Майами, Амстердаме и Сингапуре. Ваш аккаунт живёт в одном из них, фото и видео приходят и из других. На радаре в центре этот компьютер: чем быстрее датацентр отвечает напрямую, тем ближе к центру его точка. Если датацентр напрямую не отвечает, его, скорее всего, режет провайдер. Прокси ходит к Telegram через WebSocket, поэтому Telegram может работать и в этом случае."
        sub={sub}
        right={
          <>
            {time && !pinging && <span className="hidden text-[11.5px] text-muted-foreground sm:inline">проверено в {time}</span>}
            <Button
              size="sm"
              variant="outline"
              onClick={onCheck}
              disabled={pinging}
              data-tour="tg-dc-check"
              title="Замерить задержку до датацентров ещё раз"
              className="h-8 rounded-lg text-xs"
            >
              {pinging ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />}
              {pinging ? 'Проверяем…' : 'Проверить'}
            </Button>
          </>
        }
      />

      <div className="mt-3 grid items-center gap-x-5 gap-y-3 md:grid-cols-[minmax(0,1.12fr)_minmax(0,1fr)]">
        <Radar list={list} measured={measured} pinging={pinging} proxyOn={proxyOn} hot={hot} best={best?.dc ?? null} onHot={setHot} />

        <div className="flex flex-col gap-1.5" onMouseLeave={() => setHot(null)}>
          {list.map((d) => {
            const p = parts(d)
            const s = stateOf(d, measured)
            const isBest = best?.dc === d.dc && reachable.length > 1
            const color = colorOf(s)
            return (
              <div
                key={d.dc}
                onMouseEnter={() => setHot(d.dc)}
                title={
                  s === 'down'
                    ? `${p.code} напрямую не отвечает. Прокси подключается к Telegram через WebSocket, поэтому Telegram может работать и так.`
                    : `${p.code} ${p.nick}, ${p.city}. Адрес ${d.ip}:${d.port}`
                }
                className={cn(
                  'relative flex items-center gap-3 overflow-hidden rounded-xl border py-1.5 pr-3 pl-1.5 transition-colors',
                  hot === d.dc ? 'border-primary/40 bg-foreground/[0.06]' : 'border-foreground/[0.07] bg-foreground/[0.03]',
                  s === 'down' && 'bg-st-err/[0.06]',
                  s === 'slow' && 'bg-st-warn/[0.06]'
                )}
              >
                <span
                  className={cn(
                    'flex h-8 w-11 shrink-0 items-center justify-center rounded-lg text-[12px] font-extrabold tabular-nums',
                    s === 'unknown' ? 'bg-foreground/[0.06] text-muted-foreground' : 'text-foreground'
                  )}
                  style={s === 'unknown' ? undefined : { background: `color-mix(in oklab, ${color} 16%, transparent)`, color }}
                >
                  {p.code}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5 text-[13.5px] leading-tight font-bold text-foreground">
                    <span className="truncate">{p.city}</span>
                    {isBest && (
                      <span className="shrink-0 rounded-md bg-primary/12 px-1.5 py-px text-[10.5px] font-semibold text-primary">ближе всех</span>
                    )}
                  </span>
                  <span className="block truncate text-[11.5px] text-muted-foreground">
                    {p.nick}
                    {p.region ? `, ${p.region}` : ''}
                  </span>
                </span>
                <SignalBars ms={s === 'ok' || s === 'slow' ? d.latencyMs : null} unreachable={s === 'down'} on={s === 'ok'} />
                <span className="w-[76px] shrink-0 text-right">
                  <span className="block text-[15px] leading-tight font-extrabold tabular-nums" style={{ color: s === 'unknown' ? undefined : color }}>
                    {pinging && !measured ? (
                      <span className="text-muted-foreground">…</span>
                    ) : d.latencyMs !== null && measured ? (
                      <>
                        <LiveNumber value={d.latencyMs} />
                        <span className="ml-0.5 text-[11px] font-semibold">мс</span>
                      </>
                    ) : (
                      <span className={s === 'unknown' ? 'text-muted-foreground' : undefined}>—</span>
                    )}
                  </span>
                  <span className="block text-[11px] leading-tight text-muted-foreground">{pinging ? 'проверяем…' : STATE_WORD[s]}</span>
                </span>
              </div>
            )
          })}
        </div>
      </div>
    </LzPanel>
  )
}

interface RadarProps {
  list: TelegramDCPing[]
  measured: boolean
  pinging: boolean
  proxyOn: boolean
  hot: number | null
  best: number | null
  onHot: (dc: number | null) => void
}

const Radar: React.FC<RadarProps> = ({ list, measured, pinging, proxyOn, hot, best, onHot }) => {
  // Новый замер — новый ключ: точки заново «встают» на свои места.
  const popKey = list.map((d) => d.latencyMs ?? 'x').join('-')
  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className="h-auto w-full overflow-visible select-none"
      role="img"
      aria-label="Радар датацентров Telegram: чем ближе точка к центру, тем меньше задержка"
    >
      <defs>
        <radialGradient id="tg-radar-floor" cx="50%" cy="100%" r="100%">
          <stop offset="0%" stopColor="var(--primary)" stopOpacity={proxyOn ? 0.16 : 0.05} />
          <stop offset="70%" stopColor="var(--primary)" stopOpacity="0" />
        </radialGradient>
        <clipPath id="tg-radar-clip">
          <path d={`M ${CX - R} ${CY} A ${R} ${R} 0 0 1 ${CX + R} ${CY} Z`} />
        </clipPath>
      </defs>

      {/* Пол радара: полукруг со светом от центра. */}
      <path d={`M ${CX - R} ${CY} A ${R} ${R} 0 0 1 ${CX + R} ${CY} Z`} fill="url(#tg-radar-floor)" />

      {/* Кольца задержки. */}
      {RINGS.map((ms) => {
        const r = radiusOf(ms)
        return (
          <g key={ms}>
            <path
              d={`M ${CX - r} ${CY} A ${r} ${r} 0 0 1 ${CX + r} ${CY}`}
              fill="none"
              stroke="var(--foreground)"
              strokeOpacity={0.1}
              strokeDasharray="2 4"
            />
            <text x={CX + r - 3} y={CY - 4} textAnchor="end" fontSize="9.5" fill="var(--muted-foreground)" className="tabular-nums">
              {ms}
            </text>
          </g>
        )
      })}
      <path d={`M ${CX - R} ${CY} A ${R} ${R} 0 0 1 ${CX + R} ${CY}`} fill="none" stroke="var(--foreground)" strokeOpacity={0.16} />
      <line x1={CX - R - 6} y1={CY} x2={CX + R + 6} y2={CY} stroke="var(--foreground)" strokeOpacity={0.12} />
      <text x={CX + R + 6} y={CY + 13} textAnchor="end" fontSize="9.5" fill="var(--muted-foreground)">
        задержка, мс
      </text>
      <text x={CX - R - 6} y={CY + 13} textAnchor="start" fontSize="9.5" fill="var(--muted-foreground)">
        ближе к центру — быстрее
      </text>

      {/* Луч, пока идёт замер: линия и след за ней, обрезанные по полу радара. */}
      {pinging && (
        <g clipPath="url(#tg-radar-clip)">
          <g className="tg-sweep" style={{ transformOrigin: `${CX}px ${CY}px` }}>
            <path d={`M ${CX} ${CY} L ${CX - R} ${CY} A ${R} ${R} 0 0 0 ${polar(R, 208).x} ${polar(R, 208).y} Z`} fill="var(--primary)" fillOpacity={0.13} />
            <line x1={CX} y1={CY} x2={CX - R} y2={CY} stroke="var(--primary)" strokeOpacity={0.75} strokeWidth={1.5} />
          </g>
        </g>
      )}

      {/* Города по краю. */}
      {CITY_ANGLE.map((c) => {
        const p = polar(R + 9, c.deg)
        const cos = Math.cos((c.deg * Math.PI) / 180)
        return (
          <text
            key={c.name}
            x={p.x}
            y={p.y + (Math.abs(cos) < 0.3 ? 0 : 3)}
            textAnchor={cos < -0.3 ? 'end' : cos > 0.3 ? 'start' : 'middle'}
            fontSize="10.5"
            fontWeight={600}
            fill="var(--muted-foreground)"
          >
            {c.name}
          </text>
        )
      })}

      {/* Линии от компьютера к датацентрам. */}
      {list.map((d) => {
        const s = stateOf(d, measured)
        if (s === 'unknown') return null
        const r = d.latencyMs === null ? R_DOWN : radiusOf(d.latencyMs)
        const p = polar(r, ANGLE[d.dc] ?? 90)
        const isHot = hot === d.dc
        if (s === 'down')
          return (
            <line key={`l${d.dc}`} x1={CX} y1={CY} x2={p.x} y2={p.y} stroke="var(--st-err)" strokeOpacity={isHot ? 0.55 : 0.28} strokeDasharray="3 5" />
          )
        const color = colorOf(s)
        return (
          <g key={`l${d.dc}`}>
            <line x1={CX} y1={CY} x2={p.x} y2={p.y} stroke={color} strokeOpacity={proxyOn ? (isHot ? 0.5 : 0.22) : isHot ? 0.4 : 0.16} strokeWidth={isHot ? 2 : 1.4} />
            {proxyOn && <line x1={CX} y1={CY} x2={p.x} y2={p.y} stroke={color} strokeWidth={2.6} className="tg-flow" />}
          </g>
        )
      })}

      {/* Точки датацентров. */}
      {list.map((d, i) => {
        const s = stateOf(d, measured)
        const deg = ANGLE[d.dc] ?? 90
        const r = s === 'unknown' ? R * 0.66 : d.latencyMs === null ? R_DOWN : radiusOf(d.latencyMs)
        const p = polar(r, deg)
        const color = colorOf(s)
        const isHot = hot === d.dc
        const isBest = best === d.dc
        const cos = Math.cos((deg * Math.PI) / 180)
        const lx = p.x + (cos < -0.2 ? -12 : cos > 0.2 ? 12 : 0)
        const anchor = cos < -0.2 ? 'end' : cos > 0.2 ? 'start' : 'middle'
        const ly = Math.abs(cos) <= 0.2 ? p.y - 13 : p.y + 3.5
        return (
          <g
            key={`${popKey}-${d.dc}`}
            className={measured ? 'tg-pop' : undefined}
            style={{ animationDelay: `${i * 70}ms`, cursor: 'default' }}
            onMouseEnter={() => onHot(d.dc)}
            onMouseLeave={() => onHot(null)}
          >
            {(isHot || (isBest && proxyOn)) && s !== 'unknown' && <circle cx={p.x} cy={p.y} r={isHot ? 15 : 12} fill={color} fillOpacity={0.16} />}
            {s === 'unknown' ? (
              <circle cx={p.x} cy={p.y} r={5.5} fill="var(--card)" stroke="var(--muted-foreground)" strokeOpacity={0.6} strokeDasharray="2 2" />
            ) : s === 'down' ? (
              <g>
                <circle cx={p.x} cy={p.y} r={6.5} fill="var(--card)" stroke={color} strokeWidth={1.8} />
                <path d={`M ${p.x - 2.6} ${p.y - 2.6} L ${p.x + 2.6} ${p.y + 2.6} M ${p.x + 2.6} ${p.y - 2.6} L ${p.x - 2.6} ${p.y + 2.6}`} stroke={color} strokeWidth={1.6} strokeLinecap="round" />
              </g>
            ) : (
              <circle cx={p.x} cy={p.y} r={isHot ? 7.5 : 6.5} fill={color} stroke="var(--card)" strokeWidth={2} />
            )}
            <text
              x={lx}
              y={ly}
              textAnchor={anchor}
              fontSize="11"
              fontWeight={800}
              fill={s === 'unknown' ? 'var(--muted-foreground)' : 'var(--foreground)'}
              fillOpacity={isHot || hot === null ? 1 : 0.55}
            >
              DC{d.dc}
            </text>
          </g>
        )
      })}

      {/* Этот компьютер. */}
      <g>
        <title>Этот компьютер</title>
        <circle cx={CX} cy={CY} r={17} fill="var(--card)" stroke={proxyOn ? 'var(--primary)' : 'var(--foreground)'} strokeOpacity={proxyOn ? 0.8 : 0.25} strokeWidth={1.5} />
        <Monitor x={CX - 8.5} y={CY - 9.5} width={17} height={17} color={proxyOn ? 'var(--primary)' : 'var(--muted-foreground)'} strokeWidth={2} />
      </g>
    </svg>
  )
}

export default DcRadar
