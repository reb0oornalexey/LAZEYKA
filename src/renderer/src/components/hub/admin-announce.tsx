import React, { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { Eye, Loader2, Megaphone, Plus, X } from 'lucide-react'
import { Button } from '@renderer/components/ui/button'
import { Input } from '@renderer/components/ui/input'
import { cn } from '@renderer/lib/utils'
import { adminAnnounce, adminAnnounceOff, adminAudience, type AdminAnnounce, type AdminWhoami, type AnnounceOs } from '@renderer/utils/hub-admin-api'
import { AnnounceCard } from './announce-banner'
import { HubModal, textareaClass } from './modal'
import { AdminSection, Segmented, SubLabel, insetClass } from './admin-section'
import { ColorPick, EmojiPick } from './admin-pickers'
import { Hint } from '@renderer/components/prematch/hint'
import { DON_PALETTE, emojiOk } from '@renderer/utils/hub-donations-api'
import type { AccentKey } from '@renderer/utils/hub-api'

const DON_HEX: Record<string, string> = DON_PALETTE

const msg = (e: unknown): string => (e instanceof Error ? e.message : String(e))
const fmt = (t: number): string => new Date(t).toLocaleString('ru-RU', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' })

type Days = 1 | 3 | 7
type VerMode = 'all' | 'lt' | 'ge'
const SEMVER_RE = /^\d{1,6}\.\d{1,6}\.\d{1,6}(-[0-9A-Za-z.-]+)?$/

/** «всем», «Windows, версии ниже 1.3.0» — как подпись в боте. */
export function condText(os: AnnounceOs, ver: string): string {
  const parts: string[] = []
  if (os === 'win') parts.push('Windows')
  if (os === 'mac') parts.push('Mac')
  if (os === 'linux') parts.push('Linux')
  if (ver.startsWith('<')) parts.push(`версии ниже ${ver.slice(1)}`)
  else if (ver.startsWith('>=')) parts.push(`версии ${ver.slice(2)} и выше`)
  return parts.length ? parts.join(', ') : 'всем'
}

/**
 * «Объявления» в «Админке»: активные (до 3) с «Дополнить / Снять», форма нового с условиями
 * (система, версии, срок) и предпросмотром. Публикация — только кнопкой, о каждой приходит
 * сообщение владельцу в Telegram с кнопкой отмены.
 */
export const AdminAnnounceSection: React.FC<{
  who: AdminWhoami | null
  loading: boolean
  onChanged: () => void
  onWho: (fn: (w: AdminWhoami | null) => AdminWhoami | null) => void
  /** Меняется — поле текста получает фокус (кнопка «Новое объявление» на пульте). */
  focusKey?: number
}> = ({ who, loading, onChanged, onWho, focusKey }) => {
  const textRef = useRef<HTMLTextAreaElement>(null)
  useEffect(() => {
    if (!focusKey) return
    const t = setTimeout(() => {
      textRef.current?.focus()
      textRef.current?.scrollIntoView({ block: 'center', behavior: 'smooth' })
    }, 60)
    return () => clearTimeout(t)
  }, [focusKey])
  const [text, setText] = useState('')
  const [days, setDays] = useState<Days>(3)
  const [os, setOs] = useState<AnnounceOs>('all')
  const [verMode, setVerMode] = useState<VerMode>('all')
  const [verX, setVerX] = useState('')
  const [reTo, setReTo] = useState<AdminAnnounce | null>(null)
  const [preview, setPreview] = useState(false)
  const [aud, setAud] = useState<{ now: number; day: number } | null | 'error'>(null)
  const [busy, setBusy] = useState(false)
  const [emoji, setEmoji] = useState('')
  const [accent, setAccent] = useState<AccentKey | null>(null)
  const emojiBad = emoji.trim().length > 0 && !emojiOk(emoji)

  const verValue = verX || who?.latest || ''
  const verOk = verMode === 'all' || SEMVER_RE.test(verValue.trim())
  const ver = verMode === 'all' ? '' : `${verMode === 'lt' ? '<' : '>='}${verValue.trim()}`
  const max = who?.maxActive ?? 3
  const active = who?.announces ?? []
  const full = active.length >= max
  const canSend = !busy && text.trim().length >= 2 && verOk && !full && !emojiBad

  const publish = async (): Promise<void> => {
    setBusy(true)
    try {
      const a = await adminAnnounce(text.trim(), days, { os, ver, re: reTo?.id ?? null, emoji: emoji.trim() || null, accent })
      setText('')
      setEmoji('')
      setAccent(null)
      setReTo(null)
      setPreview(false)
      toast.success('Объявление опубликовано', { description: `Кому: ${a.label}. До ${fmt(a.until)}. Программы увидят его при следующей проверке.` })
      onChanged()
    } catch (e) {
      toast.error('Не опубликовано', { description: msg(e) })
    } finally {
      setBusy(false)
    }
  }

  const remove = async (id: number | string): Promise<void> => {
    setBusy(true)
    try {
      await adminAnnounceOff(id)
      onWho((w) => (w ? { ...w, announces: w.announces.filter((a) => a.id !== id) } : w))
      if (reTo?.id === id) setReTo(null)
      toast.success('Объявление снято', { description: 'У пользователей оно пропадёт при следующей проверке.' })
    } catch (e) {
      toast.error('Не снято', { description: msg(e) })
    } finally {
      setBusy(false)
    }
  }

  const startAddition = (a: AdminAnnounce): void => {
    setReTo(a)
    setOs(a.os)
    if (a.ver) {
      setVerMode(a.ver.startsWith('<') ? 'lt' : 'ge')
      setVerX(a.ver.replace(/^(<|>=)/, ''))
    } else setVerMode('all')
  }

  const openPreview = async (): Promise<void> => {
    setPreview(true)
    setAud(null)
    try {
      const r = await adminAudience({ os, ver })
      setAud({ now: r.now, day: r.day })
    } catch {
      setAud('error')
    }
  }

  return (
    <AdminSection
      icon={Megaphone}
      title="Объявления"
      subtitle={who ? `Активных ${active.length} из ${max}` : loading ? 'Загружаю…' : undefined}
      hint="Плашка на главной и уведомление у всех, кому подходит условие. Программы до 2.0 не сообщают версию и систему — им приходят только объявления для всех."
      tour="author-announce"
    >
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]">
        <div className="space-y-2">
          <SubLabel>Сейчас показываются</SubLabel>
          {active.length ? (
            active.map((a) => (
              <div
                key={String(a.id)}
                className="relative overflow-hidden rounded-xl border border-primary/30 bg-foreground/[0.025] py-2.5 pr-3 pl-4 text-[12.5px]"
              >
                <span aria-hidden className="absolute top-0 bottom-0 left-0 w-[3px] bg-primary" style={a.accent && DON_HEX[a.accent] ? { background: DON_HEX[a.accent] } : undefined} />
                <div className="mb-1 flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
                  <span className="rounded-md bg-foreground/[0.06] px-1.5 py-px">до {fmt(a.until)}</span>
                  <span className="rounded-md bg-foreground/[0.06] px-1.5 py-px">{a.label || condText(a.os, a.ver)}</span>
                  {a.re ? <span className="rounded-md bg-foreground/[0.06] px-1.5 py-px">дополнение</span> : null}
                </div>
                <p className="whitespace-pre-wrap break-words leading-relaxed">
                  {a.emoji ? `${a.emoji} ` : ''}
                  {a.text}
                </p>
                <div className="mt-2 flex gap-1.5">
                  <Button size="xs" variant="ghost" onClick={() => startAddition(a)} disabled={busy || full} title={full ? 'Уже максимум активных: снимите одно' : 'Новое объявление к этому: его увидят и те, кто закрыл первое'}>
                    <Plus /> Дополнить
                  </Button>
                  <Button size="xs" variant="ghost" onClick={() => void remove(a.id)} disabled={busy}>
                    <X /> Снять
                  </Button>
                </div>
              </div>
            ))
          ) : (
            <div className="flex h-24 flex-col items-center justify-center gap-1.5 rounded-xl border border-dashed border-foreground/15 text-[12px] text-muted-foreground">
              {loading ? <Loader2 className="size-4 animate-spin" /> : (
                <>
                  <Megaphone className="size-4" />
                  Сейчас объявлений нет — напишите первое справа
                </>
              )}
            </div>
          )}
        </div>

        <div className="space-y-2.5">
          <SubLabel>Новое объявление</SubLabel>
          {reTo && (
            <div className="flex items-center gap-2 rounded-lg border border-primary/30 bg-primary/[0.06] px-3 py-1.5 text-[11.5px]">
              <span className="min-w-0 flex-1 truncate">
                Дополнение к объявлению от {fmt(reTo.at)}: «{reTo.text}»
              </span>
              <button type="button" onClick={() => setReTo(null)} className="cursor-pointer text-muted-foreground hover:text-foreground" aria-label="Не дополнение, а новое объявление">
                <X className="size-3.5" />
              </button>
            </div>
          )}
          <textarea
            ref={textRef}
            value={text}
            onChange={(e) => setText(e.target.value.slice(0, 300))}
            rows={3}
            placeholder={full ? `Уже ${max} активных — снимите одно, чтобы опубликовать новое.` : 'Текст, до 300 знаков. Ссылки можно вставлять прямо в текст.'}
            className={textareaClass}
            disabled={busy || full}
          />
          <div className={cn(insetClass, 'space-y-2 p-2.5')} data-tour="author-announce-style">
            <div className="flex items-center gap-1.5 text-[12px] font-semibold text-foreground/90">
              Оформление
              <Hint text="Эмодзи в начале и цвет полосы слева — на главной, в колокольчике и во всплывающем уведомлении. Программы старее этой версии покажут объявление как обычно." />
            </div>
            <EmojiPick value={emoji} onChange={setEmoji} />
            <ColorPick value={accent} onChange={(v) => setAccent(v as AccentKey | null)} allowHex={false} none="без цвета" />
            {text.trim() && (
              <div className="pt-1">
                <div className="mb-1 text-[11px] text-muted-foreground">Так увидят на главной</div>
                <AnnounceCard announce={{ text: text.trim(), emoji: emojiOk(emoji) ? emoji.trim() : undefined, accent: accent ?? undefined, re: reTo ? String(reTo.id) : undefined, reAt: reTo?.at }} />
              </div>
            )}
          </div>
          <div className="grid grid-cols-[auto_1fr] items-center gap-x-3 gap-y-2" data-tour="author-announce-target">
            <span className="text-[12px] text-muted-foreground">Система</span>
            <Segmented<AnnounceOs> label="Система" value={os} onChange={setOs} disabled={busy} items={[['all', 'Все'], ['win', 'Windows'], ['mac', 'Mac'], ['linux', 'Linux']]} />
            <span className="text-[12px] text-muted-foreground">Версии</span>
            <div className="flex flex-wrap items-center gap-2">
              <Segmented<VerMode> label="Версии" value={verMode} onChange={setVerMode} disabled={busy} items={[['all', 'Все'], ['lt', 'Ниже'], ['ge', 'Эта и выше']]} />
              {verMode !== 'all' && (
                <Input value={verValue} onChange={(e) => setVerX(e.target.value.replace(/[^\dA-Za-z.-]/g, '').slice(0, 20))} placeholder="2.0.0" aria-label="Версия" className={cn('h-7 w-24 text-xs', !verOk && 'border-destructive')} disabled={busy} />
              )}
            </div>
            <span className="text-[12px] text-muted-foreground">Срок</span>
            <Segmented<Days> label="Срок" value={days} onChange={setDays} disabled={busy} items={[[1, '1 день'], [3, '3 дня'], [7, '7 дней']]} />
          </div>
          <div className="flex flex-wrap items-center gap-2 pt-1">
            <span className="text-[11px] text-muted-foreground">
              {text.length}/300 · кому: {condText(os, verOk ? ver : '')}
            </span>
            <Button size="sm" variant="outline" className="ml-auto" onClick={() => void openPreview()} disabled={!text.trim() || !verOk} data-tour="author-announce-preview">
              <Eye /> Предпросмотр
            </Button>
            <Button size="sm" onClick={() => void publish()} disabled={!canSend}>
              {busy ? <Loader2 className="animate-spin" /> : <Megaphone />} Опубликовать
            </Button>
          </div>
        </div>
      </div>

      <HubModal
        open={preview}
        onClose={() => setPreview(false)}
        icon={Eye}
        title="Предпросмотр"
        subtitle="Так объявление появится на главной. Ещё не опубликовано."
        className="max-w-lg"
        footer={
          <>
            <Button variant="ghost" onClick={() => setPreview(false)}>
              Закрыть
            </Button>
            <Button onClick={() => void publish()} disabled={!canSend}>
              {busy ? <Loader2 className="animate-spin" /> : <Megaphone />} Опубликовать
            </Button>
          </>
        }
      >
        <AnnounceCard
          announce={{ text: text.trim() || '…', emoji: emojiOk(emoji) ? emoji.trim() : undefined, accent: accent ?? undefined, re: reTo ? String(reTo.id) : undefined, reAt: reTo?.at }}
          onClose={() => undefined}
        />
        <div className="space-y-1 text-xs">
          <p>
            Получат: <b>{condText(os, ver)}</b>
            {aud === null ? ' · считаю…' : aud === 'error' ? ' · сколько таких сейчас, узнать не удалось' : ` · сейчас таких в сети ~${aud.now} (за сутки ~${aud.day})`}
          </p>
          <p>
            Срок: {days === 1 ? '1 день' : days === 3 ? '3 дня' : '7 дней'}, до {fmt(Date.now() + days * 24 * 60 * 60 * 1000)}
          </p>
          {reTo && <p className="text-muted-foreground">Дополнение придёт отдельным объявлением: его увидят и те, кто закрыл первое.</p>}
          {full && <p className="text-st-warn-text">Уже {max} активных — снимите одно, чтобы опубликовать.</p>}
          <p className="text-[11px] text-muted-foreground">«В сети» — по программам со включённым счётчиком онлайна. Кнопка «Закрыть» на плашке здесь ничего не делает.</p>
        </div>
      </HubModal>
    </AdminSection>
  )
}
