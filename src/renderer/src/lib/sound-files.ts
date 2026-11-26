/**
 * Звуки из файлов, которые идут в сборке программы (src/renderer/src/assets/sounds).
 *
 * Права: message-sms.mp3 — звук Apple (входящее SMS на iPhone), success.mp3 —
 * происхождение неизвестно. Чтобы убрать звук из сборки (например, для
 * публичного релиза), удалите его строку ниже — файл перестанет попадать в
 * сборку (Vite копирует только то, на что есть ссылка). Выбор пользователя,
 * указывающий на удалённый звук, сам вернётся к звуку по умолчанию категории
 * (для «Сообщений» — синтезированная «Капля», см. DEFAULT_SOUND в sound.ts).
 * Себе локально такой звук можно поставить через «Свой файл…».
 */
export interface BundledFileSound {
  id: string
  name: string
  url: string
}

export const BUNDLED_FILE_SOUNDS: BundledFileSound[] = [
  { id: 'sms', name: 'SMS (iPhone)', url: new URL('../assets/sounds/message-sms.mp3', import.meta.url).href },
  { id: 'success', name: 'Успех', url: new URL('../assets/sounds/success.mp3', import.meta.url).href }
]
