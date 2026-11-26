import React, { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowRight, Gamepad2, Info, Smartphone, Tv, Wifi } from 'lucide-react'
import { Button } from '@renderer/components/ui/button'
import { LzPanel, LzSectionHead, Segmented } from '@renderer/components/lz'
import { cn } from '@renderer/lib/utils'

/**
 * «Локальная сеть: телевизор, приставка, телефон» для страницы «Информация».
 * Тексты сверены с разделом «Локальная сеть» (components/lan/*, main/core/lan-*.ts):
 * прокси HTTP и SOCKS5 на одном порту (по умолчанию 20901), пульт по QR (порт 20900),
 * Точка доступа Wi-Fi доступна на Windows. Результат подключения зависит от маршрута.
 */

interface Scenario {
  id: string
  icon: React.ComponentType<{ className?: string }>
  tab: string
  title: string
  text: string
  steps: string[]
  note?: string
}

const SCENARIOS: Scenario[] = [
  {
    id: 'tv',
    icon: Tv,
    tab: 'Телевизор',
    title: 'YouTube на телевизоре через компьютер',
    text: 'Приложения телевизора обычно не смотрят на системный прокси, поэтому на Android TV (и Google TV) ставят приложение, которое заворачивает весь трафик телевизора в прокси компьютера. После настройки проверьте доступ через прокси на компьютере и на самом телевизоре.',
    steps: [
      'На компьютере откройте «Локальная сеть» и включите раздел. На вкладке «По порту» появятся адрес компьютера и порт (по умолчанию 20901).',
      'На телевизоре поставьте приложение-клиент прокси, например v2rayNG или Hiddify (из магазина приложений или файлом APK).',
      'Добавьте в нём сервер вручную: тип SOCKS5, адрес и порт из LAZEYKA. Если в настройках раздела задан пароль, впишите логин и пароль.',
      'Включите подключение, запустите проверку YouTube в «По порту» и откройте ролик на телевизоре.'
    ],
    note: 'У Samsung, LG и многих других телевизоров нет ни поля прокси, ни таких приложений. Для них подходит «Раздать Wi-Fi» (вкладка Wi-Fi в «Локальной сети»).'
  },
  {
    id: 'phone',
    icon: Smartphone,
    tab: 'Телефон',
    title: 'Пульт и прокси на телефоне',
    text: 'Телефон в том же Wi-Fi, что и компьютер, становится пультом: включает Zapret, VPN, Telegram-прокси и ExitLag, меняет сервер VPN и DNS, запускает сценарии. Удобно, когда компьютер в другой комнате или открыта игра на весь экран.',
    steps: [
      'Включите раздел «Локальная сеть» и отсканируйте камерой телефона QR с вкладки «Пульт».',
      'Пульт можно добавить на экран «Домой»: он откроется как обычное приложение.',
      'Чтобы браузер телефона шёл через компьютер: настройки Wi-Fi → ваша сеть → прокси «Вручную», адрес и порт из LAZEYKA.',
      'В пульте откройте «Подключение» → «Проверить этот телефон», чтобы проверить браузер. Для Telegram на вкладке «По порту» есть отдельная кнопка добавления прокси.'
    ],
    note: 'Если на телефоне включён VPN, пульт может не открыться: разрешите в VPN-приложении доступ к локальной сети или выключите VPN на время.'
  },
  {
    id: 'console',
    icon: Gamepad2,
    tab: 'Приставка',
    title: 'Игровая приставка',
    text: 'PlayStation 5 умеет работать через прокси: через компьютер пойдут магазин, браузер и системные запросы приставки. Сами игры по сети соединяются напрямую.',
    steps: [
      'На компьютере включите раздел «Локальная сеть» и посмотрите адрес и порт на вкладке «По порту».',
      'На PS5: Настройки → Сеть → Настройки → «Установить соединение с интернетом» → ваша сеть → «Настроить вручную».',
      'В пункте «Прокси-сервер» выберите «Использовать», впишите адрес и порт, затем нажмите «Проверить подключение к Интернету».'
    ],
    note: 'PlayStation не поддерживает пароль для прокси, поэтому для неё пароль в настройках раздела лучше не задавать. У Xbox и Nintendo Switch настройки прокси нет: используйте «Раздать Wi-Fi».'
  },
  {
    id: 'hotspot',
    icon: Wifi,
    tab: 'Раздать Wi-Fi',
    title: 'Если устройство не настраивается',
    text: 'Компьютер с Windows создаёт свою сеть Wi-Fi, и телевизор или приставка подключаются к ней как к обычному роутеру. Ничего настраивать на устройстве не нужно.',
    steps: [
      '«Локальная сеть» → вкладка «Wi-Fi» → включите и подключите устройство к появившейся сети (имя и пароль там же, есть QR).',
      'Если используете INCY, проверьте доступ на подключённом устройстве с включённым TUN.',
      'Для проверки браузера используйте пульт. Подключение к точке доступа и работа Zapret на компьютере сами по себе не подтверждают доступ с другого устройства.'
    ],
    note: 'Только Windows 10 и 11 и только если сетевая карта это умеет. На Mac раздачи Wi-Fi нет: используйте прокси.'
  }
]

export const LanScenariosGuide: React.FC<{ className?: string }> = ({ className }) => {
  const navigate = useNavigate()
  const [tab, setTab] = useState(SCENARIOS[0].id)
  const s = SCENARIOS.find((x) => x.id === tab) ?? SCENARIOS[0]
  const Icon = s.icon

  return (
    <LzPanel className={cn('p-4', className)} data-tour="about-lan">
      <LzSectionHead
        title="Телевизор, приставка, телефон"
        hint="Компьютер с LAZEYKA может делиться обходом блокировок с другими устройствами дома и служить для них пультом. Раздел по умолчанию выключен; устройства должны быть в той же сети, а компьютер — включён."
        sub="Как поделиться обходом блокировок с другими устройствами дома"
        right={
          <Button size="sm" variant="outline" className="h-8 gap-1.5 text-xs" onClick={() => navigate('/lan')}>
            Открыть «Локальную сеть» <ArrowRight className="size-3.5" />
          </Button>
        }
      />

      <Segmented
        items={SCENARIOS.map((x) => ({ id: x.id, label: x.tab, icon: x.icon }))}
        value={tab}
        onChange={setTab}
        aria-label="Сценарии"
        className="mt-3 w-full max-w-[560px]"
      />

      <div className="mt-3 grid gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1.25fr)]" role="tabpanel">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-[15px] font-bold text-[color:var(--text-title)]">
            <span className="flex size-8 shrink-0 items-center justify-center rounded-xl bg-primary/12 text-primary">
              <Icon className="size-4" />
            </span>
            {s.title}
          </div>
          <p className="mt-2 text-[12.5px] leading-relaxed text-muted-foreground">{s.text}</p>
          {s.note && (
            <div className="mt-3 flex items-start gap-2 rounded-xl border border-foreground/[0.07] bg-foreground/[0.035] px-3 py-2 text-[11.5px] leading-relaxed text-muted-foreground">
              <Info className="mt-px size-3.5 shrink-0" />
              <span>{s.note}</span>
            </div>
          )}
        </div>
        <ol className="space-y-2">
          {s.steps.map((st, i) => (
            <li key={i} className="flex items-start gap-3 rounded-xl border border-foreground/[0.07] bg-foreground/[0.03] px-3 py-2.5 text-[12px] leading-relaxed text-foreground/90">
              <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-primary/15 text-[10.5px] font-bold text-primary tabular-nums">{i + 1}</span>
              <span>{st}</span>
            </li>
          ))}
        </ol>
      </div>
    </LzPanel>
  )
}
