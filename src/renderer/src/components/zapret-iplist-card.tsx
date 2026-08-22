import { useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import {
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  ListChecks,
  Loader2,
  PlusCircle,
  RotateCcw,
  Star,
  Trash2
} from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@renderer/components/ui/card'
import { Button } from '@renderer/components/ui/button'
import { cn, POWER_ON_BANNER_STYLE } from '@renderer/lib/utils'
import {
  zapretGetCuratedIpSets,
  zapretGetIpList,
  zapretApplyIpListPatch,
  zapretClearIpList,
  zapretRestoreIpListBackup,
  type CuratedIpSet,
  type IpListSnapshot
} from '@renderer/utils/ipc'

interface Props {
  disabled?: boolean
  disabledReason?: string
}

const ZapretIpListCard: React.FC<Props> = ({ disabled = false, disabledReason }) => {
  const [open, setOpen] = useState(false)
  const [snapshot, setSnapshot] = useState<IpListSnapshot | null>(null)
  const [sets, setSets] = useState<CuratedIpSet[]>([])
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [custom, setCustom] = useState('')
  const [busy, setBusy] = useState(false)
  /** Второй клик по «Заменить список» подтверждает удаление текущего. */
  const [confirmReplace, setConfirmReplace] = useState(false)
  const loadedRef = useRef(false)

  const refresh = async (): Promise<void> => {
    try {
      const [snap, list] = await Promise.all([
        zapretGetIpList(),
        zapretGetCuratedIpSets()
      ])
      setSnapshot(snap)
      setSets(list)
    } catch {
      // Bundle may not be installed yet — leave snapshot null.
      setSnapshot(null)
      setSets([])
    }
  }

  useEffect(() => {
    if (loadedRef.current) return
    loadedRef.current = true
    void refresh()
  }, [])

  const togglePicked = (id: string): void => {
    setPicked((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const apply = async (mode: 'append' | 'replace'): Promise<void> => {
    if (busy) return
    if (picked.size === 0 && custom.trim() === '') {
      toast.warning('Нечего применять — выбери набор или впиши IP вручную')
      return
    }
    setBusy(true)
    const tId = toast.loading(mode === 'replace' ? 'Перезаписываем список IP…' : 'Добавляем IP в список…')
    try {
      const res = await zapretApplyIpListPatch({
        setIds: [...picked],
        customCidrs: custom.length ? [custom] : [],
        replace: mode === 'replace'
      })
      setSnapshot(res)
      setPicked(new Set())
      setCustom('')
      // Показываем не только итог, но и что именно произошло. Главный вопрос
      // при добавлении большого пака — «мои записи не затёрло и дубли не
      // налезли?»; число «всего в списке» на него не отвечает.
      const nf = (n: number): string => n.toLocaleString('ru-RU')
      toast.success(
        mode === 'replace'
          ? `Список перезаписан — ${nf(res.total)} запис${endingFor(res.total)}`
          : `Добавлено ${nf(res.added)} запис${endingFor(res.added)}`,
        {
          id: tId,
          style: POWER_ON_BANNER_STYLE,
          description:
            mode === 'replace'
              ? undefined
              : res.skipped > 0
                ? `Пропущено дублей: ${nf(res.skipped)}. Всего в списке ${nf(res.total)}.`
                : `Всего в списке ${nf(res.total)}. Прежние записи сохранены.`
        }
      )
    } catch (e) {
      toast.error('Не удалось обновить список IP', {
        id: tId,
        description: e instanceof Error ? e.message : String(e)
      })
    } finally {
      setBusy(false)
    }
  }

  /**
   * «Заменить список» стирает то, что пользователь копил месяцами, и стоит
   * вплотную к основной кнопке. Бэкап тут не спасает: он снимается один раз,
   * при первой правке, и хранит исходный список Flowseal, а не текущую работу
   * пользователя. Поэтому — подтверждение в два шага.
   */
  const requestReplace = (): void => {
    if (busy) return
    if (picked.size === 0 && custom.trim() === '') {
      toast.warning('Нечего применять — выбери набор или впиши IP вручную')
      return
    }
    if (confirmReplace) {
      setConfirmReplace(false)
      void apply('replace')
      return
    }
    setConfirmReplace(true)
    window.setTimeout(() => setConfirmReplace(false), 4000)
  }

  const clearAll = async (): Promise<void> => {
    if (busy) return
    setBusy(true)
    const tId = toast.loading('Очищаем список IP…')
    try {
      const snap = await zapretClearIpList()
      setSnapshot(snap)
      toast.success('Список IP очищен', { id: tId })
    } catch (e) {
      toast.error('Не удалось очистить список', {
        id: tId,
        description: e instanceof Error ? e.message : String(e)
      })
    } finally {
      setBusy(false)
    }
  }

  const restore = async (): Promise<void> => {
    if (busy) return
    setBusy(true)
    const tId = toast.loading('Восстанавливаем список из бэкапа…')
    try {
      const snap = await zapretRestoreIpListBackup()
      setSnapshot(snap)
      toast.success(`Восстановлено — ${snap.total} запис${endingFor(snap.total)}`, {
        id: tId,
        style: POWER_ON_BANNER_STYLE
      })
    } catch (e) {
      toast.error('Не удалось восстановить', {
        id: tId,
        description: e instanceof Error ? e.message : String(e)
      })
    } finally {
      setBusy(false)
    }
  }

  const pickedCount = useMemo(() => picked.size, [picked])

  return (
    <Card className="cyber-card">
      <CardHeader className="flex flex-row items-center justify-between gap-3 space-y-0">
        <div className="min-w-0 flex-1">
          <CardTitle className="flex items-center gap-2">
            <ListChecks className="h-4 w-4 text-muted-foreground" />
            Список хостов и IP
            {snapshot && (
              <span className="text-xs font-normal text-muted-foreground">
                {snapshot.total} запис{endingFor(snapshot.total)} в list-general.txt
              </span>
            )}
          </CardTitle>
        </div>
        <Button
          variant={open ? 'secondary' : 'outline'}
          size="sm"
          disabled={disabled}
          title={disabled ? disabledReason : undefined}
          onClick={() => setOpen((v) => !v)}
          className="shrink-0"
        >
          {open
            ? <><ChevronDown className="h-3.5 w-3.5" /> Свернуть</>
            : <><ChevronRight className="h-3.5 w-3.5" /> Управление списком</>}
        </Button>
      </CardHeader>

      {open && (
        <CardContent className="space-y-4 pt-0">
          {!snapshot ? (
            <p className="text-sm text-muted-foreground">
              Не удалось прочитать <code className="text-xs">lists/list-general.txt</code>.
              Установите или обновите Zapret-бандл.
            </p>
          ) : (
            <>
              <div>
                <div className="mb-2 text-xs uppercase tracking-wide text-muted-foreground">
                  Готовые наборы
                </div>
                <div className="grid gap-2 sm:grid-cols-2">
                  {sets.map((s) => {
                    const checked = picked.has(s.id)
                    // Счётчик приходит с бэкенда: у авторского пака содержимое
                    // лежит в файле, и `cidrs` намеренно пустой.
                    const count = s.entryCount ?? s.cidrs.length
                    // Набор из файла, которого нет в сборке. Показать «0 зап.»
                    // значило бы соврать: пак не пустой, его просто не
                    // положили рядом с приложением.
                    const missing = s.available === false
                    return (
                      <label
                        key={s.id}
                        className={cn(
                          'flex select-none items-start gap-2.5 rounded-xl border p-3 transition-all',
                          missing
                            ? 'cursor-not-allowed border-amber-500/40 bg-amber-500/[0.04]'
                            : 'cursor-pointer',
                          checked
                            ? 'border-primary/60 bg-primary/10 shadow-[0_0_15px_rgba(99,102,241,0.2)]'
                            : s.recommended && !missing
                              ? 'border-amber-500/50 bg-amber-500/[0.06] hover:bg-amber-500/10'
                              : !missing && 'border-border/70 bg-card/40 hover:bg-foreground/[0.04]',
                          // Авторский пак занимает всю ширину: он покрывает
                          // почти все наборы ниже, и ставить его в один ряд с
                          // ними как равный вариант — вводить в заблуждение.
                          s.recommended && 'sm:col-span-2',
                          (disabled || busy) && 'pointer-events-none opacity-50'
                        )}
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          disabled={missing}
                          onChange={() => togglePicked(s.id)}
                          className="mt-0.5 h-4 w-4 shrink-0 cursor-pointer accent-primary disabled:cursor-not-allowed"
                        />
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center justify-between gap-2">
                            <span className="flex items-center gap-1.5 min-w-0">
                              {s.recommended && (
                                <Star className="size-3.5 shrink-0 fill-amber-400 text-amber-500" />
                              )}
                              <span className="text-xs font-semibold text-foreground truncate">
                                {s.name}
                              </span>
                              {s.recommended && (
                                <span className="shrink-0 rounded-full border border-amber-500/40 bg-amber-500/15 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide text-amber-700 dark:text-amber-400">
                                  от автора · рекомендуется
                                </span>
                              )}
                            </span>
                            <span
                              className={cn(
                                'shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-mono',
                                missing
                                  ? 'border-amber-500/50 bg-amber-500/15 text-amber-700 dark:text-amber-400'
                                  : s.recommended
                                    ? 'border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-400'
                                    : 'border-border/40 bg-foreground/[0.06] text-muted-foreground'
                              )}
                            >
                              {missing ? 'нет файла' : `${count.toLocaleString('ru-RU')} зап.`}
                            </span>
                          </div>
                          <p className="mt-1 text-[11px] text-muted-foreground leading-relaxed">
                            {s.description}
                          </p>
                          {missing && (
                            <p className="mt-1.5 flex items-start gap-1.5 text-[11px] leading-relaxed text-amber-700 dark:text-amber-400">
                              <AlertTriangle className="mt-px size-3.5 shrink-0" />
                              <span>
                                Файл пака не найден в этой сборке
                                (<code className="font-mono">resources\lists\list-general-author.txt</code>).
                                Он появится после полной переустановки или обновления через
                                fast-update.bat.
                              </span>
                            </p>
                          )}
                        </div>
                      </label>
                    )
                  })}
                </div>
              </div>

              <div>
                <div className="mb-2 text-xs uppercase tracking-wide text-muted-foreground font-mono">
                  Свои хосты / IP
                </div>
                <textarea
                  value={custom}
                  onChange={(e) => setCustom(e.target.value)}
                  disabled={disabled || busy}
                  placeholder={'example.com\n*.example.org\n1.2.3.4\n2606:4700::/32'}
                  rows={4}
                  spellCheck={false}
                  className={cn(
                    'w-full rounded-xl border border-border/80 bg-background/50 backdrop-blur-md p-3 font-mono text-xs',
                    'placeholder:text-muted-foreground/60 focus:border-primary/60 focus:ring-1 focus:ring-primary/40 focus:outline-none transition-all',
                    (disabled || busy) && 'pointer-events-none opacity-50'
                  )}
                />
                <p className="mt-1.5 text-[11px] text-muted-foreground">
                  По одному в строке. Поддерживаются домены, IPv4/IPv6 и CIDR. Невалидные строки игнорируются.
                </p>
              </div>

              {snapshot.preview.length > 0 && (
                <div>
                  <div className="mb-2 text-xs uppercase tracking-wide text-muted-foreground font-mono">
                    Текущий список (первые {snapshot.preview.length} из {snapshot.total})
                  </div>
                  <pre className="max-h-32 overflow-auto rounded-xl border border-border/70 bg-black/40 backdrop-blur-md p-3 font-mono text-[11px] leading-snug">
                    {snapshot.preview.join('\n')}
                    {snapshot.total > snapshot.preview.length ? '\n…' : ''}
                  </pre>
                </div>
              )}

              <div className="flex flex-wrap items-center gap-2 pt-1">
                <Button
                  size="sm"
                  onClick={() => { void apply('append') }}
                  disabled={disabled || busy || (pickedCount === 0 && custom.trim() === '')}
                  title="Дописать выбранное к текущему списку. Существующие записи сохранятся, дубли не продублируются."
                >
                  {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <PlusCircle className="h-3.5 w-3.5" />}
                  Добавить к списку
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={requestReplace}
                  disabled={disabled || busy || (pickedCount === 0 && custom.trim() === '')}
                  title={`Удалить текущие ${snapshot.total} записей и оставить только выбранное`}
                  className={cn(
                    confirmReplace &&
                      'border-red-500/60 bg-red-500/10 text-red-400 hover:text-red-300 hover:bg-red-500/15'
                  )}
                >
                  {confirmReplace
                    ? `Точно стереть ${snapshot.total.toLocaleString('ru-RU')}? Нажмите ещё раз`
                    : 'Заменить список'}
                </Button>
                <div className="ml-auto flex items-center gap-2">
                  {snapshot.hasBackup && (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => { void restore() }}
                      disabled={disabled || busy}
                      title="Отменить последние правки (снимок создаётся автоматически при первом изменении)"
                    >
                      <RotateCcw className="h-3.5 w-3.5" />
                      Из бэкапа
                    </Button>
                  )}
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => { void clearAll() }}
                    disabled={disabled || busy || snapshot.total === 0}
                    className="text-red-400 hover:text-red-300"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    Очистить
                  </Button>
                </div>
              </div>
            </>
          )}
        </CardContent>
      )}
    </Card>
  )
}

function endingFor(n: number): string {
  // Russian noun ending: 1 → ь, 2-4 → и, 5+ / 0 / 11-14 → ей
  const mod10 = n % 10
  const mod100 = n % 100
  if (mod10 === 1 && mod100 !== 11) return 'ь'
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return 'и'
  return 'ей'
}

export default ZapretIpListCard
