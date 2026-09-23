"""LAZEYKA: запуск Flowseal tg-ws-proxy в консольном режиме (без трея и окон).

python.exe -u lazeyka_tgws.py <каталог, где лежит пакет proxy> [аргументы tg-ws-proxy...]
"""
import os
import runpy
import sys

app_dir = os.path.abspath(sys.argv[1])
sys.path.insert(0, app_dir)
sys.argv = ["tg-ws-proxy"] + sys.argv[2:]
runpy.run_module("proxy.tg_ws_proxy", run_name="__main__", alter_sys=True)
