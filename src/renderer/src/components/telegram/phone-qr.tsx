import React from 'react'
import { Popover } from 'radix-ui'
import { QRCodeSVG } from 'qrcode.react'
import { toast } from 'sonner'
import { Copy, ExternalLink, Loader2, Smartphone, Wifi, X } from 'lucide-react'
import { Button } from '@renderer/components/ui/button'
import { POWER_ON_BANNER_STYLE, cn } from '@renderer/lib/utils'
import { writeClipboard, type TgwsShareInfo } from '@renderer/utils/ipc'

/*
 * Подключение телефона: всплывающее окно с QR. QR нужен только телефону,
 * поэтому в нём всегда ссылка с адресом ПК в Wi-Fi (ссылка на 127.0.0.1
 * телефону бесполезна). Пока доступ для телефона закрыт — одна кнопка,
 * которая его открывает (tgws:enableLan), и размытый «QR» на её месте.
 */

interface Props {
  open: boolean
  onOpenChange: (v: boolean) => void
  share: TgwsShareInfo | null
  enabling: boolean
  onEnable: () => void
  onDisable: () => void
  /** Кнопка, к которой привязано окно. */
  children: React.ReactNode
}

export const PhoneQr: React.FC<Props> = ({ open, onOpenChange, share, enabling, onEnable, onDisable, children }) => {
  const qr = share?.lanLink ?? ''
  const http = share?.httpLanLink ?? ''
  return (
    <Popover.Root open={open} onOpenChange={onOpenChange}>
      <Popover.Trigger asChild>{children}</Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="end"
          sideOffset={10}
          collisionPadding={12}
          data-tour="tg-qr"
          className="z-[190] w-[520px] max-w-[calc(100vw-24px)] rounded-2xl border border-border bg-popover p-4 text-popover-foreground shadow-2xl outline-none"
        >
          <div className="flex items-start gap-5">
            {qr ? (
              <div data-sensitive="qr" className="shrink-0 rounded-2xl bg-white p-3">
                <QRCodeSVG value={qr} size={156} level="M" includeMargin={false} />
              </div>
            ) : (
              <div className="relative flex size-[180px] shrink-0 items-center justify-center overflow-hidden rounded-2xl border border-dashed border-foreground/20 bg-foreground/[0.03]">
                {/* Размытый «QR» на фоне — понятно, что здесь появится код. */}
                <div aria-hidden className="absolute inset-4 grid grid-cols-6 gap-1 opacity-[0.12] blur-[1.5px]">
                  {Array.from({ length: 36 }, (_, i) => (
                    <span key={i} className={cn('rounded-[2px]', (i * 7 + (i % 5)) % 3 ? 'bg-foreground' : 'bg-transparent')} />
                  ))}
                </div>
                <Button className="relative h-10 rounded-xl px-4 text-xs font-bold" disabled={enabling} onClick={onEnable}>
                  {enabling ? <Loader2 className="size-4 animate-spin" /> : <Smartphone className="size-4" />}
                  Показать QR
                </Button>
              </div>
            )}

            <div className="min-w-0 flex-1">
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-2 text-[14px] font-bold text-[color:var(--text-title)]">
                  <Smartphone className="size-4 text-primary" />
                  Telegram на телефоне
                </div>
                <button
                  type="button"
                  aria-label="Закрыть"
                  onClick={() => onOpenChange(false)}
                  className="-mt-1 -mr-1 cursor-pointer rounded-lg p-1 text-muted-foreground hover:bg-foreground/[0.06] hover:text-foreground"
                >
                  <X className="size-4" />
                </button>
              </div>
              <p className="mt-1 text-[12.5px] leading-relaxed text-muted-foreground">
                Наведите камеру телефона на код: Telegram предложит добавить прокси. Телефон должен быть в той же Wi-Fi сети, что и компьютер.
              </p>

              <div className="mt-3 flex items-start gap-2 rounded-xl border border-foreground/[0.08] bg-foreground/[0.035] px-3 py-2 text-[12px] text-muted-foreground">
                <Wifi className="mt-0.5 size-3.5 shrink-0 text-primary" />
                {share?.lanLink ? (
                  <span className="flex-1 leading-relaxed">
                    Адрес ПК в сети:{' '}
                    <span data-sensitive="ip" className="font-semibold text-foreground tabular-nums">
                      {share.lanIp}:{share.port}
                    </span>
                    .{' '}
                    <button type="button" className="cursor-pointer font-semibold text-primary hover:underline" onClick={onDisable}>
                      Закрыть доступ для телефона
                    </button>
                  </span>
                ) : (
                  <span className="flex-1 leading-relaxed">
                    Сейчас прокси работает только для этого ПК. «Показать QR» откроет его для устройств в вашей Wi-Fi сети, Telegram на ПК продолжит работать как раньше.
                  </span>
                )}
              </div>

              {qr && (
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-8 rounded-lg text-xs"
                    onClick={async () => {
                      await writeClipboard(qr)
                      toast.success('tg:// ссылка скопирована', { style: POWER_ON_BANNER_STYLE })
                    }}
                  >
                    <Copy className="size-3.5" />
                    Скопировать tg://
                  </Button>
                  {http && (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-8 rounded-lg text-xs"
                      onClick={async () => {
                        await writeClipboard(http)
                        toast.success('t.me ссылка скопирована', { style: POWER_ON_BANNER_STYLE })
                      }}
                    >
                      <ExternalLink className="size-3.5" />
                      Скопировать t.me/proxy
                    </Button>
                  )}
                </div>
              )}
            </div>
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  )
}

export default PhoneQr
