import { exec } from 'node:child_process'
import { getZapretStatus } from '../core/zapret'
import { getTgwsStatus } from '../core/tgws'
import { getIncyStatus } from '../core/incy-engine'

let lastRx = 0
let lastTx = 0
let lastTime = 0
let currentRxSpeedKb = 0
let currentTxSpeedKb = 0
let isQuerying = false

export function getRealNetworkSpeed(): { rxKbps: number; txKbps: number } {
  const zapretOn = getZapretStatus().state === 'running'
  const tgwsOn = getTgwsStatus().state === 'running'
  const incyOn = getIncyStatus().state === 'running'

  if (!zapretOn && !tgwsOn && !incyOn) {
    currentRxSpeedKb = 0
    currentTxSpeedKb = 0
    return { rxKbps: 0, txKbps: 0 }
  }

  const now = Date.now()
  if (now - lastTime < 2500 || isQuerying) {
    return { rxKbps: currentRxSpeedKb, txKbps: currentTxSpeedKb }
  }

  isQuerying = true
  exec('netstat -e', { windowsHide: true }, (err, stdout) => {
    isQuerying = false
    if (!err && stdout) {
      const match = stdout.match(/(\d+)\s+(\d+)/)
      if (match) {
        const rx = Number(match[1]) || 0
        const tx = Number(match[2]) || 0
        if (lastTime > 0 && lastRx > 0 && rx >= lastRx && tx >= lastTx) {
          const deltaSec = Math.max(1, (now - lastTime) / 1000)
          currentRxSpeedKb = Math.max(0, Math.round((rx - lastRx) / 1024 / deltaSec))
          currentTxSpeedKb = Math.max(0, Math.round((tx - lastTx) / 1024 / deltaSec))
        }
        lastRx = rx
        lastTx = tx
        lastTime = now
      }
    }
  })

  return { rxKbps: currentRxSpeedKb, txKbps: currentTxSpeedKb }
}
