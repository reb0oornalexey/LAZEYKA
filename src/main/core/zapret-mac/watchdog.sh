#!/bin/sh
# LAZEYKA: страж run.sh. Если supervisor или движок умерли (в том числе kill -9),
# снимает перехват pf и добивает движок, чтобы трафик не уходил в мёртвый utun.
# Основа — watchdog.sh из Flowseal/zapret-mac-discord-youtube (MIT).

SUPERVISOR_PID=$1
ENGINE_PID=$2
ANCHOR=com.apple/lazeyka-zapret
TOKEN_FILE=/var/run/lazeyka-zapret.pf-token

while kill -0 "$SUPERVISOR_PID" 2>/dev/null && kill -0 "$ENGINE_PID" 2>/dev/null; do
    sleep 0.2
done

/sbin/pfctl -a "$ANCHOR" -F all >/dev/null 2>&1 || true
kill "$ENGINE_PID" >/dev/null 2>&1 || true
if [ -s "$TOKEN_FILE" ]; then
    TOKEN=$(/bin/cat "$TOKEN_FILE" 2>/dev/null || true)
    if [ -n "$TOKEN" ]; then /sbin/pfctl -X "$TOKEN" >/dev/null 2>&1 || true; fi
    /bin/rm -f "$TOKEN_FILE"
fi
