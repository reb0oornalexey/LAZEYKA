/* eslint-disable -- классический браузерный код плагина Stream Deck, не часть TypeScript-проекта */
/* Плагин LAZEYKA для Stream Deck. По нажатию просит Stream Deck открыть ссылку lazeyka://… */
var websocket = null
var pluginUUID = null

function send(message) {
  if (websocket && websocket.readyState === 1) websocket.send(JSON.stringify(message))
}

function connectElgatoStreamDeckSocket(inPort, inPluginUUID, inRegisterEvent) {
  pluginUUID = inPluginUUID
  websocket = new WebSocket('ws://127.0.0.1:' + inPort)

  websocket.onopen = function () {
    send({ event: inRegisterEvent, uuid: inPluginUUID })
  }

  websocket.onmessage = function (evt) {
    var data
    try {
      data = JSON.parse(evt.data)
    } catch (e) {
      return
    }
    if (data.event !== 'keyDown') return
    var settings = (data.payload && data.payload.settings) || {}
    var url = LazeykaLink.buildUrl(data.action, settings, typeof LazeykaCodes !== 'undefined' ? LazeykaCodes : null)
    if (!url) {
      // Не задан идентификатор сценария — показываем на кнопке значок предупреждения.
      send({ event: 'showAlert', context: data.context })
      return
    }
    send({ event: 'openUrl', payload: { url: url } })
  }
}
