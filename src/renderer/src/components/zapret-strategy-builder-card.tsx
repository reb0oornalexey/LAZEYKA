import { useState } from 'react'
import { toast } from 'sonner'
import {
  ChevronDown,
  ChevronRight,
  Save,
  Loader2,
  Sliders
} from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@renderer/components/ui/card'
import { Button } from '@renderer/components/ui/button'
import { Input } from '@renderer/components/ui/input'
import { Label } from '@renderer/components/ui/label'
import { Switch } from '@renderer/components/ui/switch'
import { cn, POWER_ON_BANNER_STYLE } from '@renderer/lib/utils'
import { builderGenerateStrategy, type CustomStrategyConfig } from '@renderer/utils/ipc'

interface Props {
  onStrategyCreated?: () => void
}

const DESYNC_MODES = [
  { value: 'fake', label: 'Fake', desc: 'Отправка фальшивого SNI-пакета' },
  { value: 'diso', label: 'Disorder (Diso)', desc: 'Нарушение порядка TCP-пакетов' },
  { value: 'fakeddiso', label: 'Fake + Diso', desc: 'Комбинация фальшивки и нарушения порядка' },
  { value: 'multisplit', label: 'MultiSplit', desc: 'Множественная фрагментация TLS ClientHello' },
  { value: 'split2', label: 'Split2', desc: 'Двойное разделение пакета' }
]

const FOOLING_OPTIONS = [
  { value: 'md5sig', label: 'MD5 Signature (md5sig)' },
  { value: 'badseq', label: 'Bad Sequence (badseq)' },
  { value: 'datanoack', label: 'Data No ACK (datanoack)' },
  { value: 'badsum', label: 'Bad Checksum (badsum)' },
  { value: 'none', label: 'Без спуфинга (none)' }
]

const ZapretStrategyBuilderCard: React.FC<Props> = ({ onStrategyCreated }) => {
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('My Custom Strategy')
  const [desc, setDesc] = useState('Кастомная стратегия обхода DPI')
  const [desyncMode, setDesyncMode] = useState<any>('fake')
  const [splitPos, setSplitPos] = useState('1,midsld')
  const [ttl, setTtl] = useState(3)
  const [fooling, setFooling] = useState<any>('md5sig')
  const [includeUdp, setIncludeUdp] = useState(true)
  const [saving, setSaving] = useState(false)

  const handleBuildAndSave = async (): Promise<void> => {
    if (!name.trim()) {
      toast.error('Введите название стратегии')
      return
    }
    setSaving(true)
    try {
      const config: CustomStrategyConfig = {
        name: name.trim(),
        description: desc.trim(),
        desyncMode,
        splitPos: splitPos.trim(),
        ttl,
        fooling,
        fakePayload: 'tls_clienthello_www_google_com.bin',
        includeUdp
      }
      const res = await builderGenerateStrategy(config)
      toast.success(`Стратегия "${res.file}" успешно создана`, {
        description: 'Она добавлена в список стратегий Zapret и готова к использованию',
        style: POWER_ON_BANNER_STYLE
      })
      onStrategyCreated?.()
    } catch (e: any) {
      toast.error('Ошибка создания стратегии', { description: e?.message || String(e) })
    } finally {
      setSaving(false)
    }
  }

  return (
    <Card className="cyber-card">
      <CardHeader className="flex flex-row items-center justify-between gap-3 space-y-0">
        <div className="min-w-0 flex-1">
          <CardTitle className="flex items-center gap-2">
            <Sliders className="h-4 w-4 text-primary" />
            Визуальный конструктор стратегий Zapret (Strategy Builder)
          </CardTitle>
        </div>
        <Button
          variant={open ? 'secondary' : 'outline'}
          size="sm"
          onClick={() => setOpen((v) => !v)}
          className="shrink-0"
        >
          {open ? <><ChevronDown className="h-3.5 w-3.5" /> Свернуть</> : <><ChevronRight className="h-3.5 w-3.5" /> Открыть</>}
        </Button>
      </CardHeader>

      {open && (
        <CardContent className="space-y-4 pt-0">
          <p className="text-xs text-muted-foreground">
            Создайте свою персональную стратегию winws.exe с индивидуальными параметрами разделения пакетов и спуфинга без ручного редактирования батников.
          </p>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label className="text-xs">Название стратегии</Label>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Custom ALT Mode"
                className="text-xs"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Описание</Label>
              <Input
                value={desc}
                onChange={(e) => setDesc(e.target.value)}
                placeholder="Оптимизировано для провайдера X"
                className="text-xs"
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label className="text-xs">Метод десинхронизации (--dpi-desync)</Label>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {DESYNC_MODES.map((m) => (
                <button
                  key={m.value}
                  onClick={() => setDesyncMode(m.value)}
                  className={cn(
                    'rounded-lg border p-2 text-left transition',
                    desyncMode === m.value
                      ? 'border-primary bg-primary/10 text-foreground'
                      : 'border-border bg-card/40 text-muted-foreground hover:bg-accent/40'
                  )}
                >
                  <div className="text-xs font-semibold">{m.label}</div>
                  <div className="text-[10px] text-muted-foreground line-clamp-1">{m.desc}</div>
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="space-y-1.5">
              <Label className="text-xs">Позиция сплита (--dpi-desync-split-pos)</Label>
              <Input
                value={splitPos}
                onChange={(e) => setSplitPos(e.target.value)}
                placeholder="1,midsld или 2"
                className="text-xs font-mono"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">TTL поддельного пакета (--dpi-desync-ttl)</Label>
              <Input
                type="number"
                value={ttl}
                onChange={(e) => setTtl(Number(e.target.value) || 0)}
                placeholder="3"
                className="text-xs font-mono"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Метод спуфинга (--dpi-desync-fooling)</Label>
              <select
                value={fooling}
                onChange={(e) => setFooling(e.target.value)}
                className="w-full rounded-md border border-border bg-background px-2.5 py-2 text-xs text-foreground outline-none focus:border-primary"
              >
                {FOOLING_OPTIONS.map((f) => (
                  <option key={f.value} value={f.value}>{f.label}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="flex items-center justify-between rounded-lg border border-border bg-card/40 p-3">
            <div className="min-w-0">
              <div className="text-xs font-medium">Включить QUIC / UDP фильтр</div>
              <div className="text-[11px] text-muted-foreground">Добавляет правила для обхода блокировок голосовых серверов Discord и YouTube QUIC</div>
            </div>
            <Switch checked={includeUdp} onCheckedChange={setIncludeUdp} />
          </div>

          <div className="pt-2 flex justify-end">
            <Button
              size="sm"
              onClick={() => { void handleBuildAndSave() }}
              disabled={saving}
              className="gap-1.5 text-xs"
            >
              {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
              Собрать и сохранить стратегию (.bat)
            </Button>
          </div>
        </CardContent>
      )}
    </Card>
  )
}

export default ZapretStrategyBuilderCard
