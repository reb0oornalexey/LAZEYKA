import React, { useEffect, useMemo, useState } from 'react'
import { Copy, Loader2, Play, Plus, X } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@renderer/components/ui/button'
import { Input } from '@renderer/components/ui/input'
import { LzPanel, LzSectionHead } from '@renderer/components/lz'
import { cn } from '@renderer/lib/utils'
import { useStreamerStore } from '@renderer/store/streamer-store'
import type { IngestPlatform, IngestResult, IngestServer } from '@renderer/utils/streamer-api'
import { ObsIcon, PlatformIcon, TwitchIcon, YouTubeIcon } from './icons'

/** Адрес для вставки в OBS. */
function copyAddress(s: IngestServer, raw?: string): string {
  if (s.platform === 'twitch') return s.port === 443 ? `rtmps://${s.host}:443/app` : `rtmp://${s.host}/app`
  if (s.platform === 'youtube') return s.port === 443 ? `rtmps://${s.host}:443/live2` : `rtmp://${s.host}/live2`
  return raw && /^rtmps?:\/\//i.test(raw) ? raw : `${s.host}:${s.port}`
}

/** То же самое для разбора ввода в поле «Свой сервер» — как parseTarget в main. */
function parseCustom(input: string): { host: string; port: number } | null {
  let s = input.trim()
  if (!s) return null
  let port = 1935
  const sch = /^([a-z][a-z0-9+.-]*):\/\//i.exec(s)
  if (sch) {
    const v = sch[1].toLowerCase()
    if (v === 'rtmps') port = 443
    else if (v !== 'rtmp') return null
    s = s.slice(sch[0].length)
  }
  s = s.split(/[/?#]/)[0]
  const m = /^([a-z0-9]([a-z0-9.-]*[a-z0-9])?)(?::(\d{1,5}))?$/i.exec(s)
  if (!m) return null
  const p = m[3] ? Number(m[3]) : port
  if (p < 1 || p > 65535) return null
  return { host: m[1].toLowerCase(), port: p }
}

const PLATFORM_CHOICES: { id: IngestPlatform; label: string }[] = [
  { id: 'custom', label: 'Другой' },
  { id: 'kick', label: 'Kick' },
  { id: 'twitch', label: 'Twitch' },
  { id: 'youtube', label: 'YouTube' }
]

export const IngestCard: React.FC = () => {
  const s = useStreamerStore()
  const platform = s.state?.platform
  const [input, setInput] = useState('')
  const [plat, setPlat] = useState<IngestPlatform>('custom')

  useEffect(() => {
    if (!s.list) void s.loadList()
  }, [])

  const rawByCustom = useMemo(() => new Map(s.custom.map((c) => [c.id, c.name])), [s.custom])

  const rows = useMemo(() => {
    const all: IngestServer[] = [
      ...(s.list?.servers ?? []).filter((x) => (x.platform === 'twitch' ? s.include.twitch : s.include.youtube)),
      ...s.custom
    ]
    const hasResults = Object.keys(s.results).length > 0
    const key = (x: IngestServer): number => {
      const r = s.results[x.id]
      if (!r) return Number.MAX_SAFE_INTEGER - 1
      return r.medianMs ?? Number.MAX_SAFE_INTEGER
    }
    return hasResults ? [...all].sort((a, b) => key(a) - key(b)) : all
  }, [s.list, s.include, s.custom, s.results])

  const bestId = useMemo(() => {
    if (s.running) return null
    let best: IngestResult | null = null
    for (const r of Object.values(s.results)) if (r.medianMs != null && (!best || r.medianMs < (best.medianMs ?? Infinity))) best = r
    return best?.id ?? null
  }, [s.results, s.running])

  const add = (): void => {
    const t = parseCustom(input)
    if (!t) {
      toast.error('Не получилось разобрать адрес. Пример: rtmp://example.com/live или example.com:1935')
      return
    }
    s.addCustom(plat, t.host, t.port, input.trim())
    setInput('')
  }

  const copy = (x: IngestServer): void => {
    navigator.clipboard
      .writeText(copyAddress(x, rawByCustom.get(x.id)))
      .then(() => toast.success('Адрес скопирован'))
      .catch(() => toast.error('Не удалось скопировать'))
  }

  const maxMs = Math.max(1, ...Object.values(s.results).map((r) => r.medianMs ?? 0))
  const tested = Object.keys(s.results).length > 0

  return (
    <LzPanel data-tour="streamer-section-ingest" className="p-4">
      <LzSectionHead
        title="Серверы приёма трансляции"
        hint="Показывает, до какого сервера Twitch или YouTube соединение быстрее всего. Меряется время установки соединения, 5 раз на сервер; чем меньше, тем лучше. Ничего не передаётся и не включается."
        sub={
          s.running
            ? `Проверяю ${s.progress?.done ?? 0} из ${s.progress?.total ?? 0}`
            : bestId
              ? 'Быстрее всех — сервер с отметкой «лучший». Скопируйте его адрес в OBS'
              : 'Какой сервер Twitch или YouTube отвечает быстрее'
        }
        right={
          <Button size="sm" className="h-8 gap-1.5 text-xs" disabled={s.running || s.listLoading || !s.list} onClick={() => void s.runTest()}>
            {s.running ? <Loader2 className="size-3.5 animate-spin" /> : <Play className="size-3.5" />}
            {s.running ? `${s.progress?.done ?? 0} из ${s.progress?.total ?? 0}` : tested ? 'Проверить снова' : 'Проверить'}
          </Button>
        }
      />

      <div className="mt-3 flex flex-wrap items-center gap-2">
        {(
          [
            ['twitch', 'Twitch', 'Европа и Азия', <TwitchIcon key="t" className="size-4" />],
            ['youtube', 'YouTube', 'все серверы', <YouTubeIcon key="y" className="size-4" />]
          ] as const
        ).map(([key, name, sub, icon]) => {
          const on = s.include[key]
          return (
            <button
              key={key}
              type="button"
              role="switch"
              aria-checked={on}
              onClick={() => s.setInclude(key, !on)}
              className={cn(
                'flex h-10 cursor-pointer items-center gap-2 rounded-xl border px-3 text-left transition-colors',
                on ? 'border-primary/40 bg-primary/10' : 'border-foreground/[0.08] bg-foreground/[0.03] opacity-70 hover:opacity-100'
              )}
            >
              {icon}
              <span className="leading-tight">
                <span className="block text-[12.5px] font-semibold">{name}</span>
                <span className="block text-[10.5px] text-muted-foreground">{sub}</span>
              </span>
              <span aria-hidden className={cn('ml-1 flex h-4 w-7 items-center rounded-full p-0.5 transition-colors', on ? 'bg-primary' : 'bg-foreground/15')}>
                <span className={cn('size-3 rounded-full bg-background transition-transform', on && 'translate-x-3')} />
              </span>
            </button>
          )
        })}
        <div className="flex min-w-[300px] flex-1 items-center gap-2">
          <Input value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && add()} placeholder="Свой сервер: rtmp://… или host:port" className="h-10 min-w-0 flex-1 rounded-xl text-xs" />
          <select
            value={plat}
            onChange={(e) => setPlat(e.target.value as IngestPlatform)}
            className="h-10 rounded-xl border border-border bg-background px-2 text-xs"
            aria-label="Значок"
          >
            {PLATFORM_CHOICES.map((c) => (
              <option key={c.id} value={c.id}>
                {c.label}
              </option>
            ))}
          </select>
          <Button size="sm" variant="outline" className="h-10 rounded-xl text-xs" onClick={add} title="Например, адрес сервера Kick: скопируйте его из настроек трансляции на сайте и вставьте сюда. Подойдёт rtmp://… или host:port.">
            <Plus className="size-3.5" /> Добавить
          </Button>
        </div>
      </div>

      {s.list && !s.list.twitchLive && (
        <p className="mt-3 rounded-xl bg-st-warn/10 px-3 py-2 text-xs text-st-warn-text">
          Не удалось получить полный список серверов Twitch, показан короткий встроенный. Проверьте подключение к интернету и откройте страницу заново.
        </p>
      )}

      <div className="mt-3 overflow-hidden rounded-xl border border-foreground/[0.08]">
        <div className="grid grid-cols-[minmax(0,1fr)_180px_70px_70px_84px] gap-3 bg-foreground/[0.035] px-3 py-1.5 text-[11px] text-muted-foreground">
          <span>Сервер</span>
          <span>Время соединения</span>
          <span className="text-right">Разброс</span>
          <span className="text-right">Потери</span>
          <span />
        </div>
        <div className="custom-scrollbar max-h-[max(220px,calc(100vh-650px))] divide-y divide-foreground/[0.06] overflow-y-auto">
          {rows.length === 0 && (
            <div className="px-3 py-6 text-center text-xs text-muted-foreground">{s.listLoading ? 'Загружаю список серверов…' : 'Серверов нет'}</div>
          )}
          {rows.map((x) => {
            const r = s.results[x.id]
            const best = bestId === x.id
            const pct = r?.medianMs != null ? Math.max(4, Math.round((r.medianMs / maxMs) * 100)) : 0
            return (
              <div key={x.id} className={cn('relative grid grid-cols-[minmax(0,1fr)_180px_70px_70px_84px] items-center gap-3 px-3 py-2 text-xs', best && 'bg-primary/[0.07]')}>
                {best && <span aria-hidden className="absolute inset-y-1 left-0 w-[3px] rounded-r bg-primary" />}
                <div className="flex min-w-0 items-center gap-2.5">
                  <PlatformIcon platform={x.platform} className="size-4 shrink-0" />
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 truncate font-semibold">
                      <span className="truncate">{x.platform === 'custom' || x.platform === 'kick' ? x.host : x.name}</span>
                      {best && <span className="shrink-0 rounded-md bg-primary px-1.5 py-px text-[10px] font-bold text-primary-foreground">лучший</span>}
                    </div>
                    <div className="truncate font-mono text-[10.5px] text-muted-foreground">
                      {x.host}:{x.port}
                    </div>
                  </div>
                  {(x.platform === 'custom' || x.platform === 'kick') && (
                    <button type="button" aria-label="Убрать" className="shrink-0 cursor-pointer text-muted-foreground hover:text-foreground" onClick={() => s.removeCustom(x.id)}>
                      <X className="size-3.5" />
                    </button>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  {r ? (
                    r.medianMs != null ? (
                      <>
                        <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-foreground/[0.08]">
                          <span className={cn('block h-full rounded-full', best ? 'bg-primary' : 'bg-foreground/35')} style={{ width: `${pct}%` }} />
                        </span>
                        <span className="w-14 text-right font-semibold tabular-nums">{r.medianMs} мс</span>
                      </>
                    ) : (
                      <span className="truncate text-st-err-text">{r.error ?? 'нет ответа'}</span>
                    )
                  ) : (
                    <span className="text-muted-foreground">{s.running ? 'жду очереди…' : '—'}</span>
                  )}
                </div>
                <span className="text-right tabular-nums text-muted-foreground">{r && r.medianMs != null ? `±${r.spreadMs} мс` : '—'}</span>
                <span className={cn('text-right tabular-nums', r && r.lost > 0 ? 'text-st-warn-text' : 'text-muted-foreground')}>{r ? `${r.lost} из 5` : '—'}</span>
                <div className="text-right">
                  <Button size="xs" variant="ghost" onClick={() => copy(x)} title="Скопировать адрес для OBS">
                    <Copy /> Адрес
                  </Button>
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {s.direct === false && (
        <p className="mt-3 text-xs text-muted-foreground">Не удалось определить физический адаптер, поэтому замер мог идти через VPN, если он включён. Для точного результата отключите VPN на время проверки.</p>
      )}

      <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-foreground/[0.07] bg-foreground/[0.03] px-3 py-2 text-xs">
        <span className="flex items-center gap-2 leading-relaxed">
          <ObsIcon className="size-4" />
          OBS лучше пускать напрямую, мимо VPN, иначе упадёт битрейт.
        </span>
        {platform === 'win32' && (
          <Button size="sm" variant="outline" className="h-8 text-xs" disabled={s.obsBusy} onClick={() => void s.obsDirect()}>
            {s.obsBusy && <Loader2 className="size-3.5 animate-spin" />}
            Пускать OBS напрямую
          </Button>
        )}
      </div>
    </LzPanel>
  )
}
