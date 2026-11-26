import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { ArrowRight, Loader2 } from 'lucide-react'
import { Switch } from '@renderer/components/ui/switch'
import { Hint } from '@renderer/components/prematch/hint'
import type { IncyNode } from '@renderer/utils/ipc'
import { chainExitCheck, chainGet, chainSet, type ChainInfo } from '@renderer/utils/incy-extra-api'

interface Props {
  /** Вызывается после сохранения: страница может обновить состояние. */
  onChanged?: () => void
  /** Текущий сервер (выход): при его смене карточка перечитывает состояние. */
  exitKey?: string | null
  /** Выбрать сервер-выход так же, как в списке серверов (с переподключением, если VPN включён). */
  onSelectExit?: (id: string) => Promise<void>
  nodes: IncyNode[]
  pinging: ReadonlySet<string>
  pingBusy: boolean
  onPing: (ids: string[]) => void
  onStopPing: () => void
}

const nodeSelectClass =
  'h-8 w-88 max-w-full min-w-0 rounded-lg border border-border/60 bg-background/60 px-2.5 text-xs outline-none focus:border-primary/60 disabled:opacity-50'

/** Цепочка узлов (двойной VPN): вход через один сервер, выход через другой. */
const NodeChainCard: React.FC<Props> = ({ onChanged, exitKey, onSelectExit, nodes, pinging, pingBusy, onPing, onStopPing }) => {
  const [info, setInfo] = useState<ChainInfo | null>(null)
  const [busy, setBusy] = useState(false)
  const [pick, setPick] = useState('')
  const [error, setError] = useState<string | null>(null)

  const reload = useCallback(async () => {
    try {
      setInfo(await chainGet())
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не удалось получить состояние цепочки')
    }
  }, [])

  useEffect(() => {
    void reload()
  }, [reload, exitKey])

  const byId = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes])
  const enabled = Boolean(info?.entryNodeId)
  const entry = info?.entryNodeId ? byId.get(info.entryNodeId) : undefined
  const exit = info?.exitNodeId ? byId.get(info.exitNodeId) : undefined
  const eligible = useMemo(
    () => nodes.filter((n) => info?.eligibleEntryIds.includes(n.id)),
    [nodes, info]
  )
  const exits = useMemo(() => nodes.filter((n) => info?.eligibleExitIds?.includes(n.id)), [nodes, info])
  const exitOk = Boolean(exit && info?.eligibleExitIds?.includes(exit.id))
  const pingIds = [...new Set([...eligible, ...exits].map((node) => node.id))]
  const pingLabel = (n: IncyNode): string =>
    pinging.has(n.id) ? 'замер…' : n.latencyMs != null ? `${n.latencyMs} мс` : n.latencyAt ? 'нет ответа' : 'пинг не измерен'

  const chooseExit = async (id: string): Promise<void> => {
    if (!id || !onSelectExit || id === exit?.id) return
    setBusy(true)
    setError(null)
    try {
      if (enabled) {
        const check = await chainExitCheck(id)
        if (!check.ok) {
          setError(check.reason ?? 'Выход не прошёл проверку')
          return
        }
      }
      await onSelectExit(id)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не удалось выбрать выход')
    } finally {
      setBusy(false)
      void reload()
    }
  }

  const apply = async (id: string | null): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      const r = await chainSet(id)
      if (!r.applied) {
        setError(r.reason ?? 'Цепочку включить не удалось')
        return
      }
      toast.success(
        id
          ? r.reconnecting
            ? 'Пара ответила, VPN переподключается'
            : 'Пара ответила, цепочка сохранена'
          : r.reconnecting
            ? 'Цепочка выключена, VPN переподключается'
            : 'Цепочка выключена'
      )
      setPick('')
      onChanged?.()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Ошибка')
    } finally {
      setBusy(false)
      void reload()
    }
  }

  const node = (n: IncyNode | undefined, fallback: string): React.JSX.Element => (
    <span data-sensitive="node" className="max-w-[10rem] truncate rounded-md border border-border/60 px-2 py-0.5 text-[11px] font-semibold">
      {n ? `${n.name} · ${pingLabel(n)}` : fallback}
    </span>
  )

  const noCandidates = !enabled && info != null && eligible.length === 0

  return (
    <div data-tour="incy-chain" className="space-y-3 rounded-xl border border-border bg-card/40 p-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-1.5 text-sm font-semibold">
          Цепочка узлов
          <Hint text="Сайт видит IP второго сервера. При выборе сначала проверяется доступность через пару узлов." />
        </div>
        <Switch
          checked={enabled}
          disabled={busy || info === null || (!enabled && eligible.length === 0)}
          onCheckedChange={(on) => {
            if (!on) void apply(null)
            else if (pick) void apply(pick)
            else if (eligible.length === 1) void apply(eligible[0].id)
            else setError('Выберите узел-вход ниже — затем цепочка включится')
          }}
        />
      </div>

      <p className="text-[11px] leading-snug text-muted-foreground">
        Трафик проходит через входной и выходной серверы. Дополнительный переход может увеличить задержку.
      </p>

      <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
        <span>Вы</span>
        <ArrowRight className="size-3" />
        {node(entry ?? byId.get(pick), 'вход не выбран')}
        <ArrowRight className="size-3" />
        {node(exit, 'сервер не выбран')}
        <ArrowRight className="size-3" />
        <span>сайт</span>
      </div>

      {onSelectExit && (
        <div className="flex flex-wrap items-center gap-2">
          <label className="w-20 text-[11px] text-muted-foreground" htmlFor="chain-exit">
            Узел-выход
          </label>
          <select
            id="chain-exit"
            value={exitOk ? (exit?.id ?? '') : ''}
            disabled={busy || info === null || exits.length === 0}
            onChange={(e) => void chooseExit(e.target.value)}
            className={nodeSelectClass}
          >
            <option value="">{exitOk ? '—' : exit ? 'Текущий не подходит — выберите' : '— выберите —'}</option>
            {exits.map((n) => (
              <option key={n.id} value={n.id} disabled={n.id === info?.entryNodeId} data-sensitive="node">
                {n.name} · {pingLabel(n)}
              </option>
            ))}
          </select>
          <Hint text="Выход — сервер, чей IP увидят сайты. Это тот же сервер, что выбран в списке серверов: смена здесь меняет и его. Подходят VLESS, VMess, Trojan и Shadowsocks — из ссылок и из конфигов провайдера (Xray или sing-box). Вход — любой сервер того же вида, в том числе Hysteria2." />
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <label className="w-20 text-[11px] text-muted-foreground" htmlFor="chain-entry">
          Узел-вход
        </label>
        <select
          id="chain-entry"
          value={enabled ? (info?.entryNodeId ?? '') : pick}
          disabled={busy || info === null || eligible.length === 0}
          onChange={(e) => {
            const id = e.target.value
            if (enabled) void apply(id || null)
            else setPick(id)
          }}
          className={nodeSelectClass}
        >
          <option value="">— не выбран —</option>
          {eligible.map((n) => (
            <option key={n.id} value={n.id} data-sensitive="node">
              {n.name} · {pingLabel(n)}
            </option>
          ))}
        </select>
        {!enabled && pick && (
          <button
            type="button"
            disabled={busy}
            onClick={() => void apply(pick)}
            className="inline-flex cursor-pointer items-center gap-1 rounded-lg border border-primary/40 px-2 py-1 text-[11px] font-semibold text-primary hover:bg-primary/10 disabled:opacity-50"
          >
            {busy && <Loader2 className="size-3 animate-spin" />}
            Включить цепочку
          </button>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={busy || (!pingBusy && pingIds.length === 0)}
          onClick={() => pingBusy ? onStopPing() : onPing(pingIds)}
          className="inline-flex cursor-pointer items-center gap-1 rounded-lg border border-border px-2 py-1 text-xs font-semibold hover:bg-muted disabled:opacity-50"
        >
          {pingBusy ? 'Остановить замер пинга' : 'Измерить пинг узлов'}
        </button>
        <span className="text-[11px] text-muted-foreground">Пинг указан для каждого узла отдельно.</span>
      </div>
      <p className="text-[11px] text-muted-foreground" role="status">
        {busy ? 'Проверяю пару узлов…' : 'Сначала проверяется доступность через пару, затем VPN переподключается.'}
      </p>

      {noCandidates && (
        <p className="rounded-lg border border-border/60 bg-muted/30 px-3 py-1.5 text-[11px] leading-snug text-muted-foreground">
          {(info?.reason ?? 'Для выбранного узла подходящих серверов-входов нет').replace(/[.\s]*$/, '.')}
          {onSelectExit && exits.length > 0 && !exitOk ? ' Выберите другой узел-выход выше.' : ''}
          {exits.length === 0 ? ' В ваших подписках нет серверов VLESS, VMess, Trojan или Shadowsocks — цепочка недоступна.' : ''}
        </p>
      )}
      {enabled && info && !info.active && info.reason && (
        <p className="rounded-lg border border-st-warn/40 bg-st-warn/10 px-3 py-1.5 text-[11px] text-st-warn-text">
          Цепочка не применена. {info.reason}
        </p>
      )}
      {enabled && info?.active && (
        <p className="text-[11px] text-st-ok-text">Маршрут цепочки применён к VPN.</p>
      )}
      {error && <p className="text-[11px] text-st-err-text">{error}</p>}
    </div>
  )
}

export default NodeChainCard
