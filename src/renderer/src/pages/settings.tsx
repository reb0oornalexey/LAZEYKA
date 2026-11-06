import { useState } from 'react'
import { toast } from 'sonner'
import {
  Download,
  Upload,
  RotateCw
} from 'lucide-react'
import { useAppConfig } from '@renderer/hooks/use-app-config'
import { Card, CardContent, CardHeader, CardTitle } from '@renderer/components/ui/card'
import { Label } from '@renderer/components/ui/label'
import { Switch } from '@renderer/components/ui/switch'
import { Button } from '@renderer/components/ui/button'
import {
  appRelaunch,
  appResetSettings,
  appCheckUpdateNow,
  appRefreshOnlineCount,
  profileExport,
  profileImport,
} from '@renderer/utils/ipc'
import { cn, POWER_ON_BANNER_STYLE } from '@renderer/lib/utils'
import BasePage from '@renderer/components/base/base-page'
import { platform } from '@renderer/utils/init'
import MacServiceCard from '@renderer/components/mac-service-card'
import HotkeysCard from '@renderer/components/hotkeys-card'

// На macOS часть переключателей относится к Windows (панель задач, Zapret, Telegram-прокси).
const isMac = platform === 'darwin'

const Settings: React.FC = () => {
  const { appConfig, patchAppConfig } = useAppConfig()

  const [checkingUpdate, setCheckingUpdate] = useState(false)
  const [resetStep, setResetStep] = useState<'idle' | 'confirm' | 'busy'>('idle')

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

  return (
    <BasePage title="Настройки">
      <div className="px-4 pb-6 space-y-4">
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

        {/* Служба macOS (TUN) — карточка сама скрыта вне macOS */}
        <MacServiceCard />

        {/* Launch */}
        <Card className="cyber-card">
          <CardHeader>
            <CardTitle>Запуск</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center justify-between">
              <Label className="text-sm">{isMac ? 'Запускать при входе в систему' : 'Запускать при входе в Windows'}</Label>
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

        <HotkeysCard />

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
            {!isMac && (
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
            )}
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
