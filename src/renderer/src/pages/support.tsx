import React from 'react'
import { RepliesInbox } from '@renderer/components/hub/replies-inbox'
import { SupportReportCard } from '@renderer/components/hub/support-report-card'
import { IdeaCard } from '@renderer/components/hub/idea-card'
import { AuthorCorner, useAuthorSecretTap } from '@renderer/components/hub/author-panel'
import { DonationsBlock } from '@renderer/components/hub/donations-block'
import { Coins, ExternalLink, Headset, Lightbulb, Bug, Copy, Bell } from 'lucide-react'
import { toast } from 'sonner'
import { LzPanel, LzSectionHead, Segmented } from '@renderer/components/lz'
import { Button } from '@renderer/components/ui/button'
import BasePage from '@renderer/components/base/base-page'
import { openExternalUrl } from '@renderer/utils/ipc'
import { cn, SUPPORT_TELEGRAM_URL } from '@renderer/lib/utils'
import { Hint } from '@renderer/components/prematch/hint'
import { TelegramBrandIcon } from '@renderer/components/service-icons'

/**
 * Отдельная страница про автора, поддержку и обратную связь.
 *
 * Раньше это был последний блок «Информации» — самой длинной страницы в
 * приложении. Чтобы написать о проблеме, нужно было сначала пролистать всё
 * руководство, и связь с разработчиком выглядела как приписка к справке.
 * Теперь у неё свой пункт в меню: справка отвечает «как это работает»,
 * а эта страница — «что делать, если не работает, и как поддержать».
 */

type WriteTab = 'report' | 'idea'
const WRITE_TAB_KEY = 'lz-support-write-tab'

const readTab = (): WriteTab => {
  try {
    return localStorage.getItem(WRITE_TAB_KEY) === 'idea' ? 'idea' : 'report'
  } catch {
    return 'report'
  }
}

const Support: React.FC = () => {
  const authorTap = useAuthorSecretTap()
  const handle = SUPPORT_TELEGRAM_URL.replace(/^https?:\/\//, '')
  const [tab, setTab] = React.useState<WriteTab>(readTab)
  // Есть ли активный сбор: тогда старая карточка с постоянными ссылками не нужна — способы оплаты в сборе.
  const [hasCampaign, setHasCampaign] = React.useState(false)
  const openWrite = (t: WriteTab): void => {
    pickTab(t)
    requestAnimationFrame(() => {
      const el = document.getElementById('support-write')
      el?.scrollIntoView({ behavior: 'smooth', block: 'start' })
      // Курсор сразу в форму: у отчёта — первая плитка вида, у идеи — поле текста.
      window.setTimeout(() => {
        const target = el?.querySelector<HTMLElement>(t === 'idea' ? '[data-write="idea"] textarea' : '[data-write="report"] button')
        target?.focus({ preventScroll: true })
      }, 350)
    })
  }
  const pickTab = (t: WriteTab): void => {
    setTab(t)
    try {
      localStorage.setItem(WRITE_TAB_KEY, t)
    } catch {
      /* хранилище недоступно — просто не запоминаем */
    }
  }

  return (
    <BasePage title="Автор и поддержка">
      <div className="mx-auto flex w-full max-w-[1080px] flex-col lz-page-gap lz-page-x pb-5">
        {/* Сверху — кто делает программу и куда писать: это должно быть видно без прокрутки */}
        <div className="grid gap-3 md:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
          <LzPanel className="flex flex-col p-5">
            <div className="flex items-center gap-3.5">
              <div className="relative flex size-14 shrink-0 items-center justify-center">
                <div
                  aria-hidden
                  className="absolute -inset-2 rounded-full"
                  style={{ background: 'radial-gradient(closest-side, color-mix(in oklab, var(--primary) 22%, transparent), transparent)' }}
                />
                <div className="relative flex size-14 items-center justify-center rounded-2xl border border-primary/40 bg-primary/15 text-[22px] font-extrabold text-primary">R</div>
              </div>
              <div className="min-w-0">
                <div className="text-[12px] text-muted-foreground">Создатель проекта</div>
                <div className="flex items-center gap-2 text-[20px] font-extrabold leading-tight tracking-[-0.01em] text-[color:var(--text-title)]">
                  <span onClick={authorTap} className="select-none">
                    reb0oorn
                  </span>
                  <span className="rounded-md bg-primary px-1.5 py-px text-[10.5px] font-bold text-primary-foreground">Автор</span>
                </div>
                <div className="text-[12px] text-muted-foreground">Разработчик и создатель LAZEYKA</div>
              </div>
            </div>
            <p className="mt-3.5 border-t border-foreground/[0.07] pt-3 text-[12.5px] leading-relaxed text-muted-foreground">
              LAZEYKA делает один человек, программа бесплатна. Она не продаёт VPN и не имеет своих серверов — только помогает работать с теми, что у вас уже
              есть.
            </p>
          </LzPanel>

          {/* Главный путь — написать прямо в программе: ответ придёт в колокольчик */}
          <LzPanel hero tone="on" glow={12} className="flex flex-col p-5" data-tour="support-write-cta">
            <LzSectionHead
              title="Написать автору прямо в программе"
              hint="Отчёт или идея уходят автору напрямую, без Telegram и регистрации. К отчёту можно приложить логи — по ним причину видно почти всегда. Ответ придёт в колокольчик в шапке окна."
            />
            <p className="mt-1 text-[12.5px] leading-relaxed text-muted-foreground">
              Что-то не работает или есть идея — напишите здесь. Автор читает всё сам и отвечает прямо в программе.
            </p>
            <div className="mt-3 grid grid-cols-2 gap-2">
              <Button className="h-11 rounded-xl text-[14px] shadow-[0_0_18px_-6px_var(--primary)]" onClick={() => openWrite('report')}>
                <Bug /> Есть проблема
              </Button>
              <Button variant="outline" className="h-11 rounded-xl text-[14px]" onClick={() => openWrite('idea')}>
                <Lightbulb /> Есть идея
              </Button>
            </div>
            <div className="mt-auto flex items-center gap-1.5 pt-3 text-[12px] text-muted-foreground">
              <Bell className="size-3.5 shrink-0 text-primary" />
              Ответ придёт в колокольчик в шапке окна
            </div>
          </LzPanel>
        </div>

        {/* Сбор — сразу под автором: сумма, полоса и «Поддержать» видны без прокрутки */}
        <div data-tour={hasCampaign ? 'support-donate' : undefined} className="flex flex-col gap-3 empty:hidden">
          <DonationsBlock onLoaded={setHasCampaign} />
        </div>

        <RepliesInbox />

        {/* Написать автору из программы: отчёт или идея — одна карточка с переключателем */}
        <section id="support-write" className="scroll-mt-4 space-y-2.5" data-tour="support-write">
          <div className="flex flex-wrap items-center gap-3">
            <div className="lz-onwall flex items-center gap-1.5 text-[14px] font-bold text-[color:var(--text-title)]">
              Написать автору из программы
              <Hint text="Сообщение уйдёт автору напрямую, без Telegram. Ответ придёт в колокольчик в шапке окна." />
            </div>
            <Segmented
              items={[
                { id: 'report' as WriteTab, label: 'Сообщить о проблеме', icon: Bug },
                { id: 'idea' as WriteTab, label: 'Предложить идею', icon: Lightbulb }
              ]}
              value={tab}
              onChange={pickTab}
              aria-label="Что отправить"
              className="ml-auto w-[380px]"
            />
          </div>
          {/* Обе формы остаются смонтированными: набранный текст не теряется при переключении */}
          <div data-tour="support-report" data-write="report" className={cn(tab !== 'report' && 'hidden')}>
            <SupportReportCard />
          </div>
          <div data-write="idea" className={cn(tab !== 'idea' && 'hidden')}>
            <IdeaCard />
          </div>
        </section>

        {/* Донаты */}
        {!hasCampaign && (
          <LzPanel className="p-4" data-tour="support-donate">
            <LzSectionHead
              title="Поддержать развитие проекта"
              sub="Это не обязательно и ни на что в приложении не влияет: все функции доступны всем и всегда"
            />
            <p className="mt-1 text-[12px] leading-relaxed text-muted-foreground">Если LAZEYKA оказалась полезной — любая сумма помогает продолжать.</p>
            <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
              <Button variant="outline" className="h-10 rounded-xl" onClick={() => openExternalUrl('https://www.donationalerts.com/r/reb0oorn')}>
                <Coins className="size-4" />
                DonationAlerts
                <ExternalLink className="size-3 opacity-70" />
              </Button>
              <Button variant="outline" className="h-10 rounded-xl" onClick={() => openExternalUrl('https://t.me/send?start=IVCka2D1cl42')}>
                <TelegramBrandIcon className="size-4" />
                CryptoBot в Telegram
                <ExternalLink className="size-3 opacity-70" />
              </Button>
            </div>
          </LzPanel>
        )}

        {/* Telegram — запасной путь, если программа не может связаться с сервером */}
        <div
          className="flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-xl border border-foreground/[0.07] bg-foreground/[0.03] px-3.5 py-2.5 text-[12px] text-muted-foreground"
          data-tour="support-telegram"
        >
          <Headset className="size-3.5 shrink-0" />
          <span>Не получается отправить из программы? Есть канал поддержки в Telegram.</span>
          <button
            type="button"
            onClick={() => openExternalUrl(SUPPORT_TELEGRAM_URL)}
            className="inline-flex cursor-pointer items-center gap-1 font-semibold text-foreground/80 hover:text-foreground"
          >
            <TelegramBrandIcon className="size-3.5" />
            Открыть
            <ExternalLink className="size-3 opacity-70" />
          </button>
          <button
            type="button"
            onClick={() => {
              navigator.clipboard.writeText(SUPPORT_TELEGRAM_URL)
              toast.success('Ссылка скопирована')
            }}
            className="inline-flex cursor-pointer items-center gap-1 font-mono hover:text-foreground"
            title="Скопировать ссылку"
          >
            {handle}
            <Copy className="size-3" />
          </button>
        </div>

        <AuthorCorner />
      </div>
    </BasePage>
  )
}

export default Support
