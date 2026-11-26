import React, { useMemo, useState } from 'react'
import { toast } from 'sonner'
import { Loader2, Pencil, Plus, Save, Sparkles, Trash2, X } from 'lucide-react'
import { Button } from '@renderer/components/ui/button'
import { Switch } from '@renderer/components/ui/switch'
import { cn } from '@renderer/lib/utils'
import { adminStyleDelete, adminStyleSave, DON_BADGE_RU, DON_BADGES, emojiOk, levelOf, type DonationsAdmin, type DonBadge, type DonStyle, type DonStyleAdmin } from '@renderer/utils/hub-donations-api'
import { BADGE_ICON, DonorChip } from './donation-ui'
import { Field, inputClass } from './admin-section'
import { ColorPick, EmojiPick } from './admin-pickers'
import { Empty } from './admin-claims'

const msg = (e: unknown): string => (e instanceof Error ? e.message : String(e))
const toStyle = (s: Omit<DonStyleAdmin, 'nick'>): DonStyle => ({
  ...(s.color ? { color: s.color } : {}),
  ...(s.emoji ? { emoji: s.emoji } : {}),
  ...(s.badge ? { badge: s.badge } : {}),
  ...(s.glow ? { glow: true as const } : {})
})

interface Form {
  nick: string
  color: string | null
  emoji: string
  badge: DonBadge | null
  glow: boolean
}
const EMPTY: Form = { nick: '', color: null, emoji: '', badge: null, glow: false }

/**
 * «Стили ников»: личный цвет, эмодзи, значок и свечение для отдельных ников на «стене» и в последних
 * пожертвованиях — поверх цвета уровня. До 50 ников.
 */
export const StylesPanel: React.FC<{ data: DonationsAdmin; onSaved: (d: DonationsAdmin) => void }> = ({ data, onSaved }) => {
  const [f, setF] = useState<Form | null>(null)
  const [orig, setOrig] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [confirm, setConfirm] = useState<string | null>(null)
  const set = <K extends keyof Form>(k: K, v: Form[K]): void => setF((x) => (x ? { ...x, [k]: v } : x))

  /** Сумма ника по всем сборам — для предпросмотра цвета уровня. */
  const totals = useMemo(() => {
    const m = new Map<string, number>()
    for (const d of data.donations) m.set(d.nick.toLowerCase(), (m.get(d.nick.toLowerCase()) ?? 0) + d.amount)
    return m
  }, [data.donations])
  const nicks = useMemo(() => [...new Set(data.donations.map((d) => d.nick))].slice(0, 200), [data.donations])
  const lvl = (nick: string): number => levelOf(data.levels, totals.get(nick.trim().toLowerCase()) ?? 0)

  if (!data.hasStyles) return <Empty icon={Sparkles} text="Стили ников появятся после обновления LAZEYKA Hub." />

  const emojiBad = Boolean(f && f.emoji.trim() && !emojiOk(f.emoji))
  const canSave = Boolean(f && f.nick.trim() && !emojiBad && !busy)

  const save = async (): Promise<void> => {
    if (!f) return
    setBusy(true)
    try {
      // Переименовали ник — старый стиль убираем.
      if (orig && orig.toLowerCase() !== f.nick.trim().toLowerCase()) await adminStyleDelete(orig)
      onSaved(await adminStyleSave({ nick: f.nick.trim(), color: f.color, emoji: f.emoji.trim() || null, badge: f.badge, glow: f.glow }))
      toast.success('Стиль сохранён', { description: 'В программах обновится при следующем открытии «Поддержки» (до 10 минут).' })
      setF(null)
      setOrig(null)
    } catch (e) {
      toast.error('Не сохранено', { description: msg(e) })
    } finally {
      setBusy(false)
    }
  }

  const del = async (nick: string): Promise<void> => {
    setBusy(true)
    try {
      onSaved(await adminStyleDelete(nick))
      toast.success('Стиль убран')
    } catch (e) {
      toast.error('Не удалено', { description: msg(e) })
    } finally {
      setBusy(false)
      setConfirm(null)
    }
  }

  return (
    <div className="space-y-3" data-tour="admin-don-styles">
      {data.styles.length ? (
        <div className="divide-y divide-foreground/[0.06] overflow-hidden rounded-xl border border-foreground/[0.08]">
          {data.styles.map((s) => (
            <div key={s.nick} className="group flex items-center gap-2 px-3.5 py-2.5 hover:bg-foreground/[0.03]">
              <DonorChip nick={s.nick} levels={data.levels} level={lvl(s.nick)} st={toStyle(s)} />
              <span className="min-w-0 flex-1 truncate text-[11px] text-muted-foreground">
                {[s.color && 'свой цвет', s.emoji && 'эмодзи', s.badge && DON_BADGE_RU[s.badge].toLowerCase(), s.glow && 'свечение'].filter(Boolean).join(' · ')}
              </span>
              {confirm === s.nick ? (
                <>
                  <Button size="xs" variant="destructive" onClick={() => void del(s.nick)} disabled={busy}>
                    Убрать
                  </Button>
                  <Button size="icon-xs" variant="ghost" onClick={() => setConfirm(null)} aria-label="Не убирать">
                    <X />
                  </Button>
                </>
              ) : (
                <div className="flex items-center gap-0.5 opacity-70 group-hover:opacity-100">
                  <Button
                    size="icon-xs"
                    variant="ghost"
                    aria-label="Изменить"
                    title="Изменить"
                    disabled={busy}
                    onClick={() => {
                      setOrig(s.nick)
                      setF({ nick: s.nick, color: s.color, emoji: s.emoji ?? '', badge: s.badge, glow: s.glow })
                    }}
                  >
                    <Pencil />
                  </Button>
                  <Button size="icon-xs" variant="ghost" aria-label="Убрать стиль" title="Убрать стиль" disabled={busy} onClick={() => setConfirm(s.nick)}>
                    <Trash2 />
                  </Button>
                </div>
              )}
            </div>
          ))}
        </div>
      ) : (
        !f && <Empty icon={Sparkles} text="Стилей пока нет. Можно выделить ник особым цветом, эмодзи, короной или свечением — например, у самых верных помощников." />
      )}

      {f ? (
        <div className="space-y-3 rounded-xl border border-primary/35 bg-foreground/[0.025] p-3.5">
          <div className="flex flex-wrap items-center gap-3">
            <div className="text-[13px] font-semibold">{orig ? 'Стиль ника' : 'Новый стиль'}</div>
            <div className="ml-auto flex items-center gap-2 text-[10.5px] text-muted-foreground">
              Так будет на «стене»:
              <DonorChip nick={f.nick.trim() || 'Ник'} levels={data.levels} level={lvl(f.nick)} st={toStyle({ color: f.color, emoji: emojiOk(f.emoji) ? f.emoji.trim() : null, badge: f.badge, glow: f.glow })} />
            </div>
          </div>
          <Field label="Ник" help="Регистр букв не важен. Цвет уровня по сумме остаётся, если свой цвет не выбран.">
            <input className={inputClass} list="lz-don-nicks" value={f.nick} onChange={(e) => set('nick', e.target.value.slice(0, 32))} placeholder="Ник со стены" autoFocus />
            <datalist id="lz-don-nicks">
              {nicks.map((n) => (
                <option key={n} value={n} />
              ))}
            </datalist>
          </Field>
          <Field label="Цвет" optional>
            <ColorPick value={f.color} onChange={(v) => set('color', v)} none="по уровню" palette={Object.keys(data.palette).length ? data.palette : undefined} />
          </Field>
          <Field label="Эмодзи перед ником" optional>
            <EmojiPick value={f.emoji} onChange={(v) => set('emoji', v)} />
          </Field>
          <Field label="Значок" optional>
            <div className="flex flex-wrap gap-1">
              <button
                type="button"
                onClick={() => set('badge', null)}
                className={cn('inline-flex h-7 cursor-pointer items-center rounded-lg border px-2 text-[10.5px]', !f.badge ? 'border-foreground/60 text-foreground' : 'border-border text-muted-foreground hover:text-foreground')}
              >
                без
              </button>
              {DON_BADGES.map((b) => {
                const I = BADGE_ICON[b]
                return (
                  <button
                    key={b}
                    type="button"
                    title={DON_BADGE_RU[b]}
                    onClick={() => set('badge', b)}
                    className={cn('inline-flex h-7 cursor-pointer items-center gap-1 rounded-lg border px-2 text-[11px] transition-colors', f.badge === b ? 'border-primary/70 bg-primary/12 text-foreground' : 'border-border text-muted-foreground hover:text-foreground')}
                  >
                    <I className="size-3.5" /> {DON_BADGE_RU[b]}
                  </button>
                )
              })}
            </div>
          </Field>
          <label className="flex cursor-pointer items-center justify-between gap-3 rounded-xl border border-foreground/[0.08] bg-foreground/[0.025] px-3 py-2.5">
            <span className="text-xs">
              <span className="block font-semibold">Свечение</span>
              <span className="text-[11px] text-muted-foreground">Мягкий ореол вокруг ника, как у самого высокого уровня.</span>
            </span>
            <Switch checked={f.glow} onCheckedChange={(v) => set('glow', v)} />
          </label>
          <div className="flex items-center justify-end gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setF(null)
                setOrig(null)
              }}
              disabled={busy}
            >
              Отмена
            </Button>
            <Button size="sm" onClick={() => void save()} disabled={!canSave}>
              {busy ? <Loader2 className="animate-spin" /> : <Save />} Сохранить стиль
            </Button>
          </div>
        </div>
      ) : (
        <Button size="sm" variant="outline" onClick={() => setF({ ...EMPTY })} disabled={data.styles.length >= 50 || busy}>
          <Plus /> Стиль для ника
        </Button>
      )}
    </div>
  )
}
