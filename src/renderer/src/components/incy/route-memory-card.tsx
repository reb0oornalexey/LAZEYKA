import React, { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Trash2 } from 'lucide-react'
import { Hint } from '@renderer/components/prematch/hint'
import {
  routeMemoryList,
  routeMemoryReapply,
  routeMemoryRemove,
  type RouteFix,
  type RouteMemoryItem
} from '@renderer/utils/incy-extra-api'

const FIX_LABEL: Record<RouteFix, string> = {
  zapret: 'Помогает Zapret',
  vpn: 'Через VPN',
  direct: 'Напрямую'
}

function fmtDate(ms: number): string {
  return ms ? new Date(ms).toLocaleDateString('ru-RU') : ''
}

/** Список сайтов, для которых выбрано «всегда так». Читается один раз при открытии. */
const RouteMemoryCard: React.FC = () => {
  const [items, setItems] = useState<RouteMemoryItem[] | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  const reload = useCallback(async () => {
    try {
      setItems(await routeMemoryList())
    } catch {
      setItems([])
    }
  }, [])

  useEffect(() => {
    void reload()
  }, [reload])

  const remove = async (domain: string): Promise<void> => {
    setBusy(domain)
    try {
      await routeMemoryRemove(domain)
      toast.success('Сайт убран из памяти маршрутов')
      await reload()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Не удалось удалить')
    } finally {
      setBusy(null)
    }
  }

  const reapply = async (): Promise<void> => {
    try {
      const n = await routeMemoryReapply()
      toast.success(n > 0 ? `Возвращено правил: ${n}` : 'Все правила на месте')
      await reload()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Не удалось применить')
    }
  }

  const lost = (items ?? []).filter((i) => !i.ruleActive).length

  return (
    <div data-tour="incy-route-memory" className="space-y-3 rounded-xl border border-border bg-card/40 p-4">
      <div className="flex items-center gap-1.5 text-sm font-semibold">
        Память маршрутов
        <Hint text="Сюда попадают сайты, для которых вы выбрали «всегда так». Программа применяет решение сама при каждом запуске. Если убрать сайт отсюда, созданное им правило исчезнет, а домен в списке Zapret останется — его можно убрать на вкладке Zapret." />
      </div>

      {items === null ? (
        <p className="text-[11px] text-muted-foreground">Загрузка…</p>
      ) : items.length === 0 ? (
        <p className="text-[11px] text-muted-foreground">
          Пока пусто. Сюда попадают сайты, для которых вы выбрали «всегда так». Программа применяет решение сама при
          каждом запуске.
        </p>
      ) : (
        <div className="divide-y divide-border/30 rounded-lg border border-border/40">
          {items.map((i) => (
            <div key={i.domain} className="flex items-center justify-between gap-2 px-3 py-1.5 text-[11px]">
              <span className="min-w-0 truncate font-mono font-semibold">{i.domain}</span>
              <span className="flex shrink-0 items-center gap-3">
                <span className={i.ruleActive ? 'text-muted-foreground' : 'text-st-warn-text'}>
                  {FIX_LABEL[i.fix]}
                  {!i.ruleActive && ' · правила нет'}
                </span>
                <span className="text-muted-foreground">{fmtDate(i.at)}</span>
                <button
                  type="button"
                  title="Убрать из памяти"
                  disabled={busy === i.domain}
                  onClick={() => void remove(i.domain)}
                  className="cursor-pointer text-muted-foreground hover:text-destructive disabled:opacity-40"
                >
                  <Trash2 className="size-3.5" />
                </button>
              </span>
            </div>
          ))}
        </div>
      )}

      {lost > 0 && (
        <div className="flex items-center justify-between gap-2 rounded-lg border border-st-warn/40 bg-st-warn/10 px-3 py-1.5 text-[11px] text-st-warn-text">
          <span>У части сайтов нет правила — возможно, оно пропало при смене профиля маршрутизации.</span>
          <button type="button" onClick={() => void reapply()} className="shrink-0 cursor-pointer font-semibold underline">
            Вернуть правила
          </button>
        </div>
      )}
    </div>
  )
}

export default RouteMemoryCard
