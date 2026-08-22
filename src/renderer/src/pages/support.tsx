import React from 'react'
import {
  Send,
  UserCheck,
  Heart,
  Coins,
  ExternalLink,
  LifeBuoy,
  MessageSquare,
  Lightbulb,
  Bug,
  ScrollText,
  Copy
} from 'lucide-react'
import { toast } from 'sonner'
import { Card, CardContent, CardHeader, CardTitle } from '@renderer/components/ui/card'
import { Badge } from '@renderer/components/ui/badge'
import BasePage from '@renderer/components/base/base-page'
import { openExternalUrl } from '@renderer/utils/ipc'
import { SUPPORT_TELEGRAM_URL } from '@renderer/lib/utils'

/**
 * Отдельная страница про автора, поддержку и обратную связь.
 *
 * Раньше это был последний блок «Информации» — самой длинной страницы в
 * приложении. Чтобы написать о проблеме, нужно было сначала пролистать всё
 * руководство, и связь с разработчиком выглядела как приписка к справке.
 * Теперь у неё свой пункт в меню: справка отвечает «как это работает»,
 * а эта страница — «что делать, если не работает, и как поддержать».
 */

const FEEDBACK_KINDS: { icon: React.ReactNode; title: string; text: string }[] = [
  {
    icon: <Bug className="size-4 text-rose-500" />,
    title: 'Что-то не работает',
    text: 'Опишите, что делали и что получилось вместо ожидаемого. Приложите логи со вкладки «Логи» — по ним причина видна почти всегда.'
  },
  {
    icon: <Lightbulb className="size-4 text-amber-500" />,
    title: 'Есть идея',
    text: 'Расскажите, какой задачи вам не хватает в приложении. Предложения читаются все.'
  },
  {
    icon: <MessageSquare className="size-4 text-sky-500" />,
    title: 'Просто вопрос',
    text: 'Не разобрались с настройкой или не поняли, что выбрать — спрашивайте, это нормально.'
  }
]

const Support: React.FC = () => {
  const handle = SUPPORT_TELEGRAM_URL.replace(/^https?:\/\//, '')

  return (
    <BasePage title="Автор и поддержка">
      <div className="px-4 pb-8 space-y-5 max-w-3xl mx-auto">
        {/* Автор */}
        <Card className="cyber-card border-primary/40 bg-gradient-to-br from-card via-card to-primary/5">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-bold flex items-center gap-2">
              <UserCheck className="size-4 text-primary" />
              Создатель проекта
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center gap-3">
              <div className="size-11 rounded-2xl bg-primary/20 border border-primary/40 flex items-center justify-center font-bold text-base text-primary shadow-[0_0_14px_rgba(99,102,241,0.3)] font-mono">
                R
              </div>
              <div>
                <div className="font-bold text-sm text-foreground flex items-center gap-2">
                  reb0oorn
                  <Badge
                    variant="outline"
                    className="text-[10px] px-2 py-0 font-mono text-primary border-primary/40 bg-primary/10"
                  >
                    Author
                  </Badge>
                </div>
                <div className="text-[11px] text-muted-foreground font-mono">
                  Lead Developer &amp; Project Creator
                </div>
              </div>
            </div>

            <p className="text-[11px] text-muted-foreground leading-relaxed pt-1 border-t border-border/40">
              LAZEYKA развивается силами одного человека и распространяется бесплатно. Приложение
              не продаёт доступ к VPN и не имеет своих серверов — оно только помогает работать с
              теми, что у вас уже есть.
            </p>
          </CardContent>
        </Card>

        {/* Поддержка и обратная связь */}
        <Card className="cyber-card border-primary/40">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-bold flex items-center gap-2">
              <LifeBuoy className="size-4 text-primary" />
              Поддержка: жалобы, вопросы, предложения
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-[11px] text-muted-foreground leading-relaxed">
              Официальный канал поддержки LAZEYKA в Telegram. Пишите туда по любому поводу,
              связанному с приложением.
            </p>

            <div className="space-y-2">
              {FEEDBACK_KINDS.map((k) => (
                <div
                  key={k.title}
                  className="flex items-start gap-2.5 p-2.5 rounded-lg border border-border/50 bg-card/40"
                >
                  <span className="shrink-0 mt-px">{k.icon}</span>
                  <div className="min-w-0">
                    <div className="text-xs font-semibold text-foreground">{k.title}</div>
                    <div className="text-[11px] text-muted-foreground leading-relaxed mt-0.5">
                      {k.text}
                    </div>
                  </div>
                </div>
              ))}
            </div>

            <button
              type="button"
              onClick={() => openExternalUrl(SUPPORT_TELEGRAM_URL)}
              className="group w-full cursor-pointer inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-xs font-semibold bg-gradient-to-r from-primary/20 via-primary/15 to-primary/20 text-primary border border-primary/40 hover:border-primary/70 shadow-[0_0_12px_rgba(99,102,241,0.15)] hover:shadow-[0_0_18px_rgba(99,102,241,0.3)] transition-all duration-200 active:scale-[0.98]"
            >
              <LifeBuoy className="size-4 group-hover:scale-110 transition-transform" />
              <span>Открыть поддержку LAZEYKA в Telegram</span>
              <ExternalLink className="size-3 opacity-70" />
            </button>

            {/* Адрес текстом: если кнопка почему-то не откроет браузер, его
                можно скопировать и вбить вручную. */}
            <button
              type="button"
              onClick={() => {
                navigator.clipboard.writeText(SUPPORT_TELEGRAM_URL)
                toast.success('Ссылка скопирована')
              }}
              className="w-full cursor-pointer inline-flex items-center justify-center gap-1.5 text-[11px] font-mono text-muted-foreground/80 hover:text-foreground transition-colors"
            >
              {handle}
              <Copy className="size-3" />
            </button>

            <div className="flex items-start gap-2 p-2.5 rounded-lg border border-border/50 bg-card/40 text-[11px] text-muted-foreground leading-relaxed">
              <ScrollText className="size-3.5 mt-px shrink-0 text-primary" />
              <span>
                Перед обращением: откройте вкладку «Логи», нажмите «Очистить», повторите проблему и
                нажмите «Копировать». Приложите этот текст к сообщению — так причину найдут в разы
                быстрее.
              </span>
            </div>
          </CardContent>
        </Card>

        {/* Донаты */}
        <Card className="cyber-card">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-bold flex items-center gap-2">
              <Heart className="size-4 text-rose-700 dark:text-rose-500 fill-rose-500/20" />
              Поддержать развитие проекта
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-[11px] text-muted-foreground leading-relaxed">
              Это не обязательно и ни на что в приложении не влияет: все функции доступны всем и
              всегда. Но если LAZEYKA оказалась полезной — любая сумма помогает продолжать.
            </p>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              <button
                type="button"
                onClick={() => openExternalUrl('https://www.donationalerts.com/r/reb0oorn')}
                className="group cursor-pointer inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-xs font-semibold bg-gradient-to-r from-amber-500/15 via-orange-500/15 to-red-500/15 text-amber-700 dark:text-amber-400 hover:text-amber-300 border border-amber-500/30 hover:border-amber-500/60 shadow-[0_0_12px_rgba(245,158,11,0.15)] hover:shadow-[0_0_18px_rgba(245,158,11,0.3)] transition-all duration-200 active:scale-95"
              >
                <Coins className="size-4 group-hover:scale-110 transition-transform" />
                <span>DonationAlerts</span>
                <ExternalLink className="size-3 opacity-70" />
              </button>

              <button
                type="button"
                onClick={() => openExternalUrl('https://t.me/send?start=IVCka2D1cl42')}
                className="group cursor-pointer inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-xs font-semibold bg-gradient-to-r from-sky-500/15 via-blue-500/15 to-indigo-500/15 text-sky-700 dark:text-sky-400 hover:text-sky-300 border border-sky-500/30 hover:border-sky-500/60 shadow-[0_0_12px_rgba(14,165,233,0.15)] hover:shadow-[0_0_18px_rgba(14,165,233,0.3)] transition-all duration-200 active:scale-95"
              >
                <Send className="size-4 group-hover:scale-110 transition-transform" />
                <span>CryptoBot в Telegram</span>
                <ExternalLink className="size-3 opacity-70" />
              </button>
            </div>
          </CardContent>
        </Card>
      </div>
    </BasePage>
  )
}

export default Support
