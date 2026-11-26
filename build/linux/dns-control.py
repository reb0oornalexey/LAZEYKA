#!/usr/bin/python3
import fcntl
import ipaddress
import json
import os
from pathlib import Path
import socket
import subprocess
import sys
import tempfile
import time


SERVICE = 'lazeyka-dns.service'
RESOLVED = 'systemd-resolved.service'
ADDRESS = '127.0.0.59'
PORT = 5354
DIRECTORY = Path('/var/lib/lazeyka-dns')
CONFIG = DIRECTORY / 'resolver.json'
STATUS = DIRECTORY / 'status.json'
DROPIN = Path('/etc/systemd/resolved.conf.d/95-lazeyka.conf')
SYSTEM_SETTINGS = f'[Resolve]\nDNS=\nDNS={ADDRESS}:{PORT}\nDomains=~.\nDNSOverTLS=no\n'.encode()


def systemctl(*args):
    subprocess.run(['/usr/bin/systemctl', *args], check=True, timeout=20)


def write_atomic(file, data, mode):
    file.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(dir=file.parent) as tmp:
        tmp.write(data)
        tmp.flush()
        os.chmod(tmp.name, mode)
        os.link(tmp.name, tmp.name + '.new')
        os.replace(tmp.name + '.new', file)


def read_optional(path):
    try:
        return path.read_bytes()
    except FileNotFoundError:
        return None


def restore_file(path, data, mode):
    if data is None:
        path.unlink(missing_ok=True)
    else:
        write_atomic(path, data, mode)


def wait_ready():
    for _ in range(25):
        try:
            with socket.create_connection((ADDRESS, PORT), timeout=.2):
                return
        except OSError:
            time.sleep(.15)
    raise RuntimeError('Локальный DNS не начал принимать запросы.')


def flush_resolver_cache():
    subprocess.run(['/usr/bin/resolvectl', 'flush-caches'], timeout=5, check=True)


def check_dns():
    query = b'\x98\x03\x01\x00\x00\x01\x00\x00\x00\x00\x00\x00\x07example\x03org\x00\x00\x01\x00\x01'
    with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as client:
        client.settimeout(8)
        try:
            client.connect((ADDRESS, PORT))
            client.send(query)
            response = client.recv(2048)
        except OSError as error:
            raise RuntimeError('Выбранный сервер DNS не отвечает. Настройки сети сохранены.') from error
    if len(response) < 12 or response[:2] != query[:2] or response[3] & 15:
        raise RuntimeError('Выбранный DNS вернул ошибку. Настройки сети сохранены.')


def resolver_config(request):
    endpoint = request['endpoint']
    address = str(ipaddress.ip_address(endpoint['address']))
    if address == ADDRESS:
        raise ValueError('Нельзя назначить локальный адрес LAZEYKA upstream-сервером DNS.')
    if endpoint['type'] == 'udp':
        server = {'type': 'udp', 'server': address, 'server_port': 53}
    elif endpoint['type'] == 'https':
        hostname = endpoint['hostname']
        path = endpoint['path']
        port = endpoint['port']
        if not isinstance(hostname, str) or not hostname or not isinstance(port, int) or not 0 < port < 65536:
            raise ValueError('Некорректный сервер DNS-over-HTTPS.')
        if not isinstance(path, str) or not path.startswith('/') or len(path) > 4096:
            raise ValueError('Некорректный путь DNS-over-HTTPS.')
        server = {'type': 'https', 'server': address, 'server_port': port, 'path': path,
                  'tls': {'enabled': True, 'server_name': hostname}}
    else:
        raise ValueError('Некорректный протокол DNS.')
    return {'log': {'level': 'warn'}, 'inbounds': [{'type': 'direct', 'tag': 'dns-in',
            'listen': ADDRESS, 'listen_port': PORT}], 'outbounds': [{'type': 'direct', 'tag': 'direct'}],
            'dns': {'servers': [{**server, 'tag': 'selected'}], 'final': 'selected'},
            'route': {'rules': [{'inbound': ['dns-in'], 'action': 'hijack-dns'}], 'final': 'direct'}}


def apply(request):
    config = resolver_config(request)
    provider = request['provider']
    if not isinstance(provider, str) or len(provider) > 200:
        raise ValueError('Некорректный идентификатор DNS.')
    previous = read_optional(CONFIG)
    was_active = read_optional(DROPIN) == SYSTEM_SETTINGS
    wrote_dropin = False
    try:
        write_atomic(CONFIG, json.dumps(config).encode(), 0o600)
        systemctl('restart', SERVICE)
        wait_ready()
        check_dns()
        if not was_active:
            write_atomic(DROPIN, SYSTEM_SETTINGS, 0o644)
            wrote_dropin = True
            systemctl('restart', RESOLVED)
        else:
            flush_resolver_cache()
        systemctl('enable', SERVICE)
        write_atomic(STATUS, json.dumps({'providerId': provider, 'protocol': request['endpoint']['type']}).encode(), 0o644)
    except Exception:
        restore_file(CONFIG, previous, 0o600)
        if was_active and previous is not None:
            systemctl('restart', SERVICE)
            wait_ready()
            flush_resolver_cache()
        else:
            if wrote_dropin:
                DROPIN.unlink(missing_ok=True)
                systemctl('restart', RESOLVED)
            systemctl('disable', '--now', SERVICE)
        raise


def reset():
    if read_optional(DROPIN) == SYSTEM_SETTINGS:
        DROPIN.unlink()
        try:
            systemctl('restart', RESOLVED)
        except Exception:
            write_atomic(DROPIN, SYSTEM_SETTINGS, 0o644)
            raise
    systemctl('disable', '--now', SERVICE)
    CONFIG.unlink(missing_ok=True)
    STATUS.unlink(missing_ok=True)


def main():
    if os.geteuid() != 0 or sys.argv[1:] not in (['set'], ['reset']):
        raise PermissionError('Для системного DNS нужно подтверждение администратора.')
    DIRECTORY.mkdir(mode=0o755, exist_ok=True)
    with (DIRECTORY / 'lock').open('a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        existing = read_optional(DROPIN)
        if existing is not None and existing != SYSTEM_SETTINGS:
            raise RuntimeError('Файл настроек DNS уже изменён вручную.')
        if sys.argv[1] == 'reset':
            reset()
        else:
            if Path('/sys/class/net/lazeyka0').exists():
                raise RuntimeError('Отключите TUN перед изменением системного DNS.')
            payload = sys.stdin.buffer.read(8193)
            if len(payload) > 8192:
                raise ValueError('Слишком большой запрос DNS.')
            apply(json.loads(payload))


if __name__ == '__main__':
    try:
        main()
    except (KeyError, ValueError, OSError, RuntimeError, subprocess.SubprocessError) as error:
        print(f'Системный DNS: {error}', file=sys.stderr)
        sys.exit(1)
