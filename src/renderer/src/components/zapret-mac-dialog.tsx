import React, { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion } from 'motion/react'
import { Loader2, ShieldCheck } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@renderer/components/ui/button'
import { POWER_ON_BANNER_STYLE } from '@renderer/lib/utils'
import { platform } from '@renderer/utils/init'
import { zapretMacInstall, zapretStart, type ZapretMacNotice } from '@renderer/utils/ipc'

/**
 * macOS: окно «нужна служба Zapret». Показывается, когда main сообщает, что службы нет
 * (или её пора обновить). Установка — один системный запрос пароля; после неё
 * прерванный запуск Zapret повторяется сам.
 */
const ZapretMacDialog: React.FC = () => {
  const [notice, setNotice] = useState<ZapretMacNotice | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (platform !== 'darwin') return
    const onNotice = (_e: unknown, n: ZapretMacNotice): void => setNotice(n)
    window.electron.ipcRenderer.on('zapretMac:notice', onNotice)
    return () => {
      window.electron.ipcRenderer.removeAllListeners('zapretMac:notice')
    }
  }, [])

  if (platform !== 'darwin' || typeof document === 'undefined') return null

  const isUpdate = notice?.reason === 'update'

  const install = async (): Promise<void> => {
    const reason = notice?.reason
    setBusy(true)
    try {
      const res = await zapretMacInstall()
      if (res.cancelled) return
      if (!res.ok) {
        toast.error('Служба Zapret не установилась', { description: res.message })
        return
      }
      toast.success(isUpdate ? 'Служба Zapret обновлена' : 'Служба Zapret установлена', { style: POWER_ON_BANNER_STYLE })
      setNotice(null)
      if (reason === 'required') await zapretStart().catch(() => void 0)
    } catch (e) {
      toast.error('Служба Zapret не установилась', { description: e instanceof Error ? e.message : String(e) })
    } finally {
      setBusy(false)
    }
  }

  return createPortal(
    <AnimatePresence>
      {notice && (
        <motion.div
          key="zapret-mac"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget && !busy) setNotice(null)
          }}
        >
          <motion.div
            initial={{ opacity: 0, y: 12, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.98 }}
            transition={{ duration: 0.2, ease: 'easeOut' }}
            className="relative w-full max-w-md overflow-hidden rounded-2xl border border-border/70 bg-background p-6 shadow-2xl"
          >
            <div className="flex items-start gap-4">
              <div className="flex size-12 shrink-0 items-center justify-center rounded-2xl border border-primary/40 bg-card/80">
                <ShieldCheck className="size-6 text-primary" />
              </div>
              <div className="min-w-0">
                <h2 className="text-lg font-black leading-tight tracking-tight">
                  {isUpdate ? 'Обновите службу Zapret' : 'Нужна служба Zapret'}
                </h2>
                <p className="mt-1.5 text-[13px] text-muted-foreground">{notice.message}</p>
              </div>
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <Button size="sm" variant="ghost" disabled={busy} onClick={() => setNotice(null)}>
                Не сейчас
              </Button>
              <Button size="sm" disabled={busy} onClick={() => void install()} className="gap-1.5">
                {busy && <Loader2 className="size-3.5 animate-spin" />}
                {isUpdate ? 'Обновить службу' : 'Установить'}
              </Button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body
  )
}

export default ZapretMacDialog
