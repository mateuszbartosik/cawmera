const mode = process.argv[2]

const say = (message, then) => process.stdout.write(`${JSON.stringify(message)}\n`, then)
const ready = () => say({ type: 'ready', width: 1280, height: 720 })
const finish = (message, code) => say(message, () => process.exit(code))
const keepAlive = () => setInterval(() => {}, 1000)

const onCommands = ({ start, stop }) => {
  let buffered = ''
  process.stdin.setEncoding('utf8')
  process.stdin.on('data', (chunk) => {
    buffered += chunk
    const lines = buffered.split('\n')
    buffered = lines.pop()
    for (const line of lines) {
      const type = JSON.parse(line).type
      if (type === 'start') start?.()
      if (type === 'stop') stop?.()
    }
  })
  process.stdin.on('end', () => stop?.())
}

const stoppedBeforeStart = () => finish({ type: 'error', code: 'internal', message: 'Stopped before recording began' }, 1)
const done = () => finish({ type: 'done', durationMs: 1000, frames: 60 }, 0)

switch (mode) {
  case 'ready-then-done': {
    ready()
    let started = false
    onCommands({ start: () => (started = true), stop: () => (started ? done() : stoppedBeforeStart()) })
    break
  }
  case 'error':
    finish({ type: 'error', code: 'access-denied', message: 'blocked' }, 1)
    break
  case 'silent':
    keepAlive()
    break
  case 'exit-early':
    ready()
    onCommands({ start: () => setTimeout(() => finish({ type: 'done', durationMs: 400, frames: 24 }, 0), 100) })
    break
  case 'gone-before-start':
    ready()
    setTimeout(() => finish({ type: 'error', code: 'target-gone', message: 'The window closed' }, 1), 100)
    break
  case 'ignore-stop':
    ready()
    keepAlive()
    onCommands({})
    break
  case 'split-lines':
    process.stdout.write('{"type":"ready","wi')
    setTimeout(() => process.stdout.write('dth":1920,"height":1080}\r\n'), 50)
    onCommands({ stop: () => process.exit(0) })
    break
  case 'bad-ready':
    say({ type: 'ready', width: 0, height: 720 })
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
