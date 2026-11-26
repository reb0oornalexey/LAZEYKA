#!/usr/bin/python3
import fcntl
import json
import os
from pathlib import Path
import select
import signal
import subprocess
import sys
import tempfile
import time


INTERFACE = 'lazeyka0'
TABLE = 28962
RULES = range(TABLE, TABLE + 64)
UNIT = 'lazeyka-incy-tun.service'
RUNTIME = Path('/run/lazeyka-incy-tun')
CORE = '/opt/LAZEYKA/resources/incy/sing-box'
IP = '/usr/sbin/ip'
SYSTEMCTL = '/usr/bin/systemctl'
RESOLVECTL = '/usr/bin/resolvectl'
MAX_CONFIG = 16 * 1024 * 1024


def ip_json(*args):
    return json.loads(subprocess.check_output([IP, '-j', *args], timeout=3))


def run_quiet(*argv):
    return subprocess.run(argv, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                          timeout=10, check=False).returncode


def occupied():
    for family in ('-4', '-6'):
        if any(rule.get('priority') in RULES or str(rule.get('table')) == str(TABLE)
               for rule in ip_json(family, 'rule', 'show')):
            return True
        result = subprocess.run([IP, '-j', family, 'route', 'show', 'table', str(TABLE)],
                                capture_output=True, timeout=3, check=False)
        if result.returncode == 0 and json.loads(result.stdout):
            return True
    return Path('/sys/class/net', INTERFACE).exists()


def cleanup_routes():
    for family in ('-4', '-6'):
        for rule in ip_json(family, 'rule', 'show'):
            priority = rule.get('priority')
            if priority in RULES:
                run_quiet(IP, family, 'rule', 'del', 'pref', str(priority))
        run_quiet(IP, family, 'route', 'flush', 'table', str(TABLE))
    if Path('/sys/class/net', INTERFACE).exists():
        run_quiet(IP, 'link', 'delete', INTERFACE)


def read_config():
    payload = sys.stdin.buffer.readline(MAX_CONFIG + 1)
    if not payload.endswith(b'\n') or len(payload) > MAX_CONFIG:
        raise ValueError('Некорректный размер конфигурации TUN.')
    cfg = json.loads(payload)
    tun = [i for i in cfg['inbounds'] if i.get('type') == 'tun']
    if len(tun) != 1 or any(tun[0].get(key) != value for key, value in {
        'interface_name': INTERFACE, 'iproute2_table_index': TABLE,
        'iproute2_rule_index': TABLE, 'auto_route': True
    }.items()):
        raise ValueError('Конфигурация не соответствует интерфейсу LAZEYKA TUN.')
    hijack_dns = any(rule.get('action') == 'hijack-dns' for rule in cfg.get('route', {}).get('rules', []))
    return payload, hijack_dns


def stop(_signal, _frame):
    raise SystemExit(0)


def main():
    if os.geteuid() != 0 or len(sys.argv) != 1:
        raise PermissionError('Для TUN нужно подтвердить права администратора.')
    uid = int(os.environ['PKEXEC_UID'])
    if uid < 1:
        raise PermissionError('Запустите LAZEYKA от обычного пользователя.')
    RUNTIME.mkdir(mode=0o711, exist_ok=True)
    with (RUNTIME / 'lock').open('a') as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError as error:
            raise RuntimeError('TUN уже управляется другим экземпляром LAZEYKA.') from error
        if run_quiet(SYSTEMCTL, 'is-active', '--quiet', UNIT) == 0 or occupied():
            raise RuntimeError('Интерфейс или маршруты TUN уже заняты.')
        payload, hijack_dns = read_config()
        with tempfile.TemporaryDirectory(dir=RUNTIME) as session:
            os.chmod(session, 0o711)
            cfg = Path(session, 'config.json')
            cfg.write_bytes(payload)
            cfg.chmod(0o400)
            os.chown(cfg, uid, -1)
            runner = subprocess.Popen([
                '/usr/bin/systemd-run', '--quiet', '--wait', '--pipe', '--collect',
                '--unit', UNIT, '--service-type=exec', '-p', f'User={uid}',
                '-p', 'AmbientCapabilities=CAP_NET_ADMIN', '-p', 'CapabilityBoundingSet=CAP_NET_ADMIN',
                '-p', 'NoNewPrivileges=yes', '-p', 'RestrictNamespaces=yes',
                '-p', 'TimeoutStopSec=5s', CORE, 'run', '-c', str(cfg)
            ], stdin=subprocess.DEVNULL)
            try:
                ready = False
                deadline = time.monotonic() + 15
                while runner.poll() is None:
                    if select.select([0], [], [], 0.15)[0]:
                        return
                    if not ready and Path('/sys/class/net', INTERFACE).exists():
                        time.sleep(0.25)
                        if runner.poll() is None and any(rule.get('priority') in RULES
                                                        for rule in ip_json('-4', 'rule', 'show')):
                            if hijack_dns and run_quiet(SYSTEMCTL, 'is-active', '--quiet', 'systemd-resolved') == 0:
                                for action in (('dns', '172.19.0.2'), ('domain', '~.'), ('default-route', 'yes')):
                                    if run_quiet(RESOLVECTL, action[0], INTERFACE, action[1]) != 0:
                                        raise RuntimeError('Не удалось назначить системный DNS интерфейсу TUN.')
                            print('LAZEYKA_TUN_READY', flush=True)
                            ready = True
                    if not ready and time.monotonic() >= deadline:
                        raise RuntimeError('Интерфейс TUN не появился вовремя.')
                raise RuntimeError('Служба INCY TUN завершилась.')
            finally:
                if not ready and runner.poll() is None:
                    runner.terminate()
                    try:
                        runner.wait(timeout=2)
                    except subprocess.TimeoutExpired:
                        runner.kill()
                        runner.wait()
                try:
                    run_quiet(SYSTEMCTL, 'stop', UNIT)
                finally:
                    cleanup_routes()
                runner.wait(timeout=5)


if __name__ == '__main__':
    signal.signal(signal.SIGTERM, stop)
    signal.signal(signal.SIGINT, stop)
    try:
        main()
    except (KeyError, ValueError, OSError, RuntimeError, subprocess.SubprocessError) as error:
        print(f'INCY TUN: {error}', file=sys.stderr)
        sys.exit(1)
