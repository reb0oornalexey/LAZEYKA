import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { ShieldCheck, Plus, Trash2, Globe, ChevronDown, ChevronRight } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@renderer/components/ui/card'
import { Label } from '@renderer/components/ui/label'
import { Switch } from '@renderer/components/ui/switch'
import { Button } from '@renderer/components/ui/button'
import { Input } from '@renderer/components/ui/input'
import {
  splitTunnelingGetConfig,
  splitTunnelingSaveConfig,
  incyReapplyTunnel,
  type SplitTunnelingConfig,
  type CustomDomainExclusion
} from '@renderer/utils/ipc'
import { cn } from '@renderer/lib/utils'

/**
 * Раздельное туннелирование по сайтам: какие сайты INCY пускает напрямую,
 * мимо VPN. Настройка относится только к INCY, поэтому живёт на его вкладке
 * (раньше — в общих «Настройках» приложения).
 */
export default function SplitTunnelingCard(): React.ReactElement {
  const [splitConfig, setSplitConfig] = useState<SplitTunnelingConfig | null>(null)
  const [newDomain, setNewDomain] = useState('')
  const [newComment, setNewComment] = useState('')
  const [showRuCategories, setShowRuCategories] = useState(false)

  useEffect(() => {
    splitTunnelingGetConfig().then(setSplitConfig).catch(() => {})
  }, [])

  /**
   * Сохранить список прямого доступа и применить его к работающему VPN.
   * Раньше список читался только при подключении: toast обещал «напрямую»,
   * а трафик шёл как прежде до ручного переподключения. Ошибки сохранения
   * тоже терялись, и экран расходился с файлом.
   */
  const saveSplit = async (next: SplitTunnelingConfig, message?: string): Promise<boolean> => {
    const prev = splitConfig
    setSplitConfig(next)
    try {
      await splitTunnelingSaveConfig(next)
    } catch (e) {
      setSplitConfig(prev)
      toast.error('Не удалось сохранить список', { description: e instanceof Error ? e.message : String(e) })
      return false
    }
    const reapplied = await incyReapplyTunnel().catch(() => false)
    if (message) {
      toast.success(message, reapplied ? { description: 'VPN переподключается, чтобы применить.' } : undefined)
    }
    return true
  }

  const handleToggleBypassRu = async (bypassAllRu: boolean): Promise<void> => {
    if (!splitConfig) return
    const next: SplitTunnelingConfig = { ...splitConfig, bypassAllRu }
    await saveSplit(
      next,
      bypassAllRu
        ? 'Прямой доступ для всех российских сайтов (.RU / .РФ) включен'
        : 'Прямой доступ для .RU сайтов отключен'
    )
  }

  const handleToggleCategory = async (catId: string, enabled: boolean): Promise<void> => {
    if (!splitConfig) return
    const nextCategories = splitConfig.categories.map((c) => (c.id === catId ? { ...c, enabled } : c))
    const next: SplitTunnelingConfig = { ...splitConfig, categories: nextCategories }
    const targetCat = splitConfig.categories.find((c) => c.id === catId)
    await saveSplit(
      next,
      enabled
        ? `Категория «${targetCat?.name || catId}» направляется напрямую`
        : `Категория «${targetCat?.name || catId}» исключена из прямого доступа`
    )
  }

  const handleToggleCustomDomain = async (id: string, enabled: boolean): Promise<void> => {
    if (!splitConfig) return
    const nextDomains = splitConfig.customDomains.map((d) => (d.id === id ? { ...d, enabled } : d))
    const next: SplitTunnelingConfig = { ...splitConfig, customDomains: nextDomains }
    await saveSplit(next)
  }

  const handleAddCustomDomain = async (): Promise<void> => {
    if (!newDomain.trim() || !splitConfig) return
    // «https://site.ru/page» → «*.site.ru»: раньше адрес со схемой сохранялся
    // как есть и молча отбрасывался при сборке правил.
    let clean = newDomain.trim().toLowerCase()
    if (/^[a-z]+:\/\//.test(clean) || clean.includes('/')) {
      try {
        clean = new URL(/^[a-z]+:\/\//.test(clean) ? clean : `http://${clean}`).hostname
      } catch { /* оставим как ввели */ }
    }
    clean = clean.replace(/^\*\./, '')
    if (!clean || !clean.includes('.')) {
      toast.error('Введите домен, например site.ru')
      return
    }
    clean = `*.${clean}`
    const item: CustomDomainExclusion = {
      id: String(Date.now()),
      domain: clean,
      comment: newComment.trim() || undefined,
      enabled: true
    }
    const next: SplitTunnelingConfig = {
      ...splitConfig,
      customDomains: [...splitConfig.customDomains, item]
    }
    if (!(await saveSplit(next, `Домен ${clean} добавлен в список прямого доступа`))) return
    setNewDomain('')
    setNewComment('')
  }

  const handleDeleteCustomDomain = async (id: string): Promise<void> => {
    if (!splitConfig) return
    const nextDomains = splitConfig.customDomains.filter((d) => d.id !== id)
    const next: SplitTunnelingConfig = { ...splitConfig, customDomains: nextDomains }
    await saveSplit(next, 'Домен удалён')
  }

  return (
    <Card className="cyber-card">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ShieldCheck className="h-4 w-4 text-primary" />
          Раздельное туннелирование по сайтам
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-xs text-muted-foreground">
          Трафик указанных сайтов направляется напрямую к вашему провайдеру без прокси и модификаторов. Это гарантирует быструю и стабильную работу российских банков, Госуслуг и сервисов.
        </p>

        {/* Master RU Switch */}
        <div className="flex items-center justify-between p-3 rounded-lg border border-primary/30 bg-primary/5">
          <div className="min-w-0">
            <div className="text-xs font-semibold text-foreground flex items-center gap-2">
              <Globe className="h-4 w-4 text-primary" />
              Прямой доступ для всех сайтов РФ (.RU / .РФ / .SU)
            </div>
            <div className="text-[11px] text-muted-foreground mt-0.5">
              Автоматически исключает Яндекс, Госуслуги, все банки РФ, маркетплейсы (Ozon, WB, Авито), VK, Rutube и Кинопоиск.
            </div>
          </div>
          <Switch
            checked={splitConfig?.bypassAllRu ?? true}
            onCheckedChange={(v) => { void handleToggleBypassRu(v) }}
          />
        </div>

        {/* Categories toggle */}
        <div>
          <button
            onClick={() => setShowRuCategories((v) => !v)}
            className="text-xs text-primary hover:underline inline-flex items-center gap-1 font-medium"
          >
            {showRuCategories ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
            {showRuCategories ? 'Скрыть список встроенных российских категорий' : 'Показать встроенные категории сайтов РФ (8 категорий)'}
          </button>

          {showRuCategories && splitConfig?.categories && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-2.5">
              {splitConfig.categories.map((cat) => (
                <div
                  key={cat.id}
                  className={cn(
                    'p-2.5 rounded-lg border text-xs transition',
                    cat.enabled ? 'border-border bg-card/30' : 'border-border/40 bg-card/10 opacity-60'
                  )}
                >
                  <div className="font-semibold text-foreground flex items-center justify-between gap-2">
                    <span className="truncate">{cat.name}</span>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <span
                        className={cn(
                          'text-[10px] px-1.5 py-0.5 rounded font-mono',
                          cat.enabled
                            ? 'text-st-ok-text bg-st-ok/10'
                            : 'text-muted-foreground bg-muted'
                        )}
                      >
                        {cat.enabled ? 'Прямой' : 'Через VPN'}
                      </span>
                      <Switch
                        checked={cat.enabled}
                        onCheckedChange={(v) => { void handleToggleCategory(cat.id, v) }}
                      />
                    </div>
                  </div>
                  <div className="text-[11px] text-muted-foreground mt-1">{cat.description}</div>
                  <div className="text-[10px] font-mono text-muted-foreground/70 mt-1 truncate">
                    {cat.domains.slice(0, 4).join(', ')}...
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Custom Domains list */}
        <div className="space-y-2 pt-2 border-t border-border/50">
          <Label className="text-xs font-semibold">Ваши персональные сайты-исключения</Label>
          {splitConfig?.customDomains && splitConfig.customDomains.length > 0 ? (
            <div className="space-y-2">
              {splitConfig.customDomains.map((item) => (
                <div
                  key={item.id}
                  className="flex items-center justify-between p-2.5 rounded-lg border border-border bg-card/40"
                >
                  <div>
                    <div className="text-xs font-mono font-medium text-foreground">{item.domain}</div>
                    {item.comment && (
                      <div className="text-[10px] text-muted-foreground">{item.comment}</div>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <Switch
                      checked={item.enabled}
                      onCheckedChange={(v) => { void handleToggleCustomDomain(item.id, v) }}
                    />
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      onClick={() => { void handleDeleteCustomDomain(item.id) }}
                      className="text-muted-foreground hover:text-destructive"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-xs text-muted-foreground">Персональные домены ещё не добавлены.</div>
          )}

          <div className="pt-2 flex flex-col sm:flex-row gap-2">
            <Input paste
              value={newDomain}
              onChange={(e) => setNewDomain(e.target.value)}
              placeholder="Домен (например, mysite.ru или *.work.com)"
              wrapperClassName="sm:flex-[3] sm:basis-0"
              className="text-xs font-mono"
            />
            <Input
              value={newComment}
              onChange={(e) => setNewComment(e.target.value)}
              placeholder="Описание (опционально)"
              className="text-xs sm:flex-1 sm:basis-0"
            />
            <Button
              size="sm"
              onClick={() => { void handleAddCustomDomain() }}
              disabled={!newDomain.trim()}
              className="gap-1.5 text-xs shrink-0"
            >
              <Plus className="h-3.5 w-3.5" /> Добавить
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
