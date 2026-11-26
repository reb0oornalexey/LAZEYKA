import { useEffect, useMemo, useState } from 'react'
import {
  Book,
  Briefcase,
  Camera,
  Code,
  Coffee,
  Cpu,
  Crosshair,
  Film,
  FolderOpen,
  Shapes,
  Smile,
  Gamepad2,
  Ghost,
  Globe,
  Headphones,
  Heart,
  Home,
  Joystick,
  Laptop,
  Loader2,
  Lock,
  MessageCircle,
  Monitor,
  Moon,
  Music,
  Plane,
  Rocket,
  Search,
  Send,
  Shield,
  Sparkles,
  Star,
  Sun,
  Swords,
  Target,
  Trophy,
  Tv,
  Wifi,
  Zap,
  type LucideIcon
} from 'lucide-react'
import { cn } from '@renderer/lib/utils'
import { Input } from '@renderer/components/ui/input'
import { Segmented, type SegmentedItem } from '@renderer/components/lz'
import {
  scenariosListAppIcons,
  scenariosPickIcon,
  scenariosSystemIcons,
  type AppIconEntry
} from '@renderer/utils/ipc'
import { platform } from '@renderer/utils/init'

const isWin = platform === 'win32'

/** Системные значки (рисуются в цвет темы). */
export const SYSTEM_ICONS: Record<string, LucideIcon> = {
  Gamepad2,
  Joystick,
  Swords,
  Crosshair,
  Target,
  Trophy,
  Ghost,
  Monitor,
  Laptop,
  Cpu,
  Tv,
  Film,
  Music,
  Headphones,
  Camera,
  MessageCircle,
  Send,
  Globe,
  Wifi,
  Shield,
  Lock,
  Zap,
  Rocket,
  Star,
  Heart,
  Sparkles,
  Briefcase,
  Code,
  Book,
  Coffee,
  Home,
  Plane,
  Sun,
  Moon
}

export const EMOJIS = [
  '🎮',
  '🕹️',
  '🎯',
  '⚔️',
  '🏆',
  '💼',
  '💻',
  '🎬',
  '🎧',
  '🎵',
  '📺',
  '💬',
  '🌙',
  '☀️',
  '⚡',
  '🔥',
  '🚀',
  '🔒',
  '🛡️',
  '🌍',
  '🏠',
  '✈️',
  '☕',
  '📚'
]

/** Шрифты эмодзи: сначала цветные системные (macOS, Windows, Linux). */
const EMOJI_FONT =
  "'Apple Color Emoji', 'Segoe UI Emoji', 'Noto Color Emoji', 'Segoe UI Symbol', sans-serif"

const inkOffsets = new Map<string, { x: number; y: number }>()

/**
 * Насколько сдвинуть эмодзи (в em), чтобы его рисунок встал точно по центру.
 * У шрифтов эмодзи своя высота строки и базовая линия: Segoe UI Emoji рисует
 * знак ниже и правее середины строки, Apple Color Emoji — иначе. Поэтому
 * меряем сам рисунок на холсте тем же шрифтом и считаем поправку один раз.
 */
function emojiInkOffset(emoji: string): { x: number; y: number } {
  const hit = inkOffsets.get(emoji)
  if (hit) return hit
  let out = { x: 0, y: 0 }
  try {
    const ctx = document.createElement('canvas').getContext('2d')
    if (ctx) {
      const size = 100
      ctx.font = `${size}px ${EMOJI_FONT}`
      const m = ctx.measureText(emoji)
      const asc = m.fontBoundingBoxAscent
      const desc = m.fontBoundingBoxDescent
      if (
        m.width > 0 &&
        Number.isFinite(asc) &&
        Number.isFinite(desc) &&
        m.actualBoundingBoxAscent + m.actualBoundingBoxDescent > 0
      ) {
        // Строка высотой 1em (line-height: 1): базовая линия — по середине области шрифта.
        const baseline = (size - (asc + desc)) / 2 + asc
        const inkMidY = baseline + (m.actualBoundingBoxDescent - m.actualBoundingBoxAscent) / 2
        const inkMidX = (m.actualBoundingBoxRight - m.actualBoundingBoxLeft) / 2
        const clamp = (v: number): number => Math.max(-0.3, Math.min(0.3, v))
        out = { x: clamp((m.width / 2 - inkMidX) / size), y: clamp((size / 2 - inkMidY) / size) }
      }
    }
  } catch {
    /* без поправки */
  }
  inkOffsets.set(emoji, out)
  return out
}

/** Эмодзи строго по центру своей рамки (рамка задаётся className: size-*, text-*). */
export function EmojiGlyph({
  emoji,
  className
}: {
  emoji: string
  className?: string
}): React.ReactElement {
  const o = useMemo(() => emojiInkOffset(emoji), [emoji])
  return (
    <span
      aria-hidden
      className={cn(
        'inline-flex shrink-0 select-none items-center justify-center leading-none',
        className
      )}
      style={{ fontFamily: EMOJI_FONT }}
    >
      <span
        className="block whitespace-nowrap leading-none"
        style={
          o.x || o.y
            ? { transform: `translate(${o.x.toFixed(3)}em, ${o.y.toFixed(3)}em)` }
            : undefined
        }
      >
        {emoji}
      </span>
    </span>
  )
}

/** Значок сценария: картинка программы, системный значок или эмодзи. */
export function ScenarioIcon({
  icon,
  emoji,
  className
}: {
  icon?: string
  emoji: string
  className?: string
}): React.ReactElement {
  if (icon?.startsWith('data:image/'))
    return (
      <img src={icon} alt="" draggable={false} className={cn('size-7 object-contain', className)} />
    )
  if (icon?.startsWith('lucide:')) {
    const I = SYSTEM_ICONS[icon.slice(7)]
    if (I) return <I className={cn('size-6 text-primary', className)} />
  }
  return <EmojiGlyph emoji={emoji} className={cn('size-7 text-2xl', className)} />
}

type Tab = 'emoji' | 'system' | 'windows' | 'apps'

/** Выбор значка: эмодзи, системные, установленные программы и игры, свой файл. */
export function ScenarioIconPicker({
  icon,
  emoji,
  onChange
}: {
  icon?: string
  emoji: string
  onChange: (v: { icon?: string; emoji?: string }) => void
}): React.ReactElement {
  const [tab, setTab] = useState<Tab>(
    icon?.startsWith('data:') ? 'apps' : icon?.startsWith('lucide:') ? 'system' : 'emoji'
  )
  const [apps, setApps] = useState<AppIconEntry[] | null>(null)
  const [q, setQ] = useState('')
  const [picking, setPicking] = useState(false)
  const [winIcons, setWinIcons] = useState<{ id: string; png: string }[] | null>(null)

  useEffect(() => {
    if (tab !== 'windows' || winIcons) return
    let alive = true
    scenariosSystemIcons()
      .then((l) => alive && setWinIcons(l))
      .catch(() => alive && setWinIcons([]))
    return () => {
      alive = false
    }
  }, [tab, winIcons])

  useEffect(() => {
    if (tab !== 'apps' || apps) return
    let alive = true
    scenariosListAppIcons()
      .then((l) => alive && setApps(l))
      .catch(() => alive && setApps([]))
    return () => {
      alive = false
    }
  }, [tab, apps])

  const shown = useMemo(() => {
    const s = q.trim().toLowerCase()
    return (apps ?? []).filter((a) => !s || a.name.toLowerCase().includes(s))
  }, [apps, q])

  const tabs: SegmentedItem<Tab>[] = [
    { id: 'emoji', label: 'Эмодзи', icon: Smile },
    { id: 'apps', label: 'Программы и игры', icon: Gamepad2 },
    { id: 'system', label: 'Простые', icon: Shapes },
    ...(isWin ? [{ id: 'windows' as Tab, label: 'Windows', icon: Monitor }] : [])
  ]
  const cell = (active: boolean): string =>
    cn(
      'flex size-11 cursor-pointer items-center justify-center rounded-xl border transition-colors',
      active ? 'border-primary/60 bg-primary/15' : 'border-transparent hover:border-foreground/[0.1] hover:bg-foreground/[0.05]'
    )

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Segmented<Tab> size="sm" aria-label="Вид значка" className="flex-1" items={tabs} value={tab} onChange={setTab} />
        <button
          type="button"
          disabled={picking}
          onClick={() => {
            setPicking(true)
            void scenariosPickIcon()
              .then((d) => d && onChange({ icon: d }))
              .finally(() => setPicking(false))
          }}
          className="inline-flex h-9 shrink-0 cursor-pointer items-center gap-1.5 rounded-xl border border-foreground/[0.1] px-3 text-xs font-semibold text-muted-foreground transition-colors hover:border-primary/45 hover:text-foreground"
          title="Значок из любого .exe, ярлыка или картинки"
        >
          {picking ? <Loader2 className="size-3.5 animate-spin" /> : <FolderOpen className="size-3.5" />}
          Из файла…
        </button>
      </div>

      {tab === 'emoji' && (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(2.75rem,1fr))] gap-1">
          {EMOJIS.map((e) => (
            <button
              key={e}
              type="button"
              aria-label={e}
              className={cell(!icon && emoji === e)}
              onClick={() => onChange({ emoji: e, icon: undefined })}
            >
              <EmojiGlyph emoji={e} className="size-7 text-[24px]" />
            </button>
          ))}
        </div>
      )}

      {tab === 'system' && (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(2.75rem,1fr))] gap-1">
          {Object.entries(SYSTEM_ICONS).map(([name, I]) => (
            <button
              key={name}
              type="button"
              title={name}
              className={cell(icon === `lucide:${name}`)}
              onClick={() => onChange({ icon: `lucide:${name}` })}
            >
              <I className="size-[22px] text-primary" />
            </button>
          ))}
        </div>
      )}

      {tab === 'windows' && (
        <div>
          {!winIcons ? (
            <div className="flex items-center gap-2 px-1 py-3 text-xs text-muted-foreground">
              <Loader2 className="size-3.5 animate-spin" /> Загружаю значки Windows (первый раз —
              несколько секунд)…
            </div>
          ) : winIcons.length === 0 ? (
            <div className="px-1 py-3 text-xs text-muted-foreground">
              Не удалось получить значки Windows. Нажмите «Из файла…» и выберите любой .dll, .exe
              или .ico.
            </div>
          ) : (
            <div className="grid grid-cols-[repeat(auto-fill,minmax(2.75rem,1fr))] gap-1">
              {winIcons.map((w) => (
                <button
                  key={w.id}
                  type="button"
                  title={w.id}
                  className={cell(icon === w.png)}
                  onClick={() => onChange({ icon: w.png })}
                >
                  <img
                    src={w.png}
                    alt=""
                    className="size-7 object-contain"
                    draggable={false}
                    loading="lazy"
                  />
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {tab === 'apps' && (
        <div className="space-y-2">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Найти программу или игру"
              className="h-9 rounded-xl pl-8 text-[13px]"
            />
          </div>
          {!apps ? (
            <div className="flex items-center gap-2 px-1 py-3 text-xs text-muted-foreground">
              <Loader2 className="size-3.5 animate-spin" /> Ищу игры (Steam, Epic) и программы…
            </div>
          ) : shown.length === 0 ? (
            <div className="px-1 py-3 text-xs text-muted-foreground">
              Ничего не нашлось. Нажмите «Из файла…» и выберите .exe игры или её ярлык.
            </div>
          ) : (
            <div className="space-y-3">
              {(['game', 'app'] as const).map((kind) => {
                const part = shown.filter((a) => a.kind === kind)
                if (part.length === 0) return null
                return (
                  <div key={kind}>
                    <div className="mb-1.5 px-1 text-[12px] font-semibold text-muted-foreground">
                      {kind === 'game' ? 'Игры' : 'Программы'} <span className="tabular-nums">{part.length}</span>
                    </div>
                    <div className="grid grid-cols-[repeat(auto-fill,minmax(4.5rem,1fr))] gap-1">
                      {part.map((a) => (
                        <button
                          key={a.path}
                          type="button"
                          title={a.name}
                          onClick={() => onChange({ icon: a.icon })}
                          className={cn(
                            'flex cursor-pointer flex-col items-center gap-1 rounded-xl border p-1.5 transition-colors',
                            icon === a.icon
                              ? 'border-primary/60 bg-primary/15'
                              : 'border-transparent hover:border-foreground/[0.1] hover:bg-foreground/[0.05]'
                          )}
                        >
                          <img
                            src={a.icon}
                            alt=""
                            className="size-8 rounded-md object-contain"
                            draggable={false}
                          />
                          <span className="line-clamp-2 w-full text-center text-[10px] leading-tight text-muted-foreground">
                            {a.name}
                          </span>
                        </button>
                      ))}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
