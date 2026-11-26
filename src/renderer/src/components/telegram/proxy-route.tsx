import React from 'react'
import { Cloud, Globe, Server, ShieldCheck } from 'lucide-react'
import { TelegramBrandIcon as TelegramIcon } from '@renderer/components/service-icons'
import { cn } from '@renderer/lib/utils'
import '@renderer/components/lz/lz.css'

/*
 * Путь Telegram в пульте: «Telegram → прокси 127.0.0.1:порт → способ → датацентры».
 * Развитие ProxyPath с Главной: те же бегущие точки (lz-travel), пока прокси
 * работает; выключено — пунктир без движения. Всё из настроек и замера:
 * порт, маршрут (авто / свой Worker), «через VPN INCY», доступные датацентры.
 */

interface Props {
  on: boolean
  busy: boolean
  error: boolean
  address: string
  route: 'auto' | 'worker'
  /** TgWsProxy пущен через VPN INCY и INCY сейчас подключён. */
  viaVpn: boolean
  /** Сколько датацентров отвечает напрямую (null — не замеряли). */
  dcOk: number | null
  dcTotal: number
}

const Link: React.FC<{ on: boolean; busy: boolean }> = ({ on, busy }) => (
  <span
    aria-hidden
    className={cn(
      // Линия — на высоте середины чипа (чип ≈26 px, линия 8 px), а не середины «чип + подпись».
      'mt-[9px] h-2 min-w-3 flex-1 self-start',
      on ? 'lz-travel text-primary' : busy ? 'lz-rail-flow mt-[12px] h-[2px] text-primary/50' : 'border-t border-dashed border-foreground/20'
    )}
  />
)

const Stop: React.FC<{ icon: React.ReactNode; label: React.ReactNode; sub: string; on: boolean; tone?: 'err'; title?: string; strong?: boolean }> = ({
  icon,
  label,
  sub,
  on,
  tone,
  title,
  strong
}) => (
  <span title={title} className="flex min-w-0 shrink-0 flex-col items-center gap-1">
    <span
      className={cn(
        'flex items-center gap-1.5 rounded-lg border px-2 py-1 text-[12px] font-semibold whitespace-nowrap tabular-nums transition-colors duration-300 [&_svg]:size-3.5',
        tone === 'err'
          ? 'border-st-err/40 bg-st-err/10 text-st-err-text'
          : on
            ? strong
              ? 'border-primary/45 bg-primary/15 text-primary'
              : 'border-primary/25 bg-primary/[0.07] text-foreground'
            : 'border-foreground/[0.09] bg-foreground/[0.04] text-muted-foreground'
      )}
    >
      {icon}
      {label}
    </span>
    <span className="text-[10.5px] leading-none text-muted-foreground">{sub}</span>
  </span>
)

export const ProxyRoute: React.FC<Props> = ({ on, busy, error, address, route, viaVpn, dcOk, dcTotal }) => (
  <div data-tour="tg-route-path" className="flex w-full max-w-[560px] items-start gap-1.5">
    <Stop icon={<TelegramIcon className={cn(!on && 'opacity-70 grayscale')} />} label="Telegram" sub="приложение" on={on} />
    <Link on={on} busy={busy} />
    <Stop
      icon={<ShieldCheck />}
      label={address}
      sub="прокси LAZEYKA"
      on={on}
      strong
      tone={error ? 'err' : undefined}
      title={on ? `Telegram подключается к прокси по адресу ${address}` : 'Прокси выключен'}
    />
    <Link on={on} busy={busy} />
    <Stop
      icon={route === 'worker' ? <Cloud /> : <Globe />}
      label={route === 'worker' ? 'Свой Worker' : 'WebSocket'}
      sub={viaVpn ? 'через VPN INCY' : route === 'worker' ? 'Cloudflare' : 'авто'}
      on={on}
      title={
        route === 'worker'
          ? 'Все соединения идут через ваш Cloudflare Worker'
          : 'Прокси соединяется с Telegram через WebSocket; если не вышло — через ваш Worker, затем через общий CF-прокси'
      }
    />
    <Link on={on} busy={busy} />
    <Stop
      icon={<Server />}
      label="Датацентры"
      sub={dcOk === null ? `${dcTotal} шт.` : `напрямую ${dcOk} из ${dcTotal}`}
      on={on}
      title="Серверы Telegram: DC1–DC5. Подробнее — на радаре ниже"
    />
  </div>
)

export default ProxyRoute
