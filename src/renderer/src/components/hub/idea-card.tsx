import React, { useState } from 'react'
import { Bell, Check, Layers, Loader2, Send, UserRound } from 'lucide-react'
import { Button } from '@renderer/components/ui/button'
import { Hint } from '@renderer/components/prematch/hint'
import { cn } from '@renderer/lib/utils'
import { hubSendIdea } from '@renderer/utils/hub-api'
import { textareaClass } from './modal'
import { CharCount, NextSteps, WriteHints, type NextStep } from './feedback-ui'

const MAX = 1500

const HINTS = ['Какой задачи не хватает или что неудобно сейчас', 'Как вы это себе представляете: где кнопка, что она делает', 'Если похожее есть в другой программе, назовите её']

const NEXT: NextStep[] = [
  { icon: UserRound, text: 'Каждую идею автор читает сам. В программу попадает не всё, но каждая помогает понять, что людям нужно.' },
  { icon: Bell, text: 'Если автор ответит, ответ придёт в колокольчик в шапке окна.' },
  { icon: Layers, text: 'До трёх идей в сутки, не чаще раза в 5 минут. Несколько мыслей лучше собрать в одно сообщение.' }
]

/** «Предложить идею»: короткий текст автору. Ответ придёт в колокольчик и в карточку «Ответы автора». */
export const IdeaCard: React.FC<{ className?: string }> = ({ className }) => {
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [sent, setSent] = useState(false)

  const send = async (): Promise<void> => {
    setSending(true)
    setError(null)
    setSent(false)
    try {
      const res = await hubSendIdea(text.trim())
      if (res.ok) {
        setSent(true)
        setText('')
      } else setError(res.message)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setSending(false)
    }
  }

  return (
    <div className={cn('ui-card relative rounded-2xl border border-border bg-card p-4', className)}>
      <div className="mb-1 flex items-center gap-1.5">
        <h3 className="text-[14px] font-bold text-[color:var(--text-title)]">Предложить идею</h3>
        <Hint text="Напишите, чего не хватает в программе. Текст уходит автору вместе с версией программы и вашим анонимным номером установки." />
      </div>
      <p className="mb-3 text-xs text-muted-foreground">Чего не хватает в программе или что сделать удобнее.</p>

      {sent ? (
        <div className="rounded-lg border border-st-ok/30 bg-st-ok/10 px-3 py-3 text-sm text-st-ok-text">
          <div className="flex items-start gap-2">
            <Check className="mt-0.5 size-4 shrink-0" />
            <div className="space-y-1">
              <div className="font-semibold">Идея отправлена, спасибо</div>
              <div className="text-xs leading-relaxed text-foreground/80">Если автор ответит, ответ придёт в колокольчик в шапке окна.</div>
            </div>
          </div>
          <div className="mt-2.5 pl-6">
            <Button size="sm" variant="ghost" onClick={() => setSent(false)}>
              Написать ещё
            </Button>
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          <WriteHints items={HINTS} />
          <div>
            <div className="mb-1 flex items-center justify-between text-xs">
              <label htmlFor="hub-idea-text" className="font-medium">
                Ваша идея
              </label>
              <CharCount n={text.length} max={MAX} />
            </div>
            <textarea
              id="hub-idea-text"
              rows={4}
              maxLength={MAX}
              value={text}
              disabled={sending}
              onChange={(e) => setText(e.target.value)}
              placeholder="Например: хочу отмечать любимые серверы INCY звёздочкой, чтобы они всегда были вверху списка."
              className={textareaClass}
            />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" onClick={() => void send()} disabled={sending || text.trim().length < 5}>
              {sending ? <Loader2 className="animate-spin" /> : <Send />}
              {sending ? 'Отправляю…' : 'Отправить идею'}
            </Button>
            {text.trim().length < 5 && <span className="text-[11px] text-muted-foreground">Напишите хотя бы пару слов</span>}
          </div>
          {error && <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">{error}</div>}
          <NextSteps items={NEXT} />
        </div>
      )}
    </div>
  )
}
