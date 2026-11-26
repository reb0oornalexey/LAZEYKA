import { useEffect, useState } from 'react'
import { Cable, KeyRound, Loader2, Lock, Power, Share2, ShieldCheck, Smartphone } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@renderer/components/ui/button'
import { Input } from '@renderer/components/ui/input'
import { Rows, SettingRow, SettingsGroup, SwitchRow } from '@renderer/components/settings/setting-row'
import { Hint } from '@renderer/components/prematch/hint'
import { lanFirewall, lanRotateToken, lanSetSettings, type LanSettings, type LanState } from '@renderer/utils/lan-api'
import { Notice, errMsg } from './common'

export function SettingsCard({ state, onState }: { state: LanState; onState: (s: LanState) => void }): React.ReactElement {
  const s = state.settings
  const [hubPort, setHubPort] = useState(String(s.hubPort))
  const [proxyPort, setProxyPort] = useState(String(s.proxyPort))
  const [user, setUser] = useState(s.proxyUser)
  const [pass, setPass] = useState(s.proxyPass)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    setHubPort(String(s.hubPort))
    setProxyPort(String(s.proxyPort))
    setUser(s.proxyUser)
    setPass(s.proxyPass)
  }, [s.hubPort, s.proxyPort, s.proxyUser, s.proxyPass])

  const apply = async (patch: Partial<LanSettings>, okText?: string): Promise<void> => {
    setBusy(true)
    try {
      onState(await lanSetSettings(patch))
      if (okText) toast.success(okText)
    } catch (e) {
      toast.error(errMsg(e))
    } finally {
      setBusy(false)
    }
  }

  const act = async (fn: () => Promise<LanState>, okText: string): Promise<void> => {
    setBusy(true)
    try {
      onState(await fn())
      toast.success(okText)
    } catch (e) {
      toast.error(errMsg(e))
    } finally {
      setBusy(false)
    }
  }

  const credsChanged = user !== s.proxyUser || pass !== s.proxyPass
  const portsChanged = hubPort !== String(s.hubPort) || proxyPort !== String(s.proxyPort)
  const isWin = state.platform === 'win32'

  return (
    <SettingsGroup title="Настройки" hint="Порты, пароль для раздачи и поведение при запуске программы." sub="Изменения портов перезапускают раздел">
      <Rows>
        <SwitchRow
          id="lan-autostart"
          icon={<Power />}
          title="Включать при запуске программы"
          hint="Если выключено, раздел после запуска программы остаётся выключенным и никого не слушает."
          checked={s.autostart}
          disabled={busy}
          onChange={(v) => void apply({ autostart: v })}
        />
        <SwitchRow
          id="lan-remote-on"
          icon={<Smartphone />}
          title="Пульт с телефона"
          desc="Страница управления для телефона по QR"
          hint="Страница управления для телефона по QR."
          checked={s.remote}
          disabled={busy}
          onChange={(v) => void apply({ remote: v })}
        />
        <SwitchRow
          id="lan-share-on"
          icon={<Share2 />}
          title="Раздача на устройства"
          desc="Прокси для телефонов, ноутбуков и других устройств сети"
          hint="Прокси для телефонов, ноутбуков и других устройств в вашей сети."
          checked={s.share}
          disabled={busy}
          onChange={(v) => void apply({ share: v })}
        />
        <SettingRow
          id="lan-ports"
          icon={<Cable />}
          title="Порты"
          desc="Пульт и прокси, от 1024 до 65535, разные"
          hint="По умолчанию пульт — 20900, прокси — 20901. Если порт занят другой программой, выберите другой (от 1024 до 65535). Порты должны отличаться."
          control={
            <>
              <label className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                пульт
                <Input value={hubPort} onChange={(e) => setHubPort(e.target.value.replace(/\D/g, ''))} className="h-8 w-20 rounded-lg text-xs tabular-nums" inputMode="numeric" aria-label="Порт пульта" />
              </label>
              <label className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                прокси
                <Input value={proxyPort} onChange={(e) => setProxyPort(e.target.value.replace(/\D/g, ''))} className="h-8 w-20 rounded-lg text-xs tabular-nums" inputMode="numeric" aria-label="Порт прокси" />
              </label>
            </>
          }
          below={
            portsChanged && (
              <Button size="sm" className="h-8 text-xs" disabled={busy} onClick={() => void apply({ hubPort: Number(hubPort), proxyPort: Number(proxyPort) }, 'Порты сохранены')}>
                {busy && <Loader2 className="size-3.5 animate-spin" />}
                Применить порты{state.enabled ? ' (раздел перезапустится)' : ''}
              </Button>
            )
          }
        />
        <SettingRow
          id="lan-proxy-auth"
          icon={<Lock />}
          on={Boolean(s.proxyUser)}
          title="Логин и пароль прокси"
          desc={s.proxyUser ? 'Прокси спрашивает логин и пароль' : 'Без пароля: пустит любое устройство вашей сети'}
          hint="Необязательно. Пароль защищает прокси, если вы в чужой сети. Логин и пароль задаются вместе; оставьте оба поля пустыми, чтобы прокси работал без пароля. Некоторые устройства (например, PlayStation) пароль для прокси не поддерживают."
          control={
            <>
              <Input value={user} onChange={(e) => setUser(e.target.value)} className="h-8 w-32 rounded-lg text-xs" placeholder="логин" autoComplete="off" aria-label="Логин прокси" />
              <Input value={pass} onChange={(e) => setPass(e.target.value)} className="h-8 w-32 rounded-lg text-xs" placeholder="пароль" autoComplete="off" aria-label="Пароль прокси" />
            </>
          }
          below={
            credsChanged && (
              <Button size="sm" className="h-8 text-xs" disabled={busy} onClick={() => void apply({ proxyUser: user, proxyPass: pass }, user ? 'Пароль установлен' : 'Пароль убран')}>
                Сохранить логин и пароль
              </Button>
            )
          }
        />
        <SettingRow
          id="lan-token"
          icon={<KeyRound />}
          title="Код доступа к пульту"
          desc="Старый QR и открытые пульты перестанут работать"
          hint="Сброс делает старый QR и все открытые на телефонах пульты недействительными. Потом отсканируйте новый QR."
          control={
            <Button size="sm" variant="outline" className="h-8 text-xs" disabled={busy} onClick={() => void act(lanRotateToken, 'Код сменён, старые QR больше не работают')}>
              <KeyRound className="size-3.5" />
              Сменить код
            </Button>
          }
        />
      </Rows>

      {isWin && state.enabled && (
        <div data-tour="lan-firewall" className="mx-3 mt-1 mb-2 space-y-2 rounded-xl border border-foreground/[0.08] bg-foreground/[0.03] p-3">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-1.5 text-xs font-semibold">
                Брандмауэр Windows
                <Hint
                  text={`Правило «LAZEYKA LAN» разрешает входящие подключения к портам ${s.hubPort} и ${s.proxyPort} во всех сетях (частной, общедоступной — её Windows обычно даёт раздаваемому Wi-Fi), но только с адресов локальных сетей: 192.168.x.x, 10.x.x.x, 172.16–31.x.x. Из интернета подключиться нельзя.`}
                />
              </div>
              <div className="text-[11px] text-muted-foreground">
                {state.firewallRule
                  ? 'Правило добавлено. Оно снимается при выключении раздела и ставится снова при включении.'
                  : 'Правила нет. Если телефон не открывает пульт, разрешите подключения.'}
              </div>
            </div>
            {state.firewallRule ? (
              <Button size="sm" variant="ghost" className="h-8 shrink-0 text-xs" disabled={busy} onClick={() => void act(() => lanFirewall('remove'), 'Правило удалено')}>
                Удалить правило
              </Button>
            ) : (
              <Button size="sm" variant="outline" className="h-8 shrink-0 text-xs" disabled={busy} onClick={() => void act(() => lanFirewall('allow'), 'Правило добавлено')}>
                {busy ? <Loader2 className="size-3.5 animate-spin" /> : <ShieldCheck className="size-3.5" />}
                Разрешить в брандмауэре
              </Button>
            )}
          </div>
          {state.networkCategory === 'public' && !state.firewallRule && (
            <Notice tone="warn">Сеть компьютера в Windows — «Общедоступная»: без правила брандмауэр может не пускать устройства.</Notice>
          )}
          {state.firewallBlockers && state.firewallBlockers.length > 0 && (
            <div data-tour="lan-firewall-blockers" className="space-y-2">
              <Notice tone="warn">
                В брандмауэре есть запрет для этой программы ({[...new Set(state.firewallBlockers.map((b) => `«${b.name}» — ${b.profiles}`))].join('; ')}). Обычно он появляется, если в окне Windows
                «Разрешить доступ?» отметить только частные сети. Запрет сильнее любого разрешения, поэтому устройства в такой сети (например, в раздаваемом Wi-Fi) не подключатся.
                Кнопка отключит эти правила; включить их обратно можно в «Брандмауэре Защитника Windows».
              </Notice>
              <div className="flex justify-end">
                <Button size="sm" variant="outline" className="h-8 text-xs" disabled={busy} onClick={() => void act(() => lanFirewall('unblock'), 'Запрещающие правила отключены')}>
                  Отключить запрещающие правила
                </Button>
              </div>
            </div>
          )}
        </div>
      )}
    </SettingsGroup>
  )
}
