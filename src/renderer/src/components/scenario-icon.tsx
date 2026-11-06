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
import { scenariosListAppIcons, scenariosPickIcon, scenariosSystemIcons, type AppIconEntry } from '@renderer/utils/ipc'
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

export const EMOJIS = ['🎮', '🕹️', '🎯', '⚔️', '🏆', '💼', '💻', '🎬', '🎧', '🎵', '📺', '💬', '🌙', '☀️', '⚡', '🔥', '🚀', '🔒', '🛡️', '🌍', '🏠', '✈️', '☕', '📚']

/** Значок сценария: картинка программы, системный значок или эмодзи. */
export function ScenarioIcon({ icon, emoji, className }: { icon?: string; emoji: string; className?: string }): React.ReactElement {
  if (icon?.startsWith('data:image/')) return <img src={icon} alt="" draggable={false} className={cn('size-7 object-contain', className)} />
  if (icon?.startsWith('lucide:')) {
    const I = SYSTEM_ICONS[icon.slice(7)]
    if (I) return <I className={cn('size-6 text-primary', className)} />
  }
  return <span className={cn('text-2xl leading-none', className)}>{emoji}</span>
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
  const [tab, setTab] = useState<Tab>(icon?.startsWith('data:') ? 'apps' : icon?.startsWith('lucide:') ? 'system' : 'emoji')
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

  const tabBtn = (id: Tab, label: string): React.ReactElement => (
    <button
      type="button"
      onClick={() => setTab(id)}
      className={cn(
        'cursor-pointer rounded-md px-2.5 py-1 text-xs font-semibold transition-colors',
        tab === id ? 'bg-primary/20 text-foreground' : 'text-muted-foreground hover:text-foreground'
      )}
    >
      {label}
    </button>
  )
  const cell = (active: boolean): string =>
    cn(
      'flex size-9 cursor-pointer items-center justify-center rounded-lg transition-colors',
      active ? 'bg-primary/20 ring-1 ring-primary/50' : 'hover:bg-foreground/[0.06]'
    )

  return (
    <div className="space-y-2 rounded-xl border border-border bg-card/40 p-2.5">
      <div className="flex flex-wrap items-center gap-1">
        {tabBtn('emoji', 'Эмодзи')}
        {tabBtn('apps', 'Программы и игры')}
        {tabBtn('system', 'Простые')}
        {isWin && tabBtn('windows', 'Windows')}
        <button
          type="button"
          disabled={picking}
          onClick={() => {
            setPicking(true)
            void scenariosPickIcon()
              .then((d) => d && onChange({ icon: d }))
              .finally(() => setPicking(false))
          }}
          className="ml-auto inline-flex cursor-pointer items-center gap-1 rounded-md px-2 py-1 text-xs text-muted-foreground hover:text-foreground"
          title="Значок из любого .exe, ярлыка или картинки"
        >
          {picking ? <Loader2 className="size-3.5 animate-spin" /> : <FolderOpen className="size-3.5" />}
          Из файла…
        </button>
      </div>

      {tab === 'emoji' && (
        <div className="flex flex-wrap gap-1">
          {EMOJIS.map((e) => (
            <button key={e} type="button" className={cn(cell(!icon && emoji === e), 'text-lg')} onClick={() => onChange({ emoji: e, icon: undefined })}>
              {e}
            </button>
          ))}
        </div>
      )}

      {tab === 'system' && (
        <div className="flex flex-wrap gap-1">
          {Object.entries(SYSTEM_ICONS).map(([name, I]) => (
            <button key={name} type="button" title={name} className={cell(icon === `lucide:${name}`)} onClick={() => onChange({ icon: `lucide:${name}` })}>
              <I className="size-5 text-primary" />
            </button>
          ))}
        </div>
      )}

      {tab === 'windows' && (
        <div>
          {!winIcons ? (
            <div className="flex items-center gap-2 px-1 py-3 text-xs text-muted-foreground">
              <Loader2 className="size-3.5 animate-spin" /> Загружаю значки Windows (первый раз — несколько секунд)…
            </div>
          ) : winIcons.length === 0 ? (
            <div className="px-1 py-3 text-xs text-muted-foreground">Не удалось получить значки Windows. Нажмите «Из файла…» и выберите любой .dll, .exe или .ico.</div>
          ) : (
            <div className="grid max-h-64 grid-cols-[repeat(auto-fill,minmax(2.5rem,1fr))] gap-1 overflow-y-auto pr-1">
              {winIcons.map((w) => (
                <button key={w.id} type="button" title={w.id} className={cell(icon === w.png)} onClick={() => onChange({ icon: w.png })}>
                  <img src={w.png} alt="" className="size-7 object-contain" draggable={false} loading="lazy" />
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {tab === 'apps' && (
        <div className="space-y-2">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Найти программу или игру" className="h-8 pl-7 text-xs" />
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
            <div className="max-h-64 space-y-2 overflow-y-auto pr-1">
              {(['game', 'app'] as const).map((kind) => {
                const part = shown.filter((a) => a.kind === kind)
                if (part.length === 0) return null
                return (
                  <div key={kind}>
                    <div className="mb-1 px-1 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                      {kind === 'game' ? `Игры · ${part.length}` : `Программы · ${part.length}`}
                    </div>
                    <div className="grid grid-cols-[repeat(auto-fill,minmax(4.5rem,1fr))] gap-1">
                      {part.map((a) => (
                        <button
                          key={a.path}
                          type="button"
                          title={a.name}
                          onClick={() => onChange({ icon: a.icon })}
                          className={cn(
                            'flex cursor-pointer flex-col items-center gap-1 rounded-lg p-1.5 transition-colors',
                            icon === a.icon ? 'bg-primary/20 ring-1 ring-primary/50' : 'hover:bg-foreground/[0.06]'
                          )}
                        >
                          <img src={a.icon} alt="" className="size-8 rounded-md object-contain" draggable={false} />
                          <span className="line-clamp-2 w-full text-center text-[10px] leading-tight text-muted-foreground">{a.name}</span>
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
