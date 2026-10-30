import React, { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Loader2 } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@renderer/components/ui/card'
import { Button } from '@renderer/components/ui/button'
import { POWER_ON_BANNER_STYLE } from '@renderer/lib/utils'
import { platform } from '@renderer/utils/init'
import {
  macServiceGetState,
  macServiceInstall,
  macServiceUninstall,
  type MacServiceInfo,
  type MacServiceStateId
} from '@renderer/utils/ipc'

const LABEL: Record<MacServiceStateId, string> = {
  unsupported: 'не поддерживается',
  not_installed: 'не установлена',
  not_paired: 'не сопряжена',
  needs_update: 'установлена, нужно обновить',
  not_running: 'установлена, не отвечает',
  ready: 'установлена'
}

/** Настройки → «Служба macOS»: состояние root-службы для режима TUN и кнопки установки/удаления. */
const MacServiceCard: React.FC = () => {
  const [info, setInfo] = useState<MacServiceInfo | null>(null)
  const [busy, setBusy] = useState<'install' | 'uninstall' | null>(null)

  const refresh = useCallback(async (): Promise<void> => {
    try {
      setInfo(await macServiceGetState())
    } catch {
      setInfo(null)
    }
  }, [])

  useEffect(() => {
    if (platform === 'darwin') void refresh()
  }, [refresh])

  if (platform !== 'darwin') return null

  const run = async (kind: 'install' | 'uninstall'): Promise<void> => {
    setBusy(kind)
    try {
      const res = kind === 'install' ? await macServiceInstall() : await macServiceUninstall()
      setInfo(res.info)
      if (res.cancelled) return
      if (res.ok) toast.success(res.message, { style: POWER_ON_BANNER_STYLE })
      else toast.error(res.message)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(null)
      void refresh()
    }
  }

  const state = info?.state
  const installed = Boolean(info?.installed)
  const installLabel = !installed ? 'Установить' : state === 'needs_update' ? 'Обновить' : 'Переустановить'

  return (
    <Card className="cyber-card">
      <CardHeader>
        <CardTitle>Служба macOS</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-xs text-muted-foreground">
          Режиму TUN нужна служба с правами администратора. Пароль спросят один раз — при установке.
        </p>
        <div className="flex items-center justify-between gap-3">
          <div className="flex flex-col">
            <span className="text-sm">
              Состояние: <b>{state ? LABEL[state] : '…'}</b>
            </span>
            {info?.serviceVersion && (
              <span className="text-xs text-muted-foreground">Ядро службы: {info.serviceVersion}</span>
            )}
          </div>
          <div className="flex shrink-0 gap-2">
            <Button size="sm" variant="secondary" disabled={busy !== null} onClick={() => void run('install')} className="gap-1.5">
              {busy === 'install' && <Loader2 className="size-3.5 animate-spin" />}
              {installLabel}
            </Button>
            {installed && (
              <Button size="sm" variant="outline" disabled={busy !== null} onClick={() => void run('uninstall')} className="gap-1.5">
                {busy === 'uninstall' && <Loader2 className="size-3.5 animate-spin" />}
                Удалить
              </Button>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

export default MacServiceCard
