import React, { useEffect, useState, useSyncExternalStore } from 'react'
import { Activity, Bell, Play, Volume2, VolumeX, Zap } from 'lucide-react'
import { Button } from '@renderer/components/ui/button'
import { SoundPicker } from '@renderer/components/sound-picker'
import { useAppConfig } from '@renderer/hooks/use-app-config'
import { appReloadShortcuts } from '@renderer/utils/ipc'
import { RangeField, Rows, SettingRow, SettingsGroup, SwitchRow } from '@renderer/components/settings/setting-row'
import {
  SOUND_CATEGORIES,
  SOUND_MASTER_MAX,
  getCategorySound,
  getSoundVolume,
  playSound,
  setCategorySound,
  setSoundVolume,
  soundsVersion,
  subscribeSounds,
  type SoundCategory,
  type SoundVolume
} from '@renderer/lib/sound'

const ICONS: Record<SoundCategory, React.ReactElement> = {
  actions: <Zap />,
  messages: <Bell />,
  alerts: <Activity />
}

/**
 * Звуки программы (Настройки → «Звуки»): «Без звука», общая громкость и три
 * категории — у каждой свой звук и своя громкость. Меняется сразу и
 * сохраняется. Звуки системных уведомлений Windows и macOS сюда не входят —
 * их громкость задаёт система.
 */
export default function SoundCard(): React.ReactElement {
  const [vol, setVol] = useState<SoundVolume>(() => getSoundVolume())
  // Перерисовка при смене набора (свой звук добавлен/удалён) и выбора.
  const soundsVer = useSyncExternalStore(subscribeSounds, soundsVersion)
  // «Без звука» могла переключить горячая клавиша — берём громкость из хранилища.
  useEffect(() => setVol(getSoundVolume()), [soundsVer])
  const { patchAppConfig } = useAppConfig()

  const patch = (p: Partial<SoundVolume>): void => setVol(setSoundVolume(p))
  const off = vol.muted || vol.master === 0

  const choose = (cat: SoundCategory, id: string): void => {
    setCategorySound(cat, id)
    // Звук «Действий» — прежнее поле конфига «какой звук» (горячие клавиши).
    if (cat === 'actions') void patchAppConfig({ hotkeySoundId: id }).then(() => appReloadShortcuts())
  }

  return (
    <SettingsGroup
      data-tour="sound-volume"
      title="Звуки"
      hint="Звуки самой программы: подтверждение сценариев и горячих клавиш, новые сообщения, сигнал о лагах. Для каждого случая — свой звук и своя громкость. На звук игры, Discord и системы не влияет."
      sub={vol.muted ? 'Все звуки программы выключены' : `Общая громкость ${vol.master}%`}
    >
      <Rows>
        <SwitchRow
          id="sound-mute"
          icon={vol.muted ? <VolumeX /> : <Volume2 />}
          title="Без звука"
          desc="Выключить все звуки программы. Громкость и выбор звуков сохранятся."
          checked={vol.muted}
          onChange={(v) => patch({ muted: v })}
        />
        <SettingRow
          id="sound-master"
          icon={<Volume2 />}
          on={!off}
          title="Общая громкость"
          hint="Действует на все звуки программы. 100% — обычная громкость, выше — громче обычного, если звук теряется за игрой."
          desc="Выше 100% — громче обычного, если звук теряется за игрой"
          below={<RangeField label="Общая громкость" value={vol.master} max={SOUND_MASTER_MAX} disabled={vol.muted} onChange={(v) => patch({ master: v })} />}
        />
        {SOUND_CATEGORIES.map((c) => {
          const v = vol[c.id]
          return (
            <SettingRow
              key={c.id}
              id={`sound-${c.id}`}
              data-tour={`sound-${c.id}`}
              icon={ICONS[c.id]}
              on={!off && v > 0}
              title={c.title}
              desc={c.when}
              control={
                <>
                  <SoundPicker category={c.id} value={getCategorySound(c.id)} disabled={vol.muted} onChange={(id) => choose(c.id, id)} />
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-8 shrink-0 gap-1 px-2 text-xs"
                    title="Проиграть выбранный звук с этой громкостью"
                    disabled={off || v === 0}
                    onClick={() => playSound(undefined, c.id !== 'alerts', c.id, true)}
                  >
                    <Play className="size-3.5" /> Проверить
                  </Button>
                </>
              }
              below={
                <RangeField label={`Громкость: ${c.title}`} value={v} max={100} disabled={vol.muted} onChange={(x) => patch({ [c.id]: x } as Partial<SoundVolume>)} />
              }
            />
          )
        })}
      </Rows>
    </SettingsGroup>
  )
}
