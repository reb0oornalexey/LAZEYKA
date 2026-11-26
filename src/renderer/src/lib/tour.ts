/**
 * Экскурсия по новым функциям.
 *
 * В экскурсию попадают только крупные функции версии — список задаётся вручную.
 * Мелкие правки остаются в «Что нового». Каждый шаг сам открывает раздел,
 * переключает внутреннюю вкладку (если она нужна), прокручивает к настройке и
 * подсвечивает её. Цель шага — значение атрибута data-tour на карточке или
 * строке настройки. Интерфейс при этом не блокируется.
 *
 * Два вида экскурсий:
 *  - «Знакомство» (INTRO_TOUR) — для новой установки: проход по всему меню;
 *  - «Что нового в <версия>» (TOURS) — только для обновившихся.
 * Что показать при запуске, решает feature-tour.tsx (новая установка или
 * обновление — по install:state из main). Повторно обе открываются в блоке
 * «Обучение» на странице «Информация»; «Что нового» — ещё и из окна истории
 * версий.
 */

import { VELVET_URL } from '@renderer/components/velvet-recommendation'
import { useUiState } from '@renderer/lib/appearance/ui-state'

export interface TourStep {
  /** Маршрут страницы. */
  route: string
  /** Внутренняя вкладка страницы (INCY: main | servers | routing | settings | stats; «Оформление»: themes | colors | interface | advanced). */
  tab?: string
  /** Значение атрибута data-tour у подсвечиваемого элемента. */
  target: string
  title: string
  text: string
  /** Шаг только для одной системы. */
  only?: 'win32' | 'darwin'
  /** Необязательная кнопка-ссылка под текстом шага. Открывается только https (через shell:openExternal). */
  link?: { label: string; url: string }
}

export interface Tour {
  /** Для «Что нового» — версия; для знакомства — INTRO_ID. */
  version: string
  kind?: 'intro' | 'whatsnew'
  title: string
  steps: TourStep[]
}

export const INTRO_ID = 'intro'

/**
 * Знакомство для новой установки: проходит по всему меню по порядку. Шаги
 * разделов подсвечивают пункт меню (data-tour="nav-<ключ>" у пунктов бокового
 * меню), а сам раздел при этом открывается — видно и где он, и как выглядит.
 */
export const INTRO_TOUR: Tour = {
  version: INTRO_ID,
  kind: 'intro',
  title: 'Знакомство с LAZEYKA',
  steps: [
    {
      route: '/home',
      target: 'nav-home',
      title: 'Добро пожаловать в LAZEYKA',
      text: 'Короткая экскурсия по всем разделам, займёт минуту. Её можно пропустить и пройти позже.'
    },
    {
      route: '/home',
      target: 'home-status',
      title: 'Главная',
      text: 'Здесь видно, что сейчас включено. «Включить всё» запускает Zapret, Telegram и VPN одной кнопкой.'
    },
    {
      route: '/home',
      target: 'home-services',
      title: 'Что сейчас открывается',
      text: 'Плитки YouTube, Discord, Telegram и других сервисов. Красная — сервис не открывается; нажмите, и программа поищет причину.'
    },
    {
      route: '/zapret',
      target: 'nav-zapret',
      title: 'Zapret',
      text: 'Открывает заблокированные сайты и YouTube без VPN. Если сайт не открылся, автоподбор найдёт рабочую настройку.'
    },
    {
      route: '/telegram',
      target: 'nav-telegram',
      title: 'Telegram',
      text: 'Помогает, если Telegram плохо грузит фото и видео. Включается одной кнопкой, в Telegram прокси добавляется по ссылке.'
    },
    {
      route: '/dns',
      target: 'nav-dns',
      title: 'DNS',
      text: 'Другой DNS-сервер, если провайдер подменяет адреса сайтов. Прежний можно вернуть одной кнопкой.'
    },
    {
      route: '/incy',
      tab: 'servers',
      target: 'nav-incy',
      title: 'INCY: VPN',
      text: 'VPN работает по подписке — ссылке от VPN-сервиса. Её получают в Telegram-боте сервиса («Получить подписку») и вставляют на вкладке «Сервера».',
      link: { label: 'Рекомендация автора: Velvet', url: VELVET_URL }
    },
    {
      route: '/exitlag',
      target: 'nav-exitlag',
      title: 'ExitLag',
      text: 'Режим VPN для игр: через сервер идут только выбранные игры и программы, остальное — напрямую.'
    },
    {
      route: '/prematch',
      target: 'nav-prematch',
      title: 'Перед каткой',
      text: 'Проверка сети за полминуты до матча: пинг, потери, Wi-Fi. Подскажет, где проблема — дома или дальше.'
    },
    {
      route: '/optimizer',
      target: 'nav-optimizer',
      title: 'Оптимизатор',
      text: 'Сравнивает пинг до игрового сервера напрямую и через каждый ваш VPN-сервер, чтобы выбрать лучший путь.'
    },
    {
      route: '/tweaks',
      target: 'nav-tweaks',
      title: 'Твики',
      text: 'Настройки сети системы, которые убирают лишние задержки и скачки пинга в играх. Всё возвращается одной кнопкой.'
    },
    {
      route: '/streamer',
      target: 'nav-streamer',
      title: 'Стример',
      text: 'Прячет IP, названия серверов и ссылки, чтобы зрители их не увидели. Здесь же кнопки для Stream Deck.'
    },
    {
      route: '/diagnostics',
      target: 'nav-diagnostics',
      title: 'Диагностика',
      text: 'Если сайт не открывается: проверка сайта, утечки IP и DNS, каналы Wi-Fi. Покажет, в чём дело.'
    },
    {
      route: '/lan',
      target: 'nav-lan',
      title: 'Локальная сеть',
      text: 'Пульт на телефоне по QR-коду, прокси для устройств и точка доступа Wi-Fi на Windows. Раздел выключен по умолчанию.'
    },
    {
      route: '/scenarios',
      target: 'nav-scenarios',
      title: 'Сценарии',
      text: 'Набор действий на одну кнопку или горячую клавишу: например, «Игры» включает VPN, ExitLag и мини-окно.'
    },
    {
      route: '/appearance',
      target: 'nav-appearance',
      title: 'Оформление',
      text: 'Темы, цвета и вид интерфейса. Можно поставить тему из галереи или собрать свою.'
    },
    {
      route: '/settings',
      target: 'nav-settings',
      title: 'Настройки',
      text: 'Запуск вместе с системой, горячие клавиши, звуки, мини-окно поверх игры, резервная копия настроек.'
    },
    {
      route: '/support',
      target: 'nav-support',
      title: 'Связь с автором',
      text: 'Прямо из программы: отчёт о проблеме, идея новой функции, своя тема в галерею. Ответ автора придёт сюда и колокольчиком в шапке.'
    },
    {
      route: '/support',
      target: 'support-donate',
      title: 'Помочь проекту',
      text: 'LAZEYKA бесплатна и делается одним человеком. Если она вам помогает — здесь можно поддержать развитие любой суммой. Это добровольно: все функции доступны всем. Когда идёт сбор на что-то конкретное, выше видны цель, полоска и стена благодарностей с никами поддержавших.'
    },
    {
      route: '/about',
      target: 'about-learning',
      title: 'Пройти снова',
      text: 'Это знакомство можно повторить в любой момент: «Информация» → «Знакомство с программой».'
    }
  ]
}

/** От новых к старым. Первая — та, что показывается после обновления. */
export const TOURS: Tour[] = [
  {
    version: '2.0.0',
    kind: 'whatsnew',
    title: 'Что нового в LAZEYKA 2.0',
    steps: [
      {
        route: '/zapret',
        tab: 'strategies',
        target: 'zapret-catalog',
        title: 'Zapret: всё на одном экране',
        text: 'В каталоге можно найти стратегию, проверить её, сравнить результаты и выбрать подходящую для своей сети.'
      },
      {
        route: '/zapret',
        tab: 'strategies',
        target: 'zapret-autopick',
        only: 'win32',
        title: 'Автоподбор стратегии',
        text: 'Программа сама поймёт, что именно блокирует провайдер, и проверит несколько подходящих приёмов, а не все подряд. Обычно до минуты-двух.'
      },
      {
        route: '/zapret',
        tab: 'builder',
        target: 'zapret-builder-family',
        only: 'win32',
        title: 'Конструктор стратегий',
        text: 'Соберите свою стратегию из понятных блоков, проверьте её на Discord, YouTube и Google и сохраните под своим названием.'
      },
      {
        route: '/prematch',
        target: 'prematch-goal',
        title: 'Перед каткой',
        text: 'Проверка сети за полминуты до матча: пинг, потери, Wi-Fi. Программа скажет, можно ли играть, а после игры покажет отчёт.'
      },
      {
        route: '/optimizer',
        tab: 'valve',
        target: 'valve-regions',
        title: 'Оптимизатор переехал',
        text: 'Всё игровое теперь в группе «Игры». Здесь лежат оптимизатор маршрута, регионы Valve и трассировка.'
      },
      {
        route: '/tweaks',
        target: 'tweaks-adapter',
        title: 'Твики',
        text: 'Настройки системы, которые убирают лишние задержки и скачки пинга. У каждой написано, что она делает. Всё возвращается одной кнопкой.'
      },
      {
        route: '/streamer',
        target: 'streamer-mode',
        title: 'Режим стримера',
        text: 'Размывает IP, названия серверов и ссылки подписок, чтобы зрители их не увидели. Включается сам, когда запущен OBS.'
      },
      {
        route: '/settings',
        tab: 'discord',
        target: 'discord-status',
        title: 'Статус в Discord',
        text: 'Строка «Играет в LAZEYKA» в вашем профиле Discord. Включается переключателем в «Настройках» и сразу пропадает при выключении.'
      },
      {
        route: '/streamer',
        tab: 'deck',
        target: 'streamdeck',
        title: 'Кнопки для стрим-пульта',
        text: 'Кнопки Stream Deck, Fifine и других пультов включают VPN, Zapret и ваши сценарии. Всё это на вкладке «Стрим-пульт» страницы «Стример».'
      },
      {
        route: '/diagnostics',
        tab: 'site',
        target: 'diag-site-check',
        title: 'Проверка сайтов',
        text: 'Посмотрите, открылась ли страница, на каком этапе произошёл сбой и отвечает ли сайт через INCY. Повторите проверку того же адреса, чтобы сравнить результаты.'
      },
      {
        route: '/diagnostics',
        tab: 'leak',
        target: 'diag-leak',
        title: 'Утечки IP и DNS',
        text: 'Показывает, что видит сеть снаружи при включённом обходе или VPN, и подсказывает, где есть утечка.'
      },
      {
        route: '/lan',
        tab: 'remote',
        target: 'lan-remote',
        title: 'Пульт с телефона',
        text: 'Сканируйте QR-код, чтобы управлять службами, переключать узлы и запускать сценарии с телефона. В пульте можно проверить, идёт ли браузер через ПК.'
      },
      {
        route: '/lan',
        tab: 'share',
        target: 'lan-share',
        title: 'Раздача на устройства',
        text: 'Укажите адрес и порт прокси на нужном устройстве. Здесь же можно проверить YouTube через прокси. Для общего маршрута через ПК нужна настройка шлюза.'
      },
      {
        route: '/home',
        target: 'home-services',
        title: 'Что сейчас работает',
        text: 'Панель сервисов: YouTube, Discord, Telegram, ChatGPT, Claude и другие. Красная плитка значит, что сервис не открывается. Нажмите на неё, и программа найдёт причину.'
      },
      {
        route: '/dns',
        tab: 'ai',
        target: 'dns-ai-check',
        title: 'Нейросети по DNS',
        text: 'Проверка, какой DNS-сервер открывает ChatGPT, Claude и Gemini именно в вашей сети. Лучший ставится одной кнопкой.'
      },
      {
        route: '/incy',
        tab: 'stats',
        target: 'incy-connections',
        title: 'Соединения INCY',
        text: 'Какая программа куда подключается. Любой сайт можно отправить через VPN или напрямую.'
      },
      {
        route: '/incy',
        tab: 'settings',
        target: 'incy-chain',
        title: 'Цепочка узлов',
        text: 'Выберите вход и выход. Рядом с узлами виден пинг. INCY проверяет пару перед применением и показывает, на каком этапе произошёл сбой.'
      },
      {
        route: '/incy',
        tab: 'settings',
        target: 'incy-killswitch-reset',
        title: 'Сброс Kill Switch',
        text: 'Снимает блокировку трафика, если после сбоя интернет остался закрытым. Нажмите, если интернета нет, а VPN не подключён.'
      },
      {
        route: '/incy',
        tab: 'settings',
        target: 'incy-excluded-routes',
        title: 'Исключённые маршруты',
        text: 'Подсети из списка идут напрямую, мимо туннеля: принтер, рабочая сеть, игровой сервер. Только для режима TUN.'
      },
      {
        route: '/incy',
        tab: 'settings',
        target: 'incy-secure-dns',
        title: 'Защищённый DNS для адреса сервера',
        text: 'Помогает, если провайдер подменяет адреса VPN-серверов. Адрес сервера ищется через защищённый DNS.'
      },
      {
        route: '/incy',
        tab: 'settings',
        target: 'incy-verbose-log',
        title: 'Подробный лог ядра',
        text: 'Нужен для диагностики. Включайте на время поиска проблемы и выключайте: лог быстро растёт.'
      },
      {
        route: '/settings',
        tab: 'sounds',
        target: 'sound-volume',
        title: 'Громкость звуков',
        text: 'Карточка «Звуки» в «Настройках»: общая громкость, сценарии и горячие клавиши, сигнал о лагах. На звук игры и Discord не влияет.'
      },
      {
        route: '/settings',
        tab: 'overlay',
        target: 'mini-window',
        title: 'Мини-окно поверх игры',
        text: 'Маленькое окно с переключателями, которое не мешает игре. Включается в «Настройках», карточка «Мини-окно поверх игры».'
      },
      {
        route: '/settings',
        tab: 'overlay',
        target: 'mini-window-modes',
        title: 'Индикатор поверх игры',
        text: 'Режим «Индикатор»: только зелёные точки включённых функций, без кнопок. Закреплённый индикатор пропускает клики сквозь себя.'
      },
      {
        route: '/appearance',
        tab: 'themes',
        target: 'theme-gallery',
        title: 'Галерея тем',
        text: 'Темы других пользователей ставятся одним нажатием, а своей можно поделиться. Каждая тема проходит проверку перед публикацией.'
      },
      {
        route: '/support',
        target: 'support-report',
        title: 'Связь с автором прямо из программы',
        text: 'Отчёт о проблеме (программа сама соберёт его и скроет IP и ссылки), идея новой функции — всё отправляется отсюда, без Telegram и почты.'
      },
      {
        route: '/support',
        target: 'hub-bell',
        title: 'Ответы автора',
        text: 'Нажмите на колокольчик, чтобы увидеть ответы на отчёты и идеи, решения по темам и объявления автора.'
      },
      {
        route: '/support',
        target: 'support-donate',
        title: 'Сбор на развитие',
        text: 'Теперь у проекта есть сборы с понятной целью: полоска показывает, сколько собрано, а ники поддержавших попадают на стену благодарностей — со стилем за уровень поддержки.'
      }
    ]
  }
]

export const TOUR_EVENT = 'lazeyka:tour'
const SEEN_KEY = 'lazeyka.tour.seen'

export function latestTour(): Tour | null {
  return TOURS[0] ?? null
}

export function tourFor(version: string): Tour | null {
  if (version === INTRO_ID) return INTRO_TOUR
  return TOURS.find((t) => t.version === version) ?? null
}

export function seenTourVersion(): string | null {
  try {
    return localStorage.getItem(SEEN_KEY)
  } catch {
    return null
  }
}

export function markTourSeen(version: string): void {
  try {
    localStorage.setItem(SEEN_KEY, version)
  } catch {
    /* хранилище недоступно — экскурсия просто покажется ещё раз */
  }
}

/** Запустить экскурсию «Что нового» (по умолчанию — самую свежую). */
export function startTour(version?: string): void {
  window.dispatchEvent(new CustomEvent(TOUR_EVENT, { detail: { version } }))
}

/** Запустить «Знакомство». */
export function startIntroTour(): void {
  startTour(INTRO_ID)
}

const ONBOARDING_KEY = 'lazeyka.onboarding.done'

export function isOnboardingDone(): boolean {
  try {
    return localStorage.getItem(ONBOARDING_KEY) === '1'
  } catch {
    return false
  }
}

export function markOnboardingDone(): void {
  try {
    localStorage.setItem(ONBOARDING_KEY, '1')
  } catch {
    /* хранилище недоступно */
  }
}

/**
 * Одноразовые подсказки, которые пропадают после первого показа или по
 * крестику. «Сбросить подсказки» удаляет эти отметки, и подсказки появятся
 * снова. Рекомендация Velvet сюда намеренно не входит.
 */
const ONE_TIME_HINT_KEYS = [
  'lazeyka.appearance.calloutSeen',
  'lazeyka.appearance.coachSeen',
  'lazeyka.appearance.hintDismissed'
]

/** Есть ли что сбрасывать. */
export function hasDismissedHints(): boolean {
  try {
    return ONE_TIME_HINT_KEYS.some((k) => localStorage.getItem(k) !== null)
  } catch {
    return false
  }
}

export function resetHints(): void {
  useUiState.getState().showCoach()
  try {
    for (const k of ONE_TIME_HINT_KEYS) localStorage.removeItem(k)
  } catch {
    /* noop */
  }
}

export type StartupTour = 'intro' | 'whatsnew' | null

/**
 * Что показать при запуске (чистая функция, проверяется скриптом).
 * fresh — main сообщил о чистой установке (null — не удалось узнать).
 */
export function decideStartupTour(opts: {
  fresh: boolean | null
  onboardingDone: boolean
  seenVersion: string | null
  latestVersion: string | null
  appVersion: string
}): StartupTour {
  const { fresh, onboardingDone, seenVersion, latestVersion, appVersion } = opts
  // Новичок: чистая установка, знакомство ещё не проходил и экскурсий не видел.
  if (fresh === true && !onboardingDone && seenVersion === null) return 'intro'
  if (!latestVersion || seenVersion === latestVersion) return null
  // Экскурсия от будущей версии (сборка разработчика) не показывается.
  if (appVersion && !versionAtLeast(appVersion, latestVersion)) return null
  return 'whatsnew'
}

/** Сравнение версий вида 1.2.10 — без учёта суффиксов. */
export function versionAtLeast(current: string, wanted: string): boolean {
  const a = current.split(/[.-]/).map((x) => parseInt(x, 10) || 0)
  const b = wanted.split(/[.-]/).map((x) => parseInt(x, 10) || 0)
  for (let i = 0; i < 3; i++) {
    if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) > (b[i] ?? 0)
  }
  return true
}
