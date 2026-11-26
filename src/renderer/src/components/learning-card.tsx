import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { Compass, GraduationCap, Heart, RotateCcw, Sparkles } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@renderer/components/ui/card'
import { hasDismissedHints, latestTour, resetHints, startIntroTour, startTour } from '@renderer/lib/tour'

const btn =
  'inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-lg border px-3 text-xs font-semibold transition-colors disabled:cursor-default disabled:opacity-50'

/**
 * Блок «Обучение» на странице «Информация»: повторно пройти знакомство или
 * экскурсию по новому в текущей версии, вернуть скрытые подсказки.
 */
export default function LearningCard(): React.ReactElement {
  const latest = latestTour()
  const [canReset, setCanReset] = useState(hasDismissedHints)
  const navigate = useNavigate()
  const openDonate = (): void => {
    navigate('/support')
    // Страница «Поддержка» ленивая — ждём, пока блок появится, и прокручиваем к нему.
    let tries = 0
    const look = (): void => {
      const el = document.querySelector<HTMLElement>('[data-tour="support-donations"], [data-tour="support-donate"]')
      if (el) el.scrollIntoView({ block: 'center', behavior: 'smooth' })
      else if (++tries < 20) setTimeout(look, 100)
    }
    setTimeout(look, 50)
  }

  return (
    <Card className="cyber-card" data-tour="about-learning">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-sm font-bold">
          <GraduationCap className="size-4 text-primary" />
          Обучение
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-[11px] leading-relaxed text-muted-foreground">
          Программа сама откроет нужные разделы и подсветит, куда нажимать. Интерфейс при этом остаётся рабочим, экскурсию можно закрыть
          в любой момент.
        </p>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => startIntroTour()}
            title="Экскурсия по всем разделам: Zapret, Telegram, VPN, DNS, игры, оформление, связь с автором"
            className={`${btn} border-primary/40 text-primary hover:bg-primary/10`}
          >
            <Compass className="size-3.5" /> Знакомство с программой
          </button>
          {latest && (
            <button
              type="button"
              onClick={() => startTour(latest.version)}
              title="Программа по шагам покажет новые разделы этой версии"
              className={`${btn} border-border text-foreground hover:bg-foreground/[0.06]`}
            >
              <Sparkles className="size-3.5" /> Что нового в версии {latest.version}
            </button>
          )}
          <button
            type="button"
            disabled={!canReset}
            onClick={() => {
              resetHints()
              setCanReset(false)
              toast.success('Подсказки снова будут показаны')
            }}
            title={
              canReset
                ? 'Снова показать подсказки, которые вы закрыли (например, в «Оформлении»)'
                : 'Скрытых подсказок нет'
            }
            className={`${btn} border-border text-muted-foreground hover:bg-foreground/[0.06]`}
          >
            <RotateCcw className="size-3.5" /> Сбросить подсказки
          </button>
        </div>
        <div className="flex items-start gap-2.5 rounded-lg border border-st-err/25 bg-st-err/[0.06] px-3 py-2.5">
          <Heart className="mt-0.5 size-4 shrink-0 fill-st-err/20 text-st-err-text" />
          <div className="min-w-0 flex-1">
            <p className="text-xs font-semibold">Помочь проекту</p>
            <p className="text-[11px] leading-relaxed text-muted-foreground">
              LAZEYKA бесплатна и делается одним человеком. Поддержка любой суммой помогает выпускать новые функции и версию для Mac — по
              желанию, все функции и так доступны всем.
            </p>
          </div>
          <button
            type="button"
            onClick={openDonate}
            title="Открыть «Поддержку»: текущий сбор, цель и способы помочь"
            className={`${btn} shrink-0 self-center border-st-err/40 text-st-err-text hover:bg-st-err/10`}
          >
            Поддержать
          </button>
        </div>
      </CardContent>
    </Card>
  )
}
