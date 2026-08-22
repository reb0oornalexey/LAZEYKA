import React, { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Shield,
  Send,
  Zap,
  Gamepad2,
  Lock,
  Bot,
  Wrench,
  HelpCircle,
  Sparkles,
  CheckCircle2,
  LifeBuoy,
  ChevronDown,
  Rocket,
  ScrollText,
  Split,
  BarChart2,
  Download,
  Link as LinkIcon,
  AlertTriangle
} from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@renderer/components/ui/card'
import { Badge } from '@renderer/components/ui/badge'
import BasePage from '@renderer/components/base/base-page'
import { cn } from '@renderer/lib/utils'

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
    icon: <Shield className="h-5 w-5 text-emerald-700 dark:text-emerald-400" />,
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
      }
    ],
    tip: 'Zapret работает только на этом компьютере и только для программ на нём. Телефон, приставка и телевизор через него не пойдут.',
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
      }
    ],
    tip: 'Подписка обновляется сама. Если серверы пропали — нажмите обновление на карточке подписки.',
    troubleshoot:
      'Подключилось, но сайты не грузятся — переключите профиль на «Глобально». Не помогло — смените сервер. Совсем ничего — вкладка «Логи», последние строки скажут причину.'
  },
  {
    icon: <Send className="h-5 w-5 text-sky-700 dark:text-sky-400" />,
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
        name: 'QR-код',
        what: 'Тот же прокси для телефона: отсканируйте код в приложении Telegram на смартфоне.',
        when: 'Если телефон в одной сети Wi-Fi с компьютером.'
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
    icon: <Lock className="h-5 w-5 text-emerald-700 dark:text-emerald-400" />,
    title: 'Шифрованный DNS',
    where: 'Настройки → DNS',
    badge: 'Приватность',
    badgeVariant: 'secondary',
    simple:
      'DNS — это телефонная книга интернета: по названию сайта находит его адрес. Обычно эти запросы видит провайдер и может подменять ответы. Шифрование закрывает их и убирает часть блокировок само по себе.',
    features: [
      {
        name: 'Выбор сервера',
        what: 'Cloudflare, Google, Quad9 или Xbox DNS. Рядом с каждым показана задержка — берите самый быстрый.'
      },
      {
        name: 'Применить в системе',
        what: 'Настройка прописывается в Windows и работает для всех программ, а не только для браузера.'
      }
    ],
    tip: 'Иногда одного шифрованного DNS достаточно, чтобы сайт открылся, — попробуйте до включения VPN.'
  },
  {
    icon: <Bot className="h-5 w-5 text-amber-700 dark:text-amber-400" />,
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
    simple: 'Поведение самой программы: тема, автозапуск, трей, язык.',
    features: [
      { name: 'Тема', what: 'Тёмная или светлая.' },
      { name: 'Автозапуск', what: 'Запускать LAZEYKA при входе в Windows.' },
      { name: 'Сворачивать в трей', what: 'При закрытии окна приложение остаётся работать в трее у часов.' },
      { name: 'Проверять обновления', what: 'Сообщать о новых версиях самого приложения.' }
    ]
  }
]

/** Три шага для того, кто открыл приложение впервые. */
const QUICK_START: { step: string; title: string; text: string }[] = [
  {
    step: '1',
    title: 'Включите Zapret',
    text: 'Вкладка «Zapret» → большая кнопка. Проверьте нужный сайт. Не открылся — запустите «Автоподбор стратегии» и подождите пару минут.'
  },
  {
    step: '2',
    title: 'Не хватило — добавьте VPN',
    text: 'Вкладка «INCY Proxy» → «Сервера» → вставьте ссылку на подписку или нажмите «Из буфера». Выберите сервер с зелёным пингом и нажмите «Подключить».'
  },
  {
    step: '3',
    title: 'Тормозит Telegram — включите его прокси',
    text: 'Вкладка «Telegram» → кнопка подключения. Она сама пропишет настройки в мессенджере.'
  }
]

const About: React.FC = () => {
  const navigate = useNavigate()
  const [openId, setOpenId] = useState<number | null>(0)

  return (
    <BasePage title="Информация и руководство">
      <div className="px-4 pb-8 space-y-5 max-w-4xl mx-auto">
        {/* Заголовок */}
        <Card className="cyber-card border-primary/40 bg-gradient-to-br from-card via-card/90 to-primary/10 shadow-xl">
          <CardContent className="p-6 space-y-3">
            <div className="flex items-center gap-3">
              <div className="p-2.5 rounded-2xl bg-primary/20 border border-primary/30 text-primary shadow-[0_0_15px_rgba(99,102,241,0.3)]">
                <Sparkles className="size-6" />
              </div>
              <div>
                <h1 className="text-xl font-bold text-foreground">LAZEYKA</h1>
                <p className="text-xs text-muted-foreground">
                  Свободный интернет без блокировок — четыре способа в одной программе
                </p>
              </div>
            </div>

            <p className="text-xs text-muted-foreground leading-relaxed pt-1">
              Каждый способ решает свою задачу, и они дополняют друг друга. Ниже — что делает
              каждая функция, когда её включать и что делать, если не помогло. Термины
              расшифрованы: специальных знаний не нужно.
            </p>
          </CardContent>
        </Card>

        {/* С чего начать */}
        <Card className="cyber-card border-emerald-500/30 bg-emerald-500/[0.04]">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-bold flex items-center gap-2">
              <Rocket className="size-4 text-emerald-600 dark:text-emerald-400" />
              С чего начать
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2.5">
            {QUICK_START.map((s) => (
              <div key={s.step} className="flex items-start gap-3">
                <span className="shrink-0 size-6 rounded-full bg-emerald-500/15 border border-emerald-500/40 text-emerald-700 dark:text-emerald-400 text-[11px] font-bold flex items-center justify-center">
                  {s.step}
                </span>
                <div className="min-w-0">
                  <div className="text-xs font-bold text-foreground">{s.title}</div>
                  <div className="text-[11px] text-muted-foreground leading-relaxed">{s.text}</div>
                </div>
              </div>
            ))}
            <div className="flex items-start gap-2 pt-2 border-t border-border/40 text-[11px] text-muted-foreground leading-relaxed">
              <AlertTriangle className="size-3.5 mt-px shrink-0 text-amber-600 dark:text-amber-400" />
              <span>
                Включайте по одному способу за раз и после каждого проверяйте результат. Если
                запустить всё сразу и что-то сломается, будет непонятно, что именно виновато.
              </span>
            </div>
          </CardContent>
        </Card>

        {/* Разделы приложения */}
        <div className="space-y-3">
          <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-muted-foreground px-1">
            <HelpCircle className="size-4 text-primary" />
            Все функции приложения
          </div>

          <div className="grid grid-cols-1 gap-2.5">
            {MODULES.map((mod, idx) => {
              const open = openId === idx
              return (
                <Card key={idx} className="cyber-card overflow-hidden">
                  <button
                    type="button"
                    onClick={() => setOpenId(open ? null : idx)}
                    className="w-full text-left cursor-pointer"
                  >
                    <CardHeader className="pb-3">
                      <div className="flex items-start justify-between gap-3">
                        <CardTitle className="text-sm font-bold flex items-start gap-2.5 min-w-0">
                          <span className="shrink-0 mt-px">{mod.icon}</span>
                          <span className="min-w-0">
                            <span className="block">{mod.title}</span>
                            <span className="block text-[11px] font-normal text-muted-foreground mt-0.5">
                              {mod.where}
                            </span>
                          </span>
                        </CardTitle>
                        <div className="flex items-center gap-2 shrink-0">
                          <Badge
                            variant={mod.badgeVariant || 'outline'}
                            className="text-[10px] px-2.5 py-0.5 font-semibold rounded-full border-border/80"
                          >
                            {mod.badge}
                          </Badge>
                          <ChevronDown
                            className={cn(
                              'size-4 text-muted-foreground transition-transform duration-200',
                              open && 'rotate-180'
                            )}
                          />
                        </div>
                      </div>
                    </CardHeader>
                  </button>

                  {open && (
                    <CardContent className="space-y-3 text-xs pt-0">
                      <p className="text-muted-foreground leading-relaxed">{mod.simple}</p>

                      <div className="space-y-2 pt-1">
                        {mod.features.map((f, fIdx) => (
                          <div
                            key={fIdx}
                            className="p-2.5 rounded-lg border border-border/50 bg-card/40"
                          >
                            <div className="flex items-center gap-2 text-[12px] font-semibold text-foreground">
                              <CheckCircle2 className="size-3.5 text-primary shrink-0" />
                              <span>{f.name}</span>
                            </div>
                            <p className="text-[11px] text-muted-foreground leading-relaxed mt-1 pl-5.5">
                              {f.what}
                            </p>
                            {f.when && (
                              <p className="text-[11px] text-primary/90 leading-relaxed mt-1 pl-5.5">
                                Когда: {f.when}
                              </p>
                            )}
                          </div>
                        ))}
                      </div>

                      {mod.tip && (
                        <div className="flex items-start gap-2 p-3 rounded-xl border border-primary/20 bg-primary/5 text-foreground/90 text-[11px] leading-relaxed">
                          <Split className="size-3.5 mt-px shrink-0 text-primary" />
                          <span>{mod.tip}</span>
                        </div>
                      )}

                      {mod.troubleshoot && (
                        <div className="flex items-start gap-2 p-3 rounded-xl border border-amber-500/25 bg-amber-500/[0.07] text-[11px] leading-relaxed text-amber-800 dark:text-amber-300">
                          <AlertTriangle className="size-3.5 mt-px shrink-0" />
                          <span>
                            <span className="font-semibold">Если не помогло: </span>
                            {mod.troubleshoot}
                          </span>
                        </div>
                      )}
                    </CardContent>
                  )}
                </Card>
              )
            })}
          </div>
        </div>

        {/* Частые вопросы */}
        <Card className="cyber-card">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-bold flex items-center gap-2">
              <HelpCircle className="size-4 text-primary" />
              Частые вопросы
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2.5 text-[11px] leading-relaxed">
            {[
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
                a: 'Приложение не продаёт доступ и не имеет своих серверов. Ссылку на подписку выдаёт сторонний продавец VPN — LAZEYKA только работает с ней.'
              },
              {
                q: 'Мои данные куда-то отправляются?',
                a: 'Нет. Настройки и логи лежат только на вашем компьютере. Приложение обращается в сеть за обновлениями и к серверу вашей подписки — больше никуда.'
              }
            ].map((item, i) => (
              <div key={i} className="pb-2.5 border-b border-border/40 last:border-0 last:pb-0">
                <div className="font-semibold text-foreground">{item.q}</div>
                <div className="text-muted-foreground mt-0.5">{item.a}</div>
              </div>
            ))}
          </CardContent>
        </Card>

        {/* Автор и поддержка живут на своей странице — здесь только
            указатель. Раньше это был последний блок самой длинной страницы
            приложения: чтобы написать о проблеме, надо было пролистать всё
            руководство. */}
        <Card className="cyber-card border-primary/40 bg-gradient-to-br from-card via-card to-primary/5">
          <CardContent className="p-4 flex items-center justify-between gap-3 flex-wrap">
            <div className="flex items-center gap-3 min-w-0">
              <div className="p-2 rounded-xl bg-primary/15 border border-primary/30 text-primary shrink-0">
                <LifeBuoy className="size-5" />
              </div>
              <div className="min-w-0">
                <div className="text-sm font-bold text-foreground">Не нашли ответ?</div>
                <div className="text-[11px] text-muted-foreground leading-relaxed">
                  Напишите в поддержку, предложите идею или поддержите автора — всё на отдельной
                  странице «Поддержка» в меню слева.
                </div>
              </div>
            </div>
            <button
              type="button"
              onClick={() => navigate('/support')}
              className="cursor-pointer inline-flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-semibold bg-primary/15 text-primary border border-primary/40 hover:border-primary/70 hover:bg-primary/20 transition-all active:scale-95 shrink-0"
            >
              <LifeBuoy className="size-4" />
              <span>Открыть поддержку</span>
            </button>
          </CardContent>
        </Card>
      </div>
    </BasePage>
  )
}

export default About
