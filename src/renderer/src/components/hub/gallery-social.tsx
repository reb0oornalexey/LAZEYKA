import React from 'react'
import { Heart, Loader2, Star } from 'lucide-react'
import { Tooltip, TooltipContent, TooltipTrigger } from '@renderer/components/ui/tooltip'
import { cn } from '@renderer/lib/utils'
import { useHubStore } from '@renderer/store/hub-store'
import { likeBlockedReason, likesOf, useGallerySocial } from '@renderer/store/gallery-social-store'
import type { GalleryItem } from '@renderer/utils/hub-api'

type Look = 'tile' | 'panel'

const looks: Record<Look, string> = {
  // Поверх картинки плитки: тёмная «таблетка», читается на любом превью.
  tile: 'h-6 gap-1 rounded-full bg-black/55 px-2 text-[11px] text-white backdrop-blur-sm hover:bg-black/75',
  // Под картинкой в окне темы.
  panel: 'h-9 gap-1.5 rounded-xl border border-border bg-card/60 px-3 text-sm hover:bg-card'
}

/** Сердечко с числом лайков. Лайк — только по нажатию; без связи кнопка неактивна, причина — в подсказке. */
export const LikeButton: React.FC<{ item: GalleryItem; look?: Look; className?: string }> = ({ item, look = 'tile', className }) => {
  const liked = useGallerySocial((s) => Boolean(s.liked[item.id]))
  const busy = useGallerySocial((s) => Boolean(s.busy[item.id]))
  const count = useGallerySocial((s) => likesOf(item, s.counts))
  const toggle = useGallerySocial((s) => s.toggleLike)
  const stale = useHubStore((s) => Boolean(s.gallery?.stale))
  const error = useHubStore((s) => Boolean(s.gallery?.error))
  const blocked = likeBlockedReason(item, stale, error)
  const tip = blocked ?? (liked ? 'Вам нравится эта тема. Нажмите, чтобы убрать лайк.' : 'Нравится? Поставьте лайк: по ним темы сортируются в «Популярных».')
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        {/* span держит подсказку и у неактивной кнопки */}
        <span className={cn('inline-flex', className)}>
          <button
            type="button"
            aria-label={liked ? 'Убрать лайк' : 'Поставить лайк'}
            aria-pressed={liked}
            disabled={Boolean(blocked) || busy}
            onClick={(e) => {
              e.stopPropagation()
              void toggle(item)
            }}
            className={cn(
              'inline-flex cursor-pointer items-center font-medium tabular-nums transition-colors disabled:cursor-not-allowed disabled:opacity-55',
              looks[look]
            )}
          >
            {busy && look === 'panel' ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Heart
                className={cn(look === 'tile' ? 'size-3.5' : 'size-4', 'transition-transform duration-200', liked && 'scale-110 fill-rose-500 text-rose-500')}
              />
            )}
            <span>{count === null ? '—' : count}</span>
          </button>
        </span>
      </TooltipTrigger>
      <TooltipContent side="top" className="max-w-xs text-left leading-snug">
        {tip}
      </TooltipContent>
    </Tooltip>
  )
}

/** «В избранное» — звёздочка. Хранится только на этом компьютере, сеть не нужна. */
export const FavButton: React.FC<{ id: string; look?: Look; withText?: boolean; className?: string }> = ({ id, look = 'tile', withText, className }) => {
  const fav = useGallerySocial((s) => Boolean(s.fav[id]))
  const toggle = useGallerySocial((s) => s.toggleFav)
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={fav ? 'Убрать из избранного' : 'В избранное'}
          aria-pressed={fav}
          onClick={(e) => {
            e.stopPropagation()
            void toggle(id)
          }}
          className={cn('inline-flex cursor-pointer items-center font-medium transition-colors', looks[look], className)}
        >
          <Star className={cn(look === 'tile' ? 'size-3.5' : 'size-4', 'transition-transform duration-200', fav && 'scale-110 fill-amber-400 text-amber-400')} />
          {withText && <span>{fav ? 'В избранном' : 'В избранное'}</span>}
        </button>
      </TooltipTrigger>
      <TooltipContent side="top" className="max-w-xs text-left leading-snug">
        {fav ? 'Тема в избранном. Нажмите, чтобы убрать.' : 'Отметить тему, чтобы быстро найти её в «Избранных». Хранится только на этом компьютере.'}
      </TooltipContent>
    </Tooltip>
  )
}
