import React, { useState } from 'react'
import { toast } from 'sonner'
import {
  Bell,
  Bug,
  Check,
  ClipboardCopy,
  Clock,
  CopyX,
  FileDown,
  FileText,
  Loader2,
  MessageCircleQuestion,
  Send,
  UserRound,
  WifiOff
} from 'lucide-react'
import { Button } from '@renderer/components/ui/button'
import { Switch } from '@renderer/components/ui/switch'
import { Hint } from '@renderer/components/prematch/hint'
import { cn } from '@renderer/lib/utils'
import { hubBuildReport, hubSaveReport, hubSendReport, type BuiltReport } from '@renderer/utils/hub-api'
import { writeClipboard } from '@renderer/utils/ipc'
import { HubModal, textareaClass } from './modal'
import { CharCount, KindTiles, NextSteps, WriteHints, type KindTile, type NextStep } from './feedback-ui'

/** Сервер обрезает описание до 600 знаков; метка вида входит в них. */
const NOTE_LIMIT = 600
const MIN_TEXT = 5
const msg = (e: unknown): string => (e instanceof Error ? e.message : String(e))
const kb = (n: number): string => `${Math.max(1, Math.round(n / 1024))} КБ`

type ReportKind = 'bug' | 'broken' | 'other'

interface KindInfo {
  /** Метка в начале текста: автор в боте сразу видит вид обращения. */
  tag: string
  /** Подпись поля текста. */
  label: string
  hints: string[]
  placeholder: string
  /** Приложить логи по умолчанию. */
  attach: boolean
}

const TILES: KindTile<ReportKind>[] = [
  { id: 'bug', icon: Bug, title: 'Нашёл ошибку', sub: 'Программа ведёт себя неправильно, показывает ошибку или закрывается', tone: 'text-st-err-text' },
  { id: 'broken', icon: WifiOff, title: 'Что-то не работает', sub: 'Не открывается сайт, игра или Discord, не подключается VPN', tone: 'text-st-warn-text' },
  { id: 'other', icon: MessageCircleQuestion, title: 'Другое', sub: 'Вопрос, жалоба или что-то ещё', tone: 'text-st-info-text' }
]

const KINDS: Record<ReportKind, KindInfo> = {
  bug: {
    tag: '[Ошибка]',
    label: 'Опишите ошибку',
    hints: [
      'В каком разделе это случилось и что вы нажали перед этим',
      'Что ожидали и что получилось вместо этого',
      'Текст ошибки, если он был на экране',
      'Повторяется ли это каждый раз'
    ],
    placeholder: 'Например: в INCY нажимаю «Подключить», через пару секунд окно программы закрывается. Повторяется каждый раз после обновления.',
    attach: true
  },
  broken: {
    tag: '[Не работает]',
    label: 'Что не работает',
    hints: [
      'Какой сервис: сайт (какой), игра, Discord, Telegram или сам VPN',
      'Что было включено: Zapret (какая стратегия), VPN (какой режим), DNS',
      'С какого времени: всегда, после обновления, с сегодняшнего дня',
      'Что уже пробовали: другую стратегию, другой сервер, перезапуск'
    ],
    placeholder: 'Например: с сегодняшнего утра не открывается YouTube. Включён Zapret со стратегией ALT 3, VPN выключен. Другие стратегии пробовал, не помогло.',
    attach: true
  },
  other: {
    tag: '[Другое]',
    label: 'Ваш вопрос или сообщение',
    hints: ['Коротко, о чём вопрос или жалоба', 'Если речь о конкретном разделе программы, назовите его'],
    placeholder: 'Например: не понимаю, чем режим TUN отличается от системного прокси и что выбрать для игр.',
    attach: false
  }
}

const NEXT: NextStep[] = [
  { icon: UserRound, text: 'Отчёт читает автор программы сам, вручную. Это не автоответчик.' },
  { icon: Bell, text: 'Ответ придёт в колокольчик в шапке окна со звуком сообщений (если звуки включены в «Настройках»).' },
  { icon: Clock, text: 'Обычно автор отвечает в течение суток, но бывает и дольше: программу делает один человек.' },
  { icon: CopyX, text: 'Одно и то же несколько раз отправлять не нужно: это не ускорит ответ. Новый отчёт можно отправить через 15 минут после прошлого.' }
]

/**
 * «Отчёт в поддержку»: вид обращения, подсказки, описание и переключатель «Приложить логи».
 * «Проверить и отправить» показывает окно с ПОЛНЫМ текстом, который уйдёт; пока человек не нажал
 * «Отправить», в сеть не уходит ничего.
 */
export const SupportReportCard: React.FC<{ className?: string }> = ({ className }) => {
  const [kind, setKind] = useState<ReportKind | null>(null)
  const [text, setText] = useState('')
  const [attach, setAttach] = useState(true)
  const [building, setBuilding] = useState(false)
  const [report, setReport] = useState<BuiltReport | null>(null)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [offerSave, setOfferSave] = useState(false)
  const [code, setCode] = useState<string | null>(null)

  const info = kind ? KINDS[kind] : null
  const max = info ? NOTE_LIMIT - info.tag.length - 1 : NOTE_LIMIT
  const note = info ? `${info.tag} ${text.trim()}` : text.trim()
  const ready = info !== null && text.trim().length >= MIN_TEXT

  const pickKind = (k: ReportKind): void => {
    if (k === kind) return
    setKind(k)
    setAttach(KINDS[k].attach)
    setText((t) => t.slice(0, NOTE_LIMIT - KINDS[k].tag.length - 1))
  }

  const reset = (): void => {
    setKind(null)
    setText('')
    setAttach(true)
    setError(null)
    setOfferSave(false)
  }

  const review = async (): Promise<void> => {
    if (!ready) return
    setBuilding(true)
    setError(null)
    setOfferSave(false)
    try {
      setReport(await hubBuildReport(attach))
    } catch (e) {
      toast.error('Не удалось собрать отчёт', { description: msg(e) })
    } finally {
      setBuilding(false)
    }
  }

  const send = async (): Promise<void> => {
    setSending(true)
    setError(null)
    try {
      const res = await hubSendReport(note)
      if (res.ok) {
        setCode(res.code ?? '')
        setReport(null)
        reset()
      } else {
        setError(res.message)
        setOfferSave(res.offerSave)
      }
    } catch (e) {
      setError(msg(e))
    } finally {
      setSending(false)
    }
  }

  const save = async (): Promise<void> => {
    try {
      const r = await hubSaveReport(note)
      if (r.saved) toast.success('Отчёт сохранён в файл', { description: r.path })
    } catch (e) {
      toast.error('Не удалось сохранить файл', { description: msg(e) })
    }
  }

  const copyCode = async (): Promise<void> => {
    if (!code) return
    try {
      await writeClipboard(code)
      toast.success('Номер скопирован')
    } catch (e) {
      toast.error('Не удалось скопировать', { description: msg(e) })
    }
  }

  return (
    <div className={cn('ui-card relative rounded-2xl border border-border bg-card p-4', className)}>
      <div className="mb-1 flex items-center gap-1.5">
        <h3 className="text-[14px] font-bold text-[color:var(--text-title)]">Отчёт в поддержку</h3>
        <Hint text="Ваш текст уходит автору программы. По желанию к нему прикладывается файл: версия, система, состояние служб и последние строки журнала. Адреса, ключи, ссылки подписок и имя пользователя в нём скрыты. Перед отправкой вы увидите весь текст; без нажатия «Отправить» ничего не уходит." />
      </div>
      <p className="mb-3 text-xs text-muted-foreground">Выберите, что случилось, и опишите своими словами. Автор ответит прямо в программе.</p>

      {code !== null ? (
        <div className="rounded-lg border border-st-ok/30 bg-st-ok/10 px-3 py-3 text-sm text-st-ok-text">
          <div className="flex items-start gap-2">
            <Check className="mt-0.5 size-4 shrink-0" />
            <div className="space-y-1">
              <div className="font-semibold">Отчёт отправлен</div>
              <div className="text-xs leading-relaxed text-foreground/80">
                {code ? (
                  <>
                    Номер отчёта: <b className="select-text font-mono text-sm tracking-wider text-foreground">{code}</b>. Если будете писать в чат поддержки, назовите его.{' '}
                  </>
                ) : null}
                Ответ придёт в колокольчик в шапке окна. Повторно отправлять то же самое не нужно.
              </div>
            </div>
          </div>
          <div className="mt-2.5 flex flex-wrap gap-2 pl-6">
            {code && (
              <Button size="sm" variant="outline" onClick={() => void copyCode()}>
                <ClipboardCopy /> Скопировать номер
              </Button>
            )}
            <Button size="sm" variant="ghost" onClick={() => setCode(null)}>
              Написать ещё
            </Button>
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          <KindTiles items={TILES} value={kind} onChange={pickKind} disabled={building} label="Что случилось" />

          {info && (
            <>
              <WriteHints items={info.hints} />
              <div>
                <div className="mb-1 flex items-center justify-between text-xs">
                  <label htmlFor="hub-report-note" className="font-medium">
                    {info.label}
                  </label>
                  <CharCount n={text.length} max={max} />
                </div>
                <textarea
                  id="hub-report-note"
                  rows={4}
                  maxLength={max}
                  value={text}
                  disabled={building}
                  onChange={(e) => setText(e.target.value)}
                  placeholder={info.placeholder}
                  className={textareaClass}
                />
              </div>

              <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-border/60 bg-foreground/[0.02] px-3 py-2.5">
                <Switch checked={attach} onCheckedChange={setAttach} disabled={building} className="mt-0.5" aria-label="Приложить логи и сведения о системе" />
                <span className="min-w-0">
                  <span className="block text-xs font-semibold text-foreground">Приложить логи и сведения о системе</span>
                  <span className="mt-0.5 block text-[11px] leading-relaxed text-muted-foreground">
                    {attach
                      ? 'Версия программы, система, провайдер, состояние Zapret, VPN, Telegram-прокси и DNS, итог последней проверки сайта в этом запуске и последние строки журнала (около 400). Адреса, ключи, ссылки подписок и имя пользователя скрыты.'
                      : 'Уйдёт только ваш текст, версия программы, система и провайдер, если программа его уже знает. Без журнала причину найти сложнее.'}
                  </span>
                </span>
              </label>

              <div className="flex flex-wrap items-center gap-2">
                <Button size="sm" onClick={() => void review()} disabled={!ready || building}>
                  {building ? <Loader2 className="animate-spin" /> : <Send />}
                  {building ? 'Собираю…' : 'Проверить и отправить'}
                </Button>
                <Button size="sm" variant="ghost" onClick={reset} disabled={building}>
                  Очистить
                </Button>
                {!ready && <span className="text-[11px] text-muted-foreground">Напишите хотя бы пару слов</span>}
              </div>
            </>
          )}

          {info && <NextSteps items={NEXT} />}
        </div>
      )}

      <HubModal
        open={report !== null}
        onClose={() => setReport(null)}
        locked={sending}
        icon={FileText}
        title="Проверьте перед отправкой"
        subtitle={report ? `Вот всё, что уйдёт автору: ваш текст и файл (${kb(report.bytes)}). Адреса, ключи и имя пользователя скрыты.` : undefined}
        footer={
          <>
            <Button variant="ghost" onClick={() => setReport(null)} disabled={sending}>
              Назад
            </Button>
            <Button variant={offerSave ? 'default' : 'outline'} onClick={() => void save()} disabled={sending}>
              <FileDown /> Сохранить файлом
            </Button>
            <Button variant={offerSave ? 'outline' : 'default'} onClick={() => void send()} disabled={sending}>
              {sending ? <Loader2 className="animate-spin" /> : <Send />}
              {sending ? 'Отправляю…' : 'Отправить'}
            </Button>
          </>
        }
      >
        <div>
          <div className="mb-1 text-xs font-medium">Ваш текст</div>
          <div className="select-text whitespace-pre-wrap break-words rounded-lg border border-border bg-card/60 px-3 py-2 text-xs leading-relaxed">{note}</div>
        </div>
        <div>
          <div className="mb-1 text-xs font-medium">{attach ? 'Файл с логами и сведениями о системе' : 'Файл со сведениями о версии'}</div>
          <pre
            tabIndex={0}
            className={cn(
              'select-text overflow-auto whitespace-pre rounded-lg border border-border bg-card/60 p-3 font-mono text-[11px] leading-relaxed',
              attach ? 'h-56' : 'max-h-40'
            )}
          >
            {report?.text}
          </pre>
        </div>
        {error && <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">{error}</div>}
      </HubModal>
    </div>
  )
}
