#!/bin/sh
set -eu

marker=/run/lazeyka-zapret/firewall-installed
case "${1-}" in
  check)
    if [ -r /proc/net/netfilter/nfnetlink_queue ] &&
      awk '$1 == 17743 { found=1 } END { exit !found }' /proc/net/netfilter/nfnetlink_queue; then
      echo 'Очередь NFQUEUE 17743 уже занята другой службой' >&2
      exit 1
    fi
    ;;
  install)
    for i in 1 2 3 4 5 6 7 8 9 10; do
      if awk '$1 == 17743 { found=1 } END { exit !found }' /proc/net/netfilter/nfnetlink_queue 2>/dev/null; then
        break
      fi
      sleep 0.15
    done
    awk '$1 == 17743 { found=1 } END { exit !found }' /proc/net/netfilter/nfnetlink_queue
    opts=/opt/LAZEYKA/resources/zapret/zapret_options.py
    tcp=$(/usr/bin/python3 "$opts" tcp)
    udp=$(/usr/bin/python3 "$opts" udp)
    {
    cat <<'NFT'
create table inet lazeyka_zapret
add chain inet lazeyka_zapret output { type filter hook output priority mangle; policy accept; }
add rule inet lazeyka_zapret output oifname "lo" return
add rule inet lazeyka_zapret output meta mark & 0x40000000 != 0 return
NFT
    printf '%s\n' 'add rule inet lazeyka_zapret output tcp dport { 80, 443, 2053, 2083, 2087, 2096, 8443 } ct original packets 1-8 counter queue num 17743 bypass'
    printf '%s\n' 'add rule inet lazeyka_zapret output udp dport { 443, 19294-19344, 50000-50100 } ct original packets 1-8 counter queue num 17743 bypass'
    if [ -n "$tcp" ]; then
      printf 'add rule inet lazeyka_zapret output tcp dport != { 80, 443, 2053, 2083, 2087, 2096, 8443 } tcp dport { %s } ct original packets 1-8 counter queue num 17743 bypass\n' "$tcp"
    fi
    if [ -n "$udp" ]; then
      printf 'add rule inet lazeyka_zapret output udp dport != { 443, 19294-19344, 50000-50100 } udp dport { %s } ct original packets 1-8 counter queue num 17743 bypass\n' "$udp"
    fi
    } | /usr/sbin/nft -f -
    touch "$marker"
    ;;
  remove)
    if [ -f "$marker" ] && /usr/sbin/nft list table inet lazeyka_zapret >/dev/null 2>&1; then
      /usr/sbin/nft delete table inet lazeyka_zapret
    fi
    ;;
  *) exit 2 ;;
esac
