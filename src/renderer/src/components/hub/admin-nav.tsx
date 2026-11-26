import React from 'react'
import { BarChart3, Cloud, Globe, HandHeart, KeyRound, LayoutDashboard, Megaphone, TriangleAlert } from 'lucide-react'
import { cn } from '@renderer/lib/utils'
import { LzPanel, TONE_FILL, type LzTone } from '@renderer/components/lz'

/*
 * Навигация «Админки» (Е8): список разделов слева, как группы в «Настройках».
 * У каждого раздела — живая строка состояния («ждут 2 заявки», «расход 42 %»)
 * и, если что-то ждёт решения, счётчик справа. Открытый раздел запоминается.
 */

export type AdminTab = 'overview' | 'announce' | 'donations' | 'warn' | 'stats' | 'dns' | 'cloudflare' | 'device'

export const ADMIN_TABS: { id: AdminTab; title: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { id: 'overview', title: 'Обзор', icon: LayoutDashboard },
  { id: 'announce', title: 'Объявления', icon: Megaphone },
  { id: 'donations', title: 'Пожертвования', icon: HandHeart },
  { id: 'warn', title: 'Предупреждения', icon: TriangleAlert },
  { id: 'stats', title: 'Статистика', icon: BarChart3 },
  { id: 'dns', title: 'Каталог DNS', icon: Globe },
  { id: 'cloudflare', title: 'Cloudflare', icon: Cloud },
  { id: 'device', title: 'Это устройство', icon: KeyRound }
]

export const isAdminTab = (v: unknown): v is AdminTab => typeof v === 'string' && ADMIN_TABS.some((t) => t.id === v)

export interface AdminNavStatus {
  text: string
  tone: LzTone
  /** Счётчик справа (ждут решения). */
  badge?: number
}

export const AdminNav: React.FC<{
  active: AdminTab
  status: Partial<Record<AdminTab, AdminNavStatus>>
  onSelect: (t: AdminTab) => void
}> = ({ active, status, onSelect }) => (
  <LzPanel className="sticky top-0 p-2" data-tour="admin-nav">
    <nav className="flex flex-col gap-0.5" aria-label="Разделы админки">
      {ADMIN_TABS.map((g) => {
        const Icon = g.icon
        const on = g.id === active
        const st = status[g.id]
        return (
          <button
            key={g.id}
            type="button"
            data-admin-tab={g.id}
            aria-current={on ? 'page' : undefined}
            onClick={() => onSelect(g.id)}
            className={cn(
              'relative flex w-full cursor-pointer items-center gap-2.5 overflow-hidden rounded-xl px-2.5 py-2 text-left transition-colors',
              on ? 'bg-primary/10' : 'hover:bg-foreground/[0.045]'
            )}
          >
            {/* Полоса сигнала у открытого раздела. */}
            <span aria-hidden className={cn('absolute top-2 bottom-2 left-0 w-[3px] rounded-r-full bg-primary transition-opacity', on ? 'opacity-100' : 'opacity-0')} />
            <span className={cn('flex size-7 shrink-0 items-center justify-center rounded-lg [&_svg]:size-4', on ? 'text-primary' : 'text-muted-foreground')}>
              <Icon />
            </span>
            <span className="min-w-0 flex-1">
              <span className={cn('block truncate text-[13px] leading-tight font-semibold', on ? 'text-foreground' : 'text-foreground/85')}>{g.title}</span>
              {st && (
                <span className="mt-0.5 flex items-center gap-1.5 truncate text-[11px] leading-tight text-muted-foreground">
                  <span aria-hidden className={cn('size-1.5 shrink-0 rounded-full', TONE_FILL[st.tone])} />
                  <span className="truncate">{st.text}</span>
                </span>
              )}
            </span>
            {st?.badge ? (
              <span
                className={cn(
                  'flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full px-1.5 text-[10.5px] font-bold tabular-nums',
                  st.tone === 'warn' ? 'bg-st-warn text-black' : 'bg-primary text-primary-foreground'
                )}
              >
                {st.badge}
              </span>
            ) : null}
          </button>
        )
      })}
    </nav>
  </LzPanel>
)
