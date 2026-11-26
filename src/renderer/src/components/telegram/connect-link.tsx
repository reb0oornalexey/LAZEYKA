import React from 'react'
import { Popover } from 'radix-ui'
import { Copy, ExternalLink, Smartphone, X } from 'lucide-react'
import { Button } from '@renderer/components/ui/button'
import { TelegramBrandIcon as TelegramIcon } from '@renderer/components/service-icons'

/*
 * Подключение Telegram на этом компьютере: окно по нажатию на адрес прокси в пульте.
 * Главное действие — открыть ссылку tg:// (Telegram сам спросит «Подключить прокси?»),
 * копирование и ручной путь — запасные. Для телефона — переход к окну QR.
 */

interface Props {
  open: boolean
  onOpenChange: (v: boolean) => void
  link: string
  onOpen: () => void
  onCopy: () => void
  onPhone: () => void
  /** Элемент, к которому привязано окно (чип «Адрес прокси»). */
  children: React.ReactNode
}

export const ConnectLink: React.FC<Props> = ({ open, onOpenChange, link, onOpen, onCopy, onPhone, children }) => (
  <Popover.Root open={open} onOpenChange={onOpenChange}>
    <Popover.Anchor asChild>
      <div className="flex">{children}</div>
    </Popover.Anchor>
    <Popover.Portal>
      <Popover.Content
        align="start"
        sideOffset={10}
        collisionPadding={12}
        data-tour="tg-connect-link"
        className="z-[190] w-[460px] max-w-[calc(100vw-24px)] rounded-2xl border border-border bg-popover p-4 text-popover-foreground shadow-2xl outline-none"
      >
        <div className="flex items-start gap-3">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary/12 ring-1 ring-primary/30">
            <TelegramIcon className="size-5" />
          </span>
          <div className="min-w-0 flex-1">
            <div className="text-sm font-bold">Подключить Telegram на этом компьютере</div>
            <p className="mt-0.5 text-[11.5px] leading-relaxed text-muted-foreground">
              Нажмите «Открыть в Telegram» — Telegram спросит «Подключить прокси?», ответьте «Подключить». Больше
              ничего настраивать не нужно.
            </p>
          </div>
          <button
            type="button"
            aria-label="Закрыть"
            onClick={() => onOpenChange(false)}
            className="-mr-1 -mt-1 inline-flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-lg text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <X className="size-4" />
          </button>
        </div>

        <div
          data-sensitive="secret"
          title={link || undefined}
          className="mt-3 truncate rounded-xl border border-border bg-background/40 px-3 py-2 font-mono text-[11.5px] text-foreground/85"
        >
          {link || 'Ссылка появится, когда прокси получит секретный ключ'}
        </div>

        <div className="mt-3 grid grid-cols-2 gap-2">
          <Button className="h-10 rounded-xl text-xs font-bold" disabled={!link} onClick={onOpen}>
            <ExternalLink className="size-4" />
            Открыть в Telegram
          </Button>
          <Button variant="outline" className="h-10 rounded-xl text-xs font-semibold" disabled={!link} onClick={onCopy}>
            <Copy className="size-4" />
            Скопировать ссылку
          </Button>
        </div>

        <div className="mt-3 space-y-1.5 border-t border-border/60 pt-3 text-[11px] leading-relaxed text-muted-foreground">
          <div>
            Не открывается? Вставьте ссылку вручную: Telegram → Настройки → Продвинутые настройки → Тип соединения →
            ⋮ → вставить ссылку.
          </div>
          <button
            type="button"
            onClick={onPhone}
            className="inline-flex cursor-pointer items-center gap-1.5 font-semibold text-primary hover:underline"
          >
            <Smartphone className="size-3.5" />
            Нужно на телефоне — показать QR
          </button>
        </div>
      </Popover.Content>
    </Popover.Portal>
  </Popover.Root>
)

export default ConnectLink
