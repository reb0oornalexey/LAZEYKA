import React, { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Loader2, Server } from 'lucide-react'
import { Button } from '@renderer/components/ui/button'
import { POWER_ON_BANNER_STYLE } from '@renderer/lib/utils'
import { platform } from '@renderer/utils/init'
import { macServiceGetState, macServiceInstall, macServiceUninstall, type MacServiceInfo, type MacServiceStateId } from '@renderer/utils/ipc'
import { Rows, SettingRow, SettingsGroup } from './setting-row'

/*
 * Настройки → «Служба macOS» на языке «Сигнал». Логика — как в
 * components/mac-service-card.tsx (ту карточку показывает и Zapret):
 * состояние root-службы для режима TUN и кнопки установки / удаления.
 */

const LABEL: Record<MacServiceStateId, string> = {
  unsupported: 'не поддерживается',
  not_installed: 'не установлена',
  not_paired: 'не сопряжена',
  needs_update: 'установлена, нужно обновить',
  not_running: 'установлена, не отвечает',
  ready: 'установлена и работает'
}

export const MacServiceGroup: React.FC = () => {
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
  const ready = state === 'ready'
  const warn = state === 'needs_update' || state === 'not_running' || state === 'not_paired'
  const installLabel = !installed ? 'Установить' : state === 'needs_update' ? 'Обновить' : 'Переустановить'

  return (
    <SettingsGroup
      data-tour="settings-mac-service"
      title="Служба macOS"
      hint="Режиму TUN нужна служба с правами администратора. Пароль спросят один раз — при установке."
      sub="Нужна режиму TUN в INCY"
    >
      <Rows>
        <SettingRow
          id="mac-service"
          icon={<Server />}
          on={ready}
          title={<>Служба: {state ? LABEL[state] : '…'}</>}
          desc={
            <span className={warn ? 'text-st-warn-text' : undefined}>
              {info?.serviceVersion ? `Ядро службы: ${info.serviceVersion}. ` : ''}Пароль администратора спросят один раз — при установке.
            </span>
          }
          control={
            <>
              <Button size="sm" variant={installed && !warn ? 'outline' : 'default'} disabled={busy !== null} onClick={() => void run('install')} className="gap-1.5">
                {busy === 'install' && <Loader2 className="size-3.5 animate-spin" />}
                {installLabel}
              </Button>
              {installed && (
                <Button size="sm" variant="outline" disabled={busy !== null} onClick={() => void run('uninstall')} className="gap-1.5">
                  {busy === 'uninstall' && <Loader2 className="size-3.5 animate-spin" />}
                  Удалить
                </Button>
              )}
            </>
          }
        />
      </Rows>
    </SettingsGroup>
  )
}

export default MacServiceGroup
