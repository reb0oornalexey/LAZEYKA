import React, { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Loader2, RefreshCw } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@renderer/components/ui/card'
import { Button } from '@renderer/components/ui/button'
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

const IPSET_OPTIONS: { value: IpsetFilterMode; label: string; title: string }[] = [
  { value: 'none', label: 'Выкл', title: 'Без обхода по IP-адресам (только по спискам доменов)' },
  { value: 'loaded', label: 'Список', title: 'Обход для IP-адресов из ipset-all.txt' },
  { value: 'any', label: 'Все IP', title: 'Обход для всех IPv4-адресов, кроме исключений' }
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

  const refresh = useCallback(async (): Promise<void> => {
    try {
      setInfo(await zapretMacGetState())
    } catch {
      setInfo(null)
    }
    try {
      setIpset(await zapretGetIpsetFilter())
    } catch {
      setIpset(null)
    }
  }, [])

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
      setIpset(await zapretSetIpsetFilter(mode))
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

  return (
    <Card className="cyber-card">
      <CardHeader>
        <CardTitle>Служба Zapret (macOS)</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-xs text-muted-foreground">
          Zapret работает через службу с правами администратора. Пароль спросят один раз — при установке или обновлении.
        </p>
        <div className="flex items-center justify-between gap-3">
          <div className="flex flex-col">
            <span className="text-sm">
              Состояние: <b>{state ? LABEL[state] : '…'}</b>
            </span>
            {(info?.installedVersion || info?.bundledVersion) && (
              <span className="text-xs text-muted-foreground">
                {info?.installedVersion ? `В службе: ${info.installedVersion}` : 'Служба не установлена'}
                {info?.bundledVersion ? ` · в приложении: ${info.bundledVersion}` : ''}
              </span>
            )}
            {state === 'needs_update' && info?.detail && <span className="text-xs text-muted-foreground">{info.detail}</span>}
          </div>
          <div className="flex shrink-0 gap-2">
            <Button size="sm" variant="secondary" disabled={lock} onClick={() => void run('install')} className="gap-1.5">
              {busy === 'install' && <Loader2 className="size-3.5 animate-spin" />}
              {installLabel}
            </Button>
            {installed && (
              <Button size="sm" variant="outline" disabled={lock} onClick={() => void run('uninstall')} className="gap-1.5">
                {busy === 'uninstall' && <Loader2 className="size-3.5 animate-spin" />}
                Удалить
              </Button>
            )}
          </div>
        </div>

        <div>
          <div className="mb-2 text-xs uppercase tracking-wide text-muted-foreground">
            IPset
            {ipset && <span className="ml-1.5 normal-case font-normal">({ipset.lines} IP в списке)</span>}
          </div>
          {ipset === null ? (
            <p className="text-sm text-muted-foreground">Не удалось прочитать списки Zapret.</p>
          ) : (
            <div className="flex flex-wrap items-center gap-1.5">
              {IPSET_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  onClick={() => void pickIpset(opt.value)}
                  disabled={disabled || !!busyIpset}
                  title={opt.title}
                  className={cn(
                    'rounded-md border px-2.5 py-1 text-xs font-medium transition',
                    ipset.mode === opt.value ? 'border-primary bg-primary/10 text-foreground' : 'border-border hover:bg-accent/30 text-muted-foreground',
                    (disabled || !!busyIpset) && 'pointer-events-none opacity-50'
                  )}
                >
                  {busyIpset === opt.value ? <Loader2 className="h-3 w-3 animate-spin inline" /> : opt.label}
                </button>
              ))}
              <Button
                size="sm"
                variant="ghost"
                onClick={() => void updateList()}
                disabled={disabled || !!busyIpset}
                className="ml-1"
                title="Скачать свежий ipset-список у Flowseal и сделать его активным"
              >
                {busyIpset === 'update' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
                Обновить список
              </Button>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  )
}

export default ZapretMacServiceCard
