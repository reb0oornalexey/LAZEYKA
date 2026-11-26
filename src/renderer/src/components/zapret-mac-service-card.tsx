import React, { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Loader2, Network, RefreshCw, Server, Trash2 } from 'lucide-react'
import { Button } from '@renderer/components/ui/button'
import { Segmented } from '@renderer/components/lz'
import { Rows, SettingRow, SettingsGroup } from '@renderer/components/settings/setting-row'
import { useZapretMeta } from '@renderer/components/zapret/zapret-meta'
import { cn, POWER_ON_BANNER_STYLE } from '@renderer/lib/utils'
import { platform } from '@renderer/utils/init'
import {
  zapretGetIpsetFilter,
  zapretMacGetState,
  zapretMacInstall,
  zapretMacUninstall,
  zapretSetIpsetFilter,
  zapretUpdateIpsetList,
  type IpsetFilterMode,
  type IpsetFilterSnapshot,
  type ZapretMacServiceInfo,
  type ZapretMacStateId
} from '@renderer/utils/ipc'

const LABEL: Record<ZapretMacStateId, string> = {
  unsupported: 'не поддерживается',
  not_installed: 'не установлена',
  needs_update: 'установлена, нужно обновить',
  ready: 'установлена'
}

const IPSET_OPTIONS: { id: IpsetFilterMode; label: string; title: string }[] = [
  { id: 'none', label: 'Выкл', title: 'Без обхода по IP-адресам (только по спискам доменов)' },
  { id: 'loaded', label: 'Список', title: 'Обход для IP-адресов из ipset-all.txt' },
  { id: 'any', label: 'Все IP', title: 'Обход для всех IPv4-адресов, кроме исключений' }
]

interface Props {
  disabled?: boolean
}

/** Страница Zapret на macOS: состояние root-службы (установка/обновление/удаление) и режим IPset. */
const ZapretMacServiceCard: React.FC<Props> = ({ disabled }) => {
  const [info, setInfo] = useState<ZapretMacServiceInfo | null>(null)
  const [busy, setBusy] = useState<'install' | 'uninstall' | null>(null)
  const [ipset, setIpset] = useState<IpsetFilterSnapshot | null>(null)
  const [busyIpset, setBusyIpset] = useState<string | null>(null)
  const patchMeta = useZapretMeta((s) => s.patch)

  const refresh = useCallback(async (): Promise<void> => {
    try {
      const mac = await zapretMacGetState()
      setInfo(mac)
      patchMeta({ mac })
    } catch {
      setInfo(null)
    }
    try {
      const next = await zapretGetIpsetFilter()
      setIpset(next)
      patchMeta({ ipset: next })
    } catch {
      setIpset(null)
    }
  }, [patchMeta])

  useEffect(() => {
    if (platform === 'darwin') void refresh()
  }, [refresh])

  if (platform !== 'darwin') return null

  const run = async (kind: 'install' | 'uninstall'): Promise<void> => {
    setBusy(kind)
    try {
      const res = kind === 'install' ? await zapretMacInstall() : await zapretMacUninstall()
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

  const pickIpset = async (mode: IpsetFilterMode): Promise<void> => {
    if (busyIpset || mode === ipset?.mode) return
    setBusyIpset(mode)
    try {
      const next = await zapretSetIpsetFilter(mode)
      setIpset(next)
      patchMeta({ ipset: next })
      toast.success('Режим IPset обновлён', {
        description: 'Если Zapret включён, он перезапущен — изменения уже действуют',
        style: POWER_ON_BANNER_STYLE
      })
    } catch (e) {
      toast.error('Не удалось изменить IPset', { description: e instanceof Error ? e.message : String(e) })
    } finally {
      setBusyIpset(null)
    }
  }

  const updateList = async (): Promise<void> => {
    if (busyIpset) return
    setBusyIpset('update')
    const tId = toast.loading('Скачиваем ipset-список…')
    try {
      const next = await zapretUpdateIpsetList()
      setIpset(next)
      patchMeta({ ipset: next })
      toast.success(`Список обновлён — ${next.lines} записей`, { id: tId, style: POWER_ON_BANNER_STYLE })
    } catch (e) {
      toast.error('Не удалось обновить ipset-список', { id: tId, description: e instanceof Error ? e.message : String(e) })
    } finally {
      setBusyIpset(null)
    }
  }

  const state = info?.state
  const installed = Boolean(info?.installed)
  const installLabel = !installed ? 'Установить' : state === 'needs_update' ? 'Обновить' : 'Переустановить'
  const lock = disabled || busy !== null
  const versions = [info?.installedVersion ? `в службе ${info.installedVersion}` : null, info?.bundledVersion ? `в программе ${info.bundledVersion}` : null]
    .filter(Boolean)
    .join(', ')

  return (
    <SettingsGroup
      title="Служба и IP-адреса"
      hint="Zapret на macOS работает через службу с правами администратора. Пароль спросят один раз — при установке или обновлении."
      data-tour="zapret-settings"
    >
      <Rows>
        <SettingRow
          id="zapret-mac-service"
          icon={<Server />}
          title="Служба Zapret"
          desc={
            <>
              <span className={state === 'needs_update' ? 'text-st-warn-text' : undefined}>{state ? LABEL[state] : 'проверяю…'}</span>
              {versions && <span>{`, ${versions}`}</span>}
              {state === 'needs_update' && info?.detail && <span className="block">{info.detail}</span>}
            </>
          }
          on={state === 'ready'}
          control={
            <>
              <Button size="sm" variant={installed ? 'outline' : 'default'} disabled={lock} onClick={() => void run('install')} className="h-8 rounded-lg text-xs">
                {busy === 'install' && <Loader2 className="size-3.5 animate-spin" />}
                {installLabel}
              </Button>
              {installed && (
                <Button
                  size="icon-sm"
                  variant="outline"
                  disabled={lock}
                  onClick={() => void run('uninstall')}
                  title="Удалить службу"
                  aria-label="Удалить службу"
                  className="size-8 rounded-lg text-st-err-text hover:border-st-err/40 hover:text-st-err-text"
                >
                  {busy === 'uninstall' ? <Loader2 className="size-3.5 animate-spin" /> : <Trash2 className="size-3.5" />}
                </Button>
              )}
            </>
          }
        />
        <SettingRow
          id="zapret-ipset"
          icon={<Network />}
          title="IPset"
          desc={ipset ? `Обход по IP-адресам · в списке ${ipset.lines.toLocaleString('ru-RU')} IP` : 'Не удалось прочитать списки Zapret'}
          on={!!ipset && ipset.mode !== 'none'}
          control={
            ipset ? (
              <Segmented
                size="sm"
                items={IPSET_OPTIONS}
                value={ipset.mode}
                onChange={(v) => {
                  if (!(disabled || busyIpset)) void pickIpset(v)
                }}
                aria-label="IPset"
                className={cn('w-[230px]', (disabled || !!busyIpset) && 'pointer-events-none opacity-60')}
              />
            ) : undefined
          }
        />
        <SettingRow
          id="zapret-ipset-update"
          icon={<RefreshCw />}
          title="Список IP от Flowseal"
          desc="Скачать свежий ipset-список и сделать его активным"
          control={
            <Button size="sm" variant="outline" onClick={() => void updateList()} disabled={disabled || !!busyIpset} className="h-8 rounded-lg text-xs">
              {busyIpset === 'update' ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />}
              Обновить список
            </Button>
          }
        />
      </Rows>
    </SettingsGroup>
  )
}

export default ZapretMacServiceCard
