import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@renderer/components/ui/button'
import { Input } from '@renderer/components/ui/input'
import { zapretLinuxCustomProfiles, zapretSaveLinuxCustom, type LinuxZapretCustomProfile } from '@renderer/utils/ipc'

export function LinuxZapretBuilder({ strategies, disabled, onChanged }: {
  strategies: { file: string; title: string }[]
  disabled: boolean
  onChanged: () => void
}): React.JSX.Element {
  const [title, setTitle] = useState('')
  const [base, setBase] = useState('simple-fake')
  const [repeats, setRepeats] = useState('6')
  const [profiles, setProfiles] = useState<LinuxZapretCustomProfile[]>([])
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    void zapretLinuxCustomProfiles().then(setProfiles).catch((error) => toast.error(String(error)))
  }, [])
  const update = async (input: Parameters<typeof zapretSaveLinuxCustom>[0]): Promise<void> => {
    setBusy(true)
    try {
      await zapretSaveLinuxCustom(input)
      setProfiles(await zapretLinuxCustomProfiles())
      onChanged()
      toast.success(input.action === 'save' ? 'Стратегия сохранена' : 'Стратегия удалена')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error))
    } finally {
      setBusy(false)
    }
  }
  return (
    <section className="rounded-2xl border border-border/70 bg-card p-5" data-tour="zapret-linux-builder">
      <h2 className="text-sm font-semibold">Своя стратегия</h2>
      <p className="mt-2 text-sm text-muted-foreground">Выберите профиль Flowseal и число повторов для его пакетов. Свой вариант можно выбрать и проверить в каталоге.</p>
      <div className="mt-4 grid gap-3 sm:grid-cols-[1fr_1fr_120px]">
        <label className="flex flex-col gap-1.5 text-xs">Название
          <Input value={title} maxLength={48} onChange={(event) => setTitle(event.target.value)} />
        </label>
        <label className="flex flex-col gap-1.5 text-xs">Основа
          <select className="h-9 rounded-lg border border-border bg-background px-2 text-sm"
            value={base} onChange={(event) => setBase(event.target.value)}>
            {strategies.filter((item) => !item.file.startsWith('own-')).map((item) => <option value={item.file} key={item.file}>{item.title}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1.5 text-xs">Число повторов
          <Input value={repeats} type="number" min={1} max={20} onChange={(event) => setRepeats(event.target.value)} />
        </label>
      </div>
      <Button className="mt-4" disabled={disabled || busy || !title.trim() || !Number.isInteger(Number(repeats)) || Number(repeats) < 1 || Number(repeats) > 20}
        onClick={() => void update({ action: 'save', title, base, repeats: Number(repeats) })}>
        Сохранить стратегию
      </Button>
      {profiles.length > 0 && <div className="mt-4 grid gap-2">
        {profiles.map((item) => (
          <div className="flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-2 text-sm" key={item.file}>
            <span className="min-w-0 truncate">{item.title}</span>
            <div className="flex shrink-0 gap-2">
              <Button size="sm" variant="outline" disabled={disabled || busy} onClick={() => {
                setTitle(item.title)
                setBase(item.base)
                setRepeats(String(item.repeats))
              }}>Править</Button>
              <Button size="sm" variant="ghost" disabled={disabled || busy}
                onClick={() => void update({ action: 'remove', file: item.file })}>Удалить</Button>
            </div>
          </div>
        ))}
      </div>}
    </section>
  )
}
