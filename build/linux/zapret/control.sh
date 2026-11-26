#!/bin/sh
set -eu
PATH=/usr/sbin:/usr/bin:/sbin:/bin
export PATH

[ "$(id -u)" = 0 ] || exit 1
case "$#:${1-}:${2-}" in
  2:start:*)
    case "$2" in
      ''|*[!a-z0-9-]*) exit 2 ;;
    esac
    [ -f "/opt/LAZEYKA/resources/zapret/profiles/$2.args" ] ||
      [ -f "/var/lib/lazeyka-zapret/profiles/$2.json" ] || exit 2
    ;;
  1:stop:) ;;
  1:lists:|1:game:|1:profile:) ;;
  *) exit 2 ;;
esac

unit=lazeyka-zapret.service
state=/run/lazeyka-zapret-control
install -d -m 0755 "$state"
exec 9>"$state/lock"
flock -x 9

if [ "$1" = lists ] || [ "$1" = game ] || [ "$1" = profile ]; then
  exec /usr/bin/python3 /opt/LAZEYKA/resources/zapret/user-lists.py "$1"
fi

if [ "$1" = stop ]; then
  systemctl stop "$unit"
  exit
fi

strategy="$state/strategy"
previous=$(cat "$strategy" 2>/dev/null || true)
if systemctl is-active --quiet "$unit"; then
  [ "$previous" != "$2" ] || exit 0
  systemctl stop "$unit"
else
  previous=
fi

printf '%s\n' "$2" > "$strategy"
if systemctl start "$unit"; then
  exit 0
fi
if [ -n "$previous" ]; then
  printf '%s\n' "$previous" > "$strategy"
  systemctl start "$unit" || true
fi
journalctl --unit="$unit" --lines=12 --no-pager --output=cat >&2 || true
exit 1
