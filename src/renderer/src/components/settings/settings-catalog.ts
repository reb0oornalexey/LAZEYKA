import type React from 'react'
import { Archive, Bell, BellRing, Gamepad2, Keyboard, Power, Server, Volume2 } from 'lucide-react'
import { DiscordBrandIcon } from '@renderer/components/service-icons'

/*
 * Каталог раздела «Настройки» (Е5): группы и все строки настроек для поиска.
 * id строки = атрибут data-setting у строки на экране. Поиск ищет по названию,
 * пояснению и словам-синонимам, открывает группу и подсвечивает строку.
 *
 * Старые id свёрнутых секций 2.0 (controls / overlay / backup) остаются
 * псевдонимами: ими пользуются ссылки ?open=…&focus=… и шаги экскурсии.
 */

export type SettingsGroupId = 'launch' | 'updates' | 'notify' | 'keys' | 'sounds' | 'overlay' | 'discord' | 'mac' | 'backup'

export interface GroupDef {
  id: SettingsGroupId
  title: string
  icon: React.ComponentType<{ className?: string }>
  only?: 'win32' | 'darwin'
}

export const GROUPS: GroupDef[] = [
  { id: 'launch', title: 'Запуск и окно', icon: Power },
  { id: 'updates', title: 'Обновления и приватность', icon: Bell },
  { id: 'notify', title: 'Уведомления', icon: BellRing },
  { id: 'keys', title: 'Горячие клавиши', icon: Keyboard },
  { id: 'sounds', title: 'Звуки', icon: Volume2 },
  { id: 'overlay', title: 'Мини-окно поверх игры', icon: Gamepad2 },
  { id: 'discord', title: 'Статус в Discord', icon: DiscordBrandIcon },
  { id: 'mac', title: 'Служба macOS', icon: Server, only: 'darwin' },
  { id: 'backup', title: 'Профиль и сброс', icon: Archive }
]

export interface CatalogEntry {
  id: string
  group: SettingsGroupId
  title: string
  desc: string
  /** Синонимы, по которым тоже ищем (не показываются). */
  words?: string
  only?: 'win32' | 'darwin'
}

export const CATALOG: CatalogEntry[] = [
  // Запуск и окно
  { id: 'autoLaunch', group: 'launch', title: 'Запускать вместе с системой', desc: 'LAZEYKA запускается сама при входе в Windows или macOS', words: 'автозапуск автостарт загрузка старт' },
  { id: 'silentStart', group: 'launch', title: 'Запускать без окна', desc: 'Программа стартует сразу в трее, окно не открывается', words: 'тихий старт свёрнутым скрыто трей' },
  { id: 'zapretAutoStart', group: 'launch', title: 'Включать Zapret при запуске', desc: 'Обход блокировок включается сам, когда запускается программа', words: 'автозапуск zapret запрет' },
  { id: 'tgwsAutoStart', group: 'launch', title: 'Включать Telegram-прокси при запуске', desc: 'Прокси Telegram включается сам, когда запускается программа', words: 'автозапуск телеграм tgws' },
  { id: 'tray', group: 'launch', title: 'Значок в трее', desc: 'Без значка кнопка «×» полностью закрывает программу', words: 'трей область уведомлений иконка закрытие' },
  { id: 'hideTaskbar', group: 'launch', title: 'Убрать с панели задач', desc: 'Программа видна только значком в трее', words: 'панель задач таскбар иконка трей', only: 'win32' },
  { id: 'startPage', group: 'launch', title: 'Открывать при запуске', desc: 'Главная или последний открытый раздел', words: 'стартовая страница раздел главная последний запуск' },
  { id: 'windowAlwaysOnTop', group: 'launch', title: 'Окно LAZEYKA поверх всех окон', desc: 'Основное окно не прячется за другими программами', words: 'поверх закрепить сверху окно always on top' },
  { id: 'resetWindow', group: 'launch', title: 'Сбросить размер и положение окна', desc: 'Обычный размер по центру основного экрана', words: 'окно размер положение монитор центр потерялось уехало' },
  { id: 'trayStatusTooltip', group: 'launch', title: 'Состояние в подсказке значка в трее', desc: 'Zapret, Telegram, VPN, узел и пинг при наведении на значок', words: 'трей подсказка значок статус пинг узел' },
  { id: 'hintMode', group: 'launch', title: 'Подсказки «i»: подробные или короткие', desc: 'Короткие — только первая фраза пояснения', words: 'подсказки пояснения i справка короткие подробные' },
  { id: 'windowZoom-link', group: 'launch', title: 'Масштаб всего окна', desc: '90, 100, 110 или 125 % — в «Оформлении»', words: 'масштаб размер увеличить уменьшить zoom окно 4k' },
  // Обновления и приватность
  { id: 'autoCheckUpdate', group: 'updates', title: 'Проверять обновления LAZEYKA', desc: 'Предложит скачать новую версию, когда она выйдет', words: 'обновление версия github автообновление' },
  { id: 'checkUpdateNow', group: 'updates', title: 'Проверить обновления сейчас', desc: 'Спросить GitHub напрямую, не дожидаясь плановой проверки', words: 'обновление версия' },
  { id: 'updatesViaIncy', group: 'updates', title: 'Проверять обновления через VPN INCY', desc: 'Если VPN подключён — проверка и загрузка обновлений через него', words: 'обновление github впн incy прокси' },
  { id: 'onlineStats', group: 'updates', title: 'Показывать, сколько людей онлайн', desc: 'Анонимная отметка раз в 5 минут, только случайный номер установки', words: 'статистика счётчик онлайн приватность анонимно' },
  // Уведомления
  { id: 'notify-actions', group: 'notify', title: 'Уведомления: горячие клавиши и сценарии', desc: 'Клавиша сработала, сценарий выполнен, служба включилась', words: 'уведомления всплывающие оповещения клавиши сценарии' },
  { id: 'notify-updates', group: 'notify', title: 'Уведомления: обновления', desc: 'Вышла новая версия LAZEYKA', words: 'уведомления оповещения версия обновление' },
  { id: 'notify-errors', group: 'notify', title: 'Уведомления: ошибки служб', desc: 'Zapret упал, VPN оборвался, узел заменён', words: 'уведомления оповещения ошибка сбой впн zapret' },
  { id: 'notify-author', group: 'notify', title: 'Уведомления: сообщения автора', desc: 'Ответы, объявления и предупреждения', words: 'уведомления оповещения автор ответ объявление' },
  { id: 'subExpireDays', group: 'notify', title: 'Напомнить о конце подписки VPN', desc: 'За 1, 3 или 7 дней до окончания подписки INCY', words: 'подписка срок окончание истекает напоминание incy' },
  { id: 'subTrafficPct', group: 'notify', title: 'Напомнить, когда трафик подписки на исходе', desc: 'Осталось меньше 10, 20 или 30 %', words: 'подписка трафик гигабайты остаток напоминание' },
  // Горячие клавиши
  { id: 'hk-incyToggleShortcut', group: 'keys', title: 'Клавиша: VPN (INCY)', desc: 'Подключить или отключить VPN', words: 'горячая клавиша сочетание incy впн' },
  { id: 'hk-incyBestNodeShortcut', group: 'keys', title: 'Клавиша: лучший узел', desc: 'Перейти на рабочий быстрый узел', words: 'горячая клавиша сервер' },
  { id: 'hk-exitlagToggleShortcut', group: 'keys', title: 'Клавиша: ExitLag', desc: 'VPN только для игр — включить или выключить', words: 'горячая клавиша игры' },
  { id: 'hk-zapretToggleShortcut', group: 'keys', title: 'Клавиша: Zapret', desc: 'Включить или выключить обход блокировок', words: 'горячая клавиша запрет' },
  { id: 'hk-zapretRestartShortcut', group: 'keys', title: 'Клавиша: перезапуск Zapret', desc: 'Если сайт перестал открываться', words: 'горячая клавиша запрет' },
  { id: 'hk-tgwsToggleShortcut', group: 'keys', title: 'Клавиша: Telegram-прокси', desc: 'Включить или выключить прокси Telegram', words: 'горячая клавиша телеграм', only: 'win32' },
  { id: 'hk-showWindowShortcut', group: 'keys', title: 'Клавиша: показать или спрятать LAZEYKA', desc: 'Работает и в игре', words: 'горячая клавиша окно' },
  { id: 'hk-prematchToggleShortcut', group: 'keys', title: 'Клавиша: «Перед каткой»', desc: 'Начать или завершить игровую сессию', words: 'горячая клавиша игра пинг' },
  { id: 'hk-miniWindowShortcut', group: 'keys', title: 'Клавиша: мини-окно', desc: 'Показать или скрыть окно с переключателями', words: 'горячая клавиша оверлей' },
  { id: 'hk-muteSoundsShortcut', group: 'keys', title: 'Клавиша: без звука', desc: 'Выключить или включить все звуки программы', words: 'горячая клавиша звук тишина mute' },
  { id: 'hk-restartAppShortcut', group: 'keys', title: 'Клавиша: перезапустить LAZEYKA', desc: 'Закрыть и снова открыть программу', words: 'горячая клавиша перезапуск рестарт' },
  { id: 'hk-scenarios', group: 'keys', title: 'Клавиши сценариев', desc: 'Своё сочетание для каждого сценария', words: 'горячая клавиша сценарий' },
  { id: 'hotkeySound', group: 'keys', title: 'Звук при срабатывании клавиши', desc: 'Короткий сигнал, слышно даже в полноэкранной игре', words: 'звук горячая клавиша сигнал' },
  // Звуки
  { id: 'sound-mute', group: 'sounds', title: 'Без звука', desc: 'Выключить все звуки программы', words: 'звук тишина mute' },
  { id: 'sound-master', group: 'sounds', title: 'Общая громкость', desc: 'Громкость всех звуков программы', words: 'звук громкость' },
  { id: 'sound-actions', group: 'sounds', title: 'Звук: действия', desc: 'Сценарий применился или сработала горячая клавиша', words: 'звук громкость' },
  { id: 'sound-messages', group: 'sounds', title: 'Звук: сообщения', desc: 'Ответ автора, решение по теме, объявление', words: 'звук громкость уведомления' },
  { id: 'sound-alerts', group: 'sounds', title: 'Звук: сигналы', desc: 'Во время игры вырос пинг или пошли потери', words: 'звук громкость лаги пинг' },
  // Мини-окно
  { id: 'mini-show', group: 'overlay', title: 'Мини-окно поверх игры', desc: 'Маленькое окно с переключателями поверх остальных', words: 'оверлей поверх игры мини окно' },
  { id: 'mini-mode', group: 'overlay', title: 'Вид мини-окна', desc: 'Индикатор или панель с переключателями', words: 'индикатор панель оверлей' },
  { id: 'mini-lock', group: 'overlay', title: 'Закрепить индикатор', desc: 'Клики проходят сквозь индикатор', words: 'закрепить оверлей' },
  { id: 'mini-opacity', group: 'overlay', title: 'Прозрачность мини-окна', desc: 'Насколько окно просвечивает', words: 'прозрачность оверлей' },
  { id: 'mini-help', group: 'overlay', title: 'Не видно поверх игры?', desc: 'Полноэкранный режим и как это исправить', words: 'полноэкранный borderless оверлей' },
  // Discord
  { id: 'discord-show', group: 'discord', title: 'Показывать в Discord', desc: 'Строка «Играет в LAZEYKA» в профиле', words: 'дискорд статус активность rich presence' },
  { id: 'discord-ping', group: 'discord', title: 'Показывать пинг в Discord', desc: 'Время отклика текущего узла INCY', words: 'дискорд пинг' },
  { id: 'discord-check', group: 'discord', title: 'Связь с Discord', desc: 'Принял ли Discord активность', words: 'дискорд проверить' },
  // macOS
  { id: 'mac-service', group: 'mac', title: 'Служба macOS для режима TUN', desc: 'Служба с правами администратора', words: 'tun служба мак пароль', only: 'darwin' },
  // Профиль и сброс
  { id: 'profile-export', group: 'backup', title: 'Сохранить профиль в файл', desc: 'Все настройки, списки Zapret и ключи Telegram в файле .lazeyka', words: 'экспорт резервная копия бэкап профиль' },
  { id: 'profile-import', group: 'backup', title: 'Загрузить профиль из файла', desc: 'Настройки из файла .lazeyka', words: 'импорт резервная копия бэкап профиль' },
  { id: 'disableGPU', group: 'backup', title: 'Отключить аппаратное ускорение', desc: 'Помогает при мерцании и чёрном окне. Нужен перезапуск', words: 'gpu видеокарта ускорение графика' },
  { id: 'maxLogDays', group: 'backup', title: 'Хранить логи', desc: '3, 7 или 30 дней', words: 'логи журнал срок хранения дни' },
  { id: 'clearCache', group: 'backup', title: 'Очистить кэш', desc: 'Превью галереи, старые логи, значки подписок, остатки обновлений', words: 'кэш очистка место диск удалить' },
  { id: 'backupBeforeUpdate', group: 'backup', title: 'Копия настроек перед обновлением', desc: 'Последние 3 копии .lazeyka, восстановить в один клик', words: 'резервная копия бэкап обновление откат восстановить профиль' },
  { id: 'relaunch', group: 'backup', title: 'Перезапустить программу', desc: 'Закрыть и снова открыть LAZEYKA', words: 'перезапуск рестарт' },
  { id: 'reset', group: 'backup', title: 'Сбросить настройки', desc: 'Вернуть настройки программы к исходным', words: 'сброс по умолчанию заводские' }
]

/** Старые id секций и цели data-tour → группа. */
const ALIASES: Record<string, SettingsGroupId> = {
  controls: 'keys',
  backup: 'backup',
  overlay: 'overlay'
}

const TARGET_GROUP: Record<string, SettingsGroupId> = {
  hotkeys: 'keys',
  'sound-volume': 'sounds',
  'sound-actions': 'sounds',
  'sound-messages': 'sounds',
  'sound-alerts': 'sounds',
  'mini-window': 'overlay',
  'mini-window-modes': 'overlay',
  'mini-window-fullscreen-help': 'overlay',
  'mini-window-check': 'overlay',
  'discord-status': 'discord',
  'settings-launch': 'launch',
  'settings-interface': 'launch',
  'settings-updates': 'updates',
  'settings-ui': 'launch',
  'settings-notify': 'notify',
  'settings-sub-reminder': 'notify',
  'settings-update-backups': 'backup',
  'settings-backup': 'backup',
  'settings-advanced': 'backup',
  'settings-reset': 'backup',
  'settings-mac-service': 'mac'
}

const IDS = new Set<string>(GROUPS.map((g) => g.id))

/** Группа по параметрам ссылки (?open=…&focus=…) или по полю tab шага экскурсии. */
export function resolveGroup(open: string | null | undefined, focus?: string | null): SettingsGroupId | null {
  if (focus) {
    if (TARGET_GROUP[focus]) return TARGET_GROUP[focus]
    const row = CATALOG.find((c) => c.id === focus)
    if (row) return row.group
  }
  if (!open) return null
  if (IDS.has(open)) return open as SettingsGroupId
  return ALIASES[open] ?? TARGET_GROUP[open] ?? null
}

/** Нормализация для поиска: регистр, «ё». */
export function norm(s: string): string {
  return s.toLowerCase().replace(/ё/g, 'е')
}

/** Все слова запроса должны найтись в названии, пояснении, синонимах или названии группы. */
/** Слово запроса без окончания: «трея» найдёт «трее», «звуки» — «звук». */
function stem(w: string): string {
  return w.length >= 5 ? w.slice(0, -1) : w
}

export function searchCatalog(query: string, platform: string): CatalogEntry[] {
  const words = norm(query).split(/\s+/).filter(Boolean).map(stem)
  if (!words.length) return []
  const groupTitle = new Map(GROUPS.map((g) => [g.id, g.title]))
  return CATALOG.filter((c) => !c.only || c.only === platform)
    .map((c) => {
      const title = norm(c.title)
      const hay = `${title} ${norm(c.desc)} ${norm(c.words ?? '')} ${norm(groupTitle.get(c.group) ?? '')}`
      if (!words.every((w) => hay.includes(w))) return null
      // Совпадение в названии — выше.
      const score = words.reduce((s, w) => s + (title.includes(w) ? 2 : 0) + (title.startsWith(w) ? 1 : 0), 0)
      return { c, score }
    })
    .filter((x): x is { c: CatalogEntry; score: number } => x !== null)
    .sort((a, b) => b.score - a.score)
    .map((x) => x.c)
}

/** Разбить текст на куски с отметкой совпадений (для подсветки). */
export function splitMatches(text: string, query: string): { t: string; hit: boolean }[] {
  const words = norm(query).split(/\s+/).filter((w) => w.length > 0).map(stem)
  if (!words.length) return [{ t: text, hit: false }]
  const n = norm(text)
  const mask = new Array<boolean>(text.length).fill(false)
  for (const w of words) {
    let i = n.indexOf(w)
    while (i >= 0) {
      for (let k = i; k < i + w.length; k++) mask[k] = true
      i = n.indexOf(w, i + w.length)
    }
  }
  const out: { t: string; hit: boolean }[] = []
  for (let i = 0; i < text.length; i++) {
    const last = out[out.length - 1]
    if (last && last.hit === mask[i]) last.t += text[i]
    else out.push({ t: text[i], hit: mask[i] })
  }
  return out
}
