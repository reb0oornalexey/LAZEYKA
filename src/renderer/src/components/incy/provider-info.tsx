import React from 'react'
import { ExternalLink, Wand2 } from 'lucide-react'
import { Button } from '@renderer/components/ui/button'
import { openExternalUrl, type IncyNode, type IncySettings, type IncySubscription } from '@renderer/utils/ipc'

/** Открывать из приложения можно только http и https. */
export function openHttpLink(url: string | undefined): void {
  if (!url) return
  try {
    const u = new URL(url)
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return
    void openExternalUrl(u.toString()).catch(() => void 0)
  } catch {
    /* битая ссылка — не открываем */
  }
}

/**
 * Что провайдер задаёт для подписки сверх обычных метаданных: описание,
 * ссылка к объявлению, подсказки (фрагментация, шумы, защищённый DNS),
 * сообщение о переносе на новый адрес.
 */
export const SubscriptionProviderInfo: React.FC<{
  sub: IncySubscription
  /** Включён ли пользовательский отказ от подсказок провайдера. */
  hintsIgnored: boolean
}> = ({ sub, hintsIgnored }) => {
  const hasAny = sub.description || sub.announceUrl || sub.hintsText || sub.movedFrom
  if (!hasAny) return null
  return (
    <div className="pt-3 mt-1 border-t border-border/50 space-y-1.5">
      {sub.description && (
        <div className="text-[11px] leading-relaxed text-muted-foreground">{sub.description}</div>
      )}
      {sub.hintsText && (
        <div className="flex items-start gap-2 text-[11px] leading-relaxed text-muted-foreground">
          <Wand2 className="mt-0.5 h-3 w-3 shrink-0" />
          <span>
            Провайдер задаёт: {sub.hintsText}
            {hintsIgnored ? ' (отключено в настройках: «Не применять настройки провайдера»)' : ''}
          </span>
        </div>
      )}
      {sub.movedFrom && (
        <div className="text-[11px] leading-relaxed text-muted-foreground">
          Провайдер перенёс подписку на новый адрес, прежний адрес больше не используется.
        </div>
      )}
      {sub.announceUrl && (
        <Button
          size="sm"
          variant="secondary"
          className="text-xs h-7 gap-1.5 bg-primary/10 hover:bg-primary/20 text-primary border border-primary/30"
          onClick={() => openHttpLink(sub.announceUrl)}
        >
          <ExternalLink className="h-3 w-3" /> Подробнее об объявлении
        </Button>
      )}
    </div>
  )
}

/**
 * Пометка в карточке сервера: фрагментация задана провайдером — либо в самой
 * ссылке узла, либо заголовком подписки (если пользователь не отключил подсказки).
 */
export function nodeHasProviderFragment(node: IncyNode, settings: IncySettings | null | undefined): boolean {
  if (node.fragment && (node.security === 'tls' || node.security === 'reality')) return true
  if (settings?.ignoreProviderSettings) return false
  return Boolean(node.providerHints?.fragment?.enabled)
}

export const NodeProviderFragmentNote: React.FC<{ node: IncyNode; settings: IncySettings | null | undefined }> = ({
  node,
  settings
}) =>
  nodeHasProviderFragment(node, settings) ? (
    <span
      title="Фрагментация этого сервера задана провайдером и включается независимо от общего переключателя."
      className="inline-flex items-center rounded-full border border-primary/30 bg-primary/10 px-1.5 py-px text-[9px] font-medium text-primary cursor-help"
    >
      фрагментация от провайдера
    </span>
  ) : null
