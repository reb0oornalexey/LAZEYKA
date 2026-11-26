import React, { useEffect, useRef, useState } from 'react'
import { ImageOff, Loader2, Star } from 'lucide-react'
import { useHubStore } from '@renderer/store/hub-store'
import { useGallerySocial } from '@renderer/store/gallery-social-store'
import type { GalleryItem } from '@renderer/utils/hub-api'
import { LikeButton } from './gallery-social'

// Плитки такие же, как у встроенных фонов (wallpaper-grid.tsx).
const tileBase =
  'group/tile relative aspect-video w-full cursor-pointer overflow-hidden rounded-xl border-2 border-border bg-background text-left transition-all duration-150 hover:border-primary/60 hover:brightness-110'

/**
 * Плитка темы. Превью скачивается, когда плитка попала на экран, и не рисуется, пока она вне
 * видимой области (картинки не копятся в памяти). Размер плитки фиксирован — сетка не прыгает.
 * Сверху справа — сердечко с числом лайков (нажимается отдельно от плитки), звёздочка — тема в избранном.
 */
export const Tile = React.memo(function Tile({ item, onOpen }: { item: GalleryItem; onOpen: (i: GalleryItem) => void }) {
  const ref = useRef<HTMLDivElement>(null)
  const [visible, setVisible] = useState(typeof IntersectionObserver === 'undefined')
  const src = useHubStore((s) => s.previews[item.id])
  const loadPreview = useHubStore((s) => s.loadPreview)
  const fav = useGallerySocial((s) => Boolean(s.fav[item.id]))
  useEffect(() => {
    const el = ref.current
    if (!el || typeof IntersectionObserver === 'undefined') return
    const io = new IntersectionObserver((entries) => setVisible(entries.some((e) => e.isIntersecting)), { rootMargin: '200px' })
    io.observe(el)
    return () => io.disconnect()
  }, [])
  useEffect(() => {
    if (visible && src === undefined) loadPreview(item.id)
  }, [visible, src, item.id, loadPreview])
  return (
    <div ref={ref} className="relative transition-transform duration-150 hover:-translate-y-0.5" style={{ contentVisibility: 'auto', containIntrinsicSize: 'auto 96px' }}>
      <button type="button" onClick={() => onOpen(item)} className={tileBase} title={`${item.name} — ${item.author}. Нажмите, чтобы посмотреть крупно`}>
        {visible && src ? (
          <img src={src} alt="" draggable={false} loading="lazy" decoding="async" width={320} height={180} className="absolute inset-0 size-full object-cover" />
        ) : (
          <span className="absolute inset-0 flex items-center justify-center text-muted-foreground">
            {src === null ? <ImageOff className="size-4" /> : visible ? <Loader2 className="size-4 animate-spin" /> : null}
          </span>
        )}
        <span className="absolute inset-x-0 bottom-0 truncate bg-gradient-to-t from-black/80 to-transparent px-1.5 pt-4 pb-1 text-[11px] leading-tight font-medium text-white">
          {item.name} · {item.author}
        </span>
        {fav && (
          <span className="absolute top-1.5 left-1.5 inline-flex size-6 items-center justify-center rounded-full bg-black/55 backdrop-blur-sm" aria-label="В избранном">
            <Star className="size-3.5 fill-amber-400 text-amber-400" />
          </span>
        )}
      </button>
      <LikeButton item={item} className="absolute top-1.5 right-1.5" />
    </div>
  )
})
