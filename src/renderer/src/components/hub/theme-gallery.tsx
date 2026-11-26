import React, { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Clock, LayoutGrid, Loader2, Palette, RefreshCw, Share2 } from 'lucide-react'
import { Button } from '@renderer/components/ui/button'
import { SectionCard } from '@renderer/components/appearance/section'
import { useAppearanceStore } from '@renderer/lib/appearance/store'
import { cn } from '@renderer/lib/utils'
import { useHubStore } from '@renderer/store/hub-store'
import { hubCapturePreview, hubGalleryInstall, type GalleryItem } from '@renderer/utils/hub-api'
import { ThemeShareDialog } from './theme-share-dialog'
import { GalleryDialog } from './gallery-dialog'
import { Tile } from './gallery-tile'
import { ThemeViewer } from './theme-viewer'
import { useGallerySocial } from '@renderer/store/gallery-social-store'

const msg = (e: unknown): string => (e instanceof Error ? e.message : String(e))

/** Сколько самых новых тем видно прямо в «Оформлении». */
const HEAD = 4

/** Галерея тем для вкладки «Оформление»: список, установка в один клик, кнопка «Поделиться темой». */
export const ThemeGallery: React.FC<{ className?: string; openRequest?: number }> = ({ className, openRequest }) => {
  const gallery = useHubStore((s) => s.gallery)
  const loading = useHubStore((s) => s.galleryLoading)
  const loadGallery = useHubStore((s) => s.loadGallery)
  const pending = useHubStore((s) => s.pending)
  const loadSocial = useGallerySocial((s) => s.load)
  /** Окно темы: список, по которому листают стрелки, и открытая тема в нём. */
  const [viewer, setViewer] = useState<{ items: GalleryItem[]; index: number | null }>({ items: [], index: null })
  const [installing, setInstalling] = useState(false)
  const [shareOpen, setShareOpen] = useState(false)
  const [sharePreview, setSharePreview] = useState<string | null>(null)
  const [preparing, setPreparing] = useState(false)
  const [allOpen, setAllOpen] = useState(Boolean(openRequest))

  useEffect(() => {
    if (openRequest) setAllOpen(true)
  }, [openRequest])

  useEffect(() => {
    const refresh = (): void => {
      if (!document.hidden) void loadGallery(false, 'head')
    }
    refresh()
    void loadSocial()
    const timer = window.setInterval(refresh, 60_000)
    document.addEventListener('visibilitychange', refresh)
    return () => {
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', refresh)
    }
  }, [loadGallery, loadSocial])

  const openViewer = useCallback((item: GalleryItem, items: GalleryItem[]) => {
    const i = items.findIndex((x) => x.id === item.id)
    setViewer(i >= 0 ? { items, index: i } : { items: [item], index: 0 })
  }, [])
  const setIndex = useCallback((index: number | null) => setViewer((v) => ({ ...v, index })), [])

  const install = async (selected: GalleryItem): Promise<void> => {
    if (installing) return
    setInstalling(true)
    try {
      const r = await hubGalleryInstall(selected.id)
      // Штатный импорт: тема добавляется в «Мои темы» и применяется; прежняя остаётся в списке и в истории (отмена Ctrl+Z).
      const err = useAppearanceStore.getState().importTheme(r.themeJson)
      if (err) throw new Error(err)
      if (r.bgImage) {
        const st = useAppearanceStore.getState()
        st.setSettings({ bgImage: r.bgImage })
        st.updateCustom()
      }
      toast.success(`Тема «${r.name}» установлена`, { description: r.warning ?? 'Она добавлена в «Мои темы».' })
    } catch (e) {
      toast.error('Не удалось установить тему', { description: msg(e) })
    } finally {
      setInstalling(false)
    }
  }

  const share = async (): Promise<void> => {
    setPreparing(true)
    try {
      setSharePreview(await hubCapturePreview())
    } catch (e) {
      setSharePreview(null)
      toast.error('Не удалось сделать снимок окна', { description: msg(e) })
    } finally {
      setPreparing(false)
    }
    setShareOpen(true)
  }

  const themes = (gallery?.themes ?? []).slice(0, HEAD)
  const total = gallery?.total ?? 0
  return (
    <SectionCard
      icon={Palette}
      title="Галерея тем"
      className={className}
      tip="Темы других пользователей. Здесь — самые новые, остальные — кнопкой «Вся галерея». Нажмите на плитку, чтобы посмотреть крупно (снимок программы и отдельно обои, с увеличением) и применить: тема добавится в «Мои темы», а ваша текущая останется на месте. Сердечко — лайк (по лайкам темы сортируются в «Популярных»), звёздочка в окне темы — избранное на этом компьютере. Кнопка «Обновить» запрашивает свежий список с сервера. Отправленная вами тема показывается здесь как «на проверке» до решения автора."
      right={
        <>
          <Button size="xs" variant="ghost" onClick={() => void loadGallery(true, 'head')} disabled={loading} title="Обновить список">
            <RefreshCw className={cn(loading && 'animate-spin')} /> Обновить
          </Button>
          <Button size="xs" variant="outline" onClick={() => void share()} disabled={preparing}>
            {preparing ? <Loader2 className="animate-spin" /> : <Share2 />} Поделиться темой
          </Button>
        </>
      }
    >
      {pending.length > 0 && (
        <ul className="mb-2 space-y-1" aria-label="Ваши темы на проверке">
          {pending.map((p) => (
            <li key={`${p.name}-${p.at}`} className="flex items-center gap-2 rounded-lg border border-st-warn/30 bg-st-warn/10 px-3 py-2 text-xs text-st-warn-text">
              <Clock className="size-3.5 shrink-0" />
              <span className="min-w-0 flex-1 truncate">
                «{p.name}» — на проверке у автора. Когда решение будет принято, тема появится здесь или придёт ответ.
              </span>
            </li>
          ))}
        </ul>
      )}
      {!gallery && <p className="px-1 py-3 text-xs text-muted-foreground">Загружаю список…</p>}
      {gallery?.error && <p className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">{gallery.error}</p>}
      {gallery && gallery.empty && <p className="px-1 py-3 text-xs text-muted-foreground">Тем пока нет, станьте первым: нажмите «Поделиться темой».</p>}
      {gallery?.stale && themes.length > 0 && <p className="mb-2 px-1 text-[11px] text-st-warn-text">Нет связи с галереей: показан сохранённый список.</p>}
      {themes.length > 0 && (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(120px,170px))] gap-1.5">
          {themes.map((t) => (
            <Tile key={t.id} item={t} onOpen={(i) => openViewer(i, themes)} />
          ))}
        </div>
      )}
      {total > 0 && (
        <Button size="sm" variant="outline" className="mt-2" onClick={() => setAllOpen(true)} data-tour="theme-gallery-all">
          <LayoutGrid /> Вся галерея ({total})
        </Button>
      )}

      <GalleryDialog open={allOpen} onClose={() => setAllOpen(false)} onPick={openViewer} />

      <ThemeViewer items={viewer.items} index={viewer.index} onIndex={setIndex} onApply={(i) => void install(i)} applying={installing} />

      <ThemeShareDialog open={shareOpen} onClose={() => setShareOpen(false)} preview={sharePreview} />
    </SectionCard>
  )
}
