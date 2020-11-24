const MSG_TYPES = {
  RESPONSE: 0,

  // injected -> bg
  CONNECT: 1,


  // bg -> injected
  UPDATE: 2
}

chrome.runtime.onConnect.addListener(function (port) {

  // State
  // -----

  let wsConn = null

  // Comms
  // -----

  const CONTENT_MSG = {
    send: msg => port.postMessage(msg),
    listen: listener => port.onMessage.addListener(listener)
  }

  const WEBSOCKET_TIMEOUT = 5000

  async function startWebSocket(host, initialMessage) {
    return new Promise((resolve, reject) => {

      const ws = new WebSocket(`ws://${host}`)

      const timeout = setTimeout(() => {
        console.error('Websocket timed out!')
        ws.close()
        reject()
      }, WEBSOCKET_TIMEOUT)

      ws.addEventListener('open', () => {
        clearTimeout(timeout)
        ws.send(initialMessage)
        resolve()
      })

      ws.addEventListener('error', () => {
        clearTimeout(timeout)
        console.log('Error here!')
        reject()
      })

      // const send = msg => ws.send(JSON.stringify(msg))
      const send = msg => ws.send(msg) // don't stringify for now
      const listen = listener => ws.addEventListener('message', msg =>
        listener(JSON.parse(msg.data)))
      const close = () => ws.close()
      wsConn = { send, listen, close }
    })
  }

  function clearWebsocket() {
    if (!wsConn) return
    wsConn.close()
    wsConn = null
  }

  // Message handlers
  // ----------------

  function webSocketHandler(msg) {
    CONTENT_MSG.send({
      type: MSG_TYPES.UPDATE,
      payload: msg
    })
  }

  async function contentMsgHandler({ type, requestId, payload }) {
    function respond(response) {
      CONTENT_MSG.send({
        type: MSG_TYPES.RESPONSE,
        requestId,
        payload: response
      })
    }
    switch (type) {
      case MSG_TYPES.RESPONSE:
        // To do
        break
      case MSG_TYPES.CONNECT:
        console.log('Received connect request:', payload)
        const { host, discordId } = payload
        if (wsConn) clearWebsocket()
        try {
          await startWebSocket(host, discordId)
          wsConn.listen(webSocketHandler)
          respond({
            success: true
          })
        } catch (e) {
          respond({
            success: false
          })
        }
        break
      default:
        throw new Error('Unknown message type! (content script)')
    }
  }

  // initialization
  // --------------

  CONTENT_MSG.listen(contentMsgHandler)
})