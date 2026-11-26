import React, { useState } from 'react'
import { AppWindow, Cpu, Download, EyeOff, Loader2, Lock, MonitorUp, PanelBottom, RefreshCcw, RotateCw, Send, Sparkles, Undo2, Upload, Users } from 'lucide-react'
import { Button } from '@renderer/components/ui/button'
import type { AppUpdateInfo } from '@renderer/utils/ipc'
import { Rows, SettingRow, SettingsGroup, SwitchRow } from './setting-row'
import { BackupsGroup, ClearCacheRow, InterfaceGroup, LogDaysRow, StartPageRow, UpdatesViaIncyRow, WindowRows } from './e6-groups'

/*
 * Простые группы «Настроек» (Е5): «Запуск и окно», «Обновления и
 * приватность», «Профиль и сброс». Ключи конфигурации и действия — те же,
 * что были в pages/settings.tsx 2.0; поменялся только вид.
 */

interface CfgProps {
  cfg: AppConfig | undefined
  isMac: boolean
  onPatch: (p: Partial<AppConfig>) => void
}

export const LaunchGroup: React.FC<CfgProps> = ({ cfg, isMac, onPatch }) => {
  const linux = window.api.platform === 'linux'
  const tray = !(cfg?.disableTray ?? false)
  const silent = cfg?.silentStart ?? false
  return (
    <div className="space-y-3">
      <SettingsGroup
        data-tour="settings-launch"
        title="Запуск"
        hint="Что происходит, когда запускается система и сама программа. То же самое — плитками в пульте сверху."
        sub="Автозапуск программы и служб"
      >
        <Rows>
          <SwitchRow
            id="autoLaunch"
            icon={<MonitorUp />}
            title={isMac || linux ? 'Запускать при входе в систему' : 'Запускать при входе в Windows'}
            desc="LAZEYKA запускается сама, открывать её вручную не нужно"
            checked={cfg?.autoLaunch ?? false}
            onChange={(v) => onPatch({ autoLaunch: v })}
          />
          <SwitchRow
            id="silentStart"
            icon={<EyeOff />}
            title="Запускать без окна"
            hint="Тихий старт: окно не открывается, программа сразу сворачивается в трей. Работает только со значком в трее — без него окно всё равно откроется, иначе программу было бы не найти."
            desc={silent && !tray ? <span className="text-st-warn-text">Не действует: включите значок в трее ниже</span> : 'Программа стартует сразу в трее'}
            checked={silent}
            onChange={(v) => onPatch({ silentStart: v })}
          />
          {!linux && <SwitchRow
            id="zapretAutoStart"
            icon={<Lock />}
            title="Включать Zapret при запуске"
            hint="Обход блокировок включается сам с последней выбранной стратегией каждый раз, когда запускается LAZEYKA — и при автозапуске, и при запуске вручную."
            desc="С последней выбранной стратегией"
            checked={cfg?.zapret?.autoStart ?? false}
            onChange={(v) => onPatch({ zapret: { ...cfg!.zapret!, autoStart: v } })}
          />}
          <SwitchRow
            id="tgwsAutoStart"
            icon={<Send />}
            title="Включать Telegram-прокси при запуске"
            hint="Прокси Telegram включается сам каждый раз, когда запускается LAZEYKA."
            desc="Telegram на этом компьютере сразу подключается через прокси"
            checked={cfg?.tgws?.autoStart ?? false}
            onChange={(v) => onPatch({ tgws: { ...cfg!.tgws!, autoStart: v } })}
          />
          <StartPageRow cfg={cfg} onPatch={onPatch} />
        </Rows>
      </SettingsGroup>

      <SettingsGroup data-tour="settings-interface" title="Окно и трей" hint="Где живёт программа, когда окно закрыто." sub={tray ? 'Значок в трее показан' : 'Значка в трее нет'}>
        <Rows>
          <SwitchRow
            id="tray"
            icon={<AppWindow />}
            title="Значок в трее"
            hint="Со значком кнопка «×» прячет окно в трей, а службы продолжают работать. Без значка «×» полностью закрывает программу и завершает её работу."
            desc={tray ? 'Кнопка «×» прячет окно в трей' : 'Кнопка «×» полностью закрывает программу'}
            checked={tray}
            onChange={(v) => onPatch({ disableTray: !v })}
          />
          {!isMac && !linux && (
            <SwitchRow
              id="hideTaskbar"
              icon={<PanelBottom />}
              title="Убрать с панели задач"
              hint="Программа будет полностью скрыта из панели задач и доступна только через значок в трее. Без значка в трее не действует."
              desc={!tray ? <span className="text-st-warn-text">Не действует без значка в трее</span> : 'Программа видна только значком в трее'}
              checked={cfg?.hideTaskbarIcon ?? false}
              onChange={(v) => onPatch({ hideTaskbarIcon: v })}
            />
          )}
          <WindowRows cfg={cfg} onPatch={onPatch} tray={tray} />
        </Rows>
      </SettingsGroup>

      <InterfaceGroup cfg={cfg} onPatch={onPatch} />
    </div>
  )
}

interface UpdatesProps extends CfgProps {
  version: string
  update: AppUpdateInfo | null
  checking: boolean
  onCheck: () => void
  onOnlineStats: (v: boolean) => void
}

export const UpdatesGroup: React.FC<UpdatesProps> = ({ cfg, version, update, checking, onCheck, onPatch, onOnlineStats }) => (
  <SettingsGroup
    data-tour="settings-updates"
    title="Обновления и приватность"
    hint="Программа ходит в сеть только за тем, что здесь включено: проверка новой версии на GitHub и анонимный счётчик онлайна."
    sub={`Установлена версия ${version || '…'}`}
  >
    <Rows>
      <SwitchRow
        id="autoCheckUpdate"
        icon={<Sparkles />}
        title="Проверять обновления LAZEYKA"
        hint="Если выключено, окно с предложением скачать новую версию LAZEYKA показываться не будет. Проверить вручную можно кнопкой ниже."
        desc="Предложит скачать новую версию, когда она выйдет"
        checked={cfg?.autoCheckUpdate ?? true}
        onChange={(v) => onPatch({ autoCheckUpdate: v })}
      />
      <SettingRow
        id="checkUpdateNow"
        icon={<RefreshCcw />}
        on={Boolean(update?.hasUpdate)}
        title="Проверить обновления сейчас"
        desc={
          update
            ? update.hasUpdate
              ? <span className="text-primary">Вышла версия {update.latest}</span>
              : `Установлена последняя версия — ${update.installed}`
            : 'Спросить GitHub напрямую, не дожидаясь плановой проверки'
        }
        control={
          <Button size="sm" variant="outline" disabled={checking} onClick={onCheck} className="gap-1.5">
            <RotateCw className={checking ? 'size-3.5 animate-spin' : 'size-3.5'} />
            {checking ? 'Проверяем…' : 'Проверить'}
          </Button>
        }
      />
      <UpdatesViaIncyRow cfg={cfg} onPatch={onPatch} />
      <SwitchRow
        id="onlineStats"
        icon={<Users />}
        title="Показывать, сколько людей онлайн"
        hint="Раз в 5 минут LAZEYKA анонимно отмечается на своём счётчике (только случайный номер установки, без данных о вас) и показывает на главной, сколько человек сейчас в программе. Выключено — не отправляется ничего."
        desc="Анонимная отметка раз в 5 минут. Выключено — не отправляется ничего"
        checked={cfg?.onlineStats ?? true}
        onChange={onOnlineStats}
      />
    </Rows>
  </SettingsGroup>
)

interface BackupProps extends CfgProps {
  onExport: () => void
  onImport: () => void
  onRelaunch: () => void
  onReset: () => Promise<void>
}

export const BackupGroup: React.FC<BackupProps> = ({ cfg, onPatch, onExport, onImport, onRelaunch, onReset }) => {
  const [step, setStep] = useState<'idle' | 'confirm' | 'busy'>('idle')
  return (
    <div className="space-y-3">
      <SettingsGroup
        data-tour="settings-backup"
        title="Профиль .lazeyka"
        hint="Экспорт и импорт всех настроек LAZEYKA, списка хостов Zapret, выбранных UDP-фейков и ключей Telegram в единый файл. Удобно для переноса на другой компьютер и как резервная копия."
        sub="Все настройки, списки Zapret и ключи Telegram в одном файле"
      >
        <Rows>
          <SettingRow
            id="profile-export"
            icon={<Download />}
            title="Сохранить профиль в файл"
            desc="Резервная копия или перенос на другой компьютер"
            control={
              <Button size="sm" variant="outline" onClick={onExport} className="gap-1.5">
                <Download className="size-3.5" />
                Сохранить
              </Button>
            }
          />
          <SettingRow
            id="profile-import"
            icon={<Upload />}
            title="Загрузить профиль из файла"
            desc="Настройки из файла применятся, окно перезагрузится"
            control={
              <Button size="sm" variant="outline" onClick={onImport} className="gap-1.5">
                <Upload className="size-3.5" />
                Загрузить
              </Button>
            }
          />
        </Rows>
      </SettingsGroup>

      <BackupsGroup cfg={cfg} onPatch={onPatch} />

      <SettingsGroup data-tour="settings-advanced" title="Дополнительно" hint="Редко нужные настройки. Меняйте, если что-то работает не так.">
        <Rows>
          <SwitchRow
            id="disableGPU"
            icon={<Cpu />}
            title="Отключить аппаратное ускорение"
            hint="Окно рисуется без видеокарты. Помогает, если окно мерцает, остаётся чёрным или прозрачные панели рисуются с артефактами. Нужен перезапуск программы."
            desc="Помогает при мерцании и чёрном окне. Нужен перезапуск"
            checked={cfg?.disableGPU ?? false}
            onChange={(v) => onPatch({ disableGPU: v })}
          />
          <LogDaysRow cfg={cfg} onPatch={onPatch} />
          <ClearCacheRow />
          <SettingRow
            id="relaunch"
            icon={<RotateCw />}
            title="Перезапустить программу"
            desc="Закрыть и снова открыть LAZEYKA"
            control={
              <Button size="sm" variant="outline" onClick={onRelaunch}>
                Перезапустить
              </Button>
            }
          />
        </Rows>
      </SettingsGroup>

      <SettingsGroup data-tour="settings-reset" title="Сброс настроек" className="border-st-err/30">
        <Rows>
          <SettingRow
            id="reset"
            icon={<Undo2 />}
            title="Сбросить настройки"
            hint="Не затрагиваются: тема, подписки, узлы и профили INCY, ваши списки хостов и IPSet, выбранная стратегия Zapret, адрес и ключ Telegram-прокси. Работающие службы не останавливаются."
            desc="Все настройки программы вернутся к исходным. Тема, подписки INCY, списки и ключи останутся"
            control={
              step === 'idle' ? (
                <Button size="sm" variant="outline" className="border-st-err/50 text-st-err-text hover:bg-st-err/10" onClick={() => setStep('confirm')}>
                  Сбросить
                </Button>
              ) : (
                <>
                  <span className="text-[12.5px] font-semibold text-foreground">Точно сбросить?</span>
                  <Button
                    size="sm"
                    variant="destructive"
                    disabled={step === 'busy'}
                    onClick={async () => {
                      setStep('busy')
                      try {
                        await onReset()
                      } catch {
                        setStep('idle')
                      }
                    }}
                    className="gap-1.5"
                  >
                    {step === 'busy' && <Loader2 className="size-3.5 animate-spin" />}
                    {step === 'busy' ? 'Сбрасываю…' : 'Да, сбросить'}
                  </Button>
                  <Button size="sm" variant="ghost" disabled={step === 'busy'} onClick={() => setStep('idle')}>
                    Отмена
                  </Button>
                </>
              )
            }
          />
        </Rows>
      </SettingsGroup>
    </div>
  )
}
