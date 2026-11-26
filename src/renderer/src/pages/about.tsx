import React, { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import {
  Shield,
  Zap,
  Gamepad2,
  Lock,
  Bot,
  Wrench,
  HelpCircle,
  Sparkles,
  Headset,
  ChevronDown,
  Rocket,
  ScrollText,
  Split,
  BarChart2,
  Download,
  Link as LinkIcon,
  AlertTriangle,
  Crosshair,
  Stethoscope,
  Network,
  MessageSquare,
  ArrowRight,
  BookOpen,
  Compass,
  Heart,
  RotateCcw,
  Search,
  Tv,
  Users,
  Activity,
  Trophy,
  UserCheck
} from 'lucide-react'
import { LanScenariosGuide } from '@renderer/components/lan-scenarios-guide'
import { TelegramBrandIcon } from '@renderer/components/service-icons'
import BasePage from '@renderer/components/base/base-page'
import { Button } from '@renderer/components/ui/button'
import { Input } from '@renderer/components/ui/input'
import { EmptyState, LiveNumber, LzHero, LzPanel, StatChip } from '@renderer/components/lz'
import { PageColumn, PageTabs, usePageTab, type PageTab } from '@renderer/components/e9/page-tabs'
import VelvetRecommendation from '@renderer/components/velvet-recommendation'
import { useAppConfig } from '@renderer/hooks/use-app-config'
import { useOnlineStore, selectInstallNum } from '@renderer/store/online-store'
import { hasDismissedHints, latestTour, resetHints, startIntroTour, startTour } from '@renderer/lib/tour'
import { getAppVersion } from '@renderer/utils/ipc'
import { cn, pluralRu } from '@renderer/lib/utils'
import logo from '@renderer/assets/logo.png'

/**
 * Страница «Информация» — это справка, а не витрина.
 *
 * Раньше здесь были маркетинговые описания шести модулей: что такое «ТСПУ»,
 * «desync», «QUIC» и чем режим TUN отличается от системного прокси, человек
 * должен был знать заранее. Половина возможностей приложения (маршрутизация,
 * статистика, бэкап, deeplink-и, автообновление ядер) вообще не упоминалась.
 *
 * Теперь страница построена как руководство: сначала «с чего начать» в трёх
 * шагах, потом каждый раздел приложения — что он делает простыми словами,
 * когда его включать, и где искать, если не помогло.
 */

interface FeatureRow {
  /** Название так, как оно подписано в интерфейсе. */
  name: string
  /** Что это, без терминов. */
  what: string
  /** Когда стоит включить. */
  when?: string
}

interface ModuleInfo {
  icon: React.ReactNode
  title: string
  /** Где это в приложении. */
  where: string
  badge: string
  badgeVariant?: 'default' | 'secondary' | 'outline'
  /** Объяснение «на пальцах», одно-два предложения. */
  simple: string
  features: FeatureRow[]
  tip?: string
  /** Что делать, если не помогло. */
  troubleshoot?: string
}

const MODULES: ModuleInfo[] = [
  {
    icon: <Shield className="h-5 w-5 text-st-ok-text" />,
    title: 'Zapret — обход блокировок без VPN',
    where: 'Вкладка «Zapret»',
    badge: 'Начните с этого',
    badgeVariant: 'default',
    simple:
      'Ничего никуда не перенаправляет: слегка меняет вид ваших запросов, чтобы оборудование провайдера не узнало заблокированный сайт. Ваш IP-адрес остаётся прежним, скорость не падает, задержка в играх не растёт. Это самый безопасный способ — начинать стоит с него.',
    features: [
      {
        name: 'Стратегии',
        what: 'Готовые наборы настроек под разных провайдеров. У каждого провайдера фильтрация своя, поэтому и рабочая стратегия разная.',
        when: 'Если одна не помогла — переключите на следующую и проверьте сайт заново.'
      },
      {
        name: 'Автоподбор стратегии',
        what: 'Приложение само по очереди пробует стратегии и проверяет, открылся ли YouTube и Discord.',
        when: 'Когда не хочется перебирать вручную. Занимает пару минут.'
      },
      {
        name: 'Автопилот',
        what: 'Продолжает следить за связью после подбора и сам переключает стратегию, если у провайдера что-то поменялось.',
        when: 'Включите один раз и забудьте — работает в фоне.'
      },
      {
        name: 'Свои списки сайтов',
        what: 'Список доменов, к которым применяется обход. Можно добавить сайт, если его нет в стандартном списке.'
      },
      {
        name: 'Конструктор стратегий',
        what: 'Ручная сборка своей стратегии, если ни одна готовая не подошла. Для тех, кто понимает, что делает.',
        when: 'Крайний случай. Сначала попробуйте автоподбор.'
      },
      {
        name: 'Любая версия Zapret',
        what: 'Нажмите на номер версии на карточке Zapret — откроется список всех версий с описанием изменений. Можно поставить любую, в том числе откатиться на старую.',
        when: 'Если после обновления стало хуже.'
      },
      {
        name: 'Свои порты (Game Filter)',
        what: 'Готовые наборы портов для игр и Discord (голос, звонки, стримы) или свои диапазоны.'
      }
    ],
    tip: 'Zapret обрабатывает трафик компьютера. Для телефона, приставки или телевизора откройте «Локальная сеть» → «По порту» и проверьте доступ через прокси.',
    troubleshoot:
      'Не открывается конкретный сайт — попробуйте другую стратегию. Не работает вообще ничего — выключите Zapret и проверьте, что интернет есть без него.'
  },
  {
    icon: <Zap className="h-5 w-5 text-purple-400" />,
    title: 'INCY Proxy — полноценный VPN',
    where: 'Вкладка «INCY Proxy»',
    badge: 'Нужна подписка',
    badgeVariant: 'secondary',
    simple:
      'Пропускает трафик через зарубежный сервер: меняет ваш IP-адрес и открывает то, что Zapret не берёт. Нужна ссылка на подписку — её выдаёт продавец VPN. Без ссылки раздел работать не будет.',
    features: [
      {
        name: 'Добавить подписку',
        what: 'Вставьте ссылку в поле на вкладке «Сервера» или нажмите «Из буфера» — приложение само возьмёт скопированную ссылку и загрузит список серверов.'
      },
      {
        name: 'Режим TUN',
        what: 'Через VPN идёт весь компьютер целиком, включая игры и программы.',
        when: 'Основной режим. Начинайте с него.'
      },
      {
        name: 'Системный прокси',
        what: 'Через VPN идут только браузеры и программы, которые умеют читать системные настройки прокси.',
        when: 'Если в режиме TUN что-то работает неправильно.'
      },
      {
        name: 'Только прокси',
        what: 'Приложение просто открывает локальный порт, а вы сами указываете его в нужной программе. Система не трогается.',
        when: 'Для одной конкретной программы или для теста.'
      },
      {
        name: 'Пинг серверов',
        what: 'Задержка до каждого сервера. Зелёный — быстро, жёлтый — терпимо, красный — медленно, «n/a» — сервер не ответил.',
        when: 'Выбирайте сервер с наименьшим числом.'
      },
      {
        name: 'Профили маршрутизации',
        what: 'Готовые наборы: «Раздельно» — российские сайты напрямую, остальное через VPN; «Глобально» — всё через VPN; «Напрямую» — VPN поднят, но не используется.',
        when: '«Раздельно» подходит почти всем: банки и Госуслуги не ругаются на зарубежный IP.'
      },
      {
        name: 'Гео-списки',
        what: 'Готовые списки сервисов с переключателями: Steam и Apple ходят напрямую, YouTube и Telegram — через туннель, реклама блокируется. Любую строчку можно выключить.',
        when: 'Например, если хотите пустить Steam через VPN — выключите его в списке «напрямую».'
      },
      {
        name: 'Свои правила',
        what: 'Указать конкретный сайт или подсеть и решить: напрямую, через туннель или заблокировать. Ваши правила главнее всех готовых списков.'
      },
      {
        name: 'Сайты напрямую',
        what: 'Раздельное туннелирование по сайтам: банки, Госуслуги, все .RU и свои домены — мимо VPN. Вкладка «Маршрутизация».'
      },
      {
        name: 'Автопереключение узла',
        what: 'Если сервер перестал отвечать, приложение само переходит на рабочий из разрешённых. Проверка лёгкая — пара сотен байт раз в 20 секунд.',
        when: 'Включите в карточке «Автовыбор» на главной вкладке INCY.'
      },
      {
        name: 'Тест скорости сервера',
        what: 'Настоящий замер скачивания и отдачи через выбранный сервер, не разрывая текущее подключение.'
      },
      {
        name: 'Цепочка узлов',
        what: 'Трафик идёт через два сервера подряд: вход через один, выход через другой. Вкладка «Настройки» INCY.',
        when: 'Если нужен выход в определённой стране, а прямое подключение к этому серверу работает плохо.'
      },
      {
        name: 'Соединения',
        what: 'Какая программа куда сейчас подключается. Любой сайт из списка можно отправить через VPN или напрямую.'
      }
    ],
    tip: 'Подписка обновляется сама. Если серверы пропали — нажмите обновление на карточке подписки.',
    troubleshoot:
      'Подключилось, но сайты не грузятся — переключите профиль на «Глобально». Не помогло — смените сервер. Совсем ничего — вкладка «Логи», последние строки скажут причину.'
  },
  {
    icon: <TelegramBrandIcon className="h-5 w-5" />,
    title: 'Telegram WS Proxy — только для Telegram',
    where: 'Вкладка «Telegram»',
    badge: 'Без подписки',
    badgeVariant: 'secondary',
    simple:
      'Отдельный маленький прокси только для Telegram. Ускоряет загрузку фото и видео и чинит звонки, когда мессенджер тормозит. Остальной интернет не трогает.',
    features: [
      {
        name: 'Подключить в один клик',
        what: 'Кнопка открывает Telegram и сама прописывает в нём прокси. Ничего вводить руками не нужно.'
      },
      {
        name: 'QR-код для телефона',
        what: 'Нажмите «Показать QR» — прокси станет доступен в домашней сети, а в QR появится адрес компьютера. Отсканируйте его камерой телефона. Telegram на компьютере продолжит работать.',
        when: 'Телефон должен быть в той же сети Wi-Fi, а компьютер — включён.'
      }
    ],
    tip: 'Компьютер должен быть включён — телефон подключается через него.',
    troubleshoot: 'Telegram не подключился — нажмите «Перезапустить» на вкладке и повторите.'
  },
  {
    icon: <Gamepad2 className="h-5 w-5 text-indigo-400" />,
    title: 'Игровой режим',
    where: 'Настройки → Zapret',
    badge: 'Против лагов',
    badgeVariant: 'outline',
    simple:
      'Замечает запуск игры и выводит её трафик из-под обработки, чтобы обход блокировок не добавлял задержку. Пинг в матче остаётся таким же, как без приложения.',
    features: [
      {
        name: 'Автоопределение игр',
        what: 'Dota 2, CS2, Valorant, Apex, PUBG и другие популярные игры распознаются сами.'
      },
      {
        name: 'Возврат после игры',
        what: 'Как только игра закрыта, обычная обработка включается обратно.'
      }
    ],
    tip: 'Если ваша игра не распозналась, а пинг подрос — временно выключите Zapret на время матча.'
  },
  {
    icon: <Lock className="h-5 w-5 text-st-ok-text" />,
    title: 'Шифрованный DNS',
    where: 'Вкладка «DNS»',
    badge: 'Приватность',
    badgeVariant: 'secondary',
    simple:
      'DNS — это телефонная книга интернета: по названию сайта находит его адрес. Обычно эти запросы видит провайдер и может подменять ответы. Шифрование закрывает их и убирает часть блокировок само по себе.',
    features: [
      {
        name: 'Каталог серверов',
        what: 'Готовые серверы с задержкой рядом: одни открывают нейросети, другие режут рекламу, третьи просто быстрые. Список и адреса обновляются сами, без новой версии программы.'
      },
      {
        name: 'Нейросети по DNS',
        what: 'Проверка, какой сервер открывает ChatGPT, Claude и Gemini именно в вашей сети. Лучший ставится одной кнопкой.'
      },
      {
        name: 'Свой сервер',
        what: 'Добавьте адреса IPv4/IPv6 и шаблон DoH; добавленный можно изменить или удалить.'
      },
      {
        name: 'Применить в системе',
        what: 'Настройка прописывается в систему и работает для всех программ. «Сбросить» возвращает DNS, который стоял до LAZEYKA.'
      },
      {
        name: 'macOS',
        what: 'Шифрование включается профилем: LAZEYKA создаёт его сама и показывает, где установить. Это нужно сделать один раз.'
      }
    ],
    tip: 'В режиме ExitLag всё, что идёт мимо VPN, использует этот DNS — как будто VPN нет.'
  },
  {
    icon: <Gamepad2 className="h-5 w-5 text-st-warn-text" />,
    title: 'ExitLag и оптимизатор',
    where: 'Вкладка «ExitLag», группа «Игры» → «Оптимизатор»',
    badge: 'Для игр',
    badgeVariant: 'outline',
    simple:
      'ExitLag пускает через VPN только выбранные программы (например, игру), остальное работает как обычно. Или наоборот: весь компьютер через VPN, кроме выбранных программ. Оптимизатор подбирает узел с лучшим пингом до игрового сервера.',
    features: [
      { name: 'Список приложений', what: 'Готовые наборы, поиск установленных игр Steam и Epic, выбор из запущенных программ или файлом.' },
      { name: 'Сейчас в сети', what: 'Какие программы из списка выходят в интернет, через VPN или напрямую, и с какой скоростью.' },
      {
        name: 'Оптимизатор',
        what: 'Вставьте строку «connect адрес:порт» из комнаты матча или консоли CS2: программа замерит пинг до сервера напрямую и через каждый узел и подскажет лучший. Для обычного матчмейкинга есть таблица регионов Valve.'
      }
    ]
  },
  {
    icon: <Crosshair className="h-5 w-5 text-st-err-text" />,
    title: 'Перед каткой, твики и стример',
    where: 'Группа «Игры»',
    badge: 'Для игр',
    badgeVariant: 'outline',
    simple: 'Проверка сети перед матчем, настройки системы против скачков пинга и защита от утечки адресов на трансляции.',
    features: [
      { name: 'Перед каткой', what: 'За полминуты проверяет пинг, потери и Wi-Fi и говорит, можно ли играть. После игры показывает отчёт.' },
      { name: 'Твики', what: 'Настройки Windows, которые убирают лишние задержки. У каждой написано, что она делает; всё возвращается одной кнопкой.' },
      { name: 'Режим стримера', what: 'Размывает IP, названия серверов и ссылки подписок, чтобы зрители их не увидели. Может включаться сам при запуске OBS.' },
      {
        name: 'Stream Deck и другие пульты',
        what: 'Кнопки Elgato Stream Deck, Fifine и других пультов включают VPN, Zapret, Telegram-прокси, ExitLag, мини-окно и ваши сценарии. Страница «Стример».'
      }
    ]
  },
  {
    icon: <Stethoscope className="h-5 w-5 text-cyan-400" />,
    title: 'Диагностика',
    where: 'Группа «Сеть» → «Диагностика»',
    badge: 'Проверка',
    badgeVariant: 'outline',
    simple: 'Всё, что помогает понять, почему не открывается сайт: проверка сайтов, утечки IP и DNS, каналы Wi-Fi, сети с белыми списками.',
    features: [
      { name: 'Проверка сайтов', what: 'Открывает страницу в скрытом окне и проверяет каждый её адрес: где висит, что это (блокировка, фильтр DNS или медленный сервер) и помогает ли Zapret или VPN.' },
      { name: 'Утечки IP и DNS', what: 'Показывает, что видит сеть снаружи при включённом обходе или VPN, и подсказывает, где утечка.' }
    ]
  },
  {
    icon: <Network className="h-5 w-5 text-st-info-text" />,
    title: 'Локальная сеть',
    where: 'Группа «Сеть» → «Локальная сеть»',
    badge: 'Другие устройства',
    badgeVariant: 'outline',
    simple: 'Пульт на телефоне, прокси для телевизора, приставки и телефона, раздача Wi-Fi с компьютера. По шагам — в блоке «Локальная сеть: телевизор, приставка, телефон» выше.',
    features: [
      { name: 'Пульт с телефона', what: 'Откройте по QR-коду, чтобы управлять службами, узлами, DNS и сценариями. Проверка телефона показывает, использует ли его браузер прокси ПК.' },
      { name: 'По порту', what: 'Компьютер принимает HTTP и SOCKS5 на одном порту. Введите адрес на нужном устройстве и проверьте доступ через прокси.' },
      { name: 'Общий Wi-Fi', what: 'Проверка маршрута через компьютер. Чтобы трафик устройств шёл через ПК, настройте шлюз на роутере или на устройстве.' },
      { name: 'Раздать Wi-Fi', what: 'Компьютер с Windows создаёт свою сеть Wi-Fi для устройств, где прокси не настроить.' }
    ],
    tip: 'По умолчанию раздел выключен. При включении компьютер слушает только адреса домашней сети; для чужой сети задайте пароль прокси в настройках раздела.'
  },
  {
    icon: <MessageSquare className="h-5 w-5 text-primary" />,
    title: 'Связь с автором',
    where: 'Вкладка «Поддержка» и колокольчик в шапке окна',
    badge: 'Обратная связь',
    badgeVariant: 'outline',
    simple: 'Отчёт о проблеме и идеи отправляются прямо из программы, без Telegram и почты. Ответы, объявления и предупреждения автора приходят в колокольчик.',
    features: [
      { name: 'Отчёт в поддержку', what: 'Выберите, что случилось, опишите своими словами и при желании приложите журнал. Перед отправкой виден весь текст, адреса и ключи в нём скрыты.' },
      { name: 'Предупреждения', what: 'Важное сообщение от автора показывается плашкой вверху окна, пока вы не нажмёте «Понятно».' },
      {
        name: 'Сбор на развитие',
        what: 'Полоска показывает, сколько собрано. После перевода нажмите «Я отправил пожертвование»: автор сверит его и добавит ваш ник на стену благодарностей.'
      }
    ],
    tip: 'Пожертвования необязательны и ни на что в программе не влияют: все функции доступны всем.'
  },
  {
    icon: <Sparkles className="h-5 w-5 text-primary" />,
    title: 'Сценарии и горячие клавиши',
    where: 'Вкладка «Сценарии», «Настройки» → «Горячие клавиши»',
    badge: 'Удобство',
    badgeVariant: 'outline',
    simple:
      'Сценарий включает нужное одной кнопкой: например «Игры» — Zapret со своей стратегией, ExitLag для игры и VPN с выбранным узлом. Горячие клавиши включают и выключают VPN, Zapret и Telegram из любой программы.',
    features: [
      { name: 'Сценарии', what: 'Каждый пункт можно оставить как есть, включить или выключить; для Zapret — выбрать стратегию, для VPN — узел, для DNS — сервер.' },
      { name: 'Горячие клавиши', what: 'Нажмите «Назначить» и зажмите сочетание — клавиши подсветятся на экране. Можно назначить клавишу любому сценарию, переключению ExitLag, переходу на лучший узел и перезапуску Zapret. Звук подтверждает срабатывание — удобно в полноэкранной игре.' },
      { name: 'Ограничение', what: 'Сочетание должно содержать обычную клавишу (букву, цифру, F1–F24): одни Alt + Shift система как горячую клавишу не регистрирует.' }
    ]
  },
  {
    icon: <BarChart2 className="h-5 w-5 text-cyan-400" />,
    title: 'Скорость и «Ничего не открывается»',
    where: 'Главная',
    badge: 'Проверка',
    badgeVariant: 'outline',
    simple:
      'Тест скорости как у всех спидтестов: через VPN, если он подключён, иначе напрямую; сервис на выбор — Яндекс, Speedtest или Cloudflare. Мастер «Ничего не открывается» по шагам проверяет интернет, DNS, сайты и VPN и предлагает исправление.',
    features: [
      { name: 'Исправить и откатить', what: 'Без вашего нажатия мастер ничего не меняет, а у изменений есть кнопка «Откатить».' },
      { name: 'Полный замер', what: 'По умолчанию расход трафика ограничен; «Полный замер» снимает лимит.' }
    ]
  },
  {
    icon: <Bot className="h-5 w-5 text-st-warn-text" />,
    title: 'Автообновление ядер и списков',
    where: 'Работает в фоне',
    badge: 'Автоматически',
    badgeVariant: 'outline',
    simple:
      'Приложение само подтягивает свежие версии рабочих компонентов и списки заблокированных адресов. Ничего нажимать не нужно.',
    features: [
      {
        name: 'Мелкие обновления ставятся сами',
        what: 'Исправления безопасности и багов применяются молча.'
      },
      {
        name: 'Крупные — только с вашего согласия',
        what: 'Большое обновление сначала показывается, потому что может изменить поведение. Приложение проверяет новый файл до замены рабочего и хранит старый на случай отката.'
      },
      {
        name: 'Гео-списки RoscomVPN',
        what: 'Списки российских адресов и заблокированных сервисов обновляются каждый день.'
      }
    ]
  },
  {
    icon: <BarChart2 className="h-5 w-5 text-cyan-400" />,
    title: 'Статистика трафика',
    where: 'INCY Proxy → «Статистика»',
    badge: 'Учёт',
    badgeVariant: 'outline',
    simple:
      'Сколько данных прошло через VPN за сессию и за всё время, сколько вы были подключены и график по дням недели.',
    features: [
      { name: 'Текущая сессия', what: 'Отправлено и получено с момента подключения.' },
      { name: 'Всего', what: 'Накопительный итог. Сохраняется между запусками приложения.' },
      { name: 'За неделю', what: 'Столбик на каждый день — видно, когда трафика было больше.' },
      { name: 'Сброс', what: 'Отдельно за сегодня и отдельно всё сразу.' }
    ],
    tip: 'Счёт байтов ведёт ядро sing-box. В режимах, где работает только Xray, считаются время и число подключений, а байты — нет; об этом написано прямо на вкладке.'
  },
  {
    icon: <Download className="h-5 w-5 text-teal-400" />,
    title: 'Резервная копия',
    where: 'INCY Proxy → «Бэкап»',
    badge: 'Перенос настроек',
    badgeVariant: 'outline',
    simple:
      'Сохраняет подписку, серверы, правила и настройки в один файл. Пригодится при переустановке Windows или переезде на другой компьютер.',
    features: [
      { name: 'Экспортировать', what: 'Выбираете, куда положить файл.' },
      {
        name: 'Восстановить',
        what: 'Сначала показывается, что внутри файла, и вы отмечаете, что именно применить. Ничего не заменяется без вашего подтверждения.'
      },
      {
        name: 'Скопировать ссылку',
        what: 'Короткая ссылка с подпиской и настройками — можно открыть на другом компьютере с LAZEYKA.'
      }
    ],
    tip: 'Логин и пароль локального прокси в файл не попадают — на новом компьютере они создаются заново.'
  },
  {
    icon: <LinkIcon className="h-5 w-5 text-pink-400" />,
    title: 'Ссылки-команды',
    where: 'INCY Proxy → «URL-схемы»',
    badge: 'Для ярлыков',
    badgeVariant: 'outline',
    simple:
      'Управление приложением по ссылке. Можно сделать ярлык на рабочем столе, который включает VPN одним двойным щелчком.',
    features: [
      { name: 'lazeyka://connect', what: 'Включить VPN.' },
      { name: 'lazeyka://disconnect', what: 'Выключить VPN.' },
      { name: 'lazeyka://toggle', what: 'Переключить: включить, если выключен, и наоборот.' },
      { name: 'lazeyka://import/…', what: 'Добавить подписку или сервер по ссылке.' }
    ],
    tip: 'Рядом с каждой командой есть кнопка «Проверить» — она откроет ссылку так же, как это сделал бы ярлык.'
  },
  {
    icon: <ScrollText className="h-5 w-5 text-slate-400" />,
    title: 'Логи',
    where: 'Вкладка «Логи»',
    badge: 'Если что-то сломалось',
    badgeVariant: 'outline',
    simple:
      'Подробная запись того, что делает приложение. Самое полезное место, когда нужно понять причину — и то, что стоит приложить к обращению в поддержку.',
    features: [
      { name: 'Копировать / Экспорт', what: 'Забрать текст в буфер или сохранить файлом.' },
      { name: 'Очистить', what: 'Стереть накопленное, чтобы записать проблему заново с чистого листа.' }
    ],
    tip: 'Перед обращением в поддержку: очистите логи, повторите проблему, скопируйте и приложите.'
  },
  {
    icon: <Wrench className="h-5 w-5 text-orange-400" />,
    title: 'Настройки приложения',
    where: 'Вкладка «Настройки»',
    badge: 'Внешний вид и запуск',
    badgeVariant: 'outline',
    simple: 'Поведение самой программы: автозапуск, трей, горячие клавиши, звуки, мини-окно. Внешний вид — на вкладке «Оформление».',
    features: [
      { name: 'Звуки', what: 'Общая громкость и отдельно: сценарии и горячие клавиши, сообщения автора, сигнал о лагах. На звук игры и Discord не влияет.' },
      {
        name: 'Мини-окно поверх игры',
        what: 'Маленькое окно с переключателями или только точки включённых функций. Это обычное окно поверх остальных: в игру оно не встраивается.'
      },
      { name: 'Статус в Discord', what: 'Строка «Играет в LAZEYKA» в профиле Discord. Выключается тем же переключателем.' },
      { name: 'Автозапуск', what: 'Запускать LAZEYKA при входе в систему (Windows или macOS), можно без окна.' },
      { name: 'Иконка в трее', what: 'Приложение остаётся работать в трее у часов.' },
      { name: 'Горячие клавиши', what: 'Включение VPN, Zapret и Telegram из любой программы.' },
      { name: 'Проверять обновления', what: 'Сообщать о новых версиях; если GitHub тормозит, обновление скачается с зеркала SourceForge.' }
    ]
  },
  {
    icon: <Rocket className="h-5 w-5 text-pink-400" />,
    title: 'Оформление',
    where: 'Вкладка «Оформление»',
    badge: 'Внешний вид',
    badgeVariant: 'outline',
    simple: 'Тема, цвета, готовые пресеты, свой фон (картинка или анимация) с размытием и затемнением — с живым предпросмотром.',
    features: [
      { name: 'Свой фон', what: 'Размытие и затемнение действуют только на фон, интерфейс остаётся чётким.' },
      { name: 'Галерея тем', what: 'Темы других людей ставятся одним нажатием, своей можно поделиться. Каждая тема проходит проверку автора перед публикацией.' }
    ]
  }
]

/** Три шага для того, кто открыл приложение впервые. Это последовательность, поэтому с номерами. */
const QUICK_START: { step: string; title: string; text: string; go: string; goLabel: string }[] = [
  {
    step: '1',
    title: 'Включите Zapret',
    text: 'Вкладка «Zapret» → большая кнопка. Проверьте нужный сайт. Не открылся — нажмите «Подобрать автоматически» и подождите пару минут.',
    go: '/zapret',
    goLabel: 'Открыть Zapret'
  },
  {
    step: '2',
    title: 'Не хватило — добавьте VPN',
    text: 'Вкладка «INCY Proxy» → «Сервера» → вставьте ссылку на подписку или нажмите «Из буфера». Выберите сервер с зелёным пингом и нажмите «Подключить».',
    go: '/incy',
    goLabel: 'Открыть INCY Proxy'
  },
  {
    step: '3',
    title: 'Тормозит Telegram — включите его прокси',
    text: 'Вкладка «Telegram» → кнопка подключения. Она сама пропишет настройки в мессенджере.',
    go: '/telegram',
    goLabel: 'Открыть Telegram'
  }
]

const FAQ: { q: string; a: React.ReactNode }[] = [
  {
    q: 'Zapret или VPN — что выбрать?',
    a: 'Начните с Zapret: он не меняет ваш IP и не режет скорость. VPN нужен, когда Zapret не справился или требуется зарубежный IP-адрес.'
  },
  {
    q: 'Можно включить и то, и другое сразу?',
    a: 'Можно, но не нужно: они решают одну задачу разными путями и вместе только запутают диагностику. Включайте по очереди.'
  },
  {
    q: 'Почему приложение просит права администратора?',
    a: 'Zapret работает на уровне сетевого драйвера Windows, а режим TUN создаёт виртуальный сетевой адаптер. Без прав администратора это невозможно.'
  },
  {
    q: 'Интернет пропал после включения',
    a: 'Выключите то, что включали последним. Если не помогло — закройте LAZEYKA полностью: при выходе она снимает системный прокси и останавливает свои процессы.'
  },
  {
    q: 'Где взять подписку для INCY Proxy?',
    a: (
      <>
        Приложение не продаёт доступ и не имеет своих серверов — ссылку на подписку выдаёт продавец VPN, а LAZEYKA работает с ней.
        <VelvetRecommendation className="mt-2" />
      </>
    )
  },
  {
    q: 'Мои данные куда-то отправляются?',
    a: 'Настройки и логи лежат только на вашем компьютере. В сеть программа ходит за обновлениями, к серверу вашей подписки и раз в 30 минут к серверу LAZEYKA за объявлениями и ответами автора, без логов и настроек. Отчёт, идею или тему отправляете только вы сами, кнопкой. Анонимный счётчик «сколько людей онлайн» выключается в «Настройках».'
  }
]

type Tab = 'start' | 'features' | 'faq' | 'devices'
const IDS: Tab[] = ['start', 'features', 'faq', 'devices']
const TABS: PageTab<Tab>[] = [
  { id: 'start', label: 'С чего начать', icon: Rocket, hint: 'Три шага для первого запуска' },
  { id: 'features', label: 'Все функции', icon: BookOpen, hint: `${MODULES.length} разделов: что делает, когда включать, что делать, если не помогло` },
  { id: 'faq', label: 'Вопросы', icon: HelpCircle, hint: 'Частые вопросы о работе программы' },
  { id: 'devices', label: 'Другие устройства', icon: Tv, hint: 'Телевизор, приставка и телефон через компьютер' }
]

/** Значок модуля в списке: одноцветный, горит цветом темы у выбранного. */
const ModIcon: React.FC<{ icon: React.ReactNode; on: boolean }> = ({ icon, on }) => (
  <span
    className={cn(
      'flex size-8 shrink-0 items-center justify-center rounded-xl transition-colors [&_svg]:!size-4 [&_svg]:!text-current',
      on ? 'bg-primary/15 text-primary' : 'bg-foreground/[0.05] text-muted-foreground'
    )}
  >
    {icon}
  </span>
)

const fmt = (n: number): string => n.toLocaleString('ru-RU')

/** Пульт «Информации»: программа, обучение и живой счётчик пользователей. */
const AboutHero: React.FC = () => {
  const navigate = useNavigate()
  const latest = latestTour()
  const [canReset, setCanReset] = useState(hasDismissedHints)
  const [version, setVersion] = useState<string | null>(null)
  const { appConfig } = useAppConfig()
  const stats = useOnlineStore((s) => s.stats)
  const num = useOnlineStore(selectInstallNum)
  const counterOff = appConfig?.onlineStats === false

  useEffect(() => {
    getAppVersion()
      .then((v) => setVersion(v))
      .catch(() => undefined)
  }, [])

  const people = (n: number): string => pluralRu(n, 'человек', 'человека', 'человек')
  const active =
    stats?.active24h != null && stats.active7d != null && stats.active30d != null
      ? `Активны: за сутки ${fmt(stats.active24h)}, за неделю ${fmt(stats.active7d)}, за месяц ${fmt(stats.active30d)}`
      : undefined

  const link = 'inline-flex cursor-pointer items-center gap-1.5 text-[12px] font-medium text-muted-foreground transition-colors hover:text-foreground disabled:cursor-default disabled:opacity-50'

  return (
    <LzHero
      data-tour="about-learning"
      tone="on"
      visual={
        <div className="relative flex size-[120px] shrink-0 items-center justify-center">
          <div
            aria-hidden
            className="lz-breathe pointer-events-none absolute inset-2 rounded-full"
            style={{ background: 'radial-gradient(closest-side, color-mix(in oklab, var(--primary) 28%, transparent), transparent)' }}
          />
          <svg aria-hidden className="absolute inset-0 size-full" viewBox="0 0 120 120">
            {[56, 46].map((r, i) => (
              <circle key={r} cx="60" cy="60" r={r} fill="none" stroke="var(--primary)" strokeOpacity={i ? 0.35 : 0.18} strokeWidth="1" strokeDasharray={i ? undefined : '2 5'} />
            ))}
          </svg>
          <img src={logo} alt="" className="relative size-16 rounded-2xl shadow-lg" />
        </div>
      }
      title={
        <>
          LAZEYKA
          {version && <span className="ml-2 align-middle text-[15px] font-semibold text-muted-foreground tabular-nums">{version}</span>}
        </>
      }
      text="Свободный интернет без блокировок — четыре способа в одной программе. Здесь — что делает каждая функция, когда её включать и что делать, если не помогло."
      extra={
        <>
          <button
            type="button"
            className={link}
            disabled={!canReset}
            onClick={() => {
              resetHints()
              setCanReset(false)
              toast.success('Подсказки снова будут показаны')
            }}
            title={canReset ? 'Снова показать подсказки, которые вы закрыли (например, в «Оформлении»)' : 'Скрытых подсказок нет'}
          >
            <RotateCcw className="size-3.5" /> Сбросить подсказки
          </button>
          <button type="button" className={link} onClick={() => navigate('/support')} title="Отчёт о проблеме или идея — прямо из программы">
            <Headset className="size-3.5" /> Написать автору
          </button>
          <button
            type="button"
            className={cn(link, 'hover:text-st-err-text')}
            onClick={() => {
              navigate('/support')
              let tries = 0
              const look = (): void => {
                const el = document.querySelector<HTMLElement>('[data-tour="support-donations"], [data-tour="support-donate"]')
                if (el) el.scrollIntoView({ block: 'center', behavior: 'smooth' })
                else if (++tries < 20) setTimeout(look, 100)
              }
              setTimeout(look, 50)
            }}
            title="LAZEYKA бесплатна и делается одним человеком. Поддержка любой суммой помогает выпускать новые функции — по желанию, все функции и так доступны всем."
          >
            <Heart className="size-3.5" /> Поддержать проект
          </button>
        </>
      }
      actions={
        <>
          <Button
            size="lg"
            className="h-11 rounded-xl px-5 text-[14px]"
            onClick={() => startIntroTour()}
            title="Экскурсия по всем разделам: программа сама откроет нужные разделы и подсветит, куда нажимать. Закрыть можно в любой момент."
          >
            <Compass className="size-4" /> Знакомство с программой
          </Button>
          {latest && (
            <Button variant="outline" className="h-10 rounded-xl" onClick={() => startTour(latest.version)} title="Программа по шагам покажет новые разделы этой версии">
              <Sparkles className="size-4" /> Что нового в {latest.version}
            </Button>
          )}
        </>
      }
      footer={
        counterOff ? (
          <p className="px-1 text-[12px] text-muted-foreground">Счётчик пользователей выключен в «Настройках».</p>
        ) : stats || num != null ? (
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            {stats?.installs != null && <StatChip icon={<Users />} label="Программу используют" value={<>{fmt(stats.installs)} {people(stats.installs)}</>} />}
            {stats && <StatChip icon={<Activity />} tone="on" label="Сейчас онлайн" value={<LiveNumber value={fmt(stats.online)} />} title={active} />}
            {stats?.peakOnline != null && <StatChip icon={<Trophy />} label="Рекорд онлайна" value={fmt(stats.peakOnline)} />}
            {num != null && <StatChip icon={<UserCheck />} label="Ваш номер установки" value={`#${fmt(num)}`} sensitive="id" title="Каким по счёту вы установили LAZEYKA" />}
          </div>
        ) : undefined
      }
    />
  )
}

/** «Все функции»: список разделов слева, разбор выбранного справа, с поиском. */
const Features: React.FC = () => {
  const navigate = useNavigate()
  const [pick, setPick] = useState(0)
  const [q, setQ] = useState('')
  const needle = q.trim().toLowerCase()
  const list = MODULES.map((m, i) => ({ m, i })).filter(
    ({ m }) => !needle || [m.title, m.where, m.simple, m.badge, ...m.features.flatMap((f) => [f.name, f.what, f.when ?? ''])].join(' ').toLowerCase().includes(needle)
  )
  const cur = list.find((x) => x.i === pick) ?? list[0]
  const mod = cur?.m

  return (
    <div className="grid min-h-[420px] gap-3 md:h-[calc(100vh-420px)] md:grid-cols-[300px_minmax(0,1fr)]">
      <LzPanel className="flex min-h-0 flex-col p-2">
        <div className="relative px-1 pt-1 pb-2">
          <Search className="pointer-events-none absolute top-1/2 left-3.5 size-3.5 -translate-y-[60%] text-muted-foreground" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Найти функцию" className="h-9 rounded-xl pl-8 text-xs" aria-label="Найти функцию" />
        </div>
        <div className="custom-scrollbar min-h-0 flex-1 space-y-0.5 overflow-y-auto pr-0.5">
          {list.length === 0 && <div className="px-3 py-6 text-center text-xs text-muted-foreground">Ничего не нашлось</div>}
          {list.map(({ m, i }) => {
            const on = mod === m
            return (
              <button
                key={m.title}
                type="button"
                onClick={() => setPick(i)}
                className={cn(
                  'relative flex w-full cursor-pointer items-center gap-2.5 rounded-xl px-2 py-1.5 text-left transition-colors',
                  on ? 'bg-primary/10' : 'hover:bg-foreground/[0.04]'
                )}
              >
                {on && <span aria-hidden className="absolute inset-y-1.5 left-0 w-[3px] rounded-r bg-primary" />}
                <ModIcon icon={m.icon} on={on} />
                <span className="min-w-0 flex-1">
                  <span className={cn('block truncate text-[12.5px] font-semibold', on ? 'text-foreground' : 'text-foreground/85')}>{m.title.split(' — ')[0]}</span>
                  <span className="block truncate text-[10.5px] text-muted-foreground">{m.badge}</span>
                </span>
              </button>
            )
          })}
        </div>
      </LzPanel>

      <LzPanel className="flex min-h-0 flex-col">
        {mod ? (
          <div className="custom-scrollbar min-h-0 flex-1 space-y-3 overflow-y-auto p-5">
            <div className="flex items-start gap-3">
              <ModIcon icon={mod.icon} on />
              <div className="min-w-0 flex-1">
                <h3 className="text-[16px] font-bold leading-snug text-[color:var(--text-title)]">{mod.title}</h3>
                <div className="mt-0.5 text-[11.5px] text-muted-foreground">{mod.where}</div>
              </div>
              <span className="shrink-0 rounded-lg bg-primary/12 px-2 py-0.5 text-[11px] font-semibold text-primary">{mod.badge}</span>
            </div>
            <p className="max-w-[70ch] text-[13px] leading-relaxed text-muted-foreground">{mod.simple}</p>

            <div className="divide-y divide-foreground/[0.06] rounded-xl border border-foreground/[0.08] bg-foreground/[0.025]">
              {mod.features.map((f) => (
                <div key={f.name} className="px-3.5 py-2.5">
                  <div className="text-[12.5px] font-semibold text-foreground">{f.name}</div>
                  <p className="mt-0.5 text-[12px] leading-relaxed text-muted-foreground">{f.what}</p>
                  {f.when && (
                    <p className="mt-1 text-[12px] leading-relaxed text-foreground/90">
                      <span className="font-semibold text-primary">Когда: </span>
                      {f.when}
                    </p>
                  )}
                </div>
              ))}
            </div>

            {mod.tip && (
              <div className="flex items-start gap-2 rounded-xl border border-primary/25 bg-primary/[0.06] px-3 py-2.5 text-[12px] leading-relaxed text-foreground/90">
                <Split className="mt-0.5 size-3.5 shrink-0 text-primary" />
                <span>{mod.tip}</span>
              </div>
            )}
            {mod.troubleshoot && (
              <div className="flex items-start gap-2 rounded-xl border border-st-warn/30 bg-st-warn/[0.07] px-3 py-2.5 text-[12px] leading-relaxed text-st-warn-text">
                <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
                <span>
                  <span className="font-semibold">Если не помогло: </span>
                  {mod.troubleshoot}
                </span>
              </div>
            )}
          </div>
        ) : (
          <EmptyState icon={<Search />} title="Ничего не нашлось" text="Попробуйте другое слово: например, «пинг», «DNS» или «сайт»." action={<Button size="sm" variant="outline" onClick={() => setQ('')}>Очистить поиск</Button>} />
        )}
        <div className="flex items-center justify-between gap-3 border-t border-foreground/[0.07] px-5 py-2.5 text-[12px] text-muted-foreground">
          <span>Не нашли ответ? Напишите автору прямо из программы.</span>
          <Button size="sm" variant="outline" className="h-8 text-xs" onClick={() => navigate('/support')}>
            <Headset className="size-3.5" /> Открыть поддержку
          </Button>
        </div>
      </LzPanel>
    </div>
  )
}

const About: React.FC = () => {
  const navigate = useNavigate()
  const [tab, setTab] = usePageTab<Tab>('/about', IDS, 'start')
  const [faq, setFaq] = useState<number | null>(0)

  return (
    <BasePage title="Информация и руководство">
      <PageColumn>
        <AboutHero />
        <PageTabs tabs={TABS} value={tab} onChange={setTab} label="Разделы справки" width="w-[640px]" tour="about-tabs" />

        {tab === 'start' && (
          <>
            <div className="grid gap-3 md:grid-cols-3">
              {QUICK_START.map((s) => (
                <LzPanel key={s.step} className="flex flex-col p-4">
                  <div className="flex items-center gap-2.5">
                    <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-primary/15 text-[12px] font-bold text-primary tabular-nums">{s.step}</span>
                    <span className="text-[14px] font-bold leading-snug text-[color:var(--text-title)]">{s.title}</span>
                  </div>
                  <p className="mt-2 flex-1 text-[12.5px] leading-relaxed text-muted-foreground">{s.text}</p>
                  <Button size="sm" variant="outline" className="mt-3 h-8 self-start text-xs" onClick={() => navigate(s.go)}>
                    {s.goLabel} <ArrowRight className="size-3.5" />
                  </Button>
                </LzPanel>
              ))}
            </div>
            <LzPanel className="flex items-start gap-2.5 px-4 py-3 text-[12.5px] leading-relaxed text-muted-foreground">
              <AlertTriangle className="mt-0.5 size-4 shrink-0 text-st-warn-text" />
              <span>
                Включайте по одному способу за раз и после каждого проверяйте результат. Если запустить всё сразу и что-то сломается, будет непонятно, что именно
                виновато. Сайт всё равно не открывается — проверьте его в{' '}
                <button type="button" className="cursor-pointer font-semibold text-primary hover:underline" onClick={() => navigate('/diagnostics')}>
                  «Диагностике»
                </button>
                .
              </span>
            </LzPanel>
          </>
        )}

        {tab === 'features' && <Features />}

        {tab === 'faq' && (
          <LzPanel className="divide-y divide-foreground/[0.06] px-2 py-1">
            {FAQ.map((item, i) => {
              const open = faq === i
              return (
                <div key={item.q}>
                  <button
                    type="button"
                    aria-expanded={open}
                    onClick={() => setFaq(open ? null : i)}
                    className="flex w-full cursor-pointer items-center gap-3 px-3 py-3 text-left"
                  >
                    <span className={cn('flex size-7 shrink-0 items-center justify-center rounded-xl', open ? 'bg-primary/12 text-primary' : 'bg-foreground/[0.05] text-muted-foreground')}>
                      <HelpCircle className="size-4" />
                    </span>
                    <span className="min-w-0 flex-1 text-[13.5px] font-semibold text-foreground">{item.q}</span>
                    <ChevronDown className={cn('size-4 shrink-0 text-muted-foreground transition-transform duration-200', open && 'rotate-180')} />
                  </button>
                  {open && <div className="max-w-[72ch] px-3 pb-3.5 pl-[52px] text-[12.5px] leading-relaxed text-muted-foreground">{item.a}</div>}
                </div>
              )
            })}
          </LzPanel>
        )}

        {tab === 'devices' && <LanScenariosGuide />}
      </PageColumn>
    </BasePage>
  )
}

export default About
