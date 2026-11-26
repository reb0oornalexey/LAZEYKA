import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import tempfile

from zapret_options import DATA, FILE, normalize

UNIT = 'lazeyka-zapret.service'
BUILTIN = Path('/opt/LAZEYKA/resources/zapret/profiles')
HOST = re.compile(r'^\^?(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$')


def hosts(entries):
    if not isinstance(entries, list) or len(entries) > 4096:
        raise ValueError('Укажите до 4096 доменов в каждом списке.')
    unique = []
    for raw in entries:
        if not isinstance(raw, str) or len(raw) > 254 or not HOST.fullmatch(raw):
            raise ValueError(f'Некорректный домен: {str(raw)[:80]}')
        if raw not in unique:
            unique.append(raw)
    return ('\n'.join(unique) + '\n').encode() if unique else b''


def replace_file(file, contents):
    if contents is None:
        file.unlink(missing_ok=True)
        return
    file.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(dir=file.parent) as handle:
        handle.write(contents)
        handle.flush()
        os.chmod(handle.name, 0o644)
        os.link(handle.name, handle.name + '.new')
        os.replace(handle.name + '.new', file)


def profile_edit(item, running):
    if item['action'] == 'remove':
        file = item['file']
        if not isinstance(file, str) or not re.fullmatch(r'own-[a-f0-9]{16}', file):
            raise ValueError('Выберите свою стратегию.')
        if running and Path('/run/lazeyka-zapret-control/strategy').read_text().strip() == file:
            raise ValueError('Переключите работающий Zapret на другую стратегию.')
        return {DATA / 'profiles' / (file + '.json'): None}
    if item['action'] != 'save':
        raise ValueError('Неизвестная команда конструктора.')
    base, title, repeats = item['base'], item['title'], item['repeats']
    if not isinstance(base, str) or not re.fullmatch(r'[a-z0-9-]+', base) or not (BUILTIN / (base + '.args')).is_file():
        raise ValueError('Выберите встроенную стратегию в качестве основы.')
    if not isinstance(title, str) or not 1 <= len(title.strip()) <= 48 or any(ord(ch) < 32 for ch in title):
        raise ValueError('Название должно содержать от 1 до 48 символов.')
    if type(repeats) is not int or not 1 <= repeats <= 20:
        raise ValueError('Число повторов должно быть от 1 до 20.')
    title = title.strip()
    file = 'own-' + hashlib.sha256(title.casefold().encode()).hexdigest()[:16]
    profile = {'file': file, 'title': title, 'description': f'Своя стратегия · основа {base} · повторов {repeats}',
               'base': base, 'repeats': repeats}
    return {DATA / 'profiles' / (file + '.json'): json.dumps(profile).encode()}


def main():
    if os.geteuid() != 0:
        raise PermissionError('Нужно подтверждение администратора.')
    payload = sys.stdin.buffer.read(512001)
    if len(payload) > 512000:
        raise ValueError('Списки слишком велики.')
    items = json.loads(payload)
    ctl = '/usr/bin/systemctl'
    running = subprocess.run([ctl, 'is-active', '--quiet', UNIT], check=False).returncode == 0
    if sys.argv[1:] == ['game']:
        edits = {FILE: json.dumps(normalize(items)).encode()}
    elif sys.argv[1:] == ['lists']:
        edits = {
            DATA / 'list-general-user.txt': hosts(items['include']),
            DATA / 'list-exclude-user.txt': hosts(items['exclude'])
        }
    elif sys.argv[1:] == ['profile']:
        edits = profile_edit(items, running)
    else:
        raise ValueError('Неизвестная команда настроек.')
    restart = running
    if running and sys.argv[1:] == ['profile']:
        current = Path('/run/lazeyka-zapret-control/strategy').read_text().strip()
        restart = any(file.stem == current for file in edits)
    DATA.mkdir(mode=0o755, exist_ok=True)
    old = {file: file.read_bytes() if file.is_file() else None for file in edits}
    try:
        for file, contents in edits.items():
            replace_file(file, contents)
        if restart:
            subprocess.run([ctl, 'restart', UNIT], timeout=15, check=True)
    except (OSError, subprocess.SubprocessError):
        for file, contents in old.items():
            replace_file(file, contents)
        if restart:
            subprocess.run([ctl, 'restart', UNIT], timeout=15, check=False)
        raise


if __name__ == '__main__':
    try:
        main()
    except (KeyError, OSError, ValueError, subprocess.SubprocessError) as error:
        print(f'Списки Zapret: {error}', file=sys.stderr)
        sys.exit(1)
