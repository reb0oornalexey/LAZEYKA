import React, { useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import { AlertTriangle, Check, ChevronDown, ListChecks, Loader2, PlusCircle, RotateCcw, Star, Trash2, ClipboardPaste } from 'lucide-react'
import { Button } from '@renderer/components/ui/button'
import { EmptyState } from '@renderer/components/lz'
import { Rows, SettingRow, SettingsGroup } from '@renderer/components/settings/setting-row'
import { cn, POWER_ON_BANNER_STYLE } from '@renderer/lib/utils'
import { readClipboardText } from '@renderer/utils/clipboard-field'
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
  const [previewOpen, setPreviewOpen] = useState(false)
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

  const lock = disabled || busy
  const nothing = pickedCount === 0 && custom.trim() === ''

  if (!snapshot) {
    return (
      <SettingsGroup title="Список сайтов и IP" data-tour="zapret-lists">
        <EmptyState
          icon={<ListChecks />}
          title="Список не прочитан"
          text="Не удалось прочитать lists/list-general.txt. Установите или обновите сборку Zapret кнопкой в шапке раздела."
        />
      </SettingsGroup>
    )
  }

  return (
    <div className="grid items-start gap-3 lg:grid-cols-[1.15fr_1fr]" data-tour="zapret-lists">
      <SettingsGroup
        title="Готовые наборы"
        hint="Наборы адресов, которые Zapret будет обрабатывать. Отметьте нужные и нажмите «Добавить к списку»."
        sub={pickedCount ? `Отмечено: ${pickedCount}` : 'Отметьте нужные наборы'}
      >
        <Rows>
          {sets.map((s) => {
            const checked = picked.has(s.id)
            // Счётчик приходит с бэкенда: у авторского пака содержимое
            // лежит в файле, и `cidrs` намеренно пустой.
            const count = s.entryCount ?? s.cidrs.length
            // Набор из файла, которого нет в сборке. Показать «0 зап.»
            // значило бы соврать: пак не пустой, его просто не положили рядом с приложением.
            const missing = s.available === false
            return (
              <SettingRow
                key={s.id}
                id={`zapret-set-${s.id}`}
                icon={s.recommended ? <Star /> : <ListChecks />}
                on={checked}
                disabled={lock || missing}
                onToggle={lock || missing ? undefined : () => togglePicked(s.id)}
                title={
                  <span className="flex items-center gap-1.5">
                    <span className="truncate">{s.name}</span>
                    {s.recommended && <span className="shrink-0 rounded-md bg-primary/12 px-1.5 py-px text-[11px] font-semibold text-primary">от автора, рекомендуем</span>}
                  </span>
                }
                desc={
                  missing ? (
                    <span className="flex items-start gap-1.5 text-st-warn-text">
                      <AlertTriangle className="mt-px size-3.5 shrink-0" />
                      <span>
                        Файла пака нет в этой сборке (resources\lists\list-general-author.txt). Он появится после полной переустановки или обновления через fast-update.bat.
                      </span>
                    </span>
                  ) : (
                    s.description
                  )
                }
                control={
                  <>
                    <span className={cn('text-[12px] tabular-nums', missing ? 'text-st-warn-text' : 'text-muted-foreground')}>
                      {missing ? 'нет файла' : count.toLocaleString('ru-RU')}
                    </span>
                    <button
                      type="button"
                      role="checkbox"
                      aria-checked={checked}
                      aria-label={s.name}
                      disabled={lock || missing}
                      onClick={() => togglePicked(s.id)}
                      className={cn(
                        'flex size-5 cursor-pointer items-center justify-center rounded-[6px] border transition-colors outline-none focus-visible:ring-2 focus-visible:ring-primary/60 disabled:cursor-not-allowed',
                        checked ? 'border-primary bg-primary text-primary-foreground' : 'border-foreground/25'
                      )}
                    >
                      {checked && <Check className="size-3.5" strokeWidth={3} />}
                    </button>
                  </>
                }
              />
            )
          })}
        </Rows>
      </SettingsGroup>

      <SettingsGroup
        title="Свои сайты и IP"
        hint="По одному в строке: домены, IPv4/IPv6 и CIDR. Неверные строки пропускаются. Правая кнопка мыши в поле — вставить из буфера."
        sub={`В list-general.txt ${snapshot.total.toLocaleString('ru-RU')} запис${endingFor(snapshot.total)}${disabled && disabledReason ? ` · ${disabledReason}` : ''}`}
        right={
          <Button
            size="sm"
            variant="outline"
            disabled={lock}
            className="h-8 rounded-lg text-xs"
            title="Вставить из буфера обмена (или правая кнопка мыши в поле)"
            onClick={async () => {
              const text = (await readClipboardText()).trim()
              if (!text) {
                toast.info('Буфер обмена пуст')
                return
              }
              // Дописываем с новой строки — уже введённое не теряется.
              setCustom((prev) => (prev.trim() ? `${prev.replace(/\s+$/, '')}\n${text}` : text))
            }}
          >
            <ClipboardPaste className="size-3.5" />
            Вставить
          </Button>
        }
      >
        <div className="space-y-3 px-3 pt-1 pb-2">
          <textarea
            value={custom}
            onChange={(e) => setCustom(e.target.value)}
            disabled={lock}
            placeholder={'example.com\n*.example.org\n1.2.3.4\n2606:4700::/32'}
            rows={6}
            spellCheck={false}
            className={cn(
              'custom-scrollbar w-full resize-y rounded-xl border border-[color:var(--input-border)] bg-[color:var(--input-bg)] p-3 font-mono text-xs',
              'placeholder:text-muted-foreground/60 outline-none transition-colors focus-visible:border-[color:var(--input-focus-border)]',
              lock && 'pointer-events-none opacity-50'
            )}
          />
          <div className="flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              onClick={() => void apply('append')}
              disabled={lock || nothing}
              className="h-8 rounded-lg text-xs"
              title="Дописать выбранное к текущему списку. Существующие записи сохранятся, дубли не продублируются."
            >
              {busy ? <Loader2 className="size-3.5 animate-spin" /> : <PlusCircle className="size-3.5" />}
              Добавить к списку
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={requestReplace}
              disabled={lock || nothing}
              title={`Удалить текущие ${snapshot.total} записей и оставить только выбранное`}
              className={cn('h-8 rounded-lg text-xs', confirmReplace && 'border-st-err/60 bg-st-err/10 text-st-err-text hover:bg-st-err/15 hover:text-st-err-text')}
            >
              {confirmReplace ? `Точно стереть ${snapshot.total.toLocaleString('ru-RU')}? Нажмите ещё раз` : 'Заменить список'}
            </Button>
          </div>

          <div className="rounded-xl border border-foreground/[0.08] bg-foreground/[0.03]">
            <div className="flex items-center gap-1 px-2 py-1.5">
              <button
                type="button"
                onClick={() => setPreviewOpen((v) => !v)}
                aria-expanded={previewOpen}
                disabled={snapshot.preview.length === 0}
                className="inline-flex flex-1 cursor-pointer items-center gap-1.5 rounded-lg px-1 text-left text-[12px] font-semibold text-foreground disabled:cursor-default disabled:text-muted-foreground"
              >
                <ChevronDown className={cn('size-3.5 transition-transform', !previewOpen && '-rotate-90')} />
                Сейчас в списке
                <span className="font-normal text-muted-foreground tabular-nums">{snapshot.total.toLocaleString('ru-RU')}</span>
              </button>
              {snapshot.hasBackup && (
                <Button
                  size="xs"
                  variant="ghost"
                  onClick={() => void restore()}
                  disabled={lock}
                  title="Отменить правки: вернуть снимок, сделанный при первом изменении"
                >
                  <RotateCcw className="size-3" />
                  Из бэкапа
                </Button>
              )}
              <Button
                size="xs"
                variant="ghost"
                onClick={() => void clearAll()}
                disabled={lock || snapshot.total === 0}
                className="text-st-err-text hover:text-st-err-text"
              >
                <Trash2 className="size-3" />
                Очистить
              </Button>
            </div>
            {previewOpen && snapshot.preview.length > 0 && (
              <pre className="custom-scrollbar max-h-40 overflow-auto border-t border-foreground/[0.07] px-3 py-2 font-mono text-[11px] leading-snug text-muted-foreground">
                {snapshot.preview.join('\n')}
                {snapshot.total > snapshot.preview.length ? `\n… ещё ${(snapshot.total - snapshot.preview.length).toLocaleString('ru-RU')}` : ''}
              </pre>
            )}
          </div>
        </div>
      </SettingsGroup>
    </div>
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
