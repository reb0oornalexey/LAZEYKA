import React from 'react'
import { HandCoins, HandHeart, Megaphone, MessageSquareReply, Palette, ShieldAlert, TriangleAlert } from 'lucide-react'
import type { HubNote } from '@renderer/utils/hub-api'
import { DON_PALETTE } from '@renderer/utils/hub-donations-api'
import { cn } from '@renderer/lib/utils'

/** Вид уведомления по типу: значок, цвет, подпись, пояснение и переход. Один источник для всех мест. */
export interface NoteKindInfo {
  icon: React.ComponentType<{ className?: string }>
  /** Подпись типа. */
  label: string
  /** Классы плашки-значка (фон + цвет). */
  chip: string
  /** Полоска слева у непрочитанного. */
  bar: string
  hint: string
  go: string
  path: string
  anchor?: string
}

const DONATIONS_ANCHOR = '[data-tour="support-donations"]'

export const NOTE_KIND: Record<HubNote['kind'], NoteKindInfo> = {
  reply: {
    icon: MessageSquareReply,
    label: 'Ответ автора',
    chip: 'bg-sky-500/15 text-sky-400',
    bar: 'bg-sky-400',
    hint: 'Автор ответил на ваш отчёт или идею.',
    go: 'Все ответы',
    path: '/support',
    anchor: '[data-tour="support-replies"]'
  },
  theme_ok: {
    icon: Palette,
    label: 'Тема одобрена',
    chip: 'bg-st-ok/15 text-st-ok-text',
    bar: 'bg-st-ok',
    hint: 'Ваша тема опубликована — её видят все в галерее.',
    go: 'Открыть галерею',
    path: '/appearance'
  },
  theme_no: {
    icon: Palette,
    label: 'Тема не прошла',
    chip: 'bg-st-warn/15 text-st-warn-text',
    bar: 'bg-st-warn',
    hint: 'Тема не опубликована. Причина — в тексте; тему можно поправить и отправить снова.',
    go: 'К оформлению',
    path: '/appearance'
  },
  announce: {
    icon: Megaphone,
    label: 'Объявление',
    chip: 'bg-violet-500/15 text-violet-400',
    bar: 'bg-violet-400',
    hint: 'Объявление автора LAZEYKA для всех пользователей.',
    go: '',
    path: ''
  },
  warn: {
    icon: TriangleAlert,
    label: 'Предупреждение',
    chip: 'bg-st-warn/15 text-st-warn-text',
    bar: 'bg-st-warn',
    hint: 'Личное предупреждение от автора LAZEYKA. Пользоваться программой можно как обычно.',
    go: '',
    path: ''
  },
  ban: {
    icon: ShieldAlert,
    label: 'Отправка отключена',
    chip: 'bg-st-err/15 text-st-err-text',
    bar: 'bg-st-err',
    hint: 'С этой установки отключена отправка отчётов, тем, идей и заявок. Пользоваться программой можно как обычно.',
    go: '',
    path: ''
  },
  don_ok: {
    icon: HandHeart,
    label: 'Пожертвование подтверждено',
    chip: 'bg-st-ok/15 text-st-ok-text',
    bar: 'bg-st-ok',
    hint: 'Автор сверил перевод: вы на стене благодарностей.',
    go: 'К сбору',
    path: '/support',
    anchor: DONATIONS_ANCHOR
  },
  don_no: {
    icon: HandCoins,
    label: 'Заявка отклонена',
    chip: 'bg-amber-500/10 text-amber-600 dark:text-amber-400/80',
    bar: 'bg-amber-500/60',
    hint: 'Автор не нашёл перевод по этой заявке. Причина — в тексте.',
    go: 'К сбору',
    path: '/support',
    anchor: DONATIONS_ANCHOR
  }
}

/** Красное предупреждение: те же подписи, красный цвет. */
const WARN_RED: NoteKindInfo = {
  ...NOTE_KIND.warn,
  label: 'Строгое предупреждение',
  chip: 'bg-st-err/15 text-st-err-text',
  bar: 'bg-st-err'
}

/** Сведения о виде конкретного уведомления (с учётом уровня предупреждения). */
export function noteKindOf(note: Pick<HubNote, 'kind' | 'lvl'>): NoteKindInfo {
  if (note.kind === 'warn' && note.lvl === 'red') return WARN_RED
  return NOTE_KIND[note.kind] ?? NOTE_KIND.reply
}

/** Цвет акцента объявления (#rrggbb) или null. */
export function accentHex(note: Pick<HubNote, 'kind' | 'accent'>): string | null {
  if (!note.accent) return null
  return Object.prototype.hasOwnProperty.call(DON_PALETTE, note.accent) ? DON_PALETTE[note.accent] : null
}

export const NoteKindIcon: React.FC<{ kind: HubNote['kind']; lvl?: HubNote['lvl']; accent?: HubNote['accent']; className?: string }> = ({ kind, lvl, accent, className }) => {
  const k = noteKindOf({ kind, lvl })
  const Icon = k.icon
  const hex = accentHex({ kind, accent })
  return (
    <span
      className={cn('inline-flex shrink-0 items-center justify-center rounded-lg', !hex && k.chip, className ?? 'size-8')}
      style={hex ? { backgroundColor: `color-mix(in oklab, ${hex} 16%, transparent)`, color: `color-mix(in oklab, ${hex} 80%, var(--foreground))` } : undefined}
    >
      <Icon className="size-4" />
    </span>
  )
}

/** Перейти в раздел и, если надо, прокрутить к нужному блоку (он может отрисоваться не сразу). */
export function goToNoteTarget(navigate: (p: string) => void, path: string, anchor?: string): void {
  if (!path) return
  navigate(path)
  if (!anchor) return
  let tries = 0
  const t = setInterval(() => {
    const el = document.querySelector<HTMLElement>(anchor)
    if (el || ++tries > 30) {
      clearInterval(t)
      el?.scrollIntoView({ block: 'start', behavior: 'smooth' })
    }
  }, 100)
}
