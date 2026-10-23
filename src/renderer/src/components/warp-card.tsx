import React, { useState } from 'react'
import { toast } from 'sonner'
import { Zap, Search, ShieldCheck, FileUp, Loader2, Bot } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@renderer/components/ui/card'
import { Button } from '@renderer/components/ui/button'
import { cn } from '@renderer/lib/utils'
import {
  incyGenerateWarpNode,
  incyPickWarpEndpoint,
  incyCheckWarp,
  openExternalUrl,
  type IncyNode
} from '@renderer/utils/ipc'

/** Публичный ключ пира Cloudflare WARP — по нему узнаём WARP-узлы. */
const WARP_KEY = 'bmXOC+F1FxEMF9dyiK2H5/1SUtzH0JuVo51h2wPfgyo='

export function isWarpNode(n: IncyNode): boolean {
  if (n.id.startsWith('node-warp-')) return true
  const raw: any = (n as any).rawOutbound ?? {}
  const p0: any = (Array.isArray(raw.peers) ? raw.peers : raw.settings?.peers)?.[0]
  return (p0?.public_key ?? p0?.publicKey) === WARP_KEY
}

interface Props {
  nodes: IncyNode[]
  selectedNodeId?: string | null
  onNodes: (nodes: IncyNode[]) => void
  /** Импорт текста .conf (имя файла — для названия узла). */
  onImportText: (text: string, fileName?: string) => Promise<void>
  onPickFile: () => Promise<void>
  busy?: boolean
}

/** Блок «Cloudflare WARP»: свой узел с подбором адреса и импорт из бота. */
export function WarpCard({ nodes, selectedNodeId, onNodes, onImportText, onPickFile, busy }: Props): React.JSX.Element {
  const [working, setWorking] = useState<'gen' | 'pick' | 'check' | null>(null)
  const [drag, setDrag] = useState(false)

  const warpNodes = nodes.filter(isWarpNode)
  const target = warpNodes.find((n) => n.id === selectedNodeId) ?? warpNodes[0]

  const generate = async (): Promise<void> => {
    setWorking('gen')
    try {
      const res = await incyGenerateWarpNode()
      onNodes(res.allNodes)
      if (res.pick.ok) {
        toast.success('WARP готов', { description: `${res.pick.message} · ${res.pick.latencyMs} мс` })
      } else {
        toast.warning('Узел создан, но адрес не подобран', { description: res.pick.message })
      }
    } catch (e: any) {
      toast.error('Не удалось сгенерировать WARP', { description: e?.message || String(e) })
    } finally {
      setWorking(null)
    }
  }

  const pick = async (): Promise<void> => {
    if (!target) return
    setWorking('pick')
    const tid = toast.loading('Подбираем рабочий адрес WARP…', { description: 'Это займёт до минуты' })
    try {
      const res = await incyPickWarpEndpoint(target.id)
      onNodes(res.allNodes)
      toast.dismiss(tid)
      if (res.ok) toast.success(res.message, { description: `${res.latencyMs} мс · рабочих: ${res.working} из ${res.tested}` })
      else toast.error('Адрес не подобран', { description: res.message })
    } catch (e: any) {
      toast.dismiss(tid)
      toast.error('Ошибка подбора', { description: e?.message || String(e) })
    } finally {
      setWorking(null)
    }
  }

  const check = async (): Promise<void> => {
    if (!target) return
    setWorking('check')
    try {
      const r = await incyCheckWarp(target.id)
      if (r.ok) {
        toast.success('WARP работает', {
          description: `IP ${r.ip ?? '?'} · ${r.loc ?? '?'} · warp=${r.warp ?? '?'} · ${r.latencyMs} мс`
        })
      } else {
        toast.error(r.message, r.ip ? { description: `IP ${r.ip} · ${r.loc ?? '?'} · warp=${r.warp ?? '?'}` } : undefined)
      }
    } catch (e: any) {
      toast.error('Не удалось проверить', { description: e?.message || String(e) })
    } finally {
      setWorking(null)
    }
  }

  const onDrop = async (e: React.DragEvent): Promise<void> => {
    e.preventDefault()
    setDrag(false)
    const file = e.dataTransfer.files?.[0]
    if (!file) return
    try {
      const text = await file.text()
      if (!/\[\s*interface\s*\]/i.test(text)) {
        toast.error('Это не .conf', { description: 'Нужен файл конфига WireGuard / AmneziaWG из бота.' })
        return
      }
      await onImportText(text, file.name)
    } catch (err: any) {
      toast.error('Не удалось прочитать файл', { description: err?.message || String(err) })
    }
  }

  const disabled = !!working || busy

  return (
    <Card className="cyber-card">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-sm">
          <Zap className="h-4 w-4 text-blue-500 fill-blue-500" />
          Cloudflare WARP
        </CardTitle>
      </CardHeader>
      <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
        {/* a) Свой WARP */}
        <div className="rounded-lg border border-border/60 p-3 space-y-2">
          <div className="font-semibold">Свой WARP</div>
          <p className="text-muted-foreground text-[11px]">
            Создаём бесплатный ключ и сами подбираем рабочий адрес. Нужно ядро sing-box-lx.
          </p>
          <div className="flex flex-wrap gap-1.5">
            <Button size="sm" disabled={disabled} onClick={() => { void generate() }} className="gap-1.5 text-xs">
              {working === 'gen' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Zap className="h-3.5 w-3.5" />}
              {working === 'gen' ? 'Создаём и подбираем…' : 'Сгенерировать WARP'}
            </Button>
            <Button size="sm" variant="outline" disabled={disabled || !target} onClick={() => { void pick() }} className="gap-1.5 text-xs">
              {working === 'pick' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Search className="h-3.5 w-3.5" />}
              Подобрать адрес
            </Button>
            <Button size="sm" variant="outline" disabled={disabled || !target} onClick={() => { void check() }} className="gap-1.5 text-xs">
              {working === 'check' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ShieldCheck className="h-3.5 w-3.5" />}
              Проверить WARP
            </Button>
          </div>
          {!target && <p className="text-[11px] text-muted-foreground">WARP-узла пока нет — нажмите «Сгенерировать».</p>}
        </div>

        {/* b) WARP из бота */}
        <div
          onDragOver={(e) => { e.preventDefault(); setDrag(true) }}
          onDragLeave={() => setDrag(false)}
          onDrop={(e) => { void onDrop(e) }}
          className={cn(
            'rounded-lg border border-dashed p-3 space-y-2 transition-colors',
            drag ? 'border-primary bg-primary/10' : 'border-border/60'
          )}
        >
          <div className="font-semibold flex items-center gap-1.5">
            <Bot className="h-3.5 w-3.5" /> WARP из бота (как в Tunor)
          </div>
          <ol className="list-decimal pl-4 space-y-0.5 text-muted-foreground text-[11px]">
            <li>
              Откройте{' '}
              <button
                type="button"
                className="text-primary underline underline-offset-2 hover:opacity-80"
                onClick={() => { void openExternalUrl('https://t.me/warp_generator_bot') }}
              >
                @warp_generator_bot
              </button>
            </li>
            <li>Получите .conf (AmneziaWG)</li>
            <li>Нажмите «Импорт .conf», перетащите файл сюда или вставьте текст</li>
          </ol>
          <Button size="sm" variant="outline" disabled={disabled} onClick={() => { void onPickFile() }} className="gap-1.5 text-xs">
            <FileUp className="h-3.5 w-3.5" /> Импорт .conf
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
