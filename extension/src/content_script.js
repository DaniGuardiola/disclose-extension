// TODO
// - visual representation of distance (opacity and hiding)
// - set users volume relative to a maximum?
// - hide volume controls
// - better injection method: https://stackoverflow.com/a/9517879
// - listen to relevant Discord events

// Script injection
// ----------------

const SCRIPT_TO_INJECT = `
(function () {

  // Communication with content script
  // ---------------------------------

  const MSG = (function () {
    // receiver
    const msgHandlers = []
    document.addEventListener('__DISCLOSE_CONTENT_MSG__', function (e) {
      msgHandlers.forEach(handler => handler(e.detail))
    })

    function listen(handler) {
      msgHandlers.push(handler)
    }

    function send(data) {
      document.dispatchEvent(new CustomEvent('__DISCLOSE_INJECTED_MSG__', { detail: data }));
    }

    return { listen, send }
  })()

  // Discord internal modules extraction
  // -----------------------------------

  const DISCORD = (function () {
    // Welcome to this messy hack! I'm Dani Guardiola and I will be your guide today.

    // So here's how it works...
    // Webpack uses 'Object.defineProperty' to assign the '__esModule' property
    // to modules, so we can take advantage of that and inspect every call to
    // this method to locate the module we want until we find it.
    // We do that by creating a function that wraps the original method, and
    // using it as a replacement.

    // This script will be executed before everything else (the content script that
    // injects it is configured with "run_at": "document_start")

    // Module stuff
    const REQUIRED_MODULES = ['audio', 'userInfo', 'voiceChannel', 'users', 'channels', 'messages', 'API']
    const modules = {}
    function allModulesExtracted() {
      const results = REQUIRED_MODULES.map(module => Object.keys(modules).includes(module))
      return !results.some(result => !result)
    }

    // Save the original method
    const originalDefineProperty = Object.defineProperty

    // Here's the hacky method...
    function hackyDefineProperty(obj, key, data) {
      if (key === '__esModule' && data.value === true) {
        // Congratulations! It's a module!

        // The content of the module goes in the 'default' property, which is assigned
        // at a later time, so we can define a setter to look for future values
        originalDefineProperty(obj, 'default', {
          configurable: true, // sh*t breaks without this descriptor being overwritable
          set: function (defaultValue) {
            if (typeof defaultValue === 'undefined') return // value will be undefined anyway

            if (typeof defaultValue === 'object') {
              // Detect and save the internal modules we want to use

              // Audio
              if (defaultValue.hasOwnProperty('setLocalVolume')) {
                modules.audio = defaultValue
              }

              // User info
              if (defaultValue.__proto__.hasOwnProperty('getVerifyingUserId')) {
                modules.userInfo = defaultValue
              }

              // Voice channel
              if (defaultValue.__proto__.hasOwnProperty('getUserVoiceChannelId')) {
                modules.voiceChannel = defaultValue
              }

              // Voice connection
              if (defaultValue.__proto__.hasOwnProperty('getRemoteDisconnectVoiceChannelId')) {
                modules.voiceConn = defaultValue
              }

              // Users
              if (defaultValue.__proto__.hasOwnProperty('getNullableCurrentUser')) {
                modules.users = defaultValue
              }

              // Channels
              if (defaultValue.__proto__.hasOwnProperty('getPrivateChannelsVersion')) {
                modules.channels = defaultValue
              }

              // Messages
              if (defaultValue.hasOwnProperty('fetchMessages')) {
                modules.messages = defaultValue
              }

              // API
              if (defaultValue.hasOwnProperty('getAPIBaseURL')) {
                modules.API = defaultValue
              }
            }

            // This weird descriptor is not needed anymore, thrash it
            delete obj.default
            // Assign the value
            obj.default = defaultValue

            if (allModulesExtracted()) {
              // The hack is not needed anymore, so restore the original 'defineProperty' method
              Object.defineProperty = originalDefineProperty
            }
          }
        })
      }
      // Finally, execute the original 'defineProperty' method
      return originalDefineProperty(obj, key, data)
    }

    // Replace with our hacky method, and done!
    Object.defineProperty = hackyDefineProperty

    return modules
  })()

  // Disclose API
  // ------------

  const API = (function () {

    // just in case
    function perceptualToAmplitude(e, t) {
      void 0 === t && (t = 100);
      if (0 === e) return 0;
      var n;
      n = e > t ? (e - t) / t * 6 : e / t * 50 - 50;
      return t * Math.pow(10, n / 20)
    }

    // This API is an abstraction on top of Discord's internal modules,
    // with methods that are helpful for Disclose

    // Sets a user's volume by their ID.
    function setUserVolume(userId, volume) {
      const max = 100 // might need to change it for desktop Discord client
      const amplitude = volume === 0
        ? 0
        : max * Math.pow(10, (volume > max ? (volume - max) / max * 6 : volume / max * 50 - 50) / 20)
      DISCORD.audio.setLocalVolume(userId, amplitude, 'default')
    }

    // Checks if user is currently connected to a voice channel.
    function isConnectedToVoice() {
      return DISCORD.voiceConn.isConnected()
    }

    // Gets data about the current voice channel.
    function getCurrentVoiceData() {
      if (!isConnectedToVoice()) return { connected: false }

      const channelId = DISCORD.voiceConn.getChannelId()
      const guildId = DISCORD.voiceConn.getGuildId()
      const channelVoiceStates = Object.values(DISCORD.voiceChannel.getVoiceStates(guildId))
        .filter(function (e) { return e.channelId === channelId })
      const channelUserIds = channelVoiceStates.map(s => s.userId)
      const channelName = DISCORD.channels.getChannel(channelId).name
      return {
        connected: true,
        channelId, guildId, channelUserIds, channelName
      }
    }

    // Looks for a text channel named "disclose" (case insensitive)
    // and return its ID, or false if not found.
    function getDiscloseInfoChannelId() {
      const voiceData = getCurrentVoiceData()
      if (!voiceData.connected) return false
      const result = Object.values(DISCORD.channels.getAllChannels())
        .filter(channel => channel.guild_id === voiceData.guildId)
        .find(channel => channel.name.toLowerCase() === 'disclose' && channel.type === 0)
      return result ? result.id : false
    }

    // Obtains the last message of a channel by its ID.
    async function getLastChannelMessage(channelId) {
      const result = await DISCORD.API.get({
        url: '/channels/' + channelId + '/messages',
        query: {
          limit: 1
        },
        retries: 2,
        oldFormErrors: true
      })
      return result.body[0].content
    }

    function getCurrentUserId() {
      return DISCORD.userInfo.getId()
    }

    return {
      setUserVolume,
      getCurrentVoiceData,
      getDiscloseInfoChannelId,
      getLastChannelMessage,
      getCurrentUserId
    }
  })()

  // Disclose
  // --------

  const disclose = (function () {
    const MAIN_LOOP_INTERVAL = 1000
    const DISCONNECTED_LOOP_INTERVAL = 1000

    const STATES = {
      INITIAL: 0, // Disclose has just started
      NOT_COMPATIBLE: 1, // not in a compatible server
      DISCONNECTED: 2, // in compatible server, but not connected
      NOT_AUTHENTICATED: 3, // connected, but not authenticated (not used yet)
      CONNECTED: 4 // connected to Disclose endpoint
    }

    const MSG_TYPES = {
      RESPONSE: 0,

      // injected -> bg
      CONNECT: 1,


      // bg -> injected
      UPDATE: 2
    }

    class Disclose {
      constructor() {
        this._state = STATES.INITIAL
        this._mainLoop = null
        this._disconnectedLoop = null
        this._msgCounter = 0
        this._msgListeners = []

        MSG.listen(msg => this._msgHandler(msg))
        this._startMainLoop()
      }

      // Handles messages coming from the content script.
      _msgHandler({ type, requestId: msgRequestId, payload }) {
        switch (type) {
          case MSG_TYPES.RESPONSE:
            this._msgListeners = this._msgListeners
              .filter(({ requestId, listener }) => {
                if (requestId === msgRequestId) {
                  listener(payload)
                  return true
                }
              })
            break
          case MSG_TYPES.UPDATE:
            console.log('Received update:', payload)
            this._update(payload)
            break
          default:
            throw new Error('Unknown message type! (injected script)')
        }
      }

      // Sends a message a waits for the response
      _sendRequest(type, data) {
        return new Promise(resolve => {
          const requestId = this._msgCounter++
          const msg = {
            requestId,
            type,
            payload: data
          }
          this._msgListeners.push({
            requestId,
            listener: resolve
          })
          MSG.send(msg)
        })
      }

      // Gets the info channel ID for the current server.
      // If user is not connected to voice or the server is not
      // Disclose-enabled, returns false.
      _getServerInfoChannelId() {
        const voiceData = API.getCurrentVoiceData()

        if (!voiceData.connected) return false

        const voiceChannelName = voiceData.channelName.toLowerCase()
        if (!(voiceChannelName.startsWith('[disclose]')
          || voiceChannelName.endsWith('[disclose]'))) return false

        return API.getDiscloseInfoChannelId()
      }

      // Alias of _getServerInfoChannelId(), but returns a boolean value.
      _isCurrentServerCompatible() {
        return !!this._getServerInfoChannelId()
      }

      // Parses a server info message and extracts all relevant fields.
      _parseServerInfo(msg) {
        const host = msg.match(/[\\n]host:[ ]*([a-z0-9.:-]+)/i)[1]
        return { host }
      }

      // Obtains the Disclose-related info from the info channel on the server.
      async _getServerInfo() {
        const infoChannelId = this._getServerInfoChannelId()
        const lastMessage = await API.getLastChannelMessage(infoChannelId)
        return this._parseServerInfo(lastMessage)
      }

      // Main loop
      _startMainLoop() {
        this._stopMainLoop()
        this._mainLoop = setInterval(() => this._mainLoopFn(), MAIN_LOOP_INTERVAL)
      }

      _stopMainLoop() {
        if (!this._mainLoop) return
        clearInterval(this._mainLoop)
        this._mainLoop = null
      }

      _mainLoopFn() {
        console.log('executing main loop')
        if (!(
          this._state === STATES.INITIAL ||
          this._state === STATES.NOT_COMPATIBLE)) return this._stopMainLoop()

        if (this._isCurrentServerCompatible()) {
          this._stopMainLoop()
          this._state = STATES.DISCONNECTED
          const voiceData = DISCLOSE.getCurrentVoiceData()
          this._currentGuildId = voiceData.guildId
          this._currentChannelId = voiceData.channelId
          this._startDisconnectedLoop()
        } else {
          console.log('happening?')
          this._state = STATES.NOT_COMPATIBLE
        }
      }

      // Disconnected loop
      _startDisconnectedLoop() {
        this._stopDisconnectedLoop()
        this._disconnectedLoop = setInterval(() => this._disconnectedLoopFn(), DISCONNECTED_LOOP_INTERVAL)
      }

      _stopDisconnectedLoop() {
        if (!this._disconnectedLoop) return
        clearInterval(this._disconnectedLoop)
        this._disconnectedLoop = null
      }

      _disconnectedLoopFn() {
        if (this._state !== STATES.DISCONNECTED) return this._stopDisconnectedLoop()

        if (!this._isCurrentServerCompatible()) {
          this._stopDisconnectedLoop()
          this._state = STATES.NOT_COMPATIBLE
          this._currentGuildId = null
          this._currentChannelId = null
          return this._startMainLoop()
        }

        const voiceData = API.getCurrentVoiceData()
        this._currentGuildId = voiceData.guildId
        this._currentChannelId = voiceData.channelId
      }

      // Sends a connection request to the content script.
      async _connect({ host, discordId }) {
        return this._sendRequest(MSG_TYPES.CONNECT, { host, discordId })
      }

      async connect() {
        if (this._state === STATES.NOT_COMPATIBLE)
          return console.error('This server is not Disclose-enabled :(')
        if (this._state === STATES.CONNECTED)
          return console.error('You are already connected!')

        const { host } = await this._getServerInfo()
        const discordId = API.getCurrentUserId()

        return this._connect({ host, discordId })
      }

      // Updates the current volumes.
      _update(data) {
        const fixVolume = v => 100 - v >= 0 ? 100 - v : 0
        data.forEach(([discordId, volume]) => API.setUserVolume(discordId, fixVolume(volume)))
      }
    }

    return new Disclose()
  })()


  window.MSG = MSG
  window.DISCORD = DISCORD
  window.DISCLOSE = API
  window.disclose = disclose
})()
`

function injectScript () {
  const scriptEl = document.createElement('script')
  scriptEl.textContent = SCRIPT_TO_INJECT
  document.documentElement.appendChild(scriptEl)
  scriptEl.remove()
}

// Communication with injected script
// ----------------------------------

const INJECTED_MSG = (function () {
  // receiver
  const msgHandlers = []
  document.addEventListener('__DISCLOSE_INJECTED_MSG__', function (e) {
    msgHandlers.forEach(handler => handler(e.detail))
  })

  function send (data) {
    document.dispatchEvent(
      new CustomEvent('__DISCLOSE_CONTENT_MSG__', { detail: data })
    )
  }

  function listen (handler) {
    msgHandlers.push(handler)
  }

  return { listen, send }
})()

// Communication with background script
// ------------------------------------

const BG_MSG = (function () {
  const port = chrome.runtime.connect()

  const send = msg => port.postMessage(msg)
  const listen = listener => port.onMessage.addListener(listener)

  return { send, listen }
})()

// Entrypoint
// ----------

function main () {
  console.log('start content script!')
  injectScript()
  INJECTED_MSG.listen(BG_MSG.send)
  BG_MSG.listen(INJECTED_MSG.send)
}

main()
