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
    if [ -n "$ENGINE_PID" ]; then kill "$ENGINE_PID" >/dev/null 2>&1 || true; fi
    if [ -n "$WATCHDOG_PID" ]; then wait "$WATCHDOG_PID" >/dev/null 2>&1 || true; fi
    if [ -n "$ENGINE_PID" ]; then wait "$ENGINE_PID" >/dev/null 2>&1 || true; fi
    release_pf_token
}

trap cleanup EXIT INT TERM HUP
clear_intercept
/usr/bin/pkill -9 -x utunws >/dev/null 2>&1 || true

PHYSICAL_IFACE=$(/sbin/route -n get default | /usr/bin/awk '/interface:/{print $2; exit}')
GATEWAY=$(/sbin/route -n get default | /usr/bin/awk '/gateway:/{print $2; exit}')
if [ -z "$PHYSICAL_IFACE" ] || [ -z "$GATEWAY" ]; then exit 1; fi
# LAZEYKA: имя интерфейса попадёт в правило pf — пропускаем только вид en0 / bridge0.
if ! printf '%s\n' "$PHYSICAL_IFACE" | /usr/bin/grep -Eq '^[a-z]+[0-9]+$'; then exit 1; fi
/sbin/ping -c 1 -t 1 "$GATEWAY" >/dev/null 2>&1 || true
GATEWAY_MAC=$(/usr/sbin/arp -n "$GATEWAY" | /usr/bin/awk '/ at /{print $4; exit}')
case "$GATEWAY_MAC" in
    *:*:*:*:*:*) ;;
    *) exit 1 ;;
esac

GATEWAY6_MAC=
if /sbin/route -n get -inet6 default >/var/run/lazeyka-zapret.route6 2>/dev/null; then
    GATEWAY6=$(/usr/bin/awk '/gateway:/{print $2; exit}' /var/run/lazeyka-zapret.route6)
    if [ -n "$GATEWAY6" ]; then
        GATEWAY6_MAC=$(/usr/sbin/ndp -n "$GATEWAY6" 2>/dev/null | /usr/bin/awk '/ at |%/{for(i=1;i<=NF;i++) if($i ~ /^([0-9a-f]{1,2}:){5}[0-9a-f]{1,2}$/){print $i; exit}}')
    fi
fi
/bin/rm -f /var/run/lazeyka-zapret.route6

# Файлы состояния лежат в папке пользователя, значит им верить нельзя: обычные файлы
# (не ссылки), читаем не больше 64 байт.
read_state() {
    if [ -L "$1" ] || [ ! -f "$1" ]; then return 0; fi
    /usr/bin/head -c 64 "$1" | /usr/bin/tr -d '[:space:]'
}

if [ -L "$DATA_ROOT" ] || [ -L "$DATA_ROOT/lists" ] || [ ! -d "$DATA_ROOT/lists" ]; then exit 1; fi

STRATEGY=$(read_state "$DATA_ROOT/selected-strategy")
if ! printf '%s\n' "$STRATEGY" | /usr/bin/grep -Eq '^general(-[a-z0-9]+)*$' || [ ! -f "$BASE/strategies/$STRATEGY.conf.in" ]; then
    STRATEGY=general-simple-fake
fi

# LAZEYKA: рабочие копии списков закрыты от пользователя (0700/0600): так подмена файла
# ссылкой между проверкой и копированием не позволит прочитать чужой файл через список.
RUNTIME_LISTS="$BASE/lists"
/bin/mkdir -p "$RUNTIME_LISTS"
/bin/chmod 700 "$RUNTIME_LISTS"
for NAME in list-general.txt list-general-user.txt list-google.txt list-exclude.txt list-exclude-user.txt ipset-all.txt ipset-exclude.txt ipset-exclude-user.txt; do
    SOURCE_LIST="$DATA_ROOT/lists/$NAME"
    if [ -L "$SOURCE_LIST" ] || [ ! -f "$SOURCE_LIST" ]; then exit 1; fi
    /usr/bin/install -m 0600 -o root -g wheel "$SOURCE_LIST" "$RUNTIME_LISTS/$NAME"
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
"$BASE/bin/utunws" "@$CONF_FILE" >>"$BASE/engine.log" 2>&1 &
ENGINE_PID=$!

I=0
while ! /sbin/ifconfig utun50 >/dev/null 2>&1; do
    I=$((I + 1))
    if ! kill -0 "$ENGINE_PID" 2>/dev/null || [ "$I" -gt 100 ]; then exit 1; fi
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
printf '%s\n' \
  "pass out quick on $PHYSICAL_IFACE route-to (utun50 10.77.0.2) inet proto tcp from any to any port {80,443,2053,2083,2087,2096,8443} user { >root } no state" \
  "pass out quick on $PHYSICAL_IFACE route-to (utun50 10.77.0.2) inet proto udp from any to any port {443,19294:19344,50000:50100} user { >root } no state" \
  | /sbin/pfctl -a "$ANCHOR" -f -

while kill -0 "$ENGINE_PID" 2>/dev/null; do
    sleep 2
    CURRENT_IFACE=$(/sbin/route -n get default 2>/dev/null | /usr/bin/awk '/interface:/{print $2; exit}')
    CURRENT_GATEWAY=$(/sbin/route -n get default 2>/dev/null | /usr/bin/awk '/gateway:/{print $2; exit}')
    if [ "$CURRENT_IFACE" != "$PHYSICAL_IFACE" ] || [ "$CURRENT_GATEWAY" != "$GATEWAY" ]; then exit 1; fi
done
exit 1
