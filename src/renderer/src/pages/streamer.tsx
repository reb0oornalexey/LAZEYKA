import React, { useEffect, useState } from 'react'
import { EyeOff, LayoutGrid, RadioTower } from 'lucide-react'
import BasePage from '@renderer/components/base/base-page'
import { HidePanel, StreamerHero } from '@renderer/components/streamer/mode-card'
import { IngestCard } from '@renderer/components/streamer/ingest-card'
import { StreamDeckPanel } from '@renderer/components/streamdeck-card'
import { PageColumn, PageTabs, usePageTab, type PageTab } from '@renderer/components/e9/page-tabs'
import { initStreamerMode } from '@renderer/store/streamer-store'
import type { SensitiveCategory } from '@renderer/utils/streamer-api'

type Tab = 'hide' | 'deck' | 'ingest'
const IDS: Tab[] = ['hide', 'deck', 'ingest']
const TABS: PageTab<Tab>[] = [
  { id: 'hide', label: 'Что скрывать', icon: EyeOff, hint: 'Что размывается в окне программы, пока режим включён' },
  { id: 'deck', label: 'Стрим-пульт', icon: LayoutGrid, hint: 'Кнопки Stream Deck, Fifine и других пультов для LAZEYKA' },
  { id: 'ingest', label: 'Серверы приёма', icon: RadioTower, hint: 'Какой сервер Twitch или YouTube отвечает быстрее и OBS мимо VPN' }
]

/**
 * Страница «Стример» (Е9). Сверху пульт режима стримера: кольцо из пяти дуг —
 * то, что размывается, и переключатель режима. Ниже три вкладки: что скрывать,
 * стрим-пульт и проверка серверов приёма. Статус в Discord живёт в «Настройках»,
 * сюда ведёт чип пульта. Экскурсия открывает вкладку по полю tab шага.
 */
export default function StreamerPage(): React.ReactElement {
  const [tab, setTab] = usePageTab<Tab>('/streamer', IDS, 'hide')
  const [hover, setHover] = useState<SensitiveCategory | null>(null)

  useEffect(() => {
    // Подстраховка: в приложении initStreamerMode уже вызван из App.tsx, повторный вызов ничего не дублирует.
    initStreamerMode()
  }, [])

  return (
    <BasePage title="Стример">
      <PageColumn>
        <StreamerHero active={tab === 'hide' ? hover : null} />
        <PageTabs tabs={TABS} value={tab} onChange={setTab} label="Разделы «Стримера»" width="w-[480px]" tour="streamer-tabs" />
        {tab === 'hide' && <HidePanel onHover={setHover} />}
        {tab === 'deck' && <StreamDeckPanel />}
        {tab === 'ingest' && <IngestCard />}
      </PageColumn>
    </BasePage>
  )
}
