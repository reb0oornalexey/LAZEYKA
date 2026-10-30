#!/bin/sh
# LAZEYKA: единственная команда Zapret, которую пользователь может запускать от root без пароля
# (через sudoers.d/lazeyka-zapret, сам файл ставится вместе со службой).
#
#   sudo -n '/Library/Application Support/LAZEYKA/zapret/ctl.sh' start|stop|restart|status
#
# Никаких других аргументов и путей от вызывающего: DATA_ROOT зашит в plist при установке.
# Файл и вся его папка принадлежат root и недоступны пользователю на запись.

PATH=/usr/bin:/bin:/usr/sbin:/sbin
export PATH
umask 022

LABEL=io.github.reb0oornalexey.lazeyka.zapret
PLIST=/Library/LaunchDaemons/io.github.reb0oornalexey.lazeyka.zapret.plist
BASE='/Library/Application Support/LAZEYKA/zapret'
ANCHOR=com.apple/lazeyka-zapret
KEEPINIT_FILE=/var/db/lazeyka-zapret.keepinit
ARMED_FILE=/var/run/lazeyka-zapret.armed

if [ "$#" -ne 1 ]; then echo 'usage: ctl.sh start|stop|restart|status' >&2; exit 64; fi
case "$1" in
    start|stop|restart|status) ;;
    *) echo 'usage: ctl.sh start|stop|restart|status' >&2; exit 64 ;;
esac
if [ "$(/usr/bin/id -u)" != 0 ]; then echo 'ctl.sh must run as root' >&2; exit 77; fi

job_loaded() {
    /bin/launchctl print "system/$LABEL" >/dev/null 2>&1
}

do_status() {
    if ! job_loaded; then echo stopped; return 0; fi
    if /usr/bin/pgrep -x utunws >/dev/null 2>&1 \
        && /sbin/ifconfig utun50 >/dev/null 2>&1 \
        && /sbin/pfctl -a "$ANCHOR" -sr 2>/dev/null | /usr/bin/grep -q route-to; then
        echo running
    else
        echo starting
    fi
}

do_start() {
    if [ ! -f "$PLIST" ] || [ ! -x "$BASE/run.sh" ]; then echo 'not installed' >&2; return 66; fi
    # Исходное значение keepinit сохраняем один раз; run.sh ставит 7000, stop.sh возвращает.
    if [ ! -s "$KEEPINIT_FILE" ]; then
        /usr/sbin/sysctl -n net.inet.tcp.keepinit > "$KEEPINIT_FILE" 2>/dev/null || true
        /bin/chmod 600 "$KEEPINIT_FILE" 2>/dev/null || true
    fi
    /usr/sbin/sysctl -n kern.boottime > "$ARMED_FILE" || return 1
    /bin/launchctl enable "system/$LABEL" >/dev/null 2>&1 || true
    if ! job_loaded; then
        I=0
        while ! /bin/launchctl bootstrap system "$PLIST" 2>/dev/null; do
            I=$((I + 1))
            if [ "$I" -gt 10 ]; then
                /bin/sh "$BASE/stop.sh"
                echo 'launchctl bootstrap failed' >&2
                return 1
            fi
            sleep 0.5
        done
    fi
    /bin/launchctl kickstart -k "system/$LABEL" >/dev/null 2>&1 || { /bin/sh "$BASE/stop.sh"; echo 'launchctl kickstart failed' >&2; return 1; }
    return 0
}

case "$1" in
    start|restart) do_start; exit $? ;;
    stop) /bin/sh "$BASE/stop.sh"; exit 0 ;;
    status) do_status; exit 0 ;;
esac
