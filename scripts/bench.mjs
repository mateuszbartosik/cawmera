import { spawn } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import electron from 'electron'
import { build } from 'vite'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const USAGE = 'usage: npm run bench:export -- [--seconds 20] [--size 1920x1080] [--fps 60] [--runs 3] [--compare]'

function option(args, name, fallback) {
  const at = args.indexOf(`--${name}`)
  return at >= 0 && args[at + 1] !== undefined ? args[at + 1] : fallback
}

function exportConfig(args) {
  const [width, height] = option(args, 'size', '1920x1080').split('x').map(Number)
  const config = {
    seconds: Number(option(args, 'seconds', '20')),
    width,
    height,
    fps: Number(option(args, 'fps', '60')),
    runs: Number(option(args, 'runs', '3')),
    compare: args.includes('--compare')
  }
  const valid = [config.seconds, width, height, config.runs].every((value) => Number.isFinite(value) && value > 0) && [30, 60].includes(config.fps)
  if (!valid) throw new Error(USAGE)
  return config
}

const [kind, ...args] = process.argv.slice(2)
if (kind !== 'export') {
  console.error(USAGE)
  process.exit(1)
}
const config = exportConfig(args)

await build({ configFile: join(root, 'vite.bench.config.ts'), logLevel: 'warn' })

const environment = { ...process.env }
delete environment.ELECTRON_RUN_AS_NODE
const child = spawn(electron, [join(root, 'bench', 'main.mjs'), `--bench-config=${JSON.stringify(config)}`], { stdio: 'inherit', env: environment })
child.on('exit', (code) => process.exit(code ?? 1))
