import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@renderer/components/ui/button'
import { Input } from '@renderer/components/ui/input'
import { zapretLinuxGameFilter, zapretSaveLinuxGameFilter, type LinuxGameFilter } from '@renderer/utils/ipc'

export function LinuxGameFilterCard({ disabled }: { disabled: boolean }): React.JSX.Element {
  const [settings, setSettings] = useState<LinuxGameFilter | null>(null)
  const [saving, setSaving] = useState(false)
  useEffect(() => {
    void zapretLinuxGameFilter().then(setSettings).catch((error) => toast.error(String(error)))
  }, [])
  const save = async (): Promise<void> => {
    if (!settings || saving) return
    setSaving(true)
    try {
      await zapretSaveLinuxGameFilter(settings)
      setSettings(await zapretLinuxGameFilter())
      toast.success('Game Filter и IPset применены')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error))
    } finally {
      setSaving(false)
    }
  }
  const selectClass = 'h-9 rounded-lg border border-border bg-background px-2 text-sm'
  return (
    <section className="rounded-2xl border border-border/70 bg-card p-5" data-tour="zapret-linux-game-filter">
      <h2 className="text-sm font-semibold">Game Filter и IPset</h2>
      {settings && <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1.5 text-xs">
          Обрабатывать игровые порты
          <select value={settings.mode} className={selectClass} disabled={saving}
            onChange={(event) => setSettings({ ...settings, mode: event.target.value as LinuxGameFilter['mode'] })}>
            <option value="off">Выключено</option>
            <option value="tcp">Только TCP</option>
            <option value="udp">Только UDP</option>
            <option value="all">TCP и UDP</option>
          </select>
        </label>
        <label className="flex flex-col gap-1.5 text-xs">
          IPset
          <select value={settings.ipset} className={selectClass} disabled={saving}
            onChange={(event) => setSettings({ ...settings, ipset: event.target.value as LinuxGameFilter['ipset'] })}>
            <option value="none">Выключено</option>
            <option value="loaded">Список Flowseal</option>
            <option value="any">Все адреса</option>
          </select>
        </label>
        <label className="flex flex-col gap-1.5 text-xs">
          TCP-порты
          <Input value={settings.tcp} disabled={saving} onChange={(event) => setSettings({ ...settings, tcp: event.target.value })} />
        </label>
        <label className="flex flex-col gap-1.5 text-xs">
          UDP-порты
          <Input value={settings.udp} disabled={saving} onChange={(event) => setSettings({ ...settings, udp: event.target.value })} />
        </label>
        {settings.mode !== 'off' && settings.ipset === 'none' && (
          <p className="text-xs text-muted-foreground sm:col-span-2">Выберите список IP или все адреса для обработки игровых портов.</p>
        )}
        <Button className="justify-self-start" onClick={() => void save()}
          disabled={disabled || saving || (settings.mode !== 'off' && settings.ipset === 'none')}>
          {saving ? 'Применяем…' : 'Применить'}
        </Button>
      </div>}
    </section>
  )
}
