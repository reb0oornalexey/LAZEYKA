#!/usr/bin/env node
// ============================================================
// check-zapret-menu-changes.js
//
// WHAT THIS DOES (honestly): downloads the latest Flowseal Zapret
// release, reads its service.bat menu, and prints any menu items
// that LAZEYKA does not already know about — either wired into
// the app's own settings UI, or deliberately left as "use
// service.bat manually for this one" (see KNOWN_ITEMS below).
//
// WHAT THIS DOES NOT DO: it cannot safely turn a new menu item into
// a working setting on its own. A batch-file menu label doesn't
// tell you what files it touches, whether it needs a restart,
// whether it's safe to expose without a confirmation dialog, etc.
// That still needs a human (Claude, in a chat, looking at the
// actual new service.bat code) to wire up correctly — this script
// just tells you WHEN that's worth doing, instead of you having to
// notice on your own or read the whole file by hand every release.
//
// USAGE:
//   node scripts/check-zapret-menu-changes.js
//
// Run it whenever you like (e.g. after auto-update.bat, or on its
// own). If it finds something genuinely new, copy its output and
// paste it in the Claude chat — that's enough context to go on.
// ============================================================

const https = require('https')
const fs = require('fs')
const path = require('path')

const REPO = 'Flowseal/zapret-discord-youtube'
const RELEASES_LATEST_URL = `https://api.github.com/repos/${REPO}/releases/latest`
const BUNDLED_SERVICE_BAT = path.join(__dirname, '..', 'resources', 'zapret', 'service.bat')

// Menu items LAZEYKA already understands, one way or another.
// Keys are matched case-insensitively against the menu label text.
const WIRED_INTO_SETTINGS_UI = new Set([
  'game filter',
  'ipset filter',
  'auto-update check'
])
// Deliberately NOT wired into the UI (by design, not by oversight) —
// these stay "open service.bat yourself for this one" on purpose:
// service (un)installation and diagnostics are rare, higher-risk,
// or genuinely better done interactively.
const KNOWN_BUT_NOT_WIRED = new Set([
  'install service',
  'remove services',
  'check status',
  'replace active fakes',
  'update ipset list', // LAZEYKA has its own "Обновить список" button that hits the same source
  'update hosts file',
  'check for updates', // Zapret's own legacy checker — LAZEYKA intentionally disables this via NO_UPDATE_CHECK and has its own bundle-update banner instead
  'run diagnostics',
  'run tests',
  'exit'
])

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'LAZEYKA-menu-check' } }, (res) => {
      if (res.statusCode && res.statusCode >= 400) {
        reject(new Error(`HTTP ${res.statusCode} for ${url}`))
        res.resume()
        return
      }
      let data = ''
      res.on('data', (c) => (data += c))
      res.on('end', () => {
        try { resolve(JSON.parse(data)) } catch (e) { reject(e) }
      })
    }).on('error', reject)
  })
}

function fetchText(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'LAZEYKA-menu-check' } }, (res) => {
      if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        fetchText(res.headers.location).then(resolve, reject)
        res.resume()
        return
      }
      if (res.statusCode && res.statusCode >= 400) {
        reject(new Error(`HTTP ${res.statusCode} for ${url}`))
        res.resume()
        return
      }
      const chunks = []
      res.on('data', (c) => chunks.push(c))
      res.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')))
    }).on('error', reject)
  })
}

function extractMenuLabels(serviceBatText) {
  // Scope to the MAIN menu block only — service.bat has several other
  // "echo N. Label" style sub-menus further down (Game Filter's TCP/UDP
  // picker, Replace-active-fakes' own picker, etc.) that would otherwise
  // be misread as separate top-level features. The main menu always runs
  // from its "SERVICE MANAGER" title through the first "Select option"
  // prompt that follows it.
  const titleIdx = serviceBatText.search(/ZAPRET SERVICE MANAGER/i)
  if (titleIdx === -1) return []
  const afterTitle = serviceBatText.slice(titleIdx)
  const promptIdx = afterTitle.search(/set\s+\/p\s+.*Select option/i)
  const menuBlock = promptIdx === -1 ? afterTitle : afterTitle.slice(0, promptIdx)

  const labels = []
  for (const line of menuBlock.split(/\r?\n/)) {
    const m = line.match(/^echo\s+\d+\.\s+(.+?)\s*(?:\[.*\])?\s*$/i)
    if (m) labels.push(m[1].trim())
  }
  return labels
}

async function main() {
  console.log(`Checking ${REPO} for menu changes...\n`)

  let latestTag
  let downloadUrl
  try {
    const release = await fetchJson(RELEASES_LATEST_URL)
    latestTag = release.tag_name
    const asset = (release.assets || []).find((a) => /\.zip$/i.test(a.name))
    if (!asset) throw new Error('no .zip asset in latest release')
    downloadUrl = asset.browser_download_url
  } catch (e) {
    console.error(`Could not check GitHub releases: ${e.message}`)
    console.error('(Rate-limited, offline, or GitHub is having issues — try again later.)')
    process.exit(1)
  }

  console.log(`Latest upstream release: ${latestTag}`)

  // We only need service.bat, not the whole zip — but GitHub release
  // assets don't offer single-file access, so fetch the whole zip and
  // extract just that one entry using a zero-dependency approach: shell
  // out to the OS's own unzip via a temp file, if adm-zip isn't present.
  let AdmZip
  try {
    AdmZip = require(path.join(__dirname, '..', 'node_modules', 'adm-zip'))
  } catch {
    console.error('adm-zip not found — run this from inside the LAZEYKA project folder')
    console.error('after `pnpm install`.')
    process.exit(1)
  }

  let zipBuffer
  try {
    zipBuffer = await new Promise((resolve, reject) => {
      https.get(downloadUrl, { headers: { 'User-Agent': 'LAZEYKA-menu-check' } }, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          https.get(res.headers.location, (res2) => {
            const chunks = []
            res2.on('data', (c) => chunks.push(c))
            res2.on('end', () => resolve(Buffer.concat(chunks)))
            res2.on('error', reject)
          }).on('error', reject)
          return
        }
        const chunks = []
        res.on('data', (c) => chunks.push(c))
        res.on('end', () => resolve(Buffer.concat(chunks)))
      }).on('error', reject)
    })
  } catch (e) {
    console.error(`Could not download the release zip: ${e.message}`)
    process.exit(1)
  }

  const zip = new AdmZip(zipBuffer)
  const entry = zip.getEntries().find((e) => /(^|\/)service\.bat$/i.test(e.entryName))
  if (!entry) {
    console.error('Could not find service.bat inside the downloaded release zip.')
    process.exit(1)
  }
  const latestServiceBat = entry.getData().toString('utf-8')

  if (!fs.existsSync(BUNDLED_SERVICE_BAT)) {
    console.error(`Bundled service.bat not found at ${BUNDLED_SERVICE_BAT}`)
    process.exit(1)
  }
  const bundledServiceBat = fs.readFileSync(BUNDLED_SERVICE_BAT, 'utf-8')

  const latestLabels = extractMenuLabels(latestServiceBat)
  const bundledLabels = new Set(extractMenuLabels(bundledServiceBat).map((l) => l.toLowerCase()))

  console.log(`\nMenu items in the latest release (${latestTag}):`)
  const unrecognized = []
  for (const label of latestLabels) {
    const key = label.toLowerCase()
    let status
    if (WIRED_INTO_SETTINGS_UI.has(key)) status = 'already in LAZEYKA settings'
    else if (KNOWN_BUT_NOT_WIRED.has(key)) status = 'known, intentionally not in settings'
    else if (bundledLabels.has(key)) status = 'present in bundled version too, not yet reviewed'
    else { status = 'NEW — not seen before'; unrecognized.push(label) }
    console.log(`  - ${label}  [${status}]`)
  }

  console.log()
  if (unrecognized.length === 0) {
    console.log('Nothing new — every menu item is already accounted for.')
  } else {
    console.log('============================================================')
    console.log(` Found ${unrecognized.length} menu item(s) LAZEYKA doesn't know about yet:`)
    for (const l of unrecognized) console.log(`   - ${l}`)
    console.log('============================================================')
    console.log('Copy this output and paste it into the Claude chat — that is')
    console.log('enough for Claude to look at what the new item actually does')
    console.log('in service.bat and, if it makes sense, wire it into a proper')
    console.log('setting the same way Game Filter / IPset Filter were done.')
  }
}

main()
