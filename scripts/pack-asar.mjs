import { createPackage } from '@electron/asar'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const rootDir = path.resolve(__dirname, '..')
const stagingDir = path.join(rootDir, 'dist', '.asar-staging')
const outputFile = path.join(rootDir, 'dist', 'app.asar')

// 1. Ensure staging dir
if (fs.existsSync(stagingDir)) {
  fs.rmSync(stagingDir, { recursive: true, force: true })
}
fs.mkdirSync(stagingDir, { recursive: true })

// 2. Copy package.json & out
fs.copyFileSync(path.join(rootDir, 'package.json'), path.join(stagingDir, 'package.json'))
fs.cpSync(path.join(rootDir, 'out'), path.join(stagingDir, 'out'), { recursive: true })

// 3. Copy production node_modules needed by main process
// Only what the MAIN process actually requires at runtime.
//
// The renderer's dependencies are bundled by Vite and never resolved from
// node_modules, so they must not be listed here. This list used to carry
// js-yaml, crypto-js, axios, ws, is-cidr and is-ip — none of which appear in
// a single import anywhere in src/. They were copied into every app.asar for
// nothing.
const prodPackages = [
  '@electron-toolkit',
  'adm-zip',
  'yaml',
  'electron-window-state'
]

const stagingNm = path.join(stagingDir, 'node_modules')
fs.mkdirSync(stagingNm, { recursive: true })

for (const pkg of prodPackages) {
  const srcPkg = path.join(rootDir, 'node_modules', pkg)
  if (fs.existsSync(srcPkg)) {
    fs.cpSync(srcPkg, path.join(stagingNm, pkg), { recursive: true, dereference: true })
  }
}

// 4. Pack into app.asar
const t0 = performance.now()
console.log('Packing dist/app.asar...')
await createPackage(stagingDir, outputFile)
const duration = (performance.now() - t0).toFixed(0)
const sizeMb = (fs.statSync(outputFile).size / (1024 * 1024)).toFixed(2)
console.log(`✓ dist/app.asar created in ${duration}ms (${sizeMb} MB)`)

// 5. Cleanup staging dir
fs.rmSync(stagingDir, { recursive: true, force: true })
