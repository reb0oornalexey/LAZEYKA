import React from 'react'
import { Hourglass } from 'lucide-react'
import { Card, CardContent } from '@renderer/components/ui/card'
import BasePage from '@renderer/components/base/base-page'
import { platform } from '@renderer/utils/init'

interface Props {
  title: string
  /** Что именно появится на Mac позже — одна строка под заголовком. */
  note?: string
  children: React.ReactNode
}

/**
 * Обёртка для вкладок, которые пока работают только в Windows. На macOS вместо
 * настоящей страницы показываем заглушку «Скоро на macOS» — так нет кнопок,
 * которые ничего не делают или падают с ошибкой. В Windows и Linux отдаётся
 * сама страница без изменений.
 */
const MacSoon: React.FC<Props> = ({ title, note, children }) => {
  if (platform !== 'darwin') return <>{children}</>
  return (
    <BasePage title={title}>
      <div className="mx-auto max-w-xl px-4 pb-8">
        <Card className="cyber-card">
          <CardContent className="flex flex-col items-center gap-3 px-6 py-12 text-center">
            <div className="flex size-14 items-center justify-center rounded-2xl bg-primary/15 text-primary">
              <Hourglass className="size-7" />
            </div>
            <h2 className="text-lg font-bold text-foreground">Скоро на macOS</h2>
            <p className="max-w-sm text-[13px] text-muted-foreground">
              {note ?? 'Эта функция пока работает только в Windows. Мы переносим её на Mac — следите за обновлениями.'}
            </p>
          </CardContent>
        </Card>
      </div>
    </BasePage>
  )
}

export default MacSoon
