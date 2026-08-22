import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import {
  Download,
  Upload,
  Shield,
  ShieldCheck,
  Plus,
  Trash2,
  Globe,
  ChevronDown,
  ChevronRight,
  RotateCw
} from 'lucide-react'
import { useAppConfig } from '@renderer/hooks/use-app-config'
import { Card, CardContent, CardHeader, CardTitle } from '@renderer/components/ui/card'
import { Label } from '@renderer/components/ui/label'
import { Switch } from '@renderer/components/ui/switch'
import { Button } from '@renderer/components/ui/button'
import { Input } from '@renderer/components/ui/input'
import {
  appRelaunch,
  appCheckUpdateNow,
  profileExport,
  profileImport,
  dnsGetProviders,
  dnsApplySystem,
  splitTunnelingGetConfig,
  splitTunnelingSaveConfig,
  type DohProvider,
  type SplitTunnelingConfig,
  type CustomDomainExclusion
} from '@renderer/utils/ipc'
import { cn, POWER_ON_BANNER_STYLE } from '@renderer/lib/utils'
import BasePage from '@renderer/components/base/base-page'

const themes: AppTheme[] = ['light', 'dark']
const themeLabels: Record<AppTheme, string> = {
  light: 'Светлая',
  dark: 'Тёмная'
}

const Settings: React.FC = () => {
  const { appConfig, patchAppConfig } = useAppConfig()
  const [dohProviders, setDohProviders] = useState<DohProvider[]>([])
  const [activeDnsIp, setActiveDnsIp] = useState<string>('dhcp')
  const [loadingDns, setLoadingDns] = useState(false)

  const [splitConfig, setSplitConfig] = useState<SplitTunnelingConfig | null>(null)
  const [newDomain, setNewDomain] = useState('')
  const [newComment, setNewComment] = useState('')
  const [showRuCategories, setShowRuCategories] = useState(false)
  const [checkingUpdate, setCheckingUpdate] = useState(false)

  useEffect(() => {
    dnsGetProviders().then(setDohProviders).catch(() => {})
    splitTunnelingGetConfig().then(setSplitConfig).catch(() => {})
  }, [])

  /**
   * Спросить GitHub про новую версию прямо сейчас, минуя кэш.
   *
   * Отвечаем во всех трёх случаях, включая «всё свежее»: кнопка, которая на
   * вид ничего не сделала, вынуждает гадать, сработала она или нет.
   */
  const handleCheckUpdate = async (): Promise<void> => {
    setCheckingUpdate(true)
    try {
      const info = await appCheckUpdateNow()
      if (info.hasUpdate && info.assetUrl) {
        // Окно обновления показывается само — оно слушает тот же результат.
        toast.success(`Доступна версия ${info.latest}`, {
          description: 'Окно с установкой сейчас откроется.',
          style: POWER_ON_BANNER_STYLE
        })
      } else if (info.hasUpdate) {
        toast.warning(`Версия ${info.latest} вышла, но установщик к релизу не приложен`, {
          description: 'Скачайте её вручную со страницы релизов.'
        })
      } else {
        toast.success(`Установлена последняя версия — ${info.installed}`)
      }
    } catch (e: any) {
      toast.error('Не удалось проверить обновления', {
        description: e?.message || String(e)
      })
    } finally {
      setCheckingUpdate(false)
    }
  }

  const handleExport = async (): Promise<void> => {
    try {
      const res = await profileExport()
      if (res.success) {
        toast.success(res.message || 'Профиль сохранён', { style: POWER_ON_BANNER_STYLE })
      }
    } catch (e: any) {
      toast.error('Ошибка экспорта', { description: e?.message || String(e) })
    }
  }

  const handleImport = async (): Promise<void> => {
    try {
      const res = await profileImport()
      if (res.success) {
        toast.success(res.message || 'Настройки импортированы', { style: POWER_ON_BANNER_STYLE })
        setTimeout(() => window.location.reload(), 800)
      }
    } catch (e: any) {
      toast.error('Ошибка импорта', { description: e?.message || String(e) })
    }
  }

  const handleApplyDns = async (ip: string | 'dhcp'): Promise<void> => {
    setLoadingDns(true)
    try {
      const res = await dnsApplySystem(ip)
      setActiveDnsIp(ip)
      toast.success(res.message, { style: POWER_ON_BANNER_STYLE })
    } catch (e: any) {
      toast.error('Не удалось изменить DNS', { description: e?.message || String(e) })
    } finally {
      setLoadingDns(false)
    }
  }

  const handleToggleBypassRu = async (bypassAllRu: boolean): Promise<void> => {
    if (!splitConfig) return
    const next: SplitTunnelingConfig = { ...splitConfig, bypassAllRu }
    setSplitConfig(next)
    await splitTunnelingSaveConfig(next)
    toast.success(
      bypassAllRu
        ? 'Прямой доступ для всех российских сайтов (.RU / .РФ) включен'
        : 'Прямой доступ для .RU сайтов отключен'
    )
  }

  const handleToggleCategory = async (catId: string, enabled: boolean): Promise<void> => {
    if (!splitConfig) return
    const nextCategories = splitConfig.categories.map((c) => (c.id === catId ? { ...c, enabled } : c))
    const next: SplitTunnelingConfig = { ...splitConfig, categories: nextCategories }
    setSplitConfig(next)
    await splitTunnelingSaveConfig(next)
    const targetCat = splitConfig.categories.find((c) => c.id === catId)
    toast.success(
      enabled
        ? `Категория «${targetCat?.name || catId}» направляется напрямую`
        : `Категория «${targetCat?.name || catId}» исключена из прямого доступа`
    )
  }

  const handleToggleCustomDomain = async (id: string, enabled: boolean): Promise<void> => {
    if (!splitConfig) return
    const nextDomains = splitConfig.customDomains.map((d) => (d.id === id ? { ...d, enabled } : d))
    const next: SplitTunnelingConfig = { ...splitConfig, customDomains: nextDomains }
    setSplitConfig(next)
    await splitTunnelingSaveConfig(next)
  }

  const handleAddCustomDomain = async (): Promise<void> => {
    if (!newDomain.trim() || !splitConfig) return
    let clean = newDomain.trim().toLowerCase()
    if (!clean.startsWith('*.') && !clean.startsWith('http')) {
      clean = `*.${clean}`
    }
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
    setSplitConfig(next)
    await splitTunnelingSaveConfig(next)
    setNewDomain('')
    setNewComment('')
    toast.success(`Домен ${clean} добавлен в список прямого доступа`)
  }

  const handleDeleteCustomDomain = async (id: string): Promise<void> => {
    if (!splitConfig) return
    const nextDomains = splitConfig.customDomains.filter((d) => d.id !== id)
    const next: SplitTunnelingConfig = { ...splitConfig, customDomains: nextDomains }
    setSplitConfig(next)
    await splitTunnelingSaveConfig(next)
    toast.success('Домен удален')
  }

  return (
    <BasePage title="Настройки">
      <div className="px-4 pb-6 space-y-4">
        {/* Appearance */}
        <Card className="cyber-card">
          <CardHeader>
            <CardTitle>Внешний вид</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div>
              <Label className="text-sm">Тема</Label>
              <div className="flex gap-2 mt-2">
                {themes.map((theme) => (
                  <Button
                    key={theme}
                    size="sm"
                    variant={appConfig?.appTheme === theme ? 'default' : 'outline'}
                    onClick={() => patchAppConfig({ appTheme: theme })}
                  >
                    {themeLabels[theme]}
                  </Button>
                ))}
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Encrypted DNS (DoH) */}
        <Card className="cyber-card">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Shield className="h-4 w-4 text-primary" />
              Зашифрованный DNS (DoH / DoT)
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-xs text-muted-foreground">
              Защита от подмены DNS провайдером и ускорение отклика сайтов. Выберите зашифрованный сервер:
            </p>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              {dohProviders.map((p) => {
                const isActive = activeDnsIp === p.id || activeDnsIp === p.ip
                return (
                  <div
                    key={p.id}
                    className={cn(
                      'rounded-lg border p-3 flex flex-col justify-between gap-2 transition',
                      isActive ? 'border-primary bg-primary/10' : 'border-border bg-card/40'
                    )}
                  >
                    <div>
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-semibold text-foreground">{p.name}</span>
                        {p.latencyMs !== null && (
                          <span className="text-[10px] font-mono text-emerald-700 dark:text-emerald-500 bg-emerald-500/10 px-1.5 py-0.5 rounded">
                            {p.latencyMs} мс
                          </span>
                        )}
                      </div>
                      <div className="text-[11px] text-muted-foreground mt-0.5">{p.description}</div>
                    </div>

                    <Button
                      size="sm"
                      variant={isActive ? 'secondary' : 'outline'}
                      onClick={() => { void handleApplyDns(p.id) }}
                      disabled={loadingDns}
                      className="h-7 text-xs self-end mt-1"
                    >
                      {isActive ? 'Активен' : 'Включить'}
                    </Button>
                  </div>
                )
              })}
            </div>

            <div className="pt-2 flex justify-end">
              <Button
                size="sm"
                variant="ghost"
                onClick={() => { void handleApplyDns('dhcp') }}
                disabled={loadingDns}
                className="text-xs text-muted-foreground"
              >
                Сбросить DNS на стандартный (DHCP)
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Domain-based Split Tunneling */}
        <Card className="cyber-card">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <ShieldCheck className="h-4 w-4 text-primary" />
              Раздельное туннелирование по сайтам (Split Tunneling)
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
                                ? 'text-emerald-700 dark:text-emerald-500 bg-emerald-500/10'
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
                <Input
                  value={newDomain}
                  onChange={(e) => setNewDomain(e.target.value)}
                  placeholder="Домен (например, mysite.ru или *.work.com)"
                  className="text-xs font-mono"
                />
                <Input
                  value={newComment}
                  onChange={(e) => setNewComment(e.target.value)}
                  placeholder="Описание (опционально)"
                  className="text-xs"
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

        {/* Backups & Profiles */}
        <Card className="cyber-card">
          <CardHeader>
            <CardTitle>Резервные копии и профили (.lazeyka)</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-xs text-muted-foreground">
              Экспорт и импорт всех настроек LAZEYKA, списка хостов Zapret, выбранных UDP-фейков и ключей Telegram в единый файл конфигурации.
            </p>
            <div className="flex flex-wrap gap-2 pt-1">
              <Button
                size="sm"
                variant="outline"
                onClick={handleExport}
                className="gap-1.5"
              >
                <Download className="h-3.5 w-3.5" />
                Экспорт настроек (.lazeyka)
              </Button>
              <Button
                size="sm"
                variant="secondary"
                onClick={handleImport}
                className="gap-1.5"
              >
                <Upload className="h-3.5 w-3.5" />
                Импорт профиля
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Launch */}
        <Card className="cyber-card">
          <CardHeader>
            <CardTitle>Запуск</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center justify-between">
              <Label className="text-sm">Запускать при входе в Windows</Label>
              <Switch
                checked={appConfig?.autoLaunch ?? false}
                onCheckedChange={(v) => patchAppConfig({ autoLaunch: v })}
              />
            </div>
            <div className="flex items-center justify-between">
              <Label className="text-sm">Тихий старт (без окна)</Label>
              <Switch
                checked={appConfig?.silentStart ?? false}
                onCheckedChange={(v) => patchAppConfig({ silentStart: v })}
              />
            </div>
            <div className="flex items-center justify-between">
              <Label className="text-sm">Автозапуск Telegram</Label>
              <Switch
                checked={appConfig?.tgws?.autoStart ?? false}
                onCheckedChange={(v) =>
                  patchAppConfig({ tgws: { ...appConfig!.tgws!, autoStart: v } })
                }
              />
            </div>
            <div className="flex items-center justify-between">
              <Label className="text-sm">Автозапуск Zapret</Label>
              <Switch
                checked={appConfig?.zapret?.autoStart ?? false}
                onCheckedChange={(v) =>
                  patchAppConfig({ zapret: { ...appConfig!.zapret!, autoStart: v } })
                }
              />
            </div>
            <div className="flex items-center justify-between">
              <div className="flex flex-col">
                <Label className="text-sm">Проверять обновления LAZEYKA</Label>
                <span className="text-xs text-muted-foreground">
                  Если выключено, окно с предложением скачать новую версию LAZEYKA
                  показываться не будет.
                </span>
              </div>
              <Switch
                checked={appConfig?.autoCheckUpdate ?? true}
                onCheckedChange={(v) => patchAppConfig({ autoCheckUpdate: v })}
              />
            </div>

            {/* Проверка по кнопке.
                Ответ GitHub кэшируется, и без принудительной проверки «новой
                версии нет» и «мы её просто не спрашивали» выглядели с экрана
                одинаково. Здесь кэш обходится, а ошибка показывается вслух —
                молчащая проверка хуже честного «не смогли». */}
            <div className="flex items-center justify-between">
              <div className="flex flex-col">
                <Label className="text-sm">Проверить обновления сейчас</Label>
                <span className="text-xs text-muted-foreground">
                  Спросить GitHub напрямую, не дожидаясь плановой проверки.
                </span>
              </div>
              <Button
                variant="outline"
                size="sm"
                disabled={checkingUpdate}
                onClick={() => { void handleCheckUpdate() }}
                className="gap-1.5 text-xs shrink-0"
              >
                <RotateCw className={cn('size-3.5', checkingUpdate && 'animate-spin')} />
                {checkingUpdate ? 'Проверяем…' : 'Проверить'}
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Interface */}
        <Card className="cyber-card">
          <CardHeader>
            <CardTitle>Интерфейс</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex flex-col">
                <Label className="text-sm">Иконка в трее</Label>
                <span className="text-xs text-muted-foreground">
                  Если выключена — при нажатии на «X» приложение полностью закрывается и
                  завершает работу.
                </span>
              </div>
              <Switch
                checked={!(appConfig?.disableTray ?? false)}
                onCheckedChange={(v) => patchAppConfig({ disableTray: !v })}
              />
            </div>
            <div className="flex items-center justify-between">
              <div className="flex flex-col">
                <Label className="text-sm">Убрать иконку с панели задач</Label>
                <span className="text-xs text-muted-foreground">
                  Приложение будет полностью скрыто из панели задач и доступно только через системный трей.
                </span>
              </div>
              <Switch
                checked={appConfig?.hideTaskbarIcon ?? false}
                onCheckedChange={(v) => patchAppConfig({ hideTaskbarIcon: v })}
              />
            </div>
          </CardContent>
        </Card>

        {/* Additional */}
        <Card className="cyber-card">
          <CardHeader>
            <CardTitle>Дополнительно</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center justify-between">
              <Label className="text-sm">Отключить аппаратное ускорение (нужен перезапуск)</Label>
              <Switch
                checked={appConfig?.disableGPU ?? false}
                onCheckedChange={(v) => patchAppConfig({ disableGPU: v })}
              />
            </div>
            <Button size="sm" variant="outline" onClick={() => appRelaunch()}>
              Перезапустить приложение
            </Button>
          </CardContent>
        </Card>
      </div>
    </BasePage>
  )
}

export default Settings
