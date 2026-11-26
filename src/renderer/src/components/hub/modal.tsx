import React, { useEffect } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion } from 'motion/react'
import { X } from 'lucide-react'
import { cn } from '@renderer/lib/utils'

/** Общий стиль многострочного поля — как у Input. */
export const textareaClass =
  'placeholder:text-muted-foreground w-full resize-none rounded-xl border border-[color:var(--input-border)] bg-[color:var(--input-bg)] px-3.5 py-2 text-sm outline-none transition-all focus-visible:border-[color:var(--input-focus-border)] focus-visible:ring-2 focus-visible:ring-[color:var(--input-focus-ring)] disabled:cursor-not-allowed disabled:opacity-50'

interface Props {
  open: boolean
  onClose: () => void
  title: string
  subtitle?: string
  icon?: React.ComponentType<{ className?: string }>
  /** Нельзя закрыть Esc/кликом по фону (идёт отправка). */
  locked?: boolean
  className?: string
  footer?: React.ReactNode
  children: React.ReactNode
}

/** Окно поверх страницы в стиле остальных окон программы (диагностика, обновления). */
export const HubModal: React.FC<Props> = ({ open, onClose, title, subtitle, icon: Icon, locked, className, footer, children }) => {
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape' && !locked) onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, locked, onClose])

  if (typeof document === 'undefined') return null
  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          key="hub-modal"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget && !locked) onClose()
          }}
        >
          <motion.div
            initial={{ opacity: 0, y: 12, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.98 }}
            transition={{ duration: 0.2, ease: 'easeOut' }}
            role="dialog"
            aria-modal="true"
            aria-label={title}
            className={cn(
              'relative flex max-h-[min(720px,92vh)] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-border/70 bg-background shadow-2xl',
              className
            )}
          >
            <div className="flex items-center gap-3 px-6 pb-3 pt-5">
              {Icon && <Icon className="size-5 shrink-0 text-primary" />}
              <div className="min-w-0 flex-1">
                <h2 className="text-lg font-black leading-tight tracking-tight">{title}</h2>
                {subtitle && <p className="text-xs text-muted-foreground">{subtitle}</p>}
              </div>
              <button
                type="button"
                aria-label="Закрыть"
                disabled={locked}
                onClick={onClose}
                className="inline-flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-destructive/15 hover:text-destructive disabled:pointer-events-none disabled:opacity-40"
              >
                <X className="size-4" />
              </button>
            </div>
            <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-6 pb-4">{children}</div>
            {footer && <div className="flex flex-wrap items-center justify-end gap-2 border-t border-border/50 bg-card/70 px-6 py-3.5">{footer}</div>}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body
  )
}
