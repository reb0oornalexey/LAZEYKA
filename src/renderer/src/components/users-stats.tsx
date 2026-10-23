import React from 'react'
import { Users, UserCheck, Activity, Trophy } from 'lucide-react'
import { Card, CardContent } from '@renderer/components/ui/card'
import { useAppConfig } from '@renderer/hooks/use-app-config'
import { useOnlineStore, selectInstallNum } from '@renderer/store/online-store'
import { pluralRu } from '@renderer/lib/utils'

const fmt = (n: number): string => n.toLocaleString('ru-RU')

const Stat: React.FC<{
  icon: React.ReactNode
  label: string
  value: React.ReactNode
  unit?: string
  hint?: string
}> = ({ icon, label, value, unit, hint }) => (
  <div className="flex items-center gap-3">
    <div className="flex size-11 shrink-0 items-center justify-center rounded-xl border border-primary/30 bg-primary/15 text-primary">
      {icon}
    </div>
    <div className="min-w-0">
      <div className="text-[11px] text-muted-foreground">{label}</div>
      <div className="flex items-baseline gap-1.5">
        <span className="text-3xl font-black leading-tight tabular-nums text-foreground">{value}</span>
        {unit && <span className="text-xs text-muted-foreground">{unit}</span>}
      </div>
      {hint && <div className="text-[10px] text-muted-foreground/80">{hint}</div>}
    </div>
  </div>
)

/** Две карточки со статистикой пользователей — наверху страницы «Информация». */
const UsersStats: React.FC = () => {
  const { appConfig } = useAppConfig()
  const stats = useOnlineStore((s) => s.stats)
  const num = useOnlineStore(selectInstallNum)

  if (appConfig?.onlineStats === false) {
    return <p className="px-1 text-center text-[11px] text-muted-foreground">Счётчик выключен в настройках</p>
  }
  if (!stats && num == null) return null

  const people = (n: number): string => pluralRu(n, 'человек', 'человека', 'человек')

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      <Card className="cyber-card">
        <CardContent className="space-y-4 p-4">
          {stats?.installs != null && (
            <Stat
              icon={<Users className="size-5" />}
              label="Приложение используют"
              value={fmt(stats.installs)}
              unit={people(stats.installs)}
            />
          )}
          {num != null && (
            <Stat
              icon={<UserCheck className="size-5" />}
              label="Ваш номер"
              value={`#${fmt(num)}`}
              hint="каким по счёту вы установили LAZEYKA"
            />
          )}
        </CardContent>
      </Card>

      <Card className="cyber-card">
        <CardContent className="space-y-4 p-4">
          {stats && (
            <>
              <Stat
                icon={<Activity className="size-5" />}
                label="Сейчас онлайн"
                value={fmt(stats.online)}
                unit={people(stats.online)}
              />
              {stats.peakOnline != null && (
                <Stat icon={<Trophy className="size-5" />} label="Рекорд онлайна" value={fmt(stats.peakOnline)} />
              )}
              {stats.active24h != null && stats.active7d != null && stats.active30d != null && (
                <p className="text-[10px] text-muted-foreground">
                  Активны: за сутки {fmt(stats.active24h)} · за неделю {fmt(stats.active7d)} · за месяц {fmt(stats.active30d)}
                </p>
              )}
            </>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

export default UsersStats
