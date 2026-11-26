/* eslint-disable -- классический браузерный код плагина Stream Deck, не часть TypeScript-проекта */
/* Сборка ссылки lazeyka:// по действию кнопки и её настройкам. Без зависимостей от браузера. */
(function (root) {
  var PREFIX = 'com.reb0oorn.lazeyka.'
  var MODES = ['on', 'off', 'toggle']
  var VPN_COMMAND = { on: 'connect', off: 'disconnect', toggle: 'toggle' }
  var SERVICES = ['zapret', 'telegram', 'exitlag']

  function normalizeMode(mode) {
    return MODES.indexOf(mode) >= 0 ? mode : 'toggle'
  }

  /** Действие (то, что подписывает программа): connect, zapret/off, scenario/<id>… */
  function buildAction(actionUUID, settings) {
    if (typeof actionUUID !== 'string' || actionUUID.indexOf(PREFIX) !== 0) return null
    var name = actionUUID.slice(PREFIX.length)
    var s = settings || {}
    if (name === 'vpn') return VPN_COMMAND[normalizeMode(s.mode)]
    if (SERVICES.indexOf(name) >= 0) return name + '/' + normalizeMode(s.mode)
    if (name === 'scenario') {
      var id = typeof s.scenarioId === 'string' ? s.scenarioId.trim() : ''
      if (!/^[\w.-]{1,80}$/.test(id)) return null
      return 'scenario/' + id
    }
    return null
  }

  /**
   * Возвращает строку-ссылку или null, если для кнопки ещё нечего открывать.
   * codes — коды подписи этой установки ({ 'zapret/off': '…' }); есть код — к ссылке
   * добавляется ?k=…, и программа выполняет команду без вопроса.
   */
  function buildUrl(actionUUID, settings, codes) {
    var action = buildAction(actionUUID, settings)
    if (!action) return null
    var url = 'lazeyka://' + action
    var c = codes && Object.prototype.hasOwnProperty.call(codes, action) ? codes[action] : null
    if (typeof c === 'string' && /^[A-Za-z0-9_-]{16}$/.test(c)) url += '?k=' + c
    return url
  }

  var api = { buildUrl: buildUrl, buildAction: buildAction, normalizeMode: normalizeMode }
  if (typeof module !== 'undefined' && module.exports) module.exports = api
  else root.LazeykaLink = api
})(typeof self !== 'undefined' ? self : this)
