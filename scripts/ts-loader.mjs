// Позволяет Node 22 импортировать наши .ts-файлы с «голыми» относительными путями и алиасом @renderer.
import { registerHooks } from 'node:module'
import { existsSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import path from 'node:path'

const srcRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../src/renderer/src')

registerHooks({
  resolve(specifier, context, next) {
    let target = null
    if (specifier.startsWith('@renderer/')) target = path.join(srcRoot, specifier.slice('@renderer/'.length))
    else if ((specifier.startsWith('./') || specifier.startsWith('../')) && context.parentURL?.startsWith('file:')) {
      target = path.resolve(path.dirname(fileURLToPath(context.parentURL)), specifier)
    }
    if (target && !path.extname(target)) {
      for (const cand of [target + '.ts', path.join(target, 'index.ts')]) {
        if (existsSync(cand)) return { url: pathToFileURL(cand).href, shortCircuit: true }
      }
    }
    return next(specifier, context)
  }
})
