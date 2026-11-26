import json
import os
from pathlib import Path
import re
import sys

from zapret_options import DATA, ports, read

BASE = Path('/opt/LAZEYKA/resources/zapret')


def args_for(profile):
    options = read()
    repeats = None
    if profile.startswith('own-'):
        custom = json.loads((DATA / 'profiles' / (profile + '.json')).read_text())
        profile = custom['base']
        repeats = custom['repeats']
    sections = [[]]
    for line in (BASE / 'profiles' / (profile + '.args')).read_text().splitlines():
        if line == '--new':
            sections.append([])
        else:
            sections[-1].append(line)
    for section in sections:
        game = next((arg for arg in section if '@ZAPRET_GAME_' in arg), None)
        if game:
            protocol = 'tcp' if game.startswith('--filter-tcp=') else 'udp'
            selection = ports(options, protocol)
            if not selection:
                continue
            section[section.index(game)] = f'--filter-{protocol}={selection}'
        if repeats is not None:
            section = [f'--dpi-desync-repeats={repeats}' if arg.startswith('--dpi-desync-repeats=') else arg
                       for arg in section]
        yield section, options['ipset']


def main(profile):
    if not re.fullmatch(r'[a-z0-9-]+', profile):
        raise ValueError('Некорректная стратегия Linux.')
    command = [str(BASE / 'nfqws'), '--qnum=17743', '--user=nobody']
    first = True
    for section, ipset in args_for(profile):
        if not first:
            command.append('--new')
        first = False
        for arg in section:
            if '@ZAPRET_USER@/' in arg:
                file = DATA / arg.split('@ZAPRET_USER@/', 1)[1]
                if not file.is_file() or file.stat().st_size == 0:
                    continue
                arg = arg.replace('@ZAPRET_USER@', str(DATA))
            if arg == '--ipset=@ZAPRET_DATA@/lists/ipset-all.txt':
                if ipset == 'any':
                    continue
                if ipset == 'loaded':
                    arg += '.backup'
            command.append(arg.replace('@ZAPRET_DATA@', str(BASE)))
    os.execv(command[0], command)


if __name__ == '__main__':
    main(sys.argv[1])
