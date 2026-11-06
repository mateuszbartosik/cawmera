const mode = process.argv[2]

const say = (message, then) => process.stdout.write(`${JSON.stringify(message)}\n`, then)
const ready = () => say({ type: 'ready', width: 1280, height: 720 })
const finish = (message, code) => say(message, () => process.exit(code))
const keepAlive = () => setInterval(() => {}, 1000)

const whenStopped = (action) => {
  let buffered = ''
  process.stdin.setEncoding('utf8')
  process.stdin.on('data', (chunk) => {
    buffered += chunk
    if (buffered.includes('"stop"')) action()
  })
  process.stdin.on('end', action)
}

switch (mode) {
  case 'ready-then-done':
    ready()
    whenStopped(() => finish({ type: 'done', durationMs: 1000, frames: 60 }, 0))
    break
  case 'error':
    finish({ type: 'error', code: 'access-denied', message: 'blocked' }, 1)
    break
  case 'silent':
    keepAlive()
    break
  case 'exit-early':
    ready()
    setTimeout(() => finish({ type: 'done', durationMs: 400, frames: 24 }, 0), 100)
    break
  case 'ignore-stop':
    ready()
    keepAlive()
    break
  case 'crash':
    process.exit(1)
    break
  case 'ready-then-crash':
    ready()
    setTimeout(() => process.exit(1), 100)
    break
}
