#!/bin/sh
# LAZEYKA: полная остановка Zapret: задача launchd, правила pf, движок, токен pf, keepinit.
# Основа — stop.sh из Flowseal/zapret-mac-discord-youtube (MIT). Вызывается из ctl.sh stop
# и вручную:  sudo '/Library/Application Support/LAZEYKA/zapret/stop.sh'

LABEL=io.github.reb0oornalexey.lazeyka.zapret
ANCHOR=com.apple/lazeyka-zapret
TOKEN_FILE=/var/run/lazeyka-zapret.pf-token
KEEPINIT_FILE=/var/db/lazeyka-zapret.keepinit
ARMED_FILE=/var/run/lazeyka-zapret.armed

/bin/rm -f "$ARMED_FILE"
/bin/launchctl disable "system/$LABEL" >/dev/null 2>&1 || true
/bin/launchctl bootout "system/$LABEL" >/dev/null 2>&1 || true
/sbin/pfctl -a "$ANCHOR" -F all >/dev/null 2>&1 || true
/usr/bin/pkill -9 -x utunws >/dev/null 2>&1 || true
if [ -s "$TOKEN_FILE" ]; then
    TOKEN=$(/bin/cat "$TOKEN_FILE" 2>/dev/null || true)
    if [ -n "$TOKEN" ]; then /sbin/pfctl -X "$TOKEN" >/dev/null 2>&1 || true; fi
    /bin/rm -f "$TOKEN_FILE"
fi
if [ -s "$KEEPINIT_FILE" ]; then
    KEEPINIT=$(/bin/cat "$KEEPINIT_FILE" 2>/dev/null || true)
    case "$KEEPINIT" in
        *[!0-9]*|'') ;;
        *) /usr/sbin/sysctl -w "net.inet.tcp.keepinit=$KEEPINIT" >/dev/null 2>&1 || true ;;
    esac
    /bin/rm -f "$KEEPINIT_FILE"
fi
exit 0
