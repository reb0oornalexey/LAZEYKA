import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@renderer/components/ui/button'
import { zapretLinuxUserLists, zapretSaveLinuxUserLists } from '@renderer/utils/ipc'

const fields = [
  { id: 'include', label: 'Обрабатывать дополнительно', example: 'example.org' },
  { id: 'exclude', label: 'Не обрабатывать', example: 'example.net' }
] as const

const blank = { include: '', exclude: '' }

export function LinuxZapretLists({ disabled }: { disabled: boolean }): React.JSX.Element {
  const [draft, setDraft] = useState(blank)
  const [saved, setSaved] = useState(blank)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const load = async (): Promise<void> => {
    const lists = await zapretLinuxUserLists()
    const current = { include: lists.include.join('\n'), exclude: lists.exclude.join('\n') }
    setDraft(current)
    setSaved(current)
  }
  useEffect(() => {
    void load().catch((error) => toast.error(String(error))).finally(() => setLoading(false))
  }, [])

  const save = async (): Promise<void> => {
    const lines = (value: string): string[] => value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
    setSaving(true)
    try {
      await zapretSaveLinuxUserLists({ include: lines(draft.include), exclude: lines(draft.exclude) })
      await load()
      toast.success('Списки Zapret применены')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error))
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className="rounded-2xl border border-border/70 bg-card p-5" data-tour="zapret-linux-lists">
      <h2 className="text-sm font-semibold">Свои списки доменов</h2>
      <p className="mt-2 text-sm text-muted-foreground">Укажите по одному домену в строке. Чтобы добавить только точный домен без поддоменов, поставьте перед ним ^.</p>
      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        {fields.map(({ id, label, example }) => (
          <label key={id} className="flex min-w-0 flex-col gap-2 text-xs font-medium">
            {label}
            <textarea
              value={draft[id]}
              placeholder={example}
              disabled={loading || saving}
              onChange={(event) => setDraft({ ...draft, [id]: event.target.value })}
              className="min-h-36 resize-y rounded-xl border border-border bg-background p-3 font-mono text-sm font-normal"
            />
          </label>
        ))}
      </div>
      <div className="mt-4 flex flex-wrap gap-2">
        <Button onClick={() => void save()} disabled={disabled || loading || saving || (draft.include === saved.include && draft.exclude === saved.exclude)}>
          {saving ? 'Применяем…' : 'Применить списки'}
        </Button>
        <Button variant="outline" onClick={() => setDraft(blank)} disabled={loading || saving || (!draft.include && !draft.exclude)}>
          Очистить поля
        </Button>
      </div>
    </section>
  )
}
