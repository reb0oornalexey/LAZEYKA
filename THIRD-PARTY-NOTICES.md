# Third-Party Notices

LAZEYKA is distributed under the terms of the GNU General Public License
v3.0 (see [LICENSE](./LICENSE)). It bundles, modifies and links against a
number of upstream open-source projects whose authors and licenses are
acknowledged below.

If you redistribute LAZEYKA (in source or binary form) you must preserve
this file together with [LICENSE](./LICENSE) and [COPYRIGHT](./COPYRIGHT).

---

## 1. Koala Clash

UI architecture, page-transition animations, several React components, the
Tailwind theme tokens and various visual primitives in LAZEYKA's renderer
are derived from **Koala Clash**.

- Upstream: <https://github.com/coolcoala/koala-clash>
- License: GNU General Public License v3.0 (or later)
- Copyright (C) Koala Clash contributors

Modified files in `src/renderer/` carry a header noting the modification
date and a short description of what was changed. The full text of the
GPL applies to those files exactly as it does to the rest of LAZEYKA.

> LAZEYKA's choice of GPL-3.0 as its overall license is a direct
> consequence of using Koala Clash sources: GPL is copyleft and requires
> any derivative work to be licensed under the same terms.

---

## 2. Flowseal/tg-ws-proxy (TgWsProxy)

Starting with LAZEYKA 1.1.5, TgWsProxy runs from **unmodified source** of
**Flowseal/tg-ws-proxy** (the `proxy/` package, tag `v1.10.4`) through its
console entry point `proxy.tg_ws_proxy:main`, inside a bundled embeddable
CPython. No tray icon, no windows, CLI arguments are honoured.

- Upstream source: <https://github.com/Flowseal/tg-ws-proxy>
- Bundled at: `resources/tgws/app/proxy/` (+ `resources/tgws/app/LICENSE`)
- License: MIT — Copyright (c) 2026 Flowseal

The official `TgWsProxy_windows.exe` release is a tray-GUI build
(`windows.py` + `pystray`) that ignores `--host`/`--port`/`--secret`/`--dc-ip`
and parks a tray icon. It is kept in `resources/tgws/` only as a fallback for
installations without the bundled Python.

### Bundled Python runtime (`resources/tgws/python/`)

- CPython 3.12.10 embeddable package for Windows — Python Software
  Foundation License 2. <https://www.python.org/>
- cryptography 46.0.5 — Apache-2.0 OR BSD-3-Clause.
  <https://github.com/pyca/cryptography>
- cffi 2.1.1 — MIT. <https://github.com/python-cffi/cffi>
- pycparser 3.0 — BSD-3-Clause. <https://github.com/eliben/pycparser>
- certifi 2026.7.22 — MPL-2.0. <https://github.com/certifi/python-certifi>

License texts ship inside each package's `*.dist-info/` folder.

---

## 3. bol-van/zapret + Flowseal/zapret-discord-youtube (Zapret bundle)

The bundled DPI-bypass strategies and `winws.exe` come from
**Flowseal/zapret-discord-youtube**, which itself bundles
**bol-van/zapret**.

- Flowseal bundle: <https://github.com/Flowseal/zapret-discord-youtube>
  - License: GNU General Public License v3.0
- Underlying engine `bol-van/zapret`: <https://github.com/bol-van/zapret>
  - License: Mostly under MIT-style license, with portions under custom
    permissive terms; see the upstream `LICENSE.txt` shipped inside
    `resources/zapret/`.
- Copyright (C) bol-van and zapret contributors
- Copyright (C) Flowseal and zapret-discord-youtube contributors

LAZEYKA redistributes the bundle verbatim, plus a small set of
LAZEYKA-specific patches applied at build time by
`scripts/build-zapret/build.bat`. The patches are documented in that
script and add `--profile` plumbing needed by LAZEYKA's strategy
selector; they are released under the same terms as the upstream files
they touch.

---

## 4. WinDivert

Bundled inside `resources/zapret/bin/` as `WinDivert.dll` and
`WinDivert64.sys`, used by `winws.exe` for low-level packet
interception on Windows.

- Upstream: <https://reqrypt.org/windivert.html>
- License: GNU Lesser General Public License v3.0 (LGPL-3.0)
  with a special linking exception, OR a commercial license at the
  user's option.
- Copyright (C) 2012-2024 basil00

LAZEYKA distributes WinDivert as an unmodified binary alongside
`winws.exe` per the LGPL terms. WinDivert can be replaced by the
end user with any binary-compatible build of the library.

---

## 5. Sparkle (Russian community fork) — historical heritage

LAZEYKA started life as a fork of a Russian community fork of
**Sparkle**, and has since been rewritten end-to-end. None of the
original Sparkle source survives in current LAZEYKA code, but the
project layout and a handful of build-side conventions trace back to
that lineage.

- Mihomo Party (closest English-language ancestor of the fork tree):
  <https://github.com/mihomo-party-org/mihomo-party>
- License: GNU General Public License v3.0
- Copyright (C) Mihomo Party contributors and Sparkle community
  contributors

---

## 6. NPM dependencies

The `package.json` lists every direct npm dependency. They are pulled
in at install time via `pnpm install`, are not redistributed in source
form by LAZEYKA, and are governed by their own licenses (predominantly
MIT, ISC and Apache-2.0). Notable bundled libraries:

| Project | License | Purpose |
| --- | --- | --- |
| Electron | MIT | Desktop runtime |
| React | MIT | UI framework |
| Vite | MIT | Renderer bundler |
| Tailwind CSS | MIT | Styling |
| Radix UI / shadcn-ui | MIT | UI primitives |
| Lucide | ISC | Icon set |
| Zustand | MIT | State management |
| Sonner | MIT | Toast notifications |
| adm-zip | MIT | Zapret bundle unpack |
| crypto-js | MIT | Hashing utilities |
| axios | MIT | HTTP client |
| react-router-dom | MIT | Routing |
| @electron-toolkit/* | MIT | Electron integration helpers |
| Onest font (@fontsource/onest) | SIL Open Font License 1.1 | UI typeface, `src/renderer/src/assets/fonts/onest-*.woff2` |
| country-flag-emoji-polyfill (Twemoji Country Flags font) | MIT (code), CC-BY-4.0 (flag artwork © Twitter, Inc. and other contributors, https://github.com/twitter/twemoji) | Country flags on Windows, `src/renderer/src/assets/fonts/TwemojiCountryFlags.woff2` |

Run `pnpm licenses list` (or `npm-license-checker`) on a checked-out
copy of the repository to obtain a complete, per-package, machine-
readable list.

---

## How attribution works in practice

* Every source file copied or substantially adapted from one of the
  upstreams above carries a header noting the original copyright and
  the date of modification, per the requirements of GPL-3.0 §5(a).
* This file (`THIRD-PARTY-NOTICES.md`) and `LICENSE`, `COPYRIGHT` are
  shipped alongside every LAZEYKA release (source archive AND
  installer) so end users can always trace provenance.
* If you find an upstream that should be acknowledged here and isn't,
  please open an issue on the LAZEYKA GitHub repo — we'll add it.
