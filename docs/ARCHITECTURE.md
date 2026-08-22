# LAZEYKA — полный разбор архитектуры и кода

> Сгенерировано по состоянию репозитория на 21.08.2026 (версия пакета `1.0.2`, `CONFIG_VERSION = 4`).
> ~20 300 строк TS/TSX в `src/`.

---

## 1. Что это за приложение

LAZEYKA — Electron-приложение для Windows, которое управляет **тремя независимыми сетевыми
движками** из одного UI и трея:

| Движок | Бинарник | Что делает |
| --- | --- | --- |
| **TGWS** (Telegram WS Proxy) | `TgWsProxy_windows.exe` | локальный MTProto-over-WebSocket релей для Telegram Desktop/мобильных |
| **Zapret** (обход DPI) | `winws.exe` + драйвер `WinDivert64.sys` | модификация пакетов на уровне ядра, обход ТСПУ для YouTube/Discord |
| **INCY** (прокси/VPN) | `sing-box.exe` | туннель VLESS/Reality, Hysteria2, Trojan, Shadowsocks; режимы TUN / системный прокси / только прокси |

Ни один из движков не написан внутри LAZEYKA — приложение является **оркестратором**:
спавнит дочерние процессы, следит за их здоровьем, правит их конфиги на диске,
показывает статус и корректно всё убивает при выходе.

### Стек

- **main**: Electron 37 + TypeScript, сборка через `electron-vite`
- **renderer**: React 19 + Vite + Tailwind v4 + shadcn/Radix + Zustand + SWR + react-router (HashRouter)
- **preload**: `@electron-toolkit/preload` → `window.electron.ipcRenderer` + `window.api`
- **упаковка**: `electron-builder` (NSIS perMachine + 7z-портатив), `requestedExecutionLevel: requireAdministrator`

---

## 2. Карта репозитория

```
src/
├── main/                    # Electron main process
│   ├── index.ts             # точка входа, жизненный цикл, окно, cleanup
│   ├── config/              # чтение/запись config.yaml
│   ├── core/                # 15 модулей-движков (см. §5)
│   ├── resolve/             # трей, меню, шорткаты, темы, видимость окна
│   ├── sys/autoRun.ts       # автозапуск через Task Scheduler
│   └── utils/               # пути, логгер, YAML, merge, elevation, IPC-роутер
├── preload/index.ts         # contextBridge
├── renderer/src/
│   ├── pages/               # home, telegram, zapret, incy, logs, settings, about
│   ├── components/          # sidebar, карточки Zapret, overlay обновления, UI-кит
│   ├── store/               # 5 zustand-сторов, подписанных на IPC-события
│   ├── utils/ipc.ts         # типизированные обёртки над invoke()
│   └── locales/             # ru-RU, en-US, zh-CN
└── shared/types/            # глобальные .d.ts (AppConfig, CoreStatus, ControllerLog)

resources/                   # бинарники, вшиваемые в установщик (~50 МБ)
├── zapret/                  # 21 стратегия general*.bat + bin/ + lists/ + service.bat
├── tgws/TgWsProxy_windows.exe
└── incy/sing-box.exe
```

---

## 3. Жизненный цикл приложения (`src/main/index.ts`)

Порядок запуска строго последовательный:

1. `app.setName('lazeyka' | 'lazeyka-dev')` — **до** любого обращения к `userData`,
   поэтому dev-сборка полностью изолирована в `%APPDATA%\lazeyka-dev`.
2. `requestSingleInstanceLock()` — второй экземпляр просто показывает окно первого
   (`app.on('second-instance') → showMainWindow()`).
3. `process.on('uncaughtException' | 'unhandledRejection')` → `appLog('error', …)` —
   всё летит на страницу «Логи», а не в невидимый stdout.
4. `getAppConfigSync()` → если `disableGPU`, вызывается `app.disableHardwareAcceleration()`
   (это обязано случиться до `app.whenReady()`, поэтому чтение синхронное).
5. `init()` стартует параллельно, ждётся внутри `whenReady`.
6. В `whenReady`:
   - проверка прав администратора (`isRunningAsAdmin()`), в проде без них — модалка и выход;
   - `registerIpcMainHandlers()`;
   - автозапуски: `tgws.autoStart` → `startTgws()`, `zapret.autoStart` → `startZapret()`,
     `incySettings.autoConnect` → `connectIncyNode()`; **иначе** принудительно
     `clearWindowsSystemProxy()` (защита от «нет интернета» после падения/перезагрузки);
   - синхронизация `autoLaunch` с реальной задачей планировщика;
   - `createWindow()`, затем `initShortcut()` + `createTray()`.

### Ключевые функции

| Функция | Назначение |
| --- | --- |
| `showError(title, msg)` | шлёт `showError` в renderer (toast), fallback — нативный `dialog.showErrorBox` |
| `createWindow(cfg)` | окно 1000×720, `frame: false` (свой титлбар), `backgroundMaterial: 'mica'`, `windowStateKeeper` для запоминания геометрии |
| `showMainWindow()` | восстановление из свёрнутого/скрытого + пересчёт `skipTaskbar` по текущему конфигу |
| `triggerMainWindow()` | тумблер показать/скрыть (двойной клик по трею, глобальный шорткат) |
| `syncKillChildren()` | **синхронный** `taskkill /F /T` для `TgWsProxy_windows.exe`, `winws.exe`, `sing-box.exe` + `sc stop WinDivert*` + сброс `ProxyEnable=0` в реестре |
| `cleanupServices()` | асинхронная остановка всех трёх движков с общим таймаутом 3 с, затем `syncKillChildren()` |

### Логика закрытия окна

`mainWindow.on('close')`:
- если трей включён **и жив** (`isTrayActive()`) → `preventDefault`;
  - при `hideTaskbarIcon` → `setSkipTaskbar(true) + hide()`
  - иначе → `minimize()`
- если трея нет → реальное закрытие → `before-quit` → `cleanupServices()` → `app.exit(0)`.

Дополнительно `process.on('exit' | 'SIGINT' | 'SIGTERM')` вызывают `syncKillChildren()` —
чтобы прокси **никогда** не пережил LAZEYKA (например при убийстве через Диспетчер задач).

> ⚠️ Важный комментарий в коде: служба `WinDivert` намеренно **не удаляется** (`sc delete`)
> при выходе, только `sc stop`. Причина — гонка с SCM при логон-триггере после перезагрузки:
> свежий `winws.exe` не успевал бы зарегистрировать службу, `WinDivertOpen()` молча падал,
> процесс жил, но пакеты не перехватывались (UI показывал «работает», а Discord не работал).

---

## 4. Конфигурация и файловая система

### `src/main/utils/dirs.ts`

| Функция | Возвращает |
| --- | --- |
| `isPortable()` | `true`, если рядом с `.exe` лежит файл-маркер `PORTABLE` |
| `dataDir()` | `<exeDir>/data` в портативе, иначе `app.getPath('userData')` |
| `resourcesDir()` | dev → `<project>/resources`, прод → `process.resourcesPath` |
| `tgwsBinaryPath()` | сначала `runtime/tgws/TgWsProxy_windows.exe` (если >1 МБ), иначе вшитый в `resources/` |
| `zapretBundleDir()` | `runtime/zapret`, если там есть `general.bat` + `bin/winws.exe`, иначе `resources/zapret` |
| `incyBinaryPath()` | `runtime/incy/sing-box.exe` → fallback на `resources/incy` |
| `appConfigPath()` / `logDir()` / `themesDir()` | `<dataDir>/config.yaml`, `logs/`, `themes/` |

Приоритет «runtime → resources» — это и есть механизм авто-обновления: апдейтер пишет новую
версию в `%APPDATA%\lazeyka\runtime\...`, а вшитая копия остаётся резервной.

### `src/main/utils/init.ts` — `init()`

```
initDirs()                   → создаёт themes/, logs/, runtime/{tgws,zapret,incy}
initRuntimeBundles()         → распаковывает вшитые бандлы в runtime/, НЕ перетирая существующие
                               (для zapret отдельно доливает недостающие файлы в lists/)
initConfig()                 → пишет defaultConfig, если config.yaml отсутствует
initDeeplink()               → регистрирует схемы lazeyka:// и tg-ws://
```

### `src/main/config/app.ts`

- `getAppConfig(force?)` — читает YAML, при повреждении пробует `.backup`, затем `defaultConfig`;
  делает `deepMerge(defaultConfig, saved)` (бэкфилл новых полей в старых конфигах);
  чинит невалидную тему; сравнивает `lastBuildId` с `__BUILD_ID__` и `configVersion` с `CONFIG_VERSION`,
  при расхождении перезаписывает файл.
- `patchAppConfig(patch)` — сериализованная очередь записи (`writePromise`), после записи
  **реагирует на побочные эффекты**: `autoLaunch` → enable/disableAutoRun,
  `disableTray` → создание/уничтожение трея на лету, `hideTaskbarIcon` → `applySkipTaskbar()`.
- `getAppConfigSync()` — синхронное чтение для мест, где нельзя ждать промис (GPU-флаг, обработчик `close`).
- `safeWriteConfig()` — атомарная запись: `.tmp` → бэкап старого в `.backup` → `rename`.

### `__BUILD_ID__`

`electron.vite.config.ts` вшивает `${Date.now()}-${random}` в main-бандл на каждой сборке.
При первом запуске новой сборки `lastBuildId` не совпадает → сохраняется новый ID.
Это тот же механизм, который гарантирует уникальность MTProto-секрета на каждой установке.

---

## 5. Core-модули (`src/main/core/`)

### 5.1 `tgws.ts` — Telegram WS Proxy

Состояние модуля: `child: ChildProcess | null`, `status: CoreStatus`, `opLock`.

**Предполётные проверки в `startTgwsImpl()`:**

1. `ensureSecret()` — секрет обязан быть 32 hex-символа; иначе генерируется новый
   (`randomBytes(16)`) и сразу персистится в конфиг.
2. `ensurePortFree(host, port)` — `tryListen()` поднимает временный сервер;
   при `EADDRINUSE` → `killStaleTgws()` (`taskkill /F /IM TgWsProxy_windows.exe /T`) → повторная проверка;
   если порт всё ещё занят — исключение.
3. `ensureFirewallRule(port)` — `netsh advfirewall firewall add rule …` (best-effort).
4. `isColdBoot()` (`os.uptime() < 180 c`) → фоновый `waitForNetwork()`: TCP-пинг DC-адресов
   на :443 с экспоненциальным бэкоффом (500 мс → 4 с, дедлайн 30 с). Не блокирует запуск.

**Спавн:** привязка всегда к `0.0.0.0` (чтобы телефон в той же Wi-Fi сети мог подключиться),
аргументы: `--host --port --secret --dc-ip … [--buf-kb] [--pool-size] [-v] [--no-cfproxy]
[--cfproxy-domain] [--fake-tls-domain]`. Через 120 мс проверяется, что процесс не умер.

**Остановка:** на Windows `taskkill /F /T /PID`, гонка с 500-мс таймаутом, затем `SIGKILL` (не-Windows).

**Ссылки:**

- `getTgwsShareLinks()` → `{ localLink, lanLink, httpLink, httpLanLink, lanIp, host, port, secret }`.
  Локальная — `tg://proxy?server=127.0.0.1&…`, LAN — тот же формат с IP из `getLocalNetworkIps()`
  (сортировка так, чтобы `192.168.*` был первым).
- `pingTelegramDataCenters()` — 5 датацентров (Pluto/Venus/Aurora/Vesta/Flora).
  `measureDCLatency()` делает трёхступенчатый замер: ICMP `ping -n 1` (парсит и русский, и
  английский вывод) → TCP-connect → HTTPS GET. Порог `> 180 мс` = `slow`.

### 5.2 `zapret.ts` — обход DPI

- `listStrategies()` — сканирует бандл на `general*.bat`, из первых 10 строк вытаскивает
  комментарий `::`/`REM` как описание. 21 стратегия в поставке (`general.bat`, `ALT`…`ALT12`,
  `EXP`, `FAKE TLS AUTO*`, `SIMPLE FAKE*`).
- `installZapretBundle(zipBytes)` — самая объёмная функция модуля:
  1. останавливает Zapret и `sc stop/delete` все имена WinDivert (файл `.sys` заблокирован иначе);
  2. валидирует архив: обязаны быть `general.bat` и `bin/winws.exe`; определяет `rootPrefix`;
  3. **сохраняет в память** все файлы из `lists/` перед `rmSync` папки;
  4. распаковывает (с защитой от path-traversal `..`);
  5. восстанавливает все `*-user.txt`, `*.backup` и любые нестандартные файлы **как есть**;
  6. для `list-general.txt`, `list-google.txt`, `list-exclude.txt` делает **умный merge**:
     свежий upstream-список + строки пользователя, которых в нём нет (регистронезависимо);
  7. патчит `.bat`: удаляет обёртку `start "zapret: %~n0" /min` (иначе `winws.exe` был бы
     внуком, невидимым для `taskkill /T`, и открывал бы окно консоли);
  8. патчит `service.bat`: `pause` → `if not defined NO_UPDATE_CHECK pause`;
  9. вытаскивает версию из имени корневой папки `zapret-discord-youtube-X.Y.Z/`.
- `ensureWinDivertReady()` — предполётная проверка драйвера:
  - `findWinDivertService()` перебирает `WinDivert | windivert | WinDivert64 | windivert64`,
    кэширует найденное имя;
  - `scQueryOne()` парсит `sc query` (состояние) + `sc qc` (`BINARY_PATH_NAME`);
  - если путь службы указывает на несуществующий/чужой `.sys` — `sc stop` + `sc delete`,
    чтобы `winws.exe` перерегистрировал её сам;
  - если служба остановлена — синхронный `sc start` (код 1056 = «уже запущена», игнорируется).
- `startZapretImpl()`:
  - если Zapret уже стоит **как служба Windows** и запущен — статус `running`, выход;
  - `isWinwsRunning()` → при необходимости `killWinws()`;
  - `ensureWinDivertReady()`, `resetWinwsHealth()`;
  - спавн `cmd.exe /c "<strategy>.bat"` с env: `NO_UPDATE_CHECK=1`,
    `GameFilterTCP/UDP` (`1024-65535` или `12` в зависимости от режима Game Filter);
  - **health-детект по stdout** (`ingestWinwsLine`): `"windivert initialized" | "capture is started"`
    → `capturing`; `"windivert…failed" | "access is denied" | "requires admin"` → `failed`.
    Цикл ждёт до 7 с; при `capturing` + живом процессе → `running`; при `failed` → ошибка
    с текстом от winws; по таймауту, если процесс всё же жив — `running` с предупреждением.
- `stopZapretImpl()` — `killWinws()` по имени образа + `taskkill /F /T /PID` для `cmd`-обёртки.
- `withZapretLock(fn)` — экспортируемый мьютекс, которым тестер стратегий захватывает движок целиком.

### 5.3 `zapret-service-settings.ts` — зеркало `service.bat`

Всё состояние читается **с диска**, а не из конфига — файлы бандла остаются источником правды.

| Блок | Функции | Как работает |
| --- | --- | --- |
| Game Filter | `getGameFilterMode()`, `setGameFilterMode()` | флаг-файл `utils/game_filter.enabled` с содержимым `all\|tcp\|udp`; отсутствие = `off` |
| IPset Filter | `getIpsetFilterMode()`, `getIpsetFilterSnapshot()`, `setIpsetFilterMode()`, `updateIpsetList()` | режим выводится из содержимого `lists/ipset-all.txt`: пусто = `any`, только `203.0.113.113/32` = `none`, иначе `loaded`. Переключение перекладывает файл в `.backup` и обратно. Обновление тянет `ipset-service.txt` из репозитория Flowseal |
| Active Fakes | `getActiveFakesState()`, `setActiveFake()` | сравнивает SHA-256 `bin/ACTIVE_DISCORD_UDP.bin` / `ACTIVE_GAME_UDP.bin` со всеми `*.bin` в `bin/`, чтобы понять, какой фейк активен; смена = `copyFileSync` |
| Служба Windows | `getZapretWindowsServiceStatus()`, `installZapretWindowsService()`, `removeZapretWindowsService()` | `parseStrategyArgsForService()` выдирает аргументы `winws.exe` из `.bat` (склеивая строки по `^`), разворачивает `%BIN%`/`%LISTS%`/`%GameFilter*%` в абсолютные пути, и пишет их в `ImagePath` службы `zapret`; имя стратегии кладётся в отдельный REG_SZ |
| hosts | `checkZapretHostsFile()`, `updateZapretHostsFile()` | сравнивает первую/последнюю строку эталонного hosts от Flowseal с системным; апдейт дописывает блок под маркером `# --- Zapret Discord / YouTube hosts ---` |
| Прочее | `getCheckUpdatesFlag()` / `setCheckUpdatesFlag()`, `launchZapretTestsScript()` | флаг-файл `utils/check_updates.enabled`; запуск `utils/test zapret.ps1` в видимом окне |

`executeScriptWithAdmin(script)` — пишет `.cmd` во временную папку и пробует три способа:
прямой `cmd /c` → `Start-Process -Verb RunAs` → `mshta vbscript:…ShellExecute(…,"runas")`.

**Диагностика** `runZapretDiagnostics()` возвращает 7 проверок:
BFE-служба, TCP Timestamps (парсинг `netsh interface tcp show global` на двух языках),
системный прокси, конфликтующие службы (GoodbyeDPI, `discordfix_zapret`, `winws1/2`,
зависший WinDivert), AdGuard в процессах, файл hosts, установленные клиенты Discord.
`fixDiagnosticIssue(action)` реализует 6 фиксов, включая `clear_discord_cache`
(убивает клиенты и сносит `Cache`/`Code Cache`/`GPUCache`).

### 5.4 `zapret-tester.ts` — авто-подбор стратегии

- 10 HTTPS-целей (Discord ×4, YouTube/Google ×4, google.com, cloudflare.com).
- `runStrategyTests()` захватывает `withZapretLock` на всё время прогона:
  для каждой стратегии → `killWinws()` → `ensureWinDivertReady()` → спавн `.bat` →
  ожидание появления `winws.exe` (до 6 с) → **прогрев 4.5 с** (эмпирика: меньше 3 с даёт
  ложные негативы на первой стратегии) → `probeAll()` последовательно с паузой 60 мс.
- Порог прохождения `PASS_THRESHOLD = 0.5` (≥5 из 10 целей).
- Прогресс шлётся в renderer каналом `zapret:testProgress` (`starting → testing → completed|error`).
- Отчёт кешируется в памяти и в `<dataDir>/zapret-test-results.json`.
- Если Zapret был запущен до теста — восстанавливается **вне** лока.

### 5.5 `zapret-iplist.ts` — редактор `list-general.txt`

6 курируемых наборов доменов (Discord, Telegram, YouTube/Google, Cloudflare, Twitch, Spotify).
Валидация строки: IPv4/IPv6 CIDR **или** FQDN (с поддержкой `*.example.com`, ≤253 символов).
`ensureBackup()` при первой правке копирует оригинал в `.backup`;
`applyIpListPatch({setIds, customCidrs, replace})` мержит с дедупликацией;
есть `clearIpList()` и `restoreIpListBackup()`.

### 5.6 `zapret-autopilot.ts`

Периодически (`setInterval`, по умолчанию 30 мин) `runAutopilotCycle()`:
`checkNetworkHealth()` пробит `youtube.com/generate_204` и `discord.com/api/v9/gateway`;
при деградации перебирает до 3 альтернативных стратегий (патчит конфиг → `restartZapret()`
→ ждёт 2 с → повторная проверка); при неудаче откатывается на исходную.
Кольцевой лог на 50 записей.

> ⚠️ `runAutopilotCycle(false)` читает флаг `cfg.zapret.autopilotEnabled`, которого
> **нет ни в типе `ZapretConfig`, ни где-либо в записи конфига** — то есть таймер
> просыпается и сразу выходит. Реально цикл отрабатывает только при `force = true`
> (кнопка «Проверить сейчас»). См. §9.

### 5.7 `zapret-builder.ts`

`generateCustomStrategyBat(config)` — генератор `.bat` из конструктора в UI:
режим десинхронизации (`fake | diso | fakeddiso | multisplit | split2`), `split-pos`, TTL,
метод обмана (`md5sig | badseq | datanoack | badsum | none`), файл фейкового payload,
опциональная UDP/QUIC-секция. Имя файла санитизируется и сохраняется как
`general (<Name>).bat`, поэтому новая стратегия автоматически попадает в `listStrategies()`.

### 5.8 `incy-engine.ts` — прокси/VPN на sing-box (1242 строки)

**Парсинг конфигов**

- `parseIncyUri(uri)` — поддерживает `vless://` (включая Reality: `pbk`, `sid`, `flow`, `fp`),
  `hysteria2://` / `hy2://`, `ss://` (обе формы — с base64 в userinfo и полностью base64),
  `trojan://`.
- `parseJsonConfigItem(item, idx)` — разбирает JSON-конфиги в формате
  Xray (`settings.vnext`, `streamSettings`) **и** sing-box (`server_port`, `tls.reality`).
- `fetchIncySubscription(url)` — свой `fetchHttpRaw()` с ручными редиректами (до 5) и
  User-Agent `INCY/3.5.0`. Из заголовков вытаскивается: `profile-title` (в т.ч. `base64:`),
  `subscription-userinfo` (download/upload/total/expire), `profile-web-page-url`,
  `support-url`, `premium-url`, `x-app-key-number`, `profile-update-interval`,
  `announce`/`profile-announcements`. Тело пробуется как JSON → base64 → построчный список URI.
- `importIncyInput(input)` — единая точка входа: URL подписки / одиночный URI / base64-пачка.

**Подключение** `connectIncyNode(nodeId?)`:

1. `stopRunningChild()` (taskkill дерева) — переключение узла всегда через полный рестарт;
2. собираются `bypassDomains` = `getAllBypassDomains()` (см. 5.10) + `extraBypassAddresses`;
3. генерируется конфиг sing-box: `mixed`-inbound (SOCKS+HTTP на `mixedPort`, по умолчанию 20808,
   слушает `0.0.0.0` при `allowLan`), опциональный `tun`-inbound (`172.19.0.1/30`,
   `auto_route: true`, `strict_route: true`, `stack: 'mixed'`), DNS с remote-через-proxy и
   local-через-direct, FakeIP `198.18.0.0/15`, правила маршрутизации (`block` для UDP,
   `domain_suffix → direct` для bypass-списка);
4. `buildSingBoxOutbound(node, settings)` формирует outbound по протоколу
   (uTLS-fingerprint, Reality-ключи, `multiplex: h2mux` при `multiplexing`);
5. конфиг пишется в `<dataDir>/sing-box-config.json`, спавнится `sing-box.exe run -c …`;
6. режим `system_proxy` → `setWindowsSystemProxy(port, bypassDomains)`, остальные режимы →
   `clearWindowsSystemProxy()`.

**Пинг** `pingIncyNode()`: для TCP-протоколов — обычный `net.Socket` connect с
DNS-кэшем (`resolveHostFast`, TTL 120 с, максимум 200 записей).
Для Hysteria2 сначала пробуется TCP, при неудаче — реальный QUIC-хендшейк через
`sing-box tools fetch https://www.gstatic.com/generate_204` с вычетом ~470 мс накладных расходов.

**Прочее**: кольцевой лог на 250 строк (`getIncyLogs` / `clearIncyLogs`),
счётчики `IncyStats`, `IncySettings` (~50 полей) в `incy-settings.json`,
узлы в `incy-nodes.json`, подписка в `incy-sub.json`.

### 5.9 `dns-doh.ts`, `discord-ping.ts`, `game-mode.ts`

- **DoH**: 5 провайдеров (Cloudflare, Google, AdGuard, Quad9, Xbox DNS).
  `pingDohProvider()` делает реальный DNS-JSON-запрос. `applySystemDns(target)` через PowerShell
  прописывает `Add/Set-DnsClientDohServerAddress` + `Set-DnsClientServerAddress` на все адаптеры,
  дублируя `netsh` для Ethernet/Wi-Fi, и делает `ipconfig /flushdns`. `'dhcp'` — сброс.
- **Discord RTC**: TCP-пинг 5 эндпоинтов, градация `optimal <65 мс < good <130 мс < poor`.
- **Smart Game Mode**: каждые 8 с `tasklist /FO CSV`, ищет 13 процессов (Discord, Steam, CS2,
  Valorant, Dota 2, Apex, Overwatch, GTA5, Fortnite, Roblox, LoL). При обнаружении включает
  `Game Filter = all`, при закрытии — возвращает предыдущий режим.
  ⚠️ Та же проблема, что у автопилота: читается несуществующий флаг `cfg.smartGameModeEnabled`.

### 5.10 `split-tunneling.ts`

8 встроенных категорий доменов РФ (зоны `.ru/.рф/.su`, поисковики, госуслуги, банки,
маркетплейсы, телеком, медиа, карты) + пользовательские исключения.
`getAllBypassDomains()` собирает итоговый плоский список — его потребляет INCY
(правило `domain_suffix → direct`) и `setWindowsSystemProxy` (ProxyOverride).
Хранится в `<dataDir>/split-tunneling.json`.

### 5.11 Три апдейтера

| Модуль | Репозиторий | Что качает | Кеш |
| --- | --- | --- | --- |
| `zapret-updater.ts` | `Flowseal/zapret-discord-youtube` | `.zip` бандла → `installZapretBundle()` | 12 ч |
| `tgws-updater.ts` | `reb0oornalexey/LAZEYKA` | `TgWsProxy_windows.exe` | 12 ч |
| `app-updater.ts` | `reb0oornalexey/LAZEYKA` | NSIS-инсталлятор `LAZEYKA_x64.exe` | 6 ч |

Общие черты: `compareVersion()` с числовым сравнением сегментов (чтобы `1.7.10 > 1.7.7`),
персистентный кеш через `utils/update-cache.ts` (`update-cache-<name>.json` в `dataDir`),
фоновое обновление кеша по достижении половины TTL, поддержка «Позже» через
`dismissedUpdateTag` (баннер молчит ровно до следующего тега).

**`installTgwsUpdate()`** дополнительно валидирует скачанный бинарник: пишет во временный файл,
запускает `--help` и проверяет отсутствие `ModuleNotFoundError` / `Fatal Python error` /
`Failed to execute script` — только потом заменяет рабочий файл.

**`installAppUpdate()`** — самый хитрый путь:
1. качает инсталлятор в `%TEMP%`, проверяет размер (≥5 МБ);
2. `writeUpgradeMarker()` — файл `.lazeyka-upgrade` рядом с `LAZEYKA.exe`; **старый**
   деинсталлятор по нему понимает, что это апгрейд, и не сносит `%APPDATA%\lazeyka`;
3. `spawn(installer, ['/S', '--updated'], { detached: true })`;
4. поднимает PowerShell-«сторож»: ждёт завершения процесса инсталлятора (до 5 мин),
   +3 с на пост-скан Defender, ждёт появления `.exe` на диске, потом `Start-Process`
   с фолбэком на `[System.Diagnostics.Process]::Start`; всё логируется в
   `%TEMP%\LAZEYKA-relaunch-*.log`;
5. через 800 мс `app.quit()`, через ещё 1 с — `process.exit(0)`.

### 5.12 `profile-manager.ts`

`exportLazeykaProfile()` собирает `.lazeyka` (JSON, `version: 2`): весь `AppConfig`,
все `lists/*.txt`, имена активных UDP-фейков. `importLazeykaProfile()` восстанавливает всё
обратно (файл без метки формата, но с секцией `config`, тоже принимается — так
сохраняли очень старые версии).

### 5.13 Спутники INCY

| Модуль | Зачем |
| --- | --- |
| `incy-topology.ts` | Планировщик бесконфликтной топологии: SINGBOX_ONLY / XRAY_ONLY / CHAINED. Раздаёт порты `front = base`, `socks = base+1`, `clashApi = base+2`, `bridge = base+3` — у каждого дефицитного ресурса (TUN, порт, системный прокси) ровно один владелец. |
| `incy-xray.ts` | Генератор конфига Xray: `freedom` с `fragment`/`noises`, `dialerProxy`, mux/`xudpProxyUDP443`, транспорты ws/grpc/httpupgrade/xhttp, три уровня гео-правил (`full` → `minimal` → `none`). |
| `incy-geo-updater.ts` | Автообновление geoip/geosite от RoscomVPN: GitHub Releases с фолбэком на jsDelivr. `areGeoDatabasesReady()` требует записанный тег, иначе штатные базы Xray не выдавались бы за RoscomVPN-овские. |
| `incy-core-updater.ts` | Автообновление ядер. Патч-версии ставятся молча, minor/major только сообщаются: sing-box меняет схему конфига между минорами. Кандидат проверяется `sing-box check` / `xray -test` до подмены, старый бинарник остаётся как `.bak`. |
| `incy-stats.ts` | Настоящий учёт трафика. Включает `experimental.clash_api` в конфиге sing-box (loopback + разовый секрет), раз в секунду читает `/connections`, копит сессию и пожизненные итоги, хранит историю за 14 дней в `<dataDir>/incy-stats.json`. Если ядро собрано без Clash API — preflight откатывает конфиг без `experimental`, и считаются только время и число подключений. |
| `incy-backup.ts` | Экспорт/восстановление INCY: подписка, серверы, правила, настройки. Восстановление двухшаговое (`pickIncyBackup` → предпросмотр → `applyIncyBackup`). Логин/пароль локального прокси и замеры пинга в файл не попадают. |
| `incy-watchers.ts` | Три фоновых поведения: `powerMonitor` suspend/resume для «Отключать при сне», уведомление об истечении подписки (по `expireAt`, не чаще раза в сутки), опрос RSS ядер через `tasklist` для монитора памяти. |
| `deeplink.ts` | Схема `lazeyka://`: `connect`/`open`, `disconnect`/`close`, `toggle`, `import/{base64}`, `add/{url}`, `routing/add|oneadd/{base64}`, `restore/{base64}`. Приходит через `second-instance` (Windows) или `open-url` (macOS), плюс разбор `process.argv` при холодном старте. |

**Профили маршрутизации** живут слоем *над* движком: активация профиля копирует его
`mode` / `geoRouting` / `rules` в те же поля `IncySettings`, которые генератор конфига читал
всегда. Никакая новая форма конфига до ядра не доходит, а `saveIncySettings()` сбрасывает
метку активного профиля, как только живые настройки от него отклоняются.

---

## 6. IPC-слой

**Схема:** renderer вызывает `invoke('<channel>', …args)` из `renderer/utils/ipc.ts`;
main оборачивает каждый обработчик в `h(fn)`, который возвращает
`{ ok: true, value }` или `{ ok: false, message }`. Обёртка `invoke<T>()` в renderer
разворачивает результат и **бросает Error**, если `ok === false`. Ни один необработанный
throw в обработчике не роняет main-процесс.

**Обратные каналы (main → renderer, broadcast всем окнам):**

| Канал | Кто шлёт | Кто слушает |
| --- | --- | --- |
| `log` | `appLog()`, `tgws.log()`, `zapret.log()` | `logs-store` |
| `tgws:status` / `zapret:status` / `incy:status` | `setStatus()` / `broadcastStatus()` | одноимённые сторы |
| `zapret:testProgress` | `zapret-tester` | `zapret-test-store` (+ глобальный toast) |
| `showError` | `showError()` | `App.tsx` → toast |
| `window:visibility` | обработчики окна | `App.tsx` (сброс «залипшего» hover) |

**Особый случай — `openTelegramLink(url)`.** Прямой `shell.openExternal('tg://…')` из
процесса, запущенного от администратора, открывает Telegram тоже под админом (или вовсе
не срабатывает). Поэтому реализован обход через планировщик:
временный `.vbs` с `Shell.Application.ShellExecute` → `schtasks /Create` с `/RL LIMITED /IT`
(пониженные права, интерактивный токен) → `/Run` → через 5 с задача и `.vbs` удаляются.
Есть fallback на `shell.openExternal` и защёлка 600 мс от двойных кликов.

Всего зарегистрировано **~75 каналов**, сгруппированных по префиксам:
`app:`, `theme:`, `shell:`, `clipboard:`, `tgws:`, `zapret:`, `autopilot:`, `dns:`,
`gameMode:`, `discord:`, `incy:`, `builder:`, `splitTunneling:`, `profile:`, `system:`,
плюс безпрефиксные `window*`.

---

## 7. Системная интеграция (`resolve/` + `sys/`)

- **`tray.ts`** — `createTray()` строит меню: показать/скрыть окно, подменю INCY / Zapret /
  Telegram с пунктами запуска-остановки, «Быстрое переключение стратегии» (первые 10,
  radio-пункты, при переключении на лету рестартит Zapret), выход.
  Пересборка меню по таймеру раз в 10 с + мгновенно через `refreshTray()` из событий окна.
  Иконка меняется на `icon_on`, если работает хоть один движок.
  `iconPath()` перебирает 6 кандидатных путей (dev/packaged, .ico/.png) и логирует, если не нашёл.
- **`shortcut.ts`** — глобальные хоткеи: показать окно, тумблер TGWS, тумблер Zapret.
- **`theme.ts`** — `setNativeTheme()`, плюс механика пользовательских CSS-тем из `themesDir()`
  (первая строка `/* Название */` = label); `applyTheme()` инжектит CSS через
  `webContents.insertCSS` с удалением предыдущего ключа.
- **`menu.ts`** — нативное меню только для macOS; на Windows/Linux `Menu.setApplicationMenu(null)`.
- **`autoRun.ts`** — автозапуск через **Task Scheduler**, а не HKCU\Run: генерируется
  XML (UTF-16LE + BOM — требование schtasks) с `LogonTrigger`, `RunLevel: HighestAvailable`,
  `MultipleInstancesPolicy: IgnoreNew`, аргументом `--hidden`. Это единственный способ
  автостарта приложения, которому нужен админ, без запроса UAC при каждом входе.
  Заодно снимается запись в `HKCU\…\Run`: автозапуск ведётся только через
  планировщик, и дублирующая запись стартовала бы приложение дважды.
- **`elevation.ts`** — `isRunningAsAdmin()` с тремя проверками по убыванию надёжности:
  `fltmc.exe` → `fsutil dirty query` → `net session`; результат кешируется.

---

## 8. Renderer

### Точка входа

`main.tsx` → `NextThemesProvider` → `BaseErrorBoundary` → `HashRouter` → `AppConfigProvider` → `App`.
`App.tsx` при монтировании подключает 5 сторов (`attach*Store()` возвращают детач-функции),
синхронизирует тему, подгружает кастомный CSS и лечит «залипший hover» Electron
(на `blur`/`focus`/IPC-событие делает `blur()` активного элемента и на 120 мс вешает класс `hover-reset`).

### Страницы

| Маршрут | Содержимое |
| --- | --- |
| `/home` | две больших «power core» кнопки (Telegram / Zapret) с аптаймом на `NumberFlow`, баннеры обновлений Zapret/TgWs, `LiveTrafficMonitor` (recharts, опрос `netstat -e` раз в 2.5 с), кнопка «Перезагрузить службы» |
| `/telegram` | `SwitcherCard`, поле ссылки + копировать/открыть/перегенерировать секрет, QR-код (`qrcode.react`) с переключателем LAN/localhost, монитор задержки 5 датацентров, поля host/port/secret |
| `/zapret` | баннер обновления, `SwitcherCard`, карточки IP-списка / настроек службы / автопилота / конструктора стратегий, каталог стратегий с результатами теста (после теста сортируется по score, провалившиеся дизейблятся, лучшая помечается) |
| `/incy` | 7 вкладок: Главная, Сервера, Настройки, Статистика, Логи, Бэкап, URL-схемы. Пинг всех узлов пулом из 5 воркеров, фильтры по протоколу и поиску, флаги стран по эвристике имени |
| `/logs` | виртуализированный список (`react-virtuoso`), фильтр по тексту и источнику (`all/tgws/zapret/app`), тумблер автоскролла |
| `/settings` | тема, DoH-провайдеры, split tunneling (8 категорий + свои домены), экспорт/импорт `.lazeyka`, автозапуск/тихий старт/автостарты движков, трей и панель задач, отключение GPU |
| `/about` | описание модулей, подсказки, ссылки |

### Сторы

Все пять построены одинаково: `create()` из zustand + `attachXStore()`, который
делает `removeAllListeners` (защита от дублей при HMR/StrictMode), вешает слушатель IPC,
подтягивает начальное состояние через `invoke` и возвращает функцию отписки.

`zapret-test-store` дополнительно показывает единый глобальный toast о завершении теста
на любой открытой вкладке (дедупликация по `report.ranAt`).

### i18n

`i18next` + `react-i18next`, три словаря (~980 строк каждый). Язык берётся из
`localStorage`, иначе определяется по `navigator.language`, иначе `ru-RU`.
Параллельно настраивается локаль `dayjs`.

> Фактически большая часть UI написана русским текстом прямо в JSX; словари покрывают
> в основном сайдбар и error boundary. `t(...)` вызывается с `defaultValue`.

---

## 9. Исправленные проблемы

Найдены при сверке кода и исправлены (typecheck по обоим tsconfig проходит чисто).

### 9.1 Захардкоженные версии убраны

Было: `BUNDLED_TGWS_VERSION` / `BUNDLED_ZAPRET_VERSION` в четырёх местах, причём
main и renderer разошлись (`1.10.0`/`1.10.1` против `1.6.6`/`1.9.8c`). Приложение
считало себя «актуальным» на выдуманной версии и не предлагало обновление, а UI
показывал заведомо неверный номер.

Стало: `installedVersion` берётся **только** из конфига — того значения, которое
записал апдейтер после реальной установки. Пока обновление ни разу не ставилось,
`installed` = `undefined`, а для сравнения используется базовая линия `0.0.0`:

```ts
function installedVersion(cfgInstalled?: string): string | undefined { … }
function compareBaseline(installed?: string): string { return installed ?? '0.0.0' }
hasUpdate = !!latest && compareVersion(latest, compareBaseline(installed)) > 0
```

Итог: **на первом запуске любой опубликованный релиз считается новее**, баннер
«Доступно обновление» появляется сразу, обновление ставится в один клик.
В renderer вместо фейкового номера — честное «Сейчас используется встроенная сборка»
(`formatInstalledVersion()` в `lib/utils.ts`), плашка версии просто не рисуется,
пока реальная версия неизвестна.

### 9.2 `incy:refreshSubscription` — обработчика не существовало

Кнопка «Обновить подписку» гарантированно падала. Добавлены
`refreshIncySubscription()` в `incy-engine.ts` и регистрация канала в `main/utils/ipc.ts`.

Попутно закрыты две сопутствующие проблемы: парсеры генерируют новый случайный `id`
на каждую загрузку, поэтому обновление подписки раньше обнулило бы все замеры
задержки и сбросило выбранный сервер. Теперь узлы сопоставляются по стабильному
ключу `protocol://host:port` (`nodeIdentity()`), пинги переносятся, выбранный
сервер переуказывается на тот же эндпоинт под новым id. Живой туннель не трогается.

### 9.3 Автопилот и Smart Game Mode

Оба читали флаги, которых не существовало ни в типах, ни в записи конфига
(`cfg.zapret.autopilotEnabled`, `cfg.smartGameModeEnabled`), и потому выходили на
первой строке цикла — UI показывал «включено», фактически не работало ничего.

- Источником правды стал живой таймер (`if (!autopilotTimer && !force) return`).
- Поля добавлены в `ZapretConfig` / `AppConfig` и теперь реально сохраняются.
- `restoreAutopilotFromConfig()` / `restoreGameModeFromConfig()` вызываются из
  `main/index.ts` при старте — тумблеры переживают перезапуск.
- `getAutopilotStatus()` возвращает настоящие `intervalMinutes` и `currentStrategy`
  (через `getAppConfigSync()`) вместо заглушек `30` и `''`.
- Выключение игрового режима при запущенной игре больше не оставляет Game Filter
  навсегда в состоянии `all` — предыдущий режим восстанавливается.
- Автопилот перечитывает конфиг перед каждым переключением стратегии: раньше он
  использовал снимок, сделанный до цикла, и мог откатить чужие изменения.

### 9.4 INCY: сохранённый режим соединения игнорировался

`currentStatus` инициализируется значением `'tun'`, а `connectIncyNode()` проверял
его **раньше** файла настроек. После перезапуска приложения выбор «Системный прокси»
или «Только прокси» молча терялся, и всегда поднимался TUN-адаптер.
Теперь источник правды — файл настроек (его пишет каждый сеттер), `getIncyStatus()`
и `connectIncyNode()` читают именно его.

Заодно `routingMode` стал персистентным полем `IncySettings`, а режимы
`global` и `direct` — реально реализованными через `route.final`
(раньше все три режима вели себя одинаково).

### 9.5 INCY: гонка при переключении сервера

`taskkill` асинхронный, поэтому обработчик `exit` убитого sing-box мог сработать
**после** запуска нового — и сбросить статус в `stopped`, обнулив `child`. Живой
процесс оставался сиротой, которого LAZEYKA больше не могла остановить.
Введён счётчик поколений `childGeneration`: обработчики запоминают своё поколение
и молча выходят, если их процесс уже заменён.

### 9.6 INCY: ложный «подключено»

`connectIncyNode()` рапортовал успех сразу после `spawn`, не проверяя, жив ли
процесс. При битом конфиге узла или занятом порте пользователь видел зелёный статус
и тост «INCY подключен» у мёртвого туннеля — а в режиме системного прокси Windows
дополнительно перенаправлялся на порт, который никто не слушает (интернет пропадал).
Добавлена проверка через 800 мс с понятным сообщением и последними строками лога.

### 9.7 Мелочи

- `restartAppShortcut` был объявлен в `AppConfig`, но нигде не регистрировался —
  добавлен в `initShortcut()` по аналогии с остальными.
- `cleanServerName()` в `pages/incy.tsx` использовал класс символов, составленный из
  «половинок» суррогатных пар (диапазоны high/low surrogate внутри `[...]`) — он срезал
  не только эмодзи, но и любой не-BMP символ в начале строки. Заменён на корректный
  `\p{Extended_Pictographic}` / `\p{Regional_Indicator}` под флагом `u`
  (общий хелпер `stripLeadingEmoji`, используется в двух местах).

---

## 9a. Что осталось как есть (осознанно)

1. **Мёртвые поля конфига** — `bundlePath`, `launchTelegram`, `launchDiscord`
   объявлены, но не используются. Это незаконченные функции, а не поломка;
   удаление типа сломало бы совместимость со старыми `.lazeyka`-профилями.
2. **`maxLogDays` без ротации** — логи живут только в памяти renderer (500 строк),
   в файл ничего не пишется. Чинить = реализовывать файловое логирование целиком.
3. **Часть настроек INCY декоративна** — из ~50 полей `IncySettings` в конфиг
   sing-box попадают ~15. `fragmentation*`, `noises*`, `killSwitch`, `hijackDns`,
   `perAppProxy`, `xudp*`, `idleTimeoutSec`, `maxTcp/UdpConnections` сохраняются,
   но на генерацию не влияют. Это объём отдельной задачи.
4. **Стилевые предупреждения ESLint** — `no-useless-escape` и `no-control-regex`
   в рабочих регулярках (`tgws.ts` парсинг вывода `ping`, `incy-engine.ts` разбор
   `ss://`), а также `react/prop-types` на TS-компонентах. Регулярки корректны,
   правка ради линтера рискованнее пользы.

---

## 10. Сборка

```bash
pnpm dev                 # electron-vite dev, данные в %APPDATA%\lazeyka-dev
pnpm build:win           # electron-vite build + electron-builder --win
pnpm build:asar          # только app.asar (для fast-update.bat)
pnpm typecheck           # tsc по tsconfig.node.json + tsconfig.web.json
node scripts/build-icons.mjs   # перегенерация иконок из SVG
```

**`.bat`-обёртки в корне:**

- `dev.bat` — чистит `out/main`, `out/preload` и кеши Vite, сбрасывает `ELECTRON_RUN_AS_NODE`, стартует dev.
- `build.bat` — 9 шагов с жёстким фейлом на каждом: проверка админа → проверка Node/pnpm →
  убийство запущенных процессов → очистка `dist`/`out` (`--clean` также сносит `%APPDATA%\lazeyka`) →
  `pnpm install` → пересборка иконок (`--skip-icons` пропускает) → typecheck → сборка → проверка артефактов.
- `auto-update.bat` — `git fetch` + пересборка + установка.
- `fast-update.bat` — быстрая подмена только `app.asar` (без переустановки).

**Артефакты:** `dist\LAZEYKA_x64.exe` (NSIS, perMachine, требует админа),
`dist\LAZEYKA_x64-portable.7z`, `dist\win-unpacked\`.

**`build/nsis/installer.nsh`:**
- `customInit` — пишет маркер `.lazeyka-upgrade` в старую папку установки;
- `customInstall` — правит запись в «Программы и компоненты» (Publisher, DisplayIcon, чистка версий);
- `customUnInstall` — убивает все процессы приложения и ядер, сносит задачи
  планировщика, ключи Run, URI-схемы `lazeyka`/`tg-ws` и рекурсивно удаляет `$INSTDIR`.

`electron-builder.yml` урезает локали Chromium до `en-US` + `ru` (~42 МБ → ~1.5 МБ) и
исключает из `extraResources` служебные файлы бандла Zapret (`.service/`, `.github/`, `*.backup`).

**Лицензия:** GPL-3.0, © 2026 reb0oorn; сторонние компоненты перечислены в `THIRD-PARTY-NOTICES.md`.
