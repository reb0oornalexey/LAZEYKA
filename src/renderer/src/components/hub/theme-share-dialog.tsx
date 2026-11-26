import React, { useState } from 'react'
import { Check, ImageOff, Loader2, Send, Share2 } from 'lucide-react'
import { Button } from '@renderer/components/ui/button'
import { Input } from '@renderer/components/ui/input'
import { useAppearanceStore } from '@renderer/lib/appearance/store'
import { bgKind, isBuiltin } from '@renderer/lib/appearance/bg-media'
import { hubShareTheme } from '@renderer/utils/hub-api'
import { useHubStore } from '@renderer/store/hub-store'
import { themeNameProblem } from '@renderer/utils/hub-theme-name'
import { HubModal } from './modal'

interface Props {
  open: boolean
  onClose: () => void
  /** Снимок окна (data-URL), сделанный перед открытием диалога: hubCapturePreview(). */
  preview: string | null
}

/** Что произойдёт с обоями текущей темы при отправке. */
function wallpaperNote(bg: string): { text: string; warn: boolean } {
  if (!bg) return { text: 'Обоев в теме нет.', warn: false }
  if (isBuiltin(bg)) return { text: 'Встроенные обои есть у всех, файл отправлять не нужно.', warn: false }
  const kind = bgKind(bg)
  if (kind !== 'image') return { text: 'GIF, анимированные и видеообои не отправляются: тема уйдёт без обоев.', warn: true }
  return { text: 'Картинка-обои отправится вместе с темой, если не больше 3 МБ. Больше — тема уйдёт без обоев.', warn: false }
}

/** Диалог «Поделиться темой»: название, имя автора, предпросмотр, ограничения и согласие. */
export const ThemeShareDialog: React.FC<Props> = ({ open, onClose, preview }) => {
  const bgImage = useAppearanceStore((s) => s.settings.bgImage)
  // Название не подставляется заранее: иначе все темы называются как базовая («Тёмная»).
  const [name, setName] = useState('')
  const [author, setAuthor] = useState('')
  const [agree, setAgree] = useState(false)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<string[] | null>(null)

  const wall = wallpaperNote(bgImage)
  const nameProblem = themeNameProblem(name)
  const nameOk = nameProblem === null
  const canSend = nameOk && agree && !sending && Boolean(preview)

  const close = (): void => {
    if (sending) return
    if (done) setName('')
    setDone(null)
    setError(null)
    setAgree(false)
    onClose()
  }

  const send = async (): Promise<void> => {
    setSending(true)
    setError(null)
    try {
      const res = await hubShareTheme({
        name: name.trim(),
        author: author.trim(),
        theme: useAppearanceStore.getState().exportTheme(),
        bgImage
      })
      if (res.ok) {
        setDone(res.warnings ?? [])
        void useHubStore.getState().loadPending()
      }
      else setError(res.message)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setSending(false)
    }
  }

  return (
    <HubModal
      open={open}
      onClose={close}
      locked={sending}
      icon={Share2}
      title="Поделиться темой"
      subtitle="Тема попадёт в общую галерею после проверки автором."
      className="max-w-xl"
      footer={
        done ? (
          <Button onClick={close}>Закрыть</Button>
        ) : (
          <>
            <Button variant="ghost" onClick={close} disabled={sending}>
              Отмена
            </Button>
            <Button onClick={() => void send()} disabled={!canSend}>
              {sending ? <Loader2 className="animate-spin" /> : <Send />}
              {sending ? 'Отправляю…' : 'Отправить на проверку'}
            </Button>
          </>
        )
      }
    >
      {done ? (
        <div className="space-y-2">
          <div className="flex items-start gap-2 rounded-lg border border-st-ok/30 bg-st-ok/10 px-3 py-2.5 text-sm text-st-ok-text">
            <Check className="mt-0.5 size-4 shrink-0" />
            <span>Тема отправлена на проверку и отмечена в галерее как «на проверке». Когда автор решит, тема появится в галерее, а в карточке «Ответы автора» придёт сообщение.</span>
          </div>
          {done.map((w) => (
            <div key={w} className="rounded-lg border border-st-warn/30 bg-st-warn/10 px-3 py-2 text-xs text-st-warn-text">
              {w}
            </div>
          ))}
        </div>
      ) : (
        <>
          <div className="aspect-video w-full overflow-hidden rounded-lg border border-border bg-card/60">
            {preview ? (
              <img src={preview} alt="Предпросмотр темы" draggable={false} className="size-full object-contain" />
            ) : (
              <div className="flex size-full items-center justify-center gap-2 text-xs text-muted-foreground">
                <ImageOff className="size-4" /> Снимок окна не получился: закройте окно и попробуйте снова
              </div>
            )}
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label htmlFor="hub-theme-name" className="mb-1 block text-xs font-medium">
                Название (3–40 знаков)
              </label>
              <Input
                id="hub-theme-name"
                value={name}
                maxLength={40}
                placeholder="Название вашей темы"
                disabled={sending}
                aria-invalid={name.trim().length > 0 && !nameOk}
                onChange={(e) => setName(e.target.value)}
              />
              {name.trim().length > 0 && nameProblem && <p className="mt-1 text-[11px] text-st-warn-text">{nameProblem}</p>}
            </div>
            <div>
              <label htmlFor="hub-theme-author" className="mb-1 block text-xs font-medium">
                Имя автора (необязательно, до 32)
              </label>
              <Input id="hub-theme-author" value={author} maxLength={32} placeholder="Аноним" disabled={sending} onChange={(e) => setAuthor(e.target.value)} />
            </div>
          </div>

          <ul className="list-disc space-y-1 pl-5 text-xs text-muted-foreground">
            <li className={wall.warn ? 'text-st-warn-text' : undefined}>{wall.text}</li>
            <li>Отправить можно одну тему в сутки.</li>
            <li>Тема появится в галерее после проверки автором. Как только её одобрят, придёт сообщение.</li>
            <li>В отправку входят цвета, настройки оформления и снимок окна выше. Другие ваши данные не отправляются.</li>
          </ul>

          <label className="flex cursor-pointer items-start gap-2 text-xs">
            <input type="checkbox" checked={agree} disabled={sending} onChange={(e) => setAgree(e.target.checked)} className="mt-0.5 size-4 cursor-pointer accent-[var(--primary)]" />
            <span>Я понимаю, что тема и обои станут видны всем.</span>
          </label>

          {error && <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">{error}</div>}
        </>
      )}
    </HubModal>
  )
}
