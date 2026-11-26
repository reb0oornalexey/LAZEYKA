import React, { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import {
  AlarmClock,
  ArchiveRestore,
  CalendarClock,
  FileClock,
  Gauge,
  Home,
  Info,
  Keyboard,
  Loader2,
  Maximize2,
  MessageSquareText,
  MousePointer2,
  Palette,
  Pin,
  ShieldAlert,
  Sparkles,
  Trash2,
  Waypoints
} from 'lucide-react'
import { Button } from '@renderer/components/ui/button'
import { Segmented } from '@renderer/components/lz'
import { POWER_ON_BANNER_STYLE } from '@renderer/lib/utils'
import { setHintModeLocal } from '@renderer/lib/hint-mode'
import { useUiState } from '@renderer/lib/appearance/ui-state'
import { incyGetSettings, incyPatchSettings } from '@renderer/utils/ipc'
import {
  clearAppCache,
  formatBytes,
  getCacheInfo,
  getUpdateRoute,
  listProfileBackups,
  resetWindowBounds,
  restoreProfileBackup,
  type CacheItem,
  type ProfileBackup
} from '@renderer/utils/settings-extra-api'
import { Rows, SettingRow, SettingsGroup, SubHead, SwitchRow } from './setting-row'

/*
 * Е6: новые настройки, выбранные владельцем. Строки встраиваются в группы Е5
 * (basic-groups.tsx) и в новую группу «Уведомления». Каждая строка — с «i»,
 * в каталоге поиска (settings-catalog.ts) и с data-setting.
 */

interface CfgProps {
  cfg: AppConfig | undefined
  onPatch: (p: Partial<AppConfig>) => void
}

/** Сегменты справа в строке — фиксированной ширины, чтобы строки не прыгали. */
const segCls = 'w-[228px]'

// ───────── Запуск и окно ─────────

/** «Открывать при запуске» — в группе «Запуск». */
export const StartPageRow: React.FC<CfgProps> = ({ cfg, onPatch }) => {
  const v = cfg?.startPage === 'last' ? 'last' : 'home'
  return (
    <SettingRow
      id="startPage"
      icon={<Home />}
      on={v === 'last'}
      title="Открывать при запуске"
      hint="Какой раздел показывать, когда открывается окно программы. «Последний» — тот, что был открыт перед закрытием. Раздел автора не запоминается — вместо него откроется Главная."
      desc={v === 'last' ? 'Раздел, открытый в прошлый раз' : 'Всегда Главная'}
      control={
        <Segmented
          size="sm"
          className={segCls}
          aria-label="Открывать при запуске"
          value={v}
          onChange={(x) => onPatch({ startPage: x })}
          items={[
            { id: 'home', label: 'Главная' },
            { id: 'last', label: 'Последний', title: 'Последний открытый раздел' }
          ]}
        />
      }
    />
  )
}

/** Строки окна в группе «Окно и трей»: поверх всех окон, сброс размера, подсказка трея. */
export const WindowRows: React.FC<CfgProps & { tray: boolean }> = ({ cfg, onPatch, tray }) => {
  const [busy, setBusy] = useState(false)
  const onTop = cfg?.windowAlwaysOnTop === true
  const tip = cfg?.trayStatusTooltip !== false
  const reset = async (): Promise<void> => {
    setBusy(true)
    try {
      const r = await resetWindowBounds()
      toast.success('Окно на месте', { description: `${r.width} × ${r.height} по центру основного экрана`, style: POWER_ON_BANNER_STYLE })
    } catch (e) {
      toast.error('Не удалось сбросить окно', { description: e instanceof Error ? e.message : String(e) })
    } finally {
      setBusy(false)
    }
  }
  return (
    <>
      <SwitchRow
        id="windowAlwaysOnTop"
        icon={<Pin />}
        title="Окно LAZEYKA поверх всех окон"
        hint="Основное окно остаётся над другими программами, даже когда вы работаете в них. Удобно, если держать маленькое окно рядом со стримом или игрой в окне. Может закрывать окна и диалоги других программ. Мини-окно поверх игры настраивается отдельно."
        desc="Не прячется за другими программами"
        checked={onTop}
        onChange={(v) => onPatch({ windowAlwaysOnTop: v })}
      />
      <SettingRow
        id="resetWindow"
        icon={<Maximize2 />}
        title="Сбросить размер и положение окна"
        hint="Окно вернётся к обычному размеру 1280 × 860 (или меньше, если экран маленький) и встанет по центру основного монитора. Помогает, если окно уехало за отключённый монитор или стало слишком маленьким."
        desc="Обычный размер, по центру основного экрана"
        control={
          <Button size="sm" variant="outline" disabled={busy} onClick={() => void reset()} className="gap-1.5">
            {busy && <Loader2 className="size-3.5 animate-spin" />}
            Сбросить
          </Button>
        }
      />
      <SwitchRow
        id="trayStatusTooltip"
        icon={<MousePointer2 />}
        title="Состояние в подсказке значка в трее"
        hint="При наведении на значок LAZEYKA в трее видно, что включено: Zapret, Telegram-прокси (на Windows), VPN — с узлом и пингом. Обновляется, когда меняется состояние служб. В режиме стримера название узла скрыто."
        desc={!tray ? <span className="text-st-warn-text">Не действует без значка в трее</span> : tip ? 'Zapret, Telegram, VPN, узел и пинг' : 'Только название программы'}
        checked={tip}
        disabled={!tray}
        onChange={(v) => onPatch({ trayStatusTooltip: v })}
      />
    </>
  )
}

/** Группа «Интерфейс» в «Запуск и окно»: подсказки и ссылка на масштаб окна. */
export const InterfaceGroup: React.FC<CfgProps> = ({ cfg, onPatch }) => {
  const navigate = useNavigate()
  const hint = cfg?.hintMode === 'short' ? 'short' : 'full'
  const zoom = Math.round((Number(cfg?.windowZoom) || 1) * 100)
  return (
    <SettingsGroup data-tour="settings-ui" title="Интерфейс" hint="Как подробно программа объясняет настройки и какого размера окно." sub={`Масштаб окна ${zoom} %`}>
      <Rows>
        <SettingRow
          id="hintMode"
          icon={<Info />}
          on={hint === 'short'}
          title="Подсказки «i»"
          hint="Подробные — полное объяснение при наведении на «i». Короткие — только первая фраза, без деталей. Значки «i» остаются в обоих вариантах."
          desc={hint === 'short' ? 'Только первая фраза пояснения' : 'Полное объяснение при наведении'}
          control={
            <Segmented
              size="sm"
              className={segCls}
              aria-label="Подсказки"
              value={hint}
              onChange={(x) => {
                setHintModeLocal(x)
                onPatch({ hintMode: x })
              }}
              items={[
                { id: 'full', label: 'Подробные' },
                { id: 'short', label: 'Короткие' }
              ]}
            />
          }
        />
        <SettingRow
          id="windowZoom-link"
          icon={<Palette />}
          on={zoom !== 100}
          title="Масштаб всего окна"
          hint="Увеличивает или уменьшает всё окно целиком: текст, отступы, значки. Настраивается в «Оформлении» → «Интерфейс», рядом с размером текста."
          desc={`Сейчас ${zoom} %. Меняется в «Оформлении»`}
          control={
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                navigate('/appearance')
                // Вкладка «Элементы» и подсветка строки — после отрисовки раздела.
                setTimeout(() => useUiState.getState().focusControl('setting:windowZoom'), 250)
              }}
            >
              Открыть
            </Button>
          }
        />
      </Rows>
    </SettingsGroup>
  )
}

// ───────── Обновления ─────────

export const UpdatesViaIncyRow: React.FC<CfgProps> = ({ cfg, onPatch }) => {
  const on = cfg?.updatesViaIncy === true
  const [via, setVia] = useState<boolean | null>(null)
  useEffect(() => {
    if (!on) return setVia(null)
    let alive = true
    getUpdateRoute()
      .then((r) => alive && setVia(r.viaIncy))
      .catch(() => alive && setVia(null))
    return () => {
      alive = false
    }
  }, [on])
  return (
    <SwitchRow
      id="updatesViaIncy"
      icon={<Waypoints />}
      title="Проверять обновления через VPN INCY"
      hint="Если VPN INCY подключён, проверка и загрузка обновлений LAZEYKA, Zapret и Telegram-прокси идут через него (через локальный порт INCY). Помогает, когда GitHub у провайдера открывается плохо. VPN выключен или не отвечает — всё идёт напрямую, как обычно."
      desc={on ? (via === null ? 'Когда VPN подключён' : via ? 'Сейчас — через VPN INCY' : 'Сейчас — напрямую: VPN не подключён') : 'Обновления идут напрямую'}
      checked={on}
      onChange={(v) => onPatch({ updatesViaIncy: v })}
    />
  )
}

// ───────── Уведомления ─────────

const KINDS: { id: keyof NotifyKindsConfig; title: string; desc: string; hint: string; icon: React.ReactNode }[] = [
  {
    id: 'actions',
    title: 'Горячие клавиши и сценарии',
    desc: 'Сработала клавиша, выполнен сценарий, служба включилась или выключилась',
    hint: 'Подтверждения ваших действий: горячая клавиша, сценарий, ссылка lazeyka://, «Zapret запущен», «VPN подключён / отключён», «Звуки выключены».',
    icon: <Keyboard />
  },
  {
    id: 'updates',
    title: 'Обновления',
    desc: 'Вышла новая версия LAZEYKA',
    hint: 'Системное уведомление о новой версии. Пункт в меню трея и окно обновления остаются в любом случае.',
    icon: <Sparkles />
  },
  {
    id: 'errors',
    title: 'Ошибки служб',
    desc: 'Zapret упал, VPN оборвался, узел заменён, DNS не отвечает',
    hint: 'Сбои и то, что программа переключила сама: ошибка Zapret или Telegram-прокси, обрыв VPN и переподключение, замена узла, выключение цепочки, автопилот Zapret, игровой режим, DNS не отвечает.',
    icon: <ShieldAlert />
  },
  {
    id: 'author',
    title: 'Сообщения автора',
    desc: 'Ответы, объявления и предупреждения',
    hint: 'Всплывающие сообщения о новых ответах и объявлениях автора и о смене списка DNS. Сами сообщения остаются в колокольчике, а важные предупреждения — плашкой в окне: их отключить нельзя.',
    icon: <MessageSquareText />
  }
]

const DAY_ITEMS = [
  { id: '0', label: 'Выкл.' },
  { id: '1', label: '1 дн.' },
  { id: '3', label: '3 дн.' },
  { id: '7', label: '7 дн.' }
]

export const NotifyGroup: React.FC<CfgProps> = ({ cfg, onPatch }) => {
  const kinds = cfg?.notifyKinds ?? {}
  const [days, setDays] = useState<number | null>(null)
  useEffect(() => {
    incyGetSettings()
      .then((s) => setDays(Number(s.expireNotifyDays) || 0))
      .catch(() => setDays(null))
  }, [])
  const setExpire = async (d: number): Promise<void> => {
    const prev = days
    setDays(d)
    try {
      await incyPatchSettings({ expireNotifyDays: d })
    } catch (e) {
      setDays(prev)
      toast.error('Не удалось сохранить', { description: e instanceof Error ? e.message : String(e) })
    }
  }
  const pct = [10, 20, 30].includes(Number(cfg?.subTrafficNotifyPct)) ? String(cfg?.subTrafficNotifyPct) : '10'
  // Значение 5 дней из старой настройки INCY — показываем его отдельным пунктом.
  const dayItems = days !== null && days > 0 && !DAY_ITEMS.some((d) => d.id === String(days)) ? [...DAY_ITEMS, { id: String(days), label: `${days} дн.` }] : DAY_ITEMS
  const on = KINDS.filter((k) => kinds[k.id] !== false).length
  return (
    <div className="space-y-3">
      <SettingsGroup
        data-tour="settings-notify"
        title="Уведомления системы"
        hint="Какие всплывающие уведомления Windows или macOS показывает LAZEYKA. Выключенный вид просто молчит — события по-прежнему видны в окне программы и в логах."
        sub={on === KINDS.length ? 'Показываются все' : `Показываются ${on} из ${KINDS.length}`}
      >
        <Rows>
          {KINDS.map((k) => (
            <SwitchRow
              key={k.id}
              id={`notify-${k.id}`}
              icon={k.icon}
              title={k.title}
              hint={k.hint}
              desc={k.desc}
              checked={kinds[k.id] !== false}
              onChange={(v) => onPatch({ notifyKinds: { ...kinds, [k.id]: v } })}
            />
          ))}
        </Rows>
      </SettingsGroup>

      <SettingsGroup
        data-tour="settings-sub-reminder"
        title="Подписка VPN"
        hint="Напоминание приходит по данным, которые подписка INCY и так присылает при обычном обновлении: дата окончания и остаток трафика. Отдельных запросов нет. Не чаще раза в сутки."
        sub={days === 0 ? 'Напоминания выключены' : 'Напоминание о конце срока и трафика'}
      >
        <Rows>
          <SettingRow
            id="subExpireDays"
            icon={<CalendarClock />}
            on={Boolean(days)}
            title="Напомнить о конце подписки"
            hint="За сколько дней до окончания подписки INCY прислать уведомление. Та же настройка, что «Уведомление об истечении» в настройках INCY."
            desc={days === null ? 'Настройки INCY не загрузились' : days ? `За ${days} дн. до окончания` : 'Не напоминать'}
            control={
              <Segmented
                size="sm"
                className={segCls}
                aria-label="За сколько дней напомнить"
                value={String(days ?? 0)}
                onChange={(x) => void setExpire(Number(x))}
                items={dayItems}
              />
            }
          />
          <SettingRow
            id="subTrafficPct"
            icon={<Gauge />}
            on={Boolean(days)}
            disabled={!days}
            title="Напомнить, когда трафик на исходе"
            hint="Уведомление, когда у подписки остаётся меньше выбранной доли трафика. Работает вместе с напоминанием о сроке (выключено оно — молчит и это). Безлимитные подписки не затрагиваются."
            desc={days ? `Осталось меньше ${pct} %` : 'Включите напоминание о сроке'}
            control={
              <Segmented
                size="sm"
                className={segCls}
                aria-label="Порог трафика"
                value={pct}
                onChange={(x) => onPatch({ subTrafficNotifyPct: Number(x) })}
                items={[
                  { id: '10', label: '10 %' },
                  { id: '20', label: '20 %' },
                  { id: '30', label: '30 %' }
                ]}
              />
            }
          />
        </Rows>
      </SettingsGroup>
    </div>
  )
}

// ───────── Профиль и сброс ─────────

/** «Хранить логи» — в группе «Дополнительно». */
export const LogDaysRow: React.FC<CfgProps> = ({ cfg, onPatch }) => {
  const d = [3, 7, 30].includes(Number(cfg?.maxLogDays)) ? String(cfg?.maxLogDays) : '7'
  return (
    <SettingRow
      id="maxLogDays"
      icon={<FileClock />}
      title="Хранить логи"
      hint="Сколько дней хранить файлы логов. Пригодится, когда автор просит лог за прошлую неделю. Более старые файлы удаляются сразу после изменения и при запуске. 30 дней занимают больше места на диске."
      desc={`Логи старше ${d} дн. удаляются`}
      control={
        <Segmented
          size="sm"
          className={segCls}
          aria-label="Хранить логи"
          value={d}
          onChange={(x) => onPatch({ maxLogDays: Number(x) })}
          items={[
            { id: '3', label: '3 дня' },
            { id: '7', label: '7 дней' },
            { id: '30', label: '30 дней' }
          ]}
        />
      }
    />
  )
}

/** «Очистить кэш» с размером и списком того, что чистится. */
export const ClearCacheRow: React.FC = () => {
  const [items, setItems] = useState<CacheItem[] | null>(null)
  const [step, setStep] = useState<'idle' | 'confirm' | 'busy'>('idle')
  const load = useCallback(() => {
    getCacheInfo()
      .then(setItems)
      .catch(() => setItems([]))
  }, [])
  useEffect(load, [load])
  const total = (items ?? []).reduce((s, x) => s + x.bytes, 0)
  const run = async (): Promise<void> => {
    setStep('busy')
    try {
      const r = await clearAppCache()
      toast.success('Кэш очищен', { description: `Освобождено ${formatBytes(r.freedBytes)}`, style: POWER_ON_BANNER_STYLE })
    } catch (e) {
      toast.error('Не удалось очистить кэш', { description: e instanceof Error ? e.message : String(e) })
    } finally {
      setStep('idle')
      load()
    }
  }
  return (
    <SettingRow
      id="clearCache"
      icon={<Trash2 />}
      title="Очистить кэш"
      hint="Удаляет только то, что программа скачает или соберёт заново сама: превью галереи тем, старые логи, найденные значки подписок, остатки установщиков обновлений, сетевой кэш окна. Настройки, подписки, сценарии, темы и списки Zapret не затрагиваются."
      desc={items === null ? 'Считаю размер…' : `Занято ${formatBytes(total)}`}
      control={
        step === 'idle' ? (
          <Button size="sm" variant="outline" disabled={items === null} onClick={() => setStep('confirm')}>
            Очистить
          </Button>
        ) : (
          <>
            <span className="text-[12.5px] font-semibold text-foreground">Удалить?</span>
            <Button size="sm" variant="destructive" disabled={step === 'busy'} onClick={() => void run()} className="gap-1.5">
              {step === 'busy' && <Loader2 className="size-3.5 animate-spin" />}
              {step === 'busy' ? 'Очищаю…' : 'Да, очистить'}
            </Button>
            <Button size="sm" variant="ghost" disabled={step === 'busy'} onClick={() => setStep('idle')}>
              Отмена
            </Button>
          </>
        )
      }
      below={
        step !== 'idle' && items ? (
          <ul className="space-y-1 rounded-xl bg-foreground/[0.035] px-3 py-2 text-[12px]">
            {items.map((it) => (
              <li key={it.id} className="flex items-baseline gap-2">
                <span className="min-w-0 flex-1">
                  <span className="font-semibold text-foreground">{it.title}</span>
                  <span className="text-muted-foreground"> — {it.desc}</span>
                </span>
                <span className="shrink-0 tabular-nums text-muted-foreground">{formatBytes(it.bytes)}</span>
              </li>
            ))}
          </ul>
        ) : undefined
      }
    />
  )
}

function fmtDate(at: number): string {
  try {
    return new Date(at).toLocaleString('ru-RU', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' })
  } catch {
    return new Date(at).toISOString()
  }
}

/** Группа «Копии перед обновлением». */
export const BackupsGroup: React.FC<CfgProps> = ({ cfg, onPatch }) => {
  const [list, setList] = useState<ProfileBackup[] | null>(null)
  const [confirm, setConfirm] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    listProfileBackups()
      .then(setList)
      .catch(() => setList([]))
  }, [])
  const on = cfg?.backupBeforeUpdate !== false
  const restore = async (id: string): Promise<void> => {
    setBusy(true)
    try {
      const r = await restoreProfileBackup(id)
      toast.success(r.message || 'Настройки восстановлены', { style: POWER_ON_BANNER_STYLE })
      setTimeout(() => window.location.reload(), 800)
    } catch (e) {
      toast.error('Не удалось восстановить', { description: e instanceof Error ? e.message : String(e) })
      setBusy(false)
      setConfirm(null)
    }
  }
  return (
    <SettingsGroup
      data-tour="settings-update-backups"
      title="Копии перед обновлением"
      hint="Когда вы устанавливаете новую версию LAZEYKA, рядом с настройками сохраняется профиль .lazeyka — тот же, что даёт «Сохранить профиль в файл», без ключей и паролей. Хранятся последние 3. Если после обновления что-то не так — восстановите настройки отсюда."
      sub={list?.length ? `Сохранено копий: ${list.length}` : 'Копий пока нет'}
    >
      <Rows>
        <SwitchRow
          id="backupBeforeUpdate"
          icon={<AlarmClock />}
          title="Сохранять копию настроек перед обновлением"
          hint="Маленький файл пишется только в момент установки новой версии, в фоне ничего не происходит. Хранятся 3 последние копии, более старые удаляются."
          desc="Последние 3 копии в папке данных программы"
          checked={on}
          onChange={(v) => onPatch({ backupBeforeUpdate: v })}
        />
        {list && list.length > 0 && <SubHead>Сохранённые копии</SubHead>}
        {(list ?? []).map((b) => (
          <SettingRow
            key={b.id}
            id={`backup-${b.id}`}
            icon={<ArchiveRestore />}
            title={fmtDate(b.at)}
            desc={`Версия ${b.from}${b.to ? ` → ${b.to}` : ''} · ${formatBytes(b.bytes)}`}
            control={
              confirm === b.id ? (
                <>
                  <span className="text-[12.5px] font-semibold text-foreground">Заменить текущие настройки?</span>
                  <Button size="sm" disabled={busy} onClick={() => void restore(b.id)} className="gap-1.5">
                    {busy && <Loader2 className="size-3.5 animate-spin" />}
                    Восстановить
                  </Button>
                  <Button size="sm" variant="ghost" disabled={busy} onClick={() => setConfirm(null)}>
                    Отмена
                  </Button>
                </>
              ) : (
                <Button size="sm" variant="outline" onClick={() => setConfirm(b.id)}>
                  Восстановить
                </Button>
              )
            }
          />
        ))}
      </Rows>
    </SettingsGroup>
  )
}
