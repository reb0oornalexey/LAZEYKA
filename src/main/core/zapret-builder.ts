import { writeFileSync } from 'node:fs'
import path from 'node:path'
import { zapretBundleDir } from '../utils/dirs'

export interface CustomStrategyConfig {
  name: string
  description: string
  desyncMode: 'fake' | 'diso' | 'fakeddiso' | 'multisplit' | 'split2'
  splitPos: string
  ttl: number
  fooling: 'md5sig' | 'badseq' | 'datanoack' | 'badsum' | 'none'
  fakePayload: string
  includeUdp: boolean
}

export function generateCustomStrategyBat(config: CustomStrategyConfig): { file: string; content: string } {
  const safeName = config.name.replace(/[^a-zA-Z0-9а-яА-Я _-]/g, '').trim() || 'custom_strategy'
  const fileName = `general (${safeName}).bat`
  const filePath = path.join(zapretBundleDir(), fileName)

  const foolingArg = config.fooling !== 'none' ? `--dpi-desync-fooling=${config.fooling}` : ''
  const ttlArg = config.ttl > 0 ? `--dpi-desync-ttl=${config.ttl}` : ''
  const splitArg = config.splitPos ? `--dpi-desync-split-pos=${config.splitPos}` : '--dpi-desync-split-pos=1'

  const content = `@echo off
:: ${config.description || 'Пользовательская стратегия, созданная в конструкторе LAZEYKA'}
set "BIN_PATH=%~dp0bin\\"
set "LISTS_PATH=%~dp0lists\\"

"%BIN_PATH%winws.exe" --wf-tcp=80,443 --wf-udp=443,50000-65535 ^
  --filter-tcp=80 --dpi-desync=fake,split2 --dpi-desync-autottl=2 --dpi-desync-fooling=md5sig ^
  --new ^
  --filter-tcp=443 --hostlist="%LISTS_PATH%list-general.txt" --dpi-desync=${config.desyncMode} ${splitArg} ${ttlArg} ${foolingArg} --dpi-desync-fake-tls="%BIN_PATH%${config.fakePayload || 'tls_clienthello_www_google_com.bin'}" ^
  ${config.includeUdp ? `--new --filter-udp=443 --hostlist="%LISTS_PATH%list-general.txt" --dpi-desync=fake --dpi-desync-repeats=6 --dpi-desync-fake-quic="%BIN_PATH%quic_initial_www_google_com.bin"` : ''}
`

  writeFileSync(filePath, content, 'utf-8')
  return {
    file: fileName,
    content
  }
}
