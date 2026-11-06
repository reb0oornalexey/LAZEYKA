/**
 * Значки Windows через PowerShell + user32!PrivateExtractIcons.
 *
 * app.getFileIcon у части программ (в том числе у самой LAZEYKA) отдаёт
 * стандартный «пустой» значок exe; PrivateExtractIcons достаёт значок прямо
 * из ресурсов файла нужного номера и размера (как окно «Сменить значок»).
 * Отсюда же — системные значки shell32.dll / imageres.dll для сценариев.
 */
import { execFile } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { dataDir } from '../utils/dirs'

const execFileAsync = promisify(execFile)

const PS = String.raw`param([string]$ArgsFile, [string]$OutFile)
$ErrorActionPreference = 'Stop'
$cfg = Get-Content -Raw -LiteralPath $ArgsFile | ConvertFrom-Json
Add-Type -AssemblyName System.Drawing
Add-Type -ReferencedAssemblies System.Drawing -TypeDefinition @"
using System;
using System.Drawing;
using System.Drawing.Imaging;
using System.IO;
using System.Runtime.InteropServices;
public static class LzIco {
  [DllImport("user32.dll", CharSet = CharSet.Unicode)]
  public static extern uint PrivateExtractIcons(string file, int index, int cx, int cy, IntPtr[] icons, uint[] ids, uint n, uint flags);
  [DllImport("user32.dll")]
  public static extern bool DestroyIcon(IntPtr h);
  public static int Count(string file) {
    try { uint n = PrivateExtractIcons(file, 0, 0, 0, null, null, 0, 0); return n == uint.MaxValue ? 0 : (int)n; } catch { return 0; }
  }
  public static string Png(string file, int idx, int size) {
    IntPtr[] h = new IntPtr[1]; uint[] ids = new uint[1];
    uint n;
    try { n = PrivateExtractIcons(file, idx, size, size, h, ids, 1, 0); } catch { return null; }
    if (n == 0 || n == uint.MaxValue || h[0] == IntPtr.Zero) return null;
    try {
      using (Icon ico = Icon.FromHandle(h[0]))
      using (Bitmap bmp = ico.ToBitmap()) {
        bool seen = false;
        for (int y = 0; y < bmp.Height && !seen; y += 2)
          for (int x = 0; x < bmp.Width; x += 2)
            if (bmp.GetPixel(x, y).A > 16) { seen = true; break; }
        if (!seen) return null;
        using (MemoryStream ms = new MemoryStream()) {
          bmp.Save(ms, ImageFormat.Png);
          return "data:image/png;base64," + Convert.ToBase64String(ms.ToArray());
        }
      }
    } catch { return null; } finally { DestroyIcon(h[0]); }
  }
}
"@
$size = [int]$cfg.size
$out = New-Object System.Collections.ArrayList
if ($cfg.mode -eq 'system') {
  foreach ($f in @($cfg.files)) {
    $file = [Environment]::ExpandEnvironmentVariables($f)
    if (-not (Test-Path -LiteralPath $file)) { continue }
    $count = [LzIco]::Count($file)
    if ($count -gt 600) { $count = 600 }
    for ($i = 0; $i -lt $count; $i++) {
      $p = [LzIco]::Png($file, $i, $size)
      if ($p) { [void]$out.Add([pscustomobject]@{ f = $f; i = $i; png = $p }) }
    }
  }
} else {
  foreach ($it in @($cfg.items)) {
    [void]$out.Add([pscustomobject]@{ png = [LzIco]::Png([Environment]::ExpandEnvironmentVariables([string]$it.f), [int]$it.i, $size) })
  }
}
[System.IO.File]::WriteAllText($OutFile, (ConvertTo-Json -InputObject @($out.ToArray()) -Depth 3 -Compress), (New-Object System.Text.UTF8Encoding $false))
`

async function runPs<T>(args: Record<string, unknown>, timeout: number): Promise<T[]> {
  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const script = path.join(os.tmpdir(), `lazeyka-ico-${id}.ps1`)
  const argsFile = path.join(os.tmpdir(), `lazeyka-ico-${id}.json`)
  const outFile = path.join(os.tmpdir(), `lazeyka-ico-${id}.out.json`)
  writeFileSync(script, '\ufeff' + PS, 'utf-8')
  writeFileSync(argsFile, JSON.stringify(args), 'utf-8')
  try {
    await execFileAsync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script, '-ArgsFile', argsFile, '-OutFile', outFile], {
      windowsHide: true,
      timeout,
      maxBuffer: 1 << 20
    })
    const j = JSON.parse(readFileSync(outFile, 'utf-8').replace(/^\ufeff/, '')) as T[] | T
    return Array.isArray(j) ? j : [j]
  } finally {
    for (const f of [script, argsFile, outFile]) {
      try {
        if (existsSync(f)) unlinkSync(f)
      } catch {
        /* temp */
      }
    }
  }
}

/** Значки файлов (exe/dll/ico) по номеру. Порядок ответа = порядок запроса; null — не вышло. */
export async function extractIcons(items: { file: string; index: number }[], size = 48): Promise<(string | null)[]> {
  if (process.platform !== 'win32' || items.length === 0) return items.map(() => null)
  try {
    const res = await runPs<{ png: string | null }>({ mode: 'list', size, items: items.map((x) => ({ f: x.file, i: x.index })) }, 120_000)
    return items.map((_, i) => res[i]?.png ?? null)
  } catch {
    return items.map(() => null)
  }
}

export interface SystemIcon {
  id: string
  png: string
}

const SYSTEM_FILES = ['%SystemRoot%\\System32\\imageres.dll', '%SystemRoot%\\System32\\shell32.dll', '%SystemRoot%\\System32\\ddores.dll', '%SystemRoot%\\System32\\mmres.dll']
let systemCache: SystemIcon[] | null = null

/** Системные значки Windows (как в «Сменить значок» у папки). Кэш на диске. */
export async function systemIcons(): Promise<SystemIcon[]> {
  if (process.platform !== 'win32') return []
  if (systemCache) return systemCache
  const file = path.join(dataDir(), 'cache', 'system-icons.json')
  try {
    const j = JSON.parse(readFileSync(file, 'utf-8')) as { build: string; icons: SystemIcon[] }
    if (j.build === os.release() && j.icons.length > 0) return (systemCache = j.icons)
  } catch {
    /* нет кэша */
  }
  const raw = await runPs<{ f: string; i: number; png: string }>({ mode: 'system', size: 48, files: SYSTEM_FILES }, 170_000)
  const seen = new Set<string>()
  const icons: SystemIcon[] = []
  for (const r of raw) {
    if (!r?.png || seen.has(r.png)) continue
    seen.add(r.png)
    icons.push({ id: `${path.basename(r.f)}#${r.i}`, png: r.png })
  }
  try {
    mkdirSync(path.dirname(file), { recursive: true })
    writeFileSync(file, JSON.stringify({ build: os.release(), icons }), 'utf-8')
  } catch {
    /* без кэша */
  }
  return (systemCache = icons)
}
