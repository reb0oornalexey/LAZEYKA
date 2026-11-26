import { TelegramBrandIcon } from '@renderer/components/service-icons'
import { QRCodeSVG } from 'qrcode.react'
import type { LanTelegramLinks } from '@renderer/utils/lan-api'
import { CopyButton, Notice } from './common'

/**
 * Блок «Telegram» для раздачи: Telegram на телефоне не использует прокси Wi-Fi, прокси нужно добавить в самом приложении.
 * Кнопки-ссылки tg://socks и https://t.me/socks, QR на ту же ссылку и подпись.
 */
export function TelegramBlock({
  links,
  title = 'Telegram',
  hint,
  authRequired,
  tour
}: {
  links: LanTelegramLinks
  title?: string
  hint: string
  authRequired: boolean
  tour: string
}): React.ReactElement {
  return (
    <div data-tour={tour} className="space-y-3 rounded-xl border border-foreground/[0.08] bg-foreground/[0.03] p-3">
      <div className="flex items-center gap-2 text-sm font-black">
        <span className="flex size-7 items-center justify-center rounded-lg bg-[#29a9eb]/15 text-[#29a9eb]">
          <TelegramBrandIcon className="size-4" />
        </span>
        {title}
      </div>
      <div className="flex flex-col items-center gap-4 md:flex-row">
        <div data-sensitive="qr" className="shrink-0 rounded-xl bg-white p-2.5">
          <QRCodeSVG value={links.tg} size={120} level="M" />
        </div>
        <div className="min-w-0 flex-1 space-y-2">
          <p className="text-xs leading-relaxed">{hint}</p>
          <p className="text-[11px] leading-relaxed text-muted-foreground">
            Наведите камеру телефона на этот QR (или откройте ссылку на телефоне): Telegram предложит подключить прокси.
            {authRequired ? ' Логин и пароль уже есть в ссылке.' : ''}
          </p>
          <div className="flex flex-wrap gap-2">
            <a
              href={links.tg}
              target="_blank"
              rel="noreferrer"
              className="inline-flex h-8 items-center rounded-md border border-border px-3 text-xs font-semibold hover:bg-foreground/[0.06]"
            >
              Ссылка tg://
            </a>
            <a
              href={links.https}
              target="_blank"
              rel="noreferrer"
              className="inline-flex h-8 items-center rounded-md border border-border px-3 text-xs font-semibold hover:bg-foreground/[0.06]"
            >
              Ссылка t.me
            </a>
            <CopyButton text={links.https} label="Скопировать ссылку" />
          </div>
        </div>
      </div>
      {authRequired && (
        <Notice tone="info">В ссылке есть логин и пароль прокси: не отправляйте её посторонним. Страница для телефона по QR раздачи пароль не содержит.</Notice>
      )}
    </div>
  )
}
