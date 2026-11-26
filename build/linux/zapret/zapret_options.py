import json
from pathlib import Path
import re
import sys

DATA = Path('/var/lib/lazeyka-zapret')
FILE = DATA / 'game-filter.json'
DEFAULT = {'mode': 'off', 'ipset': 'none', 'tcp': '1024-65535', 'udp': '1024-65535'}


def normalize_ports(value):
    if not isinstance(value, str) or len(value) > 512:
        raise ValueError('Некорректный список портов.')
    ports = []
    for piece in value.split(','):
        match = re.fullmatch(r'(\d{1,5})(?:-(\d{1,5}))?', piece.strip())
        if not match:
            raise ValueError('Укажите порты или диапазоны через запятую.')
        start = int(match[1])
        end = int(match[2] or match[1])
        if not 1 <= start <= end <= 65535:
            raise ValueError('Допустимые порты: от 1 до 65535.')
        ports.append((start, end))
    merged = []
    for start, end in sorted(ports):
        if merged and start <= merged[-1][1] + 1:
            merged[-1] = (merged[-1][0], max(end, merged[-1][1]))
        else:
            merged.append((start, end))
    return ','.join(str(start) if start == end else f'{start}-{end}' for start, end in merged)


def normalize(raw):
    if raw['mode'] not in ('off', 'tcp', 'udp', 'all') or raw['ipset'] not in ('none', 'loaded', 'any'):
        raise ValueError('Неизвестный режим Game Filter или IPset.')
    if raw['mode'] != 'off' and raw['ipset'] == 'none':
        raise ValueError('Чтобы обрабатывать игровые порты, выберите список IP либо все адреса.')
    return {'mode': raw['mode'], 'ipset': raw['ipset'],
            'tcp': normalize_ports(raw['tcp']), 'udp': normalize_ports(raw['udp'])}


def read():
    try:
        return normalize(json.loads(FILE.read_text()))
    except FileNotFoundError:
        return DEFAULT


def ports(options, protocol):
    return options[protocol] if options['mode'] in (protocol, 'all') else ''


if __name__ == '__main__':
    if sys.argv[1:] not in (['tcp'], ['udp']):
        sys.exit(2)
    print(ports(read(), sys.argv[1]))
