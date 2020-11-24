console.log('start content script!')

function FindReact(dom, traverseUp = 0) {
  const key = Object.keys(dom).find(key => key.startsWith("__reactInternalInstance$"));
  const domFiber = dom[key];
  if (domFiber == null) return null;

  // react <16
  if (domFiber._currentElement) {
    let compFiber = domFiber._currentElement._owner;
    for (let i = 0; i < traverseUp; i++) {
      compFiber = compFiber._currentElement._owner;
    }
    return compFiber._instance;
  }

  // react 16+
  const GetCompFiber = fiber => {
    //return fiber._debugOwner; // this also works, but is __DEV__ only
    let parentFiber = fiber.return;
    while (typeof parentFiber.type == "string") {
      parentFiber = parentFiber.return;
    }
    return parentFiber;
  };
  let compFiber = GetCompFiber(domFiber);
  for (let i = 0; i < traverseUp; i++) {
    compFiber = GetCompFiber(compFiber);
  }
  return compFiber.stateNode;
}

function contextMenuClick(e) {
  return e.target.dispatchEvent(e)
}

Disclose = (() => {
  const disclose = {}

  let lastContextMenuEvent
  function interceptContextMenuEvents(e) {
    lastContextMenuEvent = e
  }
  document.body.addEventListener('contextmenu', interceptContextMenuEvents)

  function setVolume(reactNode, volumeLevel) {
    const currentLevel = reactNode.state.value
    const diff = volumeLevel - currentLevel
    reactNode.moveGrabber(diff)
  }

  function findUserIdFromEl(el) {
    const reactEl = FindReact(el.parentNode)
    if (!reactEl) return
    return FindReact(el.parentNode).props.user.id
  }

  function makeUserVolumeSetterFromEl(el) {
    return volume => {
      const reactEl = FindReact(el)
      if (!reactEl) return false
      FindReact(el).props.onContextMenu({ preventDefault: () => { }, currentTarget: { contains: () => true }, stopPropagation: () => { } })
      const reactNode = FindReact(document.querySelector('#user-context-user-volume [class^=slider-]'))
      setVolume(reactNode, volume)
    }
  }

  function getUserVolumeSetters() {
    const userEls = [...document.querySelectorAll('div[class^="voiceUser"]')]
    const setters = {}
    userEls.forEach(userEl => {
      const userId = findUserIdFromEl(userEl)
      if (!userId) return
      setters[userId] = makeUserVolumeSetterFromEl(userEl)
    })
    return setters
  }

  function setVolumeById(id, volume) {
    const setters = getUserVolumeSetters()
    setters[id] && setters[id](volume)
  }

  disclose.update = function update(data) {
    const contextMenuAlreadyOpen = !!document.querySelector('[id$=-context]')
    const focusedEl = document.activeElement
    data.levels.forEach(val => setVolumeById(...val))
    if (contextMenuAlreadyOpen && lastContextMenuEvent) {
      contextMenuClick(lastContextMenuEvent)
    } else {
      document.body.click()
      focusedEl.focus()
    }
  }

  return disclose
})()

function run() {
  const ws = new WebSocket('ws://192.168.1.141:3456')
  ws.addEventListener('message', msg => {
    console.log(msg, msg.data)
    if (isNaN(+msg.data)) return
    let level = (+msg.data).toFixed(0)
    if (level > 100) level = 100
    level = 100 - level
    console.log(level)
    Disclose.update({
      levels: [
        ['349312214378872833', level],
        ['333009296918970369', level]
      ]
    })
  })
}

run()


async function waitForDiscloseChannelFirstMessage() {
  function recursiveCheck(cb, interval = 100) {
    const title = document.querySelector('[class*="container-"] h3[class^="title-"]')
    const firstMessage = document.querySelector('[class^="message-"] [class*=" messageContent"]')
    if (title && title.textContent === 'disclose' && firstMessage) return cb(firstMessage.textContent)
    setTimeout(() => recursiveCheck(cb, interval), interval)
  }
  return new Promise((res) => recursiveCheck(res))
}

async function getHost() {
  [...document.querySelectorAll('[class^="containerDefault"] [class^="name-"]')].filter(el => el.textContent == 'disclose')[0].click()
  const firstMessage = await waitForDiscloseChannelFirstMessage()
  const host = firstMessage.match(/\nhost:[ ]*([a-z0-9.:-]+)/i)[1]
  window.history.back()
  return host
}

getHost().then(console.log)

function startWebsocket() {
  const webSocket = new WebSocket('ws://localhost:47747')
  webSocket.addEventListener('open', () => webSocket.send("Hi! I'm Disclose calling from Discord!"))
  webSocket.addEventListener('message', ({ data }) => console.log(data))
}

let testingVolumes = false
let tmpLevel = 50
let direction = 'up'
let interval = 500

function testVolumes(start) {
  if (start) testingVolumes = true
  console.log('updating volumes')
  console.log(direction)
  console.log(tmpLevel)
  Disclose.update({
    levels: [
      ['235088799074484224', tmpLevel],
      ['234395307759108106', tmpLevel]
    ]
  })
  if (direction === 'up') {
    if (tmpLevel > 95) {
      direction = 'down'
      tmpLevel = 95
    } else {
      tmpLevel += 5
    }
  } else {
    if (tmpLevel < 5) {
      direction = 'up'
      tmpLevel = 5
    } else {
      tmpLevel -= 5
    }
  }
  if (testingVolumes) {
    console.log(testingVolumes)
    setTimeout(() => testVolumes(), interval)
  }
}

function setIntervalTime(t) {
  interval = t
}

function stopTestVolumes() {
  testingVolumes = false
}

// testVolumes(true)

console.log('hi!')