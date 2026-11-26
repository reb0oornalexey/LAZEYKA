#!/bin/sh
set -eu

exec /usr/bin/python3 /opt/LAZEYKA/resources/zapret/launch.py "$(cat /run/lazeyka-zapret-control/strategy)"
