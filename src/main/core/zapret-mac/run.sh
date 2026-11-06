#!/bin/sh
# LAZEYKA: запуск движка Zapret (utunws) на macOS.
# Запускает launchd от root (LaunchDaemon io.github.reb0oornalexey.lazeyka.zapret).
# Основа — run.sh из Flowseal/zapret-mac-discord-youtube (MIT); отличия помечены «LAZEYKA».
set -eu

DATA_ROOT=${1:-}
BASE='/Library/Application Support/LAZEYKA/zapret'
ANCHOR=com.apple/lazeyka-zapret
TOKEN_FILE=/var/run/lazeyka-zapret.pf-token
KEEPINIT_FILE=/var/db/lazeyka-zapret.keepinit
ARMED_FILE=/var/run/lazeyka-zapret.armed
CONF_FILE=/var/run/lazeyka-zapret.conf
ENGINE_PID=
WATCHDOG_PID=

# LAZEYKA: каждая остановка пишет в zapret.log время и причину — раньше в журнале
# было только «Killed: 9», и понять, кто и почему остановил движок, было нельзя.
log() { /bin/echo "$(/bin/date '+%Y-%m-%d %H:%M:%S') LAZEYKA: $*"; }
fail() { log "остановка: $*"; exit 1; }

# Мягкая остановка движка: TERM, до 3 с ожидания, только потом KILL.
stop_engine_pid() {
    P=$1
    [ -n "$P" ] || return 0
    kill "$P" >/dev/null 2>&1 || return 0
    N=0
    while kill -0 "$P" 2>/dev/null && [ "$N" -lt 30 ]; do sleep 0.1; N=$((N + 1)); done
    if kill -0 "$P" 2>/dev/null; then
        log "движок не завершился за 3 с — принудительно (KILL)"
        kill -9 "$P" >/dev/null 2>&1 || true
    fi
}

# DATA_ROOT приходит из plist (его пишет root при установке), но проверяем всё равно:
# рабочая папка приложения LAZEYKA в профиле пользователя (lazeyka-dev — dev-сборка).
case "$DATA_ROOT" in
    *..*) exit 1 ;;
    /Users/*/'Library/Application Support/lazeyka/zapret-mac') ;;
    /Users/*/'Library/Application Support/lazeyka-dev/zapret-mac') ;;
    *) exit 1 ;;
esac

# LAZEYKA: Zapret работает только пока его запустило приложение. Метку (время загрузки
# системы) ставит ctl.sh start. Если launchd поднял задачу сам (после перезагрузки) —
# метки нет или она от прошлой загрузки: тихо выходим кодом 0, KeepAlive не перезапустит.
if [ "$(/bin/cat "$ARMED_FILE" 2>/dev/null || true)" != "$(/usr/sbin/sysctl -n kern.boottime)" ]; then
    exit 0
fi

if [ -s "$KEEPINIT_FILE" ]; then
    /usr/sbin/sysctl -w net.inet.tcp.keepinit=7000 >/dev/null
fi

clear_intercept() {
    /sbin/pfctl -a "$ANCHOR" -F all >/dev/null 2>&1 || true
}

release_pf_token() {
    if [ -s "$TOKEN_FILE" ]; then
        TOKEN=$(/bin/cat "$TOKEN_FILE" 2>/dev/null || true)
        if [ -n "$TOKEN" ]; then /sbin/pfctl -X "$TOKEN" >/dev/null 2>&1 || true; fi
        /bin/rm -f "$TOKEN_FILE"
    fi
}

cleanup() {
    trap - EXIT INT TERM HUP
    clear_intercept
    if [ -n "$WATCHDOG_PID" ]; then kill "$WATCHDOG_PID" >/dev/null 2>&1 || true; fi
    if [ -n "$WATCHDOG_PID" ]; then wait "$WATCHDOG_PID" >/dev/null 2>&1 || true; fi
    stop_engine_pid "$ENGINE_PID"
    if [ -n "$ENGINE_PID" ]; then wait "$ENGINE_PID" >/dev/null 2>&1 || true; fi
    release_pf_token
}

trap cleanup EXIT
# TERM от launchd (остановка/перезапуск из приложения) — штатный выход с кодом 0:
# KeepAlive тогда не перезапускает задачу сам, перезапуск делает ctl.sh.
trap 'log "остановка по сигналу (команда из приложения)"; exit 0' INT TERM HUP
clear_intercept
# Движок от прошлого запуска (если остался) — мягко, затем принудительно, и ждём,
# пока освободится utun50: иначе новый движок падал с «open utun: Resource busy».
if /usr/bin/pgrep -x utunws >/dev/null 2>&1; then
    log "найден движок от прошлого запуска — останавливаю"
    /usr/bin/pkill -TERM -x utunws >/dev/null 2>&1 || true
    N=0
    while /usr/bin/pgrep -x utunws >/dev/null 2>&1 && [ "$N" -lt 30 ]; do sleep 0.1; N=$((N + 1)); done
    /usr/bin/pkill -9 -x utunws >/dev/null 2>&1 || true
fi
N=0
while /sbin/ifconfig utun50 >/dev/null 2>&1 && [ "$N" -lt 30 ]; do sleep 0.1; N=$((N + 1)); done

# LAZEYKA: «route get default» при включённом INCY TUN вернул бы туннель (utunN):
# sing-box на macOS ставит маршруты 0/1 и 128/1 поверх настоящего default.
# Поэтому берём default-маршрут из таблицы, пропуская виртуальные интерфейсы.
phys_default() {
    # Сначала основной маршрут (без флага I — не привязанный к интерфейсу), потом любой.
    /usr/sbin/netstat -rn -f "$1" 2>/dev/null | /usr/bin/awk '
        $1=="default" && $4 !~ /^(utun|ipsec|ppp|gif|stf|lo|awdl|llw)/ {
            if ($3 !~ /I/) { print $2, $4; found=1; exit }
            if (any=="") any=$2 " " $4
        }
        END { if (!found && any!="") print any }'
}
DEF4=$(phys_default inet)
GATEWAY=${DEF4%% *}
PHYSICAL_IFACE=${DEF4##* }
if [ -z "$PHYSICAL_IFACE" ] || [ -z "$GATEWAY" ]; then fail "нет маршрута по умолчанию через физический адаптер (нет сети?)"; fi
# LAZEYKA: имя интерфейса попадёт в правило pf — пропускаем только вид en0 / bridge0.
if ! printf '%s\n' "$PHYSICAL_IFACE" | /usr/bin/grep -Eq '^[a-z]+[0-9]+$'; then fail "странное имя интерфейса: $PHYSICAL_IFACE"; fi
/sbin/ping -c 1 -t 1 "$GATEWAY" >/dev/null 2>&1 || true
GATEWAY_MAC=$(/usr/sbin/arp -n "$GATEWAY" | /usr/bin/awk '/ at /{print $4; exit}')
case "$GATEWAY_MAC" in
    *:*:*:*:*:*) ;;
    *) fail "не удалось узнать MAC-адрес шлюза $GATEWAY" ;;
esac

GATEWAY6_MAC=
DEF6=$(phys_default inet6)
if [ -n "$DEF6" ] && [ "${DEF6##* }" = "$PHYSICAL_IFACE" ]; then
    GATEWAY6=${DEF6%% *}
    if [ -n "$GATEWAY6" ]; then
        GATEWAY6_MAC=$(/usr/sbin/ndp -n "$GATEWAY6" 2>/dev/null | /usr/bin/awk '/ at |%/{for(i=1;i<=NF;i++) if($i ~ /^([0-9a-f]{1,2}:){5}[0-9a-f]{1,2}$/){print $i; exit}}')
    fi
fi

# Файлы состояния лежат в папке пользователя, значит им верить нельзя: обычные файлы
# (не ссылки), читаем не больше 64 байт.
read_state() {
    if [ -L "$1" ] || [ ! -f "$1" ]; then return 0; fi
    /usr/bin/head -c 64 "$1" | /usr/bin/tr -d '[:space:]'
}

if [ -L "$DATA_ROOT" ] || [ -L "$DATA_ROOT/lists" ] || [ ! -d "$DATA_ROOT/lists" ]; then fail "нет рабочей папки списков"; fi

STRATEGY=$(read_state "$DATA_ROOT/selected-strategy")
if ! printf '%s\n' "$STRATEGY" | /usr/bin/grep -Eq '^general(-[a-z0-9]+)*$' || [ ! -f "$BASE/strategies/$STRATEGY.conf.in" ]; then
    STRATEGY=general-simple-fake
fi

# LAZEYKA: utunws после старта сбрасывает root (работает под UID 2147483647), поэтому
# рабочие копии списков должны быть доступны на чтение всем (как у Flowseal: 755/644).
# Чтобы подмена файла ссылкой не позволила вытащить через список чужой файл
# (например, /etc/master.passwd), исходники читаются С ПРАВАМИ ВЛАДЕЛЬЦА папки, а не root.
OWNER_UID=$(/usr/bin/stat -f %u "$DATA_ROOT" 2>/dev/null || true)
case "$OWNER_UID" in ''|0|*[!0-9]*) fail "не удалось определить владельца рабочей папки" ;; esac
RUNTIME_LISTS="$BASE/lists"
/bin/mkdir -p "$RUNTIME_LISTS"
/usr/sbin/chown root:wheel "$RUNTIME_LISTS"
/bin/chmod 755 "$RUNTIME_LISTS"
for NAME in list-general.txt list-general-user.txt list-google.txt list-exclude.txt list-exclude-user.txt ipset-all.txt ipset-exclude.txt ipset-exclude-user.txt; do
    SOURCE_LIST="$DATA_ROOT/lists/$NAME"
    if [ -L "$SOURCE_LIST" ] || [ ! -f "$SOURCE_LIST" ]; then fail "нет списка $NAME"; fi
    /bin/rm -f "$RUNTIME_LISTS/$NAME.tmp"
    /usr/bin/sudo -n -u "#$OWNER_UID" /bin/cat -- "$SOURCE_LIST" >"$RUNTIME_LISTS/$NAME.tmp" || fail "не удалось прочитать список $NAME"
    /usr/sbin/chown root:wheel "$RUNTIME_LISTS/$NAME.tmp"
    /bin/chmod 644 "$RUNTIME_LISTS/$NAME.tmp"
    /bin/mv -f "$RUNTIME_LISTS/$NAME.tmp" "$RUNTIME_LISTS/$NAME"
done

IPSET_MODE=$(read_state "$DATA_ROOT/ipset-mode")
case "$IPSET_MODE" in
    loaded) IPSET="$RUNTIME_LISTS/ipset-all.txt" ;;
    any) IPSET="$BASE/ipset-any.txt" ;;
    *) IPSET="$BASE/ipset-none.txt" ;;
esac

/usr/bin/sed -e "s|@BASE@|$BASE|g" -e "s|@LISTS@|$RUNTIME_LISTS|g" -e "s|@IPSET@|$IPSET|g" "$BASE/strategies/$STRATEGY.conf.in" > "$CONF_FILE"

export ZAPRET_IFACE="$PHYSICAL_IFACE"
export ZAPRET_GATEWAY_MAC="$GATEWAY_MAC"
export ZAPRET_GATEWAY6_MAC="$GATEWAY6_MAC"
export ZAPRET_UTUN_UNIT=51
/bin/echo "--- $(/bin/date '+%Y-%m-%d %H:%M:%S') запуск, стратегия $STRATEGY, $PHYSICAL_IFACE via $GATEWAY" >>"$BASE/engine.log"
log "запуск движка: стратегия $STRATEGY, интерфейс $PHYSICAL_IFACE, шлюз $GATEWAY"
"$BASE/bin/utunws" "@$CONF_FILE" >>"$BASE/engine.log" 2>&1 &
ENGINE_PID=$!

I=0
while ! /sbin/ifconfig utun50 >/dev/null 2>&1; do
    I=$((I + 1))
    if ! kill -0 "$ENGINE_PID" 2>/dev/null; then ENGINE_PID=; fail "движок завершился сам при старте (см. engine.log)"; fi
    if [ "$I" -gt 100 ]; then fail "движок не создал utun50 за 10 с"; fi
    sleep 0.1
done
/sbin/ifconfig utun50 10.77.0.1 10.77.0.2 netmask 255.255.255.255 up
"$BASE/watchdog.sh" $$ "$ENGINE_PID" &
WATCHDOG_PID=$!

if /sbin/pfctl -s info 2>/dev/null | /usr/bin/grep -q '^Status: Disabled'; then
    TOKEN=$(/sbin/pfctl -E 2>&1 | /usr/bin/awk '/Token :/ { print $3 }')
    if [ -n "$TOKEN" ]; then /bin/echo "$TOKEN" >"$TOKEN_FILE"; fi
fi

# LAZEYKA: правила привязаны к физическому интерфейсу («on $PHYSICAL_IFACE»). Это обязательно.
# Если в LAZEYKA включён режим TUN (INCY), трафик приложений уходит в другой utun —
# туннель sing-box. Без «on» правило route-to перехватывало бы и его, ломая туннель
# и заворачивая в utunws пакеты, которые должны идти в прокси. С «on» обработка DPI
# происходит только там, где пакет реально выходит в сеть через физический адаптер.
# Остальное — как у Flowseal: user { >root } не трогает трафик самого root (sing-box lxd, utunws).
if ! printf '%s\n' \
  "pass out quick on $PHYSICAL_IFACE route-to (utun50 10.77.0.2) inet proto tcp from any to any port {80,443,2053,2083,2087,2096,8443} user { >root } no state" \
  "pass out quick on $PHYSICAL_IFACE route-to (utun50 10.77.0.2) inet proto udp from any to any port {443,19294:19344,50000:50100} user { >root } no state" \
  | /sbin/pfctl -a "$ANCHOR" -f - 2>&1 | /usr/bin/grep -v -e 'Use of -f option' -e 'present in the main ruleset' -e 'See /etc/pf.conf' -e 'ALTQ' -e '^$'; then
    : # предупреждения pfctl выше отфильтрованы — это не ошибки
fi
if ! /sbin/pfctl -a "$ANCHOR" -sr 2>/dev/null | /usr/bin/grep -q route-to; then fail "pf не принял правила перехвата"; fi
log "работает"

# LAZEYKA: смена сети — повод перезапуститься (KeepAlive поднимет заново), но только
# если она держится 3 проверки подряд (~6 с). Раньше хватало одного «мигания»
# маршрута (Wi-Fi роуминг, переподключение другого VPN), и Zapret перезапускался.
MISMATCH=0
while kill -0 "$ENGINE_PID" 2>/dev/null; do
    sleep 2
    CUR=$(phys_default inet)
    CURRENT_GATEWAY=${CUR%% *}
    CURRENT_IFACE=${CUR##* }
    if [ "$CURRENT_IFACE" != "$PHYSICAL_IFACE" ] || [ "$CURRENT_GATEWAY" != "$GATEWAY" ]; then
        MISMATCH=$((MISMATCH + 1))
        if [ "$MISMATCH" -ge 3 ]; then fail "сменилась сеть: было $PHYSICAL_IFACE via $GATEWAY, стало ${CURRENT_IFACE:-?} via ${CURRENT_GATEWAY:-?} — перезапуск"; fi
    else
        MISMATCH=0
    fi
done
ENGINE_PID=
fail "движок завершился сам (см. engine.log)"
