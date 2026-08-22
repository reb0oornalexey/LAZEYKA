import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { dataDir } from '../utils/dirs'

export interface DomainCategory {
  id: string
  name: string
  description: string
  domains: string[]
  enabled: boolean
}

export interface CustomDomainExclusion {
  id: string
  domain: string
  comment?: string
  enabled: boolean
}

export interface SplitTunnelingConfig {
  bypassAllRu: boolean
  categories: DomainCategory[]
  customDomains: CustomDomainExclusion[]
}

export const DEFAULT_RU_CATEGORIES: DomainCategory[] = [
  {
    id: 'ru_zones',
    name: 'Доменные зоны РФ',
    description: 'Все сайты в национальных доменных зонах России (*.ru, *.рф, *.su)',
    domains: ['*.ru', '*.рф', '*.su'],
    enabled: true
  },
  {
    id: 'portals',
    name: 'Поисковики и сервисы',
    description: 'Яндекс, Mail.ru, Дзен, Рамблер',
    domains: [
      '*.yandex.ru',
      '*.ya.ru',
      '*.yandex.net',
      '*.yastatic.net',
      '*.mail.ru',
      '*.dzen.ru',
      '*.rambler.ru',
      '*.qrator.net'
    ],
    enabled: true
  },
  {
    id: 'gos',
    name: 'Государственные услуги',
    description: 'Госуслуги, Налоговая, Мос.ру, Суды, ЕГРЮЛ, МВД',
    domains: [
      '*.gosuslugi.ru',
      '*.nalog.gov.ru',
      '*.nalog.ru',
      '*.mos.ru',
      '*.pfr.gov.ru',
      '*.customs.gov.ru',
      '*.zakupki.gov.ru',
      '*.sudrf.ru',
      '*.egrul.nalog.ru',
      '*.fssp.gov.ru',
      '*.mvd.ru',
      '*.kremlin.ru'
    ],
    enabled: true
  },
  {
    id: 'banking',
    name: 'Банки и платежные системы',
    description: 'Сбер, Т-Банк, ВТБ, Альфа-Банк, МИР, НСПК, СБП, Райффайзен',
    domains: [
      '*.sberbank.ru',
      '*.sber.ru',
      '*.sberbank.com',
      '*.tbank.ru',
      '*.tinkoff.ru',
      '*.alfabank.ru',
      '*.vtb.ru',
      '*.gazprombank.ru',
      '*.raiffeisen.ru',
      '*.rshb.ru',
      '*.sovcombank.ru',
      '*.cbr.ru',
      '*.nspk.ru',
      '*.mir-pay.ru',
      '*.sbp.nspk.ru',
      '*.psbank.ru',
      '*.open.ru',
      '*.unicreditbank.ru',
      '*.rosbank.ru',
      '*.domclick.ru'
    ],
    enabled: true
  },
  {
    id: 'marketplaces',
    name: 'Маркетплейсы и доставка',
    description: 'Ozon, Wildberries, Авито, Яндекс Маркет, СДЭК, Почта РФ, Самокат',
    domains: [
      '*.ozon.ru',
      '*.wildberries.ru',
      '*.wb.ru',
      '*.market.yandex.ru',
      '*.avito.ru',
      '*.megamarket.ru',
      '*.cdek.ru',
      '*.pochta.ru',
      '*.aliexpress.ru',
      '*.samokat.ru',
      '*.lavka.yandex.ru',
      '*.kuper.ru',
      '*.sbermarket.ru',
      '*.vseinstrumenti.ru',
      '*.dns-shop.ru',
      '*.mvideo.ru',
      '*.eldorado.ru'
    ],
    enabled: true
  },
  {
    id: 'telecom',
    name: 'Связь и провайдеры',
    description: 'МТС, Мегафон, Билайн, Т2, Ростелеком, Дом.ru, Yota',
    domains: [
      '*.mts.ru',
      '*.megafon.ru',
      '*.beeline.ru',
      '*.t2.ru',
      '*.tele2.ru',
      '*.rostelecom.ru',
      '*.rt.ru',
      '*.dom.ru',
      '*.mgts.ru',
      '*.yota.ru',
      '*.ertelecom.ru'
    ],
    enabled: true
  },
  {
    id: 'media',
    name: 'Медиа, соцсети и стриминг',
    description: 'VK, Одноклассники, Rutube, Кинопоиск, Иви, Okko, Premier, Пикабу, Хабр',
    domains: [
      '*.vk.com',
      '*.vk.ru',
      '*.userapi.com',
      '*.vkvideo.ru',
      '*.ok.ru',
      '*.rutube.ru',
      '*.kinopoisk.ru',
      '*.ivi.ru',
      '*.okko.tv',
      '*.kion.ru',
      '*.premier.one',
      '*.smotrim.ru',
      '*.pikabu.ru',
      '*.habr.com',
      '*.vc.ru',
      '*.dtf.ru'
    ],
    enabled: true
  },
  {
    id: 'navigation',
    name: 'Карты, навигация и авто',
    description: '2ГИС, Яндекс Карты, Авто.ру, Дром, ЦИАН',
    domains: [
      '*.2gis.ru',
      '*.2gis.com',
      '*.auto.ru',
      '*.drom.ru',
      '*.cian.ru',
      '*.avito.st'
    ],
    enabled: true
  }
]

function splitConfigFile(): string {
  return path.join(dataDir(), 'split-tunneling.json')
}

export function loadSplitTunnelingConfig(): SplitTunnelingConfig {
  const file = splitConfigFile()
  if (!existsSync(file)) {
    return {
      bypassAllRu: true,
      categories: DEFAULT_RU_CATEGORIES,
      customDomains: [
        { id: '1', domain: '*.gosuslugi.ru', comment: 'Портал Госуслуг', enabled: true },
        { id: '2', domain: '*.sberbank.ru', comment: 'СберБанк', enabled: true },
        { id: '3', domain: '*.tbank.ru', comment: 'Т-Банк', enabled: true }
      ]
    }
  }

  try {
    const parsed = JSON.parse(readFileSync(file, 'utf-8'))
    // Merge persisted category states over default categories
    const categories = DEFAULT_RU_CATEGORIES.map((cat) => {
      const found = parsed.categories?.find((c: any) => c.id === cat.id)
      return found ? { ...cat, enabled: found.enabled ?? true } : cat
    })

    return {
      bypassAllRu: parsed.bypassAllRu ?? true,
      categories,
      customDomains: parsed.customDomains || []
    }
  } catch {
    return {
      bypassAllRu: true,
      categories: DEFAULT_RU_CATEGORIES,
      customDomains: []
    }
  }
}

export function saveSplitTunnelingConfig(cfg: SplitTunnelingConfig): void {
  writeFileSync(splitConfigFile(), JSON.stringify(cfg, null, 2), 'utf-8')
}

/**
 * Returns all active domains that must bypass proxying (go direct).
 */
export function getAllBypassDomains(): string[] {
  const cfg = loadSplitTunnelingConfig()
  const list = new Set<string>()

  if (cfg.bypassAllRu) {
    for (const cat of cfg.categories) {
      if (cat.enabled) {
        for (const d of cat.domains) list.add(d)
      }
    }
  }

  for (const item of cfg.customDomains) {
    if (item.enabled && item.domain.trim()) {
      list.add(item.domain.trim().toLowerCase())
    }
  }

  return Array.from(list)
}
