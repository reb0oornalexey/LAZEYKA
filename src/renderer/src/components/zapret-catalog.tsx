import React, { useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import { Copy, FlaskConical, Hammer, Import, Loader2, Pencil, Play, RotateCcw, Search, SearchX, Sparkles, Square, Trash2, Wand2 } from 'lucide-react'
import { Button } from '@renderer/components/ui/button'
import { Input } from '@renderer/components/ui/input'
import { Hint } from '@renderer/components/prematch/hint'
import { EmptyState, LiveNumber, LzPanel, LzSectionHead, Segmented } from '@renderer/components/lz'
import ZapretIcon from '@renderer/components/zapret-icon'
import { ScoreCells } from '@renderer/components/zapret/score-cells'
import { cn, POWER_ON_BANNER_STYLE } from '@renderer/lib/utils'
import { useZapretLab } from '@renderer/store/zapret-lab-store'
import type { StrategyTestReport, StrategyTestProgress } from '@renderer/utils/ipc'
import { isAutopickRunning, labDelete, labExport, labFromStrategy, labImport } from '@renderer/utils/zapret-lab-api'

export interface CatalogStrategy {
  file: string
  title: string
  description: string
}

interface Props {
  strategies: CatalogStrategy[]
  active?: string
  isMac: boolean
  report: StrategyTestReport | null
  progress: StrategyTestProgress | null
  testRunning: boolean
  testStopping: boolean
  onPick: (file: string) => void
  onStartTest: (resume: boolean, file?: string) => void
  onStopTest: () => void
  onResetTest: () => void
  onChanged: () => void
  /** Запрос «показать выбранную» (кнопка «Сменить» в шапке) — меняется число, список прокручивается к активной. */
  focusSignal?: number
}

type Filter = 'all' | 'working' | 'own'

const CUSTOM_PREFIX = 'general (LZ '
const customName = (file: string): string | null =>
  file.startsWith(CUSTOM_PREFIX) && file.endsWith(').bat') ? file.slice(CUSTOM_PREFIX.length, -').bat'.length) : null

const ZapretCatalog: React.FC<Props> = ({
  strategies,
  active,
  isMac,
  report,
  progress,
  testRunning,
  testStopping,
  onPick,
  onStartTest,
  onStopTest,
  onResetTest,
  onChanged,
  focusSignal
}) => {
  const { custom, refreshCustom, setDraft, setTab, autopick, setAutopickOpen, checking } = useZapretLab()
  // Результаты, пришедшие по ходу «Проверить все» (до конца прогона отчёт не сохраняется).
  const live = testRunning ? progress?.done : undefined
  const [q, setQ] = useState('')
  const [filter, setFilter] = useState<Filter>('all')
  const [confirmDel, setConfirmDel] = useState<string | null>(null)
  const [importOpen, setImportOpen] = useState(false)
  const [importText, setImportText] = useState('')
  const [importing, setImporting] = useState(false)
  const listRef = useRef<HTMLDivElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const picking = isAutopickRunning(autopick)
  const busy = testRunning || picking || checking

  useEffect(() => {
    if (!focusSignal) return
    setQ('')
    setFilter('all')
    const t = setTimeout(() => {
      const el = listRef.current?.querySelector('[data-active="true"]') as HTMLElement | null
      if (el) el.scrollIntoView({ block: 'center', behavior: 'smooth' })
      searchRef.current?.focus({ preventScroll: true })
    }, 60)
    return () => clearTimeout(t)
  }, [focusSignal])

  useEffect(() => {
    if (!confirmDel) return
    const t = setTimeout(() => setConfirmDel(null), 3500)
    return () => clearTimeout(t)
  }, [confirmDel])

  const testingFile = testRunning ? progress?.strategy : undefined
  const best = report?.bestStrategy
  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase()
    let list = strategies.filter((s) => {
      if (s.file === testingFile) return true
      if (filter === 'own' && !customName(s.file)) return false
      if (filter === 'working' && !report?.results[s.file]?.passed) return false
      if (!needle) return true
      return `${s.title} ${s.description} ${customName(s.file) ?? ''}`.toLowerCase().includes(needle)
    })
    if (report) {
      const score = (f: string): number => report.results[f]?.score ?? -1
      list = [...list].sort((a, b) => score(b.file) - score(a.file))
    } else {
      list = [...list].sort((a, b) => Number(!!customName(b.file)) - Number(!!customName(a.file)))
    }
    return list
  }, [strategies, q, filter, report, testingFile])

  const ownCount = strategies.filter((s) => customName(s.file)).length
  const passedCount = report ? Object.values(report.results).filter((r) => r.passed).length : 0
  const testedCount = report ? Object.keys(report.results).length : 0
  const partial = !!report?.partial

  const basedOn = async (file: string, title: string): Promise<void> => {
    try {
      const own = custom.find((c) => c.file === file)
      if (own) {
        setDraft({ model: own.model, name: own.name, editingId: own.id })
      } else {
        const r = await labFromStrategy(file)
        setDraft({ model: r.model, name: '', basedOn: title, approximate: r.approximate })
      }
      setTab('builder')
    } catch (e) {
      toast.error('Не удалось открыть в конструкторе', { description: e instanceof Error ? e.message : String(e) })
    }
  }

  const doExport = async (id: string): Promise<void> => {
    try {
      const text = await labExport(id)
      await navigator.clipboard.writeText(text)
      toast.success('Стратегия скопирована текстом', { description: 'Отправьте этот текст другу — он вставит его через «Импорт».' })
    } catch (e) {
      toast.error('Не удалось скопировать', { description: e instanceof Error ? e.message : String(e) })
    }
  }

  const doDelete = async (id: string): Promise<void> => {
    if (confirmDel !== id) return setConfirmDel(id)
    setConfirmDel(null)
    try {
      await labDelete(id)
      await refreshCustom()
      onChanged()
      toast.success('Стратегия удалена')
    } catch (e) {
      toast.error('Не удалось удалить', { description: e instanceof Error ? e.message : String(e) })
    }
  }

  const doImport = async (): Promise<void> => {
    setImporting(true)
    try {
      const saved = await labImport(importText)
      await refreshCustom()
      onChanged()
      setImportOpen(false)
      setImportText('')
      toast.success(`Добавлена «${saved.name}»`, { style: POWER_ON_BANNER_STYLE })
    } catch (e) {
      toast.error('Не удалось добавить', { description: e instanceof Error ? e.message : String(e) })
    } finally {
      setImporting(false)
    }
  }

  const filterItems = [
    { id: 'all' as Filter, label: `Все ${strategies.length}` },
    { id: 'working' as Filter, label: report ? `Рабочие ${passedCount}` : 'Рабочие', title: report ? 'Прошли последнюю проверку' : 'Появится после «Проверить все»' },
    ...(isMac ? [] : [{ id: 'own' as Filter, label: `Свои ${ownCount}` }])
  ]

  const summary = report ? (
    <>
      <span className={cn('font-semibold tabular-nums', passedCount ? 'text-primary' : 'text-st-warn-text')}>
        {passedCount} из {testedCount}
      </span>{' '}
      работают у вашего провайдера
      {partial && (
        <span className="text-st-warn-text">
          , проверка остановлена ({testedCount}
          {report.totalStrategies ? ` из ${report.totalStrategies}` : ''})
        </span>
      )}
      {best && <span>, лучше всех «{customName(best) ?? best.replace(/\.bat$/i, '')}»</span>}
    </>
  ) : (
    'Выберите стратегию или проверьте все: программа покажет, какие работают у вашего провайдера'
  )

  // ---- Живая полоса «Проверить все»: одно деление на стратегию.
  const total = progress?.total ?? 0
  const current = progress?.current ?? 0
  const liveResults = live ? Object.values(live) : []
  const liveOk = liveResults.filter((r) => r.passed).length
  const currentFile = testingFile

  return (
    <LzPanel className="flex min-h-[320px] flex-1 flex-col" data-tour="zapret-catalog">
      <div className="shrink-0 px-4 pt-3.5 pb-3">
        <LzSectionHead
          title="Каталог стратегий"
          hint="Стратегия — набор приёмов, которыми Zapret обходит фильтр провайдера. Нажмите на строку, чтобы выбрать. Баллы — сколько из 10 проверочных сайтов открылось."
          sub={<span className="whitespace-normal">{summary}</span>}
          right={
            testRunning ? (
              <Button size="sm" variant="outline" onClick={onStopTest} disabled={testStopping} className="h-8 rounded-lg text-xs" title="Остановить после текущей стратегии — потом можно продолжить с этого места">
                {testStopping ? <Loader2 className="size-3.5 animate-spin" /> : <Square className="size-3.5" />}
                {testStopping ? 'Останавливаем…' : 'Остановить'}
              </Button>
            ) : (
              <>
                {report && (
                  <Button size="icon-sm" variant="ghost" onClick={onResetTest} disabled={busy} className="size-8 rounded-lg" title="Сбросить баллы — стратегии снова будут в обычном порядке" aria-label="Сбросить баллы">
                    <RotateCcw className="size-3.5" />
                  </Button>
                )}
                {partial && (
                  <Button size="sm" variant="outline" onClick={() => onStartTest(true)} disabled={busy || strategies.length === 0} className="h-8 rounded-lg text-xs" title="Проверить только оставшиеся стратегии">
                    <Play className="size-3.5" /> Продолжить
                  </Button>
                )}
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => onStartTest(false)}
                  disabled={busy || strategies.length === 0}
                  className="h-8 rounded-lg text-xs"
                  title="По очереди запустить каждую стратегию и проверить 10 сайтов. Займёт несколько минут; Zapret на это время выключится."
                  data-tour="zapret-test-all"
                >
                  <FlaskConical className="size-3.5" />
                  {report ? (partial ? 'Проверить заново' : 'Перепроверить все') : 'Проверить все'}
                </Button>
              </>
            )
          }
        />

        {/* Живой ход «Проверить все» */}
        {testRunning && (
          <div className="mt-3 rounded-xl border border-primary/30 bg-primary/[0.06] px-3 py-2.5">
            <div className="flex items-center gap-2 text-[12.5px]">
              <Loader2 className="size-3.5 shrink-0 animate-spin text-primary" />
              <span className="font-semibold text-foreground">
                {total ? (
                  <>
                    Проверяю <LiveNumber value={String(current)} /> из {total}
                  </>
                ) : (
                  'Готовлюсь к проверке…'
                )}
              </span>
              {currentFile && <span className="min-w-0 truncate text-muted-foreground">{customName(currentFile) ?? currentFile.replace(/\.bat$/i, '')}</span>}
              {liveResults.length > 0 && (
                <span className="ml-auto shrink-0 tabular-nums text-muted-foreground">
                  работают <span className="font-semibold text-primary">{liveOk}</span>
                </span>
              )}
            </div>
            {total > 0 && (
              <div className="mt-2 flex h-1.5 gap-[2px]" aria-hidden>
                {Array.from({ length: total }, (_, i) => {
                  const r = liveResults[i]
                  const now = !r && i === liveResults.length && current > 0
                  return (
                    <span
                      key={i}
                      className={cn(
                        'flex-1 overflow-hidden rounded-full transition-colors duration-300',
                        r ? (r.passed ? 'bg-primary' : 'bg-st-err/70') : now ? 'lz-rail-flow text-primary/70' : 'bg-foreground/10'
                      )}
                    />
                  )
                })}
              </div>
            )}
            <div className="mt-1.5 text-[11px] text-muted-foreground">Zapret на время проверки выключен и потом вернётся как был. Сайт на каждую стратегию — около 10 секунд.</div>
          </div>
        )}
        {!testRunning && picking && (
          <button
            type="button"
            onClick={() => setAutopickOpen(true)}
            className="mt-3 flex w-full cursor-pointer items-center gap-2 rounded-xl border border-primary/30 bg-primary/[0.06] px-3 py-2 text-left text-[12.5px] transition-colors hover:border-primary/50"
          >
            <Wand2 className="size-3.5 shrink-0 animate-pulse text-primary" />
            <span className="font-semibold text-foreground">Идёт автоподбор</span>
            <span className="min-w-0 truncate text-muted-foreground">{autopick?.current}</span>
            <span className="ml-auto shrink-0 font-semibold text-primary">Открыть</span>
          </button>
        )}

        {/* Поиск и фильтр */}
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <div className="relative min-w-[180px] flex-1">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input ref={searchRef} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Поиск по названию" className="h-8 pl-8 text-xs" />
          </div>
          <Segmented
            size="sm"
            items={filterItems}
            value={filter}
            onChange={(v) => {
              if (v === 'working' && !report) return
              setFilter(v)
            }}
            aria-label="Какие стратегии показать"
            className={isMac ? 'w-[220px]' : 'w-[300px]'}
          />
          {!isMac && (
            <Button
              size="icon-sm"
              variant={importOpen ? 'secondary' : 'outline'}
              className="size-8 rounded-lg"
              title="Добавить стратегию из текста (импорт)"
              aria-label="Импорт стратегии"
              aria-expanded={importOpen}
              onClick={() => setImportOpen((v) => !v)}
            >
              <Import className="size-3.5" />
            </Button>
          )}
        </div>

        {importOpen && (
          <div className="mt-3 space-y-2 rounded-xl border border-foreground/[0.08] bg-foreground/[0.03] p-3">
            <div className="flex items-center gap-1.5 text-[12.5px] font-semibold">
              Импорт стратегии
              <Hint text="Вставьте текст, который начинается с LZS1: (кнопка «Копировать текстом» у своей стратегии), или содержимое .bat-файла Flowseal — из него возьмётся приём для сайтов." />
            </div>
            <textarea
              value={importText}
              onChange={(e) => setImportText(e.target.value)}
              rows={3}
              placeholder="LZS1:…"
              className="custom-scrollbar w-full resize-y rounded-xl border border-[color:var(--input-border)] bg-[color:var(--input-bg)] p-2.5 font-mono text-[11px] outline-none focus-visible:border-[color:var(--input-focus-border)]"
            />
            <div className="flex justify-end gap-2">
              <Button size="sm" variant="ghost" onClick={() => setImportOpen(false)} className="h-8 rounded-lg text-xs">
                Отмена
              </Button>
              <Button size="sm" disabled={!importText.trim() || importing} onClick={() => void doImport()} className="h-8 rounded-lg text-xs">
                {importing ? <Loader2 className="size-3.5 animate-spin" /> : <Import className="size-3.5" />} Добавить
              </Button>
            </div>
          </div>
        )}
      </div>

      {/* Список */}
      <div
        ref={listRef}
        className="custom-scrollbar min-h-0 flex-1 space-y-1.5 overflow-y-auto border-t border-foreground/[0.07] px-3 py-3"
      >
        {strategies.length === 0 ? (
          <EmptyState compact icon={<ZapretIcon />} title="Сборка Zapret не найдена" text="Установите сборку кнопкой «Проверить обновления» в шапке раздела." />
        ) : rows.length === 0 ? (
          <EmptyState compact icon={<SearchX />} title="Ничего не нашлось" text="Попробуйте другое слово или покажите все стратегии." />
        ) : (
          rows.map((s) => {
            const fresh = live?.[s.file]
            const r = fresh ?? report?.results[s.file]
            const stale = testRunning && !fresh && !!r
            const isActive = active === s.file
            const isBest = best === s.file && !testRunning
            const isNow = currentFile === s.file
            const own = customName(s.file)
            const ownItem = own ? custom.find((c) => c.file === s.file) : undefined
            const RowIcon = ownItem?.origin === 'autopick' ? Wand2 : own ? Hammer : ZapretIcon
            return (
              <div
                key={s.file}
                data-active={isActive ? 'true' : undefined}
                className={cn(
                  'group relative flex items-center gap-2 overflow-hidden rounded-xl border py-1.5 pr-2 pl-2 transition-[background-color,border-color] duration-200',
                  isActive
                    ? 'border-primary/50 bg-primary/[0.11]'
                    : isNow
                      ? 'border-primary/35 bg-primary/[0.05]'
                      : 'border-foreground/[0.07] bg-foreground/[0.025] hover:border-foreground/[0.14] hover:bg-foreground/[0.05]'
                )}
              >
                {/* Полоса сигнала слева: горит у выбранной стратегии. */}
                <span
                  aria-hidden
                  className={cn('absolute inset-y-2 left-0 w-[3px] rounded-r-full transition-colors', isActive ? 'bg-primary' : isNow ? 'bg-primary/55' : 'bg-transparent')}
                  style={isActive ? { boxShadow: '0 0 10px var(--primary)' } : undefined}
                />
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => onPick(s.file)}
                  title={r && !r.passed ? `Не прошла последнюю проверку (${r.okCount} из ${r.totalCount}). Выбрать всё равно можно.` : isActive ? 'Выбрана сейчас' : 'Выбрать эту стратегию'}
                  className="flex min-w-0 flex-1 cursor-pointer items-center gap-3 rounded-lg py-0.5 pl-1 text-left disabled:cursor-not-allowed"
                >
                  <span
                    className={cn(
                      'flex size-8 shrink-0 items-center justify-center rounded-lg transition-colors [&_svg]:size-4',
                      isActive ? 'bg-primary text-primary-foreground' : 'bg-foreground/[0.05] text-muted-foreground'
                    )}
                  >
                    {isNow ? <Loader2 className="animate-spin text-primary" /> : <RowIcon />}
                  </span>
                  <span className="min-w-0">
                    <span className="flex min-w-0 items-center gap-1.5">
                      <span className={cn('truncate text-[13px] font-semibold', isActive ? 'text-[color:var(--text-title)]' : 'text-foreground')}>{own ?? s.title}</span>
                      {isActive && <span className="shrink-0 rounded-md bg-primary px-1.5 py-px text-[10.5px] font-bold text-primary-foreground">выбрана</span>}
                      {isBest && (
                        <span className="inline-flex shrink-0 items-center gap-0.5 rounded-md bg-primary/12 px-1.5 py-px text-[10.5px] font-semibold text-primary">
                          <Sparkles className="size-2.5" /> рекомендуем
                        </span>
                      )}
                      {own && (
                        <span className="shrink-0 rounded-md bg-foreground/[0.07] px-1.5 py-px text-[10.5px] font-semibold text-muted-foreground">
                          {ownItem?.origin === 'autopick' ? 'своя, из подбора' : 'своя'}
                        </span>
                      )}
                    </span>
                    {(isNow || s.description) && (
                      <span className={cn('mt-0.5 block truncate text-[11.5px]', isNow ? 'text-primary' : 'text-muted-foreground')}>
                        {isNow ? 'проверяю сейчас…' : s.description}
                      </span>
                    )}
                  </span>
                </button>
                <Button
                  size="xs"
                  variant="outline"
                  disabled={busy}
                  className="shrink-0"
                  title={`Проверить: ${own ?? s.title}`}
                  aria-label={`Проверить: ${own ?? s.title}`}
                  onClick={() => onStartTest(false, s.file)}
                >
                  {isNow ? <Loader2 className="animate-spin" /> : <FlaskConical />}
                  <span className="@max-[690px]:hidden">{isNow ? 'Проверяется…' : 'Проверить'}</span>
                </Button>
                {/* Действия при наведении */}
                {!isMac && (
                  <span className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
                    {ownItem ? (
                      <>
                        <Button size="icon-xs" variant="ghost" title="Изменить в конструкторе" disabled={busy} onClick={() => void basedOn(s.file, own!)}>
                          <Pencil />
                        </Button>
                        <Button size="icon-xs" variant="ghost" title="Копировать текстом (чтобы поделиться)" onClick={() => void doExport(ownItem.id)}>
                          <Copy />
                        </Button>
                        <Button
                          size={confirmDel === ownItem.id ? 'xs' : 'icon-xs'}
                          variant="ghost"
                          title={isActive ? 'Сначала выберите другую стратегию' : 'Удалить'}
                          disabled={busy || isActive}
                          onClick={() => void doDelete(ownItem.id)}
                          className={cn(confirmDel === ownItem.id && 'text-st-err-text')}
                        >
                          <Trash2 />
                          {confirmDel === ownItem.id && 'Удалить?'}
                        </Button>
                      </>
                    ) : (
                      <Button size="xs" variant="ghost" title="Открыть копию в конструкторе и изменить" disabled={busy} onClick={() => void basedOn(s.file, s.title)}>
                        <Pencil /> На основе
                      </Button>
                    )}
                  </span>
                )}
                <span
                  className={cn('flex w-[104px] shrink-0 items-center justify-end gap-2', stale && 'opacity-45')}
                  title={r ? `${stale ? 'Прошлая проверка: ' : ''}открылось ${r.okCount} из ${r.totalCount} сайтов` : 'Ещё не проверялась'}
                >
                  <ScoreCells ok={r?.okCount ?? null} total={r?.totalCount ?? null} title="" />
                  <span
                    className={cn(
                      'w-8 text-right text-[11.5px] font-bold tabular-nums',
                      !r ? 'text-muted-foreground/60' : r.okCount === r.totalCount ? 'text-primary' : r.okCount === 0 ? 'text-st-err-text' : 'text-st-warn-text'
                    )}
                  >
                    {r ? `${r.okCount}/${r.totalCount}` : '—'}
                  </span>
                </span>
              </div>
            )
          })
        )}
      </div>
    </LzPanel>
  )
}

export default ZapretCatalog
