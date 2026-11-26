/* eslint-disable -- классический браузерный код плагина Stream Deck, не часть TypeScript-проекта */
/* Панель настроек кнопки: сохраняет выбор в настройках действия. */
var piSocket = null
var piUUID = null
var piSettings = {}

function piSend(message) {
  if (piSocket && piSocket.readyState === 1) piSocket.send(JSON.stringify(message))
}

function saveSettings() {
  piSend({ event: 'setSettings', context: piUUID, payload: piSettings })
}

function applyToControls() {
  var mode = document.getElementById('mode')
  if (mode) mode.value = ['on', 'off', 'toggle'].indexOf(piSettings.mode) >= 0 ? piSettings.mode : 'toggle'
  var sc = document.getElementById('scenarioId')
  if (sc) sc.value = typeof piSettings.scenarioId === 'string' ? piSettings.scenarioId : ''
}

function connectElgatoStreamDeckSocket(inPort, inUUID, inRegisterEvent) {
  piUUID = inUUID
  piSocket = new WebSocket('ws://127.0.0.1:' + inPort)
  piSocket.onopen = function () {
    piSend({ event: inRegisterEvent, uuid: inUUID })
    piSend({ event: 'getSettings', context: inUUID })
  }
  piSocket.onmessage = function (evt) {
    var data
    try {
      data = JSON.parse(evt.data)
    } catch (e) {
      return
    }
    if (data.event === 'didReceiveSettings') {
      piSettings = (data.payload && data.payload.settings) || {}
      applyToControls()
    }
  }
}

document.addEventListener('DOMContentLoaded', function () {
  var mode = document.getElementById('mode')
  if (mode) {
    mode.addEventListener('change', function () {
      piSettings.mode = mode.value
      saveSettings()
    })
  }
  var sc = document.getElementById('scenarioId')
  if (sc) {
    sc.addEventListener('input', function () {
      piSettings.scenarioId = sc.value.trim()
      saveSettings()
    })
  }
})
