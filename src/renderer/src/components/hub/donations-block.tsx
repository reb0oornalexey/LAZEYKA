import React, { useEffect, useMemo, useState } from 'react'
import { CalendarClock, ChevronDown, ExternalLink, Heart, PartyPopper, Send, Users } from 'lucide-react'
import { cn } from '@renderer/lib/utils'
import { Button } from '@renderer/components/ui/button'
import { LzPanel, LzSectionHead } from '@renderer/components/lz'
import { attachHubStore, useHubStore } from '@renderer/store/hub-store'
import { donationsGet, money, styleOf, type DonCampaignPublic, type DonationsPublic, type DonLevel, type DonStyle } from '@renderer/utils/hub-donations-api'
import { DonorChip, DonProgress, LevelLegend } from './donation-ui'
import { ClaimDialog, MethodPickerDialog, MyClaims, openMethod } from './donation-dialogs'
import { MethodIcon } from './pay-icons'
import { DONATIONS_ANCHOR_ID } from './donate-shortcut'

const WALL_SHOWN = 24

const dateRu = (t: number): string => new Date(t).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' })
const pctText = (p: number): string => `${p.toLocaleString('ru-RU', { maximumFractionDigits: p < 10 ? 1 : 0 })} %`

function plural(n: number, one: string, few: string, many: string): string {
  const m10 = n % 10
  const m100 = n % 100
  if (m10 === 1 && m100 !== 11) return one
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few
  return many
}

const Campaign: React.FC<{ c: DonCampaignPublic; levels: DonLevel[]; styles: Record<string, DonStyle>; first: boolean }> = ({ c, levels, styles, first }) => {
  const [all, setAll] = useState(false)
  // Сбор виден целиком на первом экране «Поддержки»: цифры, полоса и кнопки сразу,
  // описание, уровни, последние пожертвования и стена — по кнопке «Подробнее».
  const [more, setMore] = useState(false)
  const [pick, setPick] = useState(false)
  const [claim, setClaim] = useState(false)
  const allClaims = useHubStore((s) => s.claims)
  const claims = useMemo(() => allClaims.filter((x) => x.camp === c.id), [allClaims, c.id])
  const done = c.raised >= c.goal
  const wall = all ? c.wall : c.wall.slice(0, WALL_SHOWN)
  const one = c.methods.length === 1 ? c.methods[0] : null

  const support = (): void => {
    if (one) openMethod(one)
    else setPick(true)
  }

  return (
    <LzPanel id={first ? DONATIONS_ANCHOR_ID : undefined} data-tour="support-donations" tone={done ? 'on' : 'off'} className="scroll-mt-4 p-4">
      <LzSectionHead
        title={
          <span className="min-w-0 truncate" title={c.title}>
            Сбор на развитие: {c.title}
          </span>
        }
        hint="Автор собирает на развитие LAZEYKA. Это не обязательно и ни на что в программе не влияет. Данные обновляются при открытии этой страницы."
        right={
          c.ends && (
            <span className="inline-flex shrink-0 items-center gap-1 rounded-lg bg-foreground/[0.06] px-2 py-0.5 text-[11px] text-muted-foreground">
              <CalendarClock className="size-3" /> до {dateRu(c.ends)}
            </span>
          )
        }
      />
      {more && c.descr && <p className="mt-1 text-[12px] leading-relaxed text-muted-foreground">{c.descr}</p>}

      <div className="mt-3 grid items-center gap-x-5 gap-y-3 md:grid-cols-[minmax(0,1fr)_250px]">
        <div className="min-w-0 space-y-2">
          <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
            <div className="flex items-baseline gap-2">
              <span className="text-[26px] font-extrabold leading-none tracking-[-0.01em] tabular-nums text-[color:var(--text-title)]">{money(c.raised, c.cur)}</span>
              <span className="text-[13px] text-muted-foreground">из {money(c.goal, c.cur)}</span>
            </div>
            <span className={cn('text-[18px] font-extrabold tabular-nums', done ? 'text-primary' : 'text-foreground')}>{pctText(c.pct)}</span>
          </div>
          <DonProgress raised={c.raised} goal={c.goal} levels={levels} byLevel={c.byLevel} below={c.below} variant={levels.length ? 'levels' : 'accent'} size="lg" />
          <p className="sr-only">
            Собрано {money(c.raised, c.cur)} из {money(c.goal, c.cur)} ({pctText(c.pct)})
          </p>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
            <span className="inline-flex items-center gap-1.5 text-[12px] text-muted-foreground">
              <Users className="size-3.5" />
              {c.donors ? (
                <>
                  <b className="text-foreground tabular-nums">{c.donors}</b> {plural(c.donors, 'человек поддержал', 'человека поддержали', 'человек поддержали')}
                </>
              ) : (
                'Пока никто не поддержал — можно стать первым'
              )}
            </span>
            {done && (
              <span className="inline-flex items-center gap-1 text-[12px] font-semibold text-primary">
                <PartyPopper className="size-3.5" /> Цель собрана, спасибо
              </span>
            )}
            {(c.descr || levels.length > 0 || c.recent.length > 0 || c.wall.length > 0) && (
              <button
                type="button"
                onClick={() => setMore((v) => !v)}
                aria-expanded={more}
                data-tour="support-donate-more"
                className="inline-flex cursor-pointer items-center gap-1 text-[12px] font-semibold text-primary hover:underline"
              >
                <ChevronDown className={cn('size-3.5 transition-transform', more && 'rotate-180')} />
                {more ? 'Свернуть' : c.wall.length > 0 ? `Стена благодарностей (${c.wall.length})` : 'Подробнее о сборе'}
              </button>
            )}
          </div>
        </div>

        {(c.methods.length > 0 || c.claimable) && (
          <div className="flex flex-col gap-2" data-tour="support-donate-actions">
            {c.methods.length > 0 && (
              <Button className="h-10 w-full rounded-xl shadow-[0_0_18px_-6px_var(--primary)]" onClick={support}>
                <Heart className="fill-current" />
                Поддержать
                {one ? (
                  <>
                    <span className="opacity-80">· {one.name}</span>
                    <ExternalLink className="size-3.5 opacity-80" />
                  </>
                ) : (
                  <span className="flex -space-x-1">
                    {c.methods.slice(0, 4).map((m) => (
                      <MethodIcon key={m.url} icon={m.icon} className="size-4 rounded-full ring-2 ring-primary" />
                    ))}
                  </span>
                )}
              </Button>
            )}
            {c.claimable && (
              <Button
                variant="outline"
                className="h-9 w-full rounded-xl text-xs"
                onClick={() => setClaim(true)}
                data-tour="support-donate-claim"
                title="Все, кто поддержал, попадают на стену благодарностей: ник и цвет по сумме. После перевода нажмите эту кнопку — автор сверит и добавит вас."
              >
                <Send /> Я отправил пожертвование
              </Button>
            )}
          </div>
        )}
      </div>

      {more && levels.length > 0 && (
        <div className="mt-3">
          <LevelLegend levels={levels} cur={c.cur} />
        </div>
      )}
      {more && (c.methods.length > 0 || c.claimable) && (
        <p className="mt-2 text-[11.5px] leading-snug text-muted-foreground">
          Все, кто поддержал, попадают на стену благодарностей: ник и цвет по сумме.
          {c.claimable ? ' После перевода нажмите «Я отправил пожертвование» — автор сверит и добавит вас.' : ''}
        </p>
      )}

      {claims.length > 0 && (
        <div className="mt-3 space-y-1.5">
          <div className="text-[12px] font-semibold text-muted-foreground">Ваши заявки</div>
          <MyClaims claims={claims} />
        </div>
      )}

      {more && c.recent.length > 0 && (
        <div className="mt-3 space-y-2 border-t border-foreground/[0.07] pt-3">
          <div className="text-[12px] font-semibold text-muted-foreground">Последние пожертвования</div>
          <div className="flex flex-wrap gap-1.5">
            {c.recent.map((r, i) => (
              <DonorChip key={`${r.nick}-${r.at}-${i}`} nick={r.nick} levels={levels} level={r.level} amount={money(r.amount, c.cur)} size="sm" st={styleOf(styles, r.nick)} />
            ))}
          </div>
        </div>
      )}

      {more && c.wall.length > 0 && (
        <div className="mt-3 space-y-2 border-t border-foreground/[0.07] pt-3">
          <div className="text-[12px] font-semibold text-muted-foreground">Стена благодарностей</div>
          <div className="flex flex-wrap gap-1.5">
            {wall.map((w) => (
              <DonorChip key={w.nick} nick={w.nick} levels={levels} level={w.level} st={styleOf(styles, w.nick)} title={`${w.nick}${levels[w.level] ? ' · ' + levels[w.level].name : ''}`} />
            ))}
            {!all && c.wall.length > WALL_SHOWN && (
              <button type="button" onClick={() => setAll(true)} className="cursor-pointer rounded-full border border-dashed border-border px-2.5 py-1 text-xs text-muted-foreground hover:text-foreground">
                ещё {c.wall.length - WALL_SHOWN}
              </button>
            )}
          </div>
        </div>
      )}
      <MethodPickerDialog camp={pick ? c : null} onClose={() => setPick(false)} onClaim={c.claimable ? () => setClaim(true) : undefined} />
      <ClaimDialog camp={claim ? c : null} onClose={() => setClaim(false)} />
    </LzPanel>
  )
}

/**
 * Блок сбора на странице «Поддержка»: данные приходят при открытии страницы (в главном процессе
 * кэш на 10 минут), без фоновых опросов. Если сбора нет или сервер не ответил — блока нет.
 */
export const DonationsBlock: React.FC<{ onLoaded?: (hasCampaign: boolean) => void }> = ({ onLoaded }) => {
  useEffect(() => attachHubStore(), [])
  const [data, setData] = useState<DonationsPublic | null>(null)
  useEffect(() => {
    let alive = true
    donationsGet()
      .then((d) => {
        if (!alive) return
        setData(d)
        onLoaded?.(Boolean(d?.campaigns.length))
      })
      .catch(() => undefined)
    return () => {
      alive = false
    }
  }, [])
  if (!data || !data.campaigns.length) return null
  return (
    <>
      {data.campaigns.map((c, i) => (
        <Campaign key={c.id} c={c} levels={data.levels} styles={data.styles ?? {}} first={i === 0} />
      ))}
    </>
  )
}
