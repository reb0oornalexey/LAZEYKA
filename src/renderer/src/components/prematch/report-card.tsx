import React, { useState } from 'react'
import { toast } from 'sonner'
import { Copy, FileImage, Trash2, X } from 'lucide-react'
import { Button } from '@renderer/components/ui/button'
import { cn } from '@renderer/lib/utils'
import { prematchCopyImage, prematchSaveImage, type MatchReport } from '@renderer/utils/prematch-api'
import { Hint } from './hint'
import { LzPanel, LzSectionHead } from '@renderer/components/lz'
import { PingChart } from './ping-chart'
import { fmtDateTime, fmtDuration, fmtMs, VERDICT_STYLE } from './format'
import { renderReportImage } from './report-image'

const msg = (e: unknown): string => (e instanceof Error ? e.message : String(e))

function Tile({ label, value, hint }: { label: string; value: string; hint: string }): React.ReactElement {
  return (
    <div className="rounded-xl border border-foreground/[0.08] bg-foreground/[0.035] px-3 py-2">
      <div className="flex items-center gap-1 text-[11px] text-muted-foreground">
        {label}
        <Hint text={hint} />
      </div>
      <div className="mt-0.5 text-[15px] font-bold tabular-nums">{value}</div>
    </div>
  )
}

/** Отчёт о матче: цифры, график за всю сессию, вердикт и кнопки картинки. */
export const ReportCard: React.FC<{ report: MatchReport; onClose: () => void }> = ({ report, onClose }) => {
  const [busy, setBusy] = useState(false)
  const st = report.stats
  const style = VERDICT_STYLE[report.verdict.kind]
  const name = `lazeyka-match-${new Date(report.startedAt).toISOString().slice(0, 16).replace(/[:T]/g, '-')}.png`

  const withImage = async (fn: (url: string) => Promise<void>): Promise<void> => {
    setBusy(true)
    try {
      await fn(renderReportImage(report))
    } catch (e) {
      toast.error('Не удалось подготовить картинку', { description: msg(e) })
    } finally {
      setBusy(false)
    }
  }

  return (
    <LzPanel tone={report.verdict.kind === 'good' ? 'on' : report.verdict.kind === 'bad' ? 'error' : report.verdict.kind === 'warn' ? 'warn' : 'off'} glow={8} className="space-y-3 p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[14px] font-bold text-[color:var(--text-title)]">Отчёт о матче</div>
          <p className="truncate text-xs text-muted-foreground">
            {report.target.label}, {fmtDateTime(report.startedAt)}
            {report.endedBy === 'timeout' ? ', завершён по времени' : report.endedBy === 'quit' ? ', завершён при выходе из программы' : ''}
          </p>
        </div>
        <Button size="icon-sm" variant="ghost" onClick={onClose} aria-label="Закрыть отчёт">
          <X className="h-4 w-4" />
        </Button>
      </div>

      <div className={cn('rounded-xl border px-3 py-2 text-[15px] font-bold', style.box, style.text)}>{report.verdict.text}</div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        <Tile label="Средний пинг" value={fmtMs(st.avgMs)} hint="Среднее время ответа сервера за всю сессию." />
        <Tile label="Мин / макс" value={st.minMs == null ? '—' : `${st.minMs} / ${st.maxMs} мс`} hint="Самый быстрый и самый медленный ответ." />
        <Tile label="Джиттер" value={st.jitterMs == null ? '—' : `±${st.jitterMs} мс`} hint="Насколько пинг в среднем отличается от соседнего замера. Чем меньше, тем ровнее игра." />
        <Tile label="Потери" value={`${st.lossPct}%`} hint="Доля пакетов, на которые сервер не ответил." />
        <Tile label="Скачки" value={String(st.spikes)} hint="Сколько раз пинг подскакивал выше обычного (медианы сессии) больше чем на 40 мс. Подряд идущие замеры считаются одним скачком." />
        <Tile label="Длительность" value={fmtDuration(report.durationMs)} hint="Время сессии без пауз, когда компьютер спал." />
      </div>

      <div>
        <div className="mb-1 flex items-center gap-1 text-[11px] text-muted-foreground">
          График за всю сессию
          <Hint text="Яркая линия — средний пинг, бледная над ней — максимум. Красные полосы — потерянные пакеты. Пунктир — обычный пинг сессии." />
        </div>
        <PingChart data={{ avg: report.series, max: report.seriesMax, lost: report.seriesLost }} baselineMs={report.baselineMs} className="w-full" />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          variant="outline"
          className="h-8 gap-1.5 text-xs"
          disabled={busy}
          onClick={() =>
            void withImage(async (url) => {
              const r = await prematchSaveImage(url, name)
              if (r.saved) toast.success('Картинка сохранена', { description: r.path })
            })
          }
        >
          <FileImage className="h-3.5 w-3.5" /> Сохранить картинкой
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="h-8 gap-1.5 text-xs"
          disabled={busy}
          onClick={() =>
            void withImage(async (url) => {
              await prematchCopyImage(url)
              toast.success('Картинка скопирована в буфер обмена')
            })
          }
        >
          <Copy className="h-3.5 w-3.5" /> Копировать картинку
        </Button>
        <span className="text-[11px] text-muted-foreground">На картинке только адрес сервера, вашего IP там нет.</span>
      </div>
    </LzPanel>
  )
}

/** Последние отчёты: открыть или удалить. */
export const HistoryList: React.FC<{
  items: MatchReport[]
  activeId?: string
  onOpen: (r: MatchReport) => void
  onDelete: (id: string) => void
}> = ({ items, activeId, onOpen, onDelete }) => (
  <LzPanel className="space-y-2 p-4">
    <LzSectionHead title="Последние отчёты" hint="Хранятся последние 20 отчётов, только на этом компьютере." sub="Нажмите на отчёт, чтобы открыть его" />
    {items.length === 0 ? (
      <p className="text-xs text-muted-foreground">Пока пусто. Отчёт появится после первой завершённой сессии.</p>
    ) : (
      <ul className="space-y-1.5">
        {items.map((r) => {
          const style = VERDICT_STYLE[r.verdict.kind]
          return (
            <li key={r.id} className={cn('relative flex items-center gap-2 rounded-xl border px-3 py-2', activeId === r.id ? 'border-primary/40 bg-primary/[0.09]' : 'border-foreground/[0.08] bg-foreground/[0.03]')}>
              <button type="button" onClick={() => onOpen(r)} className="min-w-0 flex-1 cursor-pointer text-left">
                <div className="truncate text-[12.5px] font-semibold">
                  {fmtDateTime(r.startedAt)}, {r.target.label}
                </div>
                <div className={cn('truncate text-[11px]', style.text)}>
                  {fmtDuration(r.durationMs)}, пинг {fmtMs(r.stats.avgMs)}, потери {r.stats.lossPct}%, скачки {r.stats.spikes}
                </div>
              </button>
              <Button size="icon-sm" variant="ghost" onClick={() => onDelete(r.id)} aria-label="Удалить отчёт">
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </li>
          )
        })}
      </ul>
    )}
  </LzPanel>
)
