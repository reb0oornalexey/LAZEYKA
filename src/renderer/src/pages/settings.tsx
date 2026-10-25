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
  appResetSettings,
  appCheckUpdateNow,
  appRefreshOnlineCount,
  profileExport,
  profileImport,
  dnsGetProviders,
  dnsApplySystem,
  dnsGetSystemState,
  dnsAddCustom,
  dnsRemoveCustom,
  openExternalUrl,
  splitTunnelingGetConfig,
  splitTunnelingSaveConfig,
  incyReapplyTunnel,
  type DohProvider,
  type SplitTunnelingConfig,
  type CustomDomainExclusion
} from '@renderer/utils/ipc'
import { cn, POWER_ON_BANNER_STYLE } from '@renderer/lib/utils'
import BasePage from '@renderer/components/base/base-page'

const Settings: React.FC = () => {
  const { appConfig, patchAppConfig } = useAppConfig()
  const [dohProviders, setDohProviders] = useState<DohProvider[]>([])
  const [activeDnsIp, setActiveDnsIp] = useState<string>('dhcp')
  const [loadingDns, setLoadingDns] = useState(false)
  const [showDnsForm, setShowDnsForm] = useState(false)
  const [dnsForm, setDnsForm] = useState({ name: '', v4a: '', v4b: '', v6a: '', v6b: '', doh: '', fallback: false })
  const [savingDns, setSavingDns] = useState(false)

  const [splitConfig, setSplitConfig] = useState<SplitTunnelingConfig | null>(null)
  const [newDomain, setNewDomain] = useState('')
  const [newComment, setNewComment] = useState('')
  const [showRuCategories, setShowRuCategories] = useState(false)
  const [checkingUpdate, setCheckingUpdate] = useState(false)
  const [resetStep, setResetStep] = useState<'idle' | 'confirm' | 'busy'>('idle')

  useEffect(() => {
    // Подсветка реально стоящего DNS: раньше после перезапуска активным
    // всегда считался «стандартный», даже если выбран Cloudflare.
    Promise.all([dnsGetProviders(), dnsGetSystemState().catch(() => null)])
      .then(([providers, state]) => {
        setDohProviders(providers)
        const match = state ? providers.find((p) => state.servers.includes(p.ip)) : undefined
        setActiveDnsIp(match ? match.id : 'dhcp')
      })
      .catch(() => {})
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

  const reloadDnsProviders = async (): Promise<void> => {
    try {
      const [providers, state] = await Promise.all([dnsGetProviders(), dnsGetSystemState().catch(() => null)])
      setDohProviders(providers)
      const match = state ? providers.find((p) => state.servers.includes(p.ip)) : undefined
      setActiveDnsIp(match ? match.id : 'dhcp')
    } catch {
      /* noop */
    }
  }

  const handleAddCustomDns = async (): Promise<void> => {
    setSavingDns(true)
    try {
      await dnsAddCustom({
        name: dnsForm.name,
        ipv4: [dnsForm.v4a, dnsForm.v4b].filter((v) => v.trim()),
        ipv6: [dnsForm.v6a, dnsForm.v6b].filter((v) => v.trim()),
        doh: dnsForm.doh,
        allowFallback: dnsForm.fallback
      })
      setDnsForm({ name: '', v4a: '', v4b: '', v6a: '', v6b: '', doh: '', fallback: false })
      setShowDnsForm(false)
      toast.success('DNS-сервер добавлен', { description: 'Нажмите «Включить» на его карточке, чтобы применить.' })
      await reloadDnsProviders()
    } catch (e: any) {
      toast.error('Сервер не добавлен', { description: e?.message || String(e) })
    } finally {
      setSavingDns(false)
    }
  }

  const handleRemoveCustomDns = async (p: DohProvider): Promise<void> => {
    if (activeDnsIp === p.id || activeDnsIp === p.ip) {
      toast.error('Этот DNS сейчас включён', { description: 'Сначала выберите другой или сбросьте DNS.' })
      return
    }
    try {
      await dnsRemoveCustom(p.id)
      await reloadDnsProviders()
    } catch (e: any) {
      toast.error('Не удалось удалить', { description: e?.message || String(e) })
    }
  }

  const handleApplyDns = async (ip: string | 'dhcp'): Promise<void> => {
    setLoadingDns(true)
    try {
      const res = await dnsApplySystem(ip)
      if (!res.success) {
        toast.error('DNS не изменён', { description: res.message })
        return
      }
      setActiveDnsIp(ip)
      toast.success(res.message, { style: POWER_ON_BANNER_STYLE })
    } catch (e: any) {
      toast.error('Не удалось изменить DNS', { description: e?.message || String(e) })
    } finally {
      setLoadingDns(false)
    }
  }

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
    <BasePage title="Настройки">
      <div className="px-4 pb-6 space-y-4">
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
                const addrs = [p.ip, p.secondaryIp].filter(Boolean).join(', ')
                return (
                  <div
                    key={p.id}
                    className={cn(
                      'rounded-lg border p-3 flex flex-col justify-between gap-2 transition',
                      isActive ? 'border-primary bg-primary/10' : 'border-border bg-card/40'
                    )}
                  >
                    <div className="space-y-1">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs font-semibold text-foreground">{p.name}</span>
                        <span className="flex items-center gap-1">
                          {p.custom && (
                            <span className="text-[9px] uppercase tracking-wider text-muted-foreground border border-border rounded px-1">
                              свой
                            </span>
                          )}
                          {p.latencyMs !== null ? (
                            <span className="text-[10px] font-mono text-st-ok-text bg-st-ok/10 px-1.5 py-0.5 rounded">
                              {p.latencyMs} мс
                            </span>
                          ) : (
                            <span className="text-[10px] font-mono text-muted-foreground">нет ответа</span>
                          )}
                        </span>
                      </div>
                      {!p.custom && <div className="text-[11px] text-muted-foreground">{p.description}</div>}
                      <div className="text-[10px] font-mono text-muted-foreground leading-relaxed break-all">
                        IPv4: {addrs}
                        {p.ipv6 && p.ipv6.length > 0 && (
                          <>
                            <br />
                            IPv6: {p.ipv6.join(', ')}
                          </>
                        )}
                        {p.url && (
                          <>
                            <br />
                            DoH: {p.url}
                          </>
                        )}
                      </div>
                      <div className="text-[10px] text-muted-foreground">
                        {p.url ? (p.strict ? 'Только шифрованно, без возврата к обычному DNS' : 'Шифрованно, с запасным обычным DNS') : 'Без шифрования'}
                        {p.site && (
                          <>
                            {' · '}
                            <button
                              type="button"
                              className="text-primary underline underline-offset-2"
                              onClick={() => void openExternalUrl(p.site!)}
                            >
                              сайт
                            </button>
                          </>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center justify-end gap-1.5 mt-1">
                      {p.custom && (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => void handleRemoveCustomDns(p)}
                          disabled={loadingDns}
                          className="h-7 px-2 text-xs text-muted-foreground"
                          title="Удалить"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      )}
                      <Button
                        size="sm"
                        variant={isActive ? 'secondary' : 'outline'}
                        onClick={() => { void handleApplyDns(p.id) }}
                        disabled={loadingDns}
                        className="h-7 text-xs"
                      >
                        {isActive ? 'Активен' : 'Включить'}
                      </Button>
                    </div>
                  </div>
                )
              })}
            </div>

            {showDnsForm ? (
              <div className="rounded-lg border border-border bg-card/40 p-3 space-y-2.5">
                <div className="text-xs font-semibold text-foreground">Свой DNS-сервер</div>
                <Input
                  value={dnsForm.name}
                  onChange={(e) => setDnsForm({ ...dnsForm, name: e.target.value })}
                  placeholder="Название, например «Мой DNS»"
                  className="h-8 text-xs"
                />
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <Input paste
                    value={dnsForm.v4a}
                    onChange={(e) => setDnsForm({ ...dnsForm, v4a: e.target.value })}
                    placeholder="IPv4 основной"
                    className="h-8 text-xs font-mono"
                  />
                  <Input paste
                    value={dnsForm.v4b}
                    onChange={(e) => setDnsForm({ ...dnsForm, v4b: e.target.value })}
                    placeholder="IPv4 дополнительный (необязательно)"
                    className="h-8 text-xs font-mono"
                  />
                  <Input paste
                    value={dnsForm.v6a}
                    onChange={(e) => setDnsForm({ ...dnsForm, v6a: e.target.value })}
                    placeholder="IPv6 основной (необязательно)"
                    className="h-8 text-xs font-mono"
                  />
                  <Input paste
                    value={dnsForm.v6b}
                    onChange={(e) => setDnsForm({ ...dnsForm, v6b: e.target.value })}
                    placeholder="IPv6 дополнительный (необязательно)"
                    className="h-8 text-xs font-mono"
                  />
                </div>
                <Input paste
                  value={dnsForm.doh}
                  onChange={(e) => setDnsForm({ ...dnsForm, doh: e.target.value })}
                  placeholder="Шаблон DoH: https://dns.example.com/dns-query (пусто — без шифрования)"
                  className="h-8 text-xs font-mono"
                />
                <label className="flex items-center justify-between gap-3 text-[11px] cursor-pointer">
                  <span className="text-muted-foreground">
                    Разрешить возврат к обычному DNS, если DoH не ответил (иначе — только шифрованно)
                  </span>
                  <Switch
                    checked={dnsForm.fallback}
                    onCheckedChange={(v) => setDnsForm({ ...dnsForm, fallback: v })}
                    disabled={!dnsForm.doh.trim()}
                  />
                </label>
                <p className="text-[10px] text-muted-foreground leading-relaxed">
                  Шаблон DoH привязывается к каждому адресу (IPv4 и IPv6) — как в настройках Windows 11. IPv6 ставится
                  только на адаптеры, где IPv6 включён.
                </p>
                <div className="flex justify-end gap-2">
                  <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setShowDnsForm(false)}>
                    Отмена
                  </Button>
                  <Button
                    size="sm"
                    className="h-7 text-xs"
                    onClick={() => void handleAddCustomDns()}
                    disabled={savingDns || !dnsForm.name.trim() || !dnsForm.v4a.trim()}
                  >
                    Добавить
                  </Button>
                </div>
              </div>
            ) : null}

            <div className="pt-2 flex items-center justify-between gap-2">
              {!showDnsForm ? (
                <Button size="sm" variant="outline" onClick={() => setShowDnsForm(true)} className="text-xs h-7 gap-1">
                  <Plus className="h-3.5 w-3.5" />
                  Свой DNS-сервер
                </Button>
              ) : (
                <span />
              )}
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
            <div className="flex items-center justify-between">
              <div className="flex flex-col">
                <Label className="text-sm">Показывать, сколько людей онлайн</Label>
                <span className="text-xs text-muted-foreground">
                  Раз в 5 минут LAZEYKA анонимно отмечается на своём счётчике (только случайный номер установки, без
                  данных о вас) и показывает на главной, сколько человек сейчас в программе. Выключено — не
                  отправляется ничего.
                </span>
              </div>
              <Switch
                checked={appConfig?.onlineStats ?? true}
                onCheckedChange={(v) => {
                  void patchAppConfig({ onlineStats: v }).then(() => appRefreshOnlineCount().catch(() => void 0))
                }}
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

        {/* Danger zone */}
        <Card className="cyber-card border-destructive/40">
          <CardHeader>
            <CardTitle className="text-destructive">Сброс настроек</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-xs text-muted-foreground">
              Все настройки LAZEYKA вернутся к значениям по умолчанию. Не затрагиваются: тема, подписки, узлы и
              профили INCY, ваши списки хостов и IPSet, выбранная стратегия Zapret, адрес и ключ Telegram-прокси.
              Работающие службы не останавливаются.
            </p>
            {resetStep === 'idle' ? (
              <Button
                size="sm"
                variant="outline"
                className="border-destructive/50 text-destructive hover:bg-destructive/10"
                onClick={() => setResetStep('confirm')}
              >
                Сбросить настройки
              </Button>
            ) : (
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-medium">Точно сбросить?</span>
                <Button
                  size="sm"
                  variant="destructive"
                  disabled={resetStep === 'busy'}
                  onClick={async () => {
                    setResetStep('busy')
                    try {
                      await appResetSettings()
                      toast.success('Настройки сброшены', { style: POWER_ON_BANNER_STYLE })
                      setTimeout(() => window.location.reload(), 500)
                    } catch (e) {
                      toast.error('Не удалось сбросить настройки', {
                        description: e instanceof Error ? e.message : String(e)
                      })
                      setResetStep('idle')
                    }
                  }}
                >
                  {resetStep === 'busy' ? 'Сбрасываю…' : 'Да'}
                </Button>
                <Button size="sm" variant="ghost" disabled={resetStep === 'busy'} onClick={() => setResetStep('idle')}>
                  Отмена
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </BasePage>
  )
}

export default Settings
