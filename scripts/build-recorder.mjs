import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const SOURCE_DIR = join('native', 'recorder')
const BUILD_DIR = join(SOURCE_DIR, 'build')
const HELPER = join(BUILD_DIR, 'Release', 'cawmera-recorder.exe')
const BUNDLED_CMAKE = join('Common7', 'IDE', 'CommonExtensions', 'Microsoft', 'CMake', 'CMake', 'bin', 'cmake.exe')
const INSTALL_HINT = 'Install Visual Studio 2022 or its Build Tools with the "Desktop development with C++" workload.'

const FORBIDDEN_APIS = ['SetWindowsHookEx', 'GetAsyncKeyState', 'GetKeyState', 'GetKeyboardState', 'SetWinEventHook',
  'RegisterHotKey']
const FORBIDDEN_IMPORT = new RegExp(String.raw`\b(?:NtUser)?(?:${FORBIDDEN_APIS.join('|')})[AW]?\b`, 'g')
const NETWORK_DLLS = ['WS2_32.DLL', 'WSOCK32.DLL', 'WINHTTP.DLL', 'WININET.DLL', 'URLMON.DLL', 'DNSAPI.DLL']
const STRING_ENCODINGS = [['ASCII', 'ascii'], ['UTF-16LE', 'utf16le']]

function fail(message) {
  console.error(`\nbuild:recorder: ${message}`)
  process.exit(1)
}

function run(tool, args, failure) {
  const result = spawnSync(tool, args, { stdio: 'inherit' })
  if (result.error) fail(`couldn't start ${tool}: ${result.error.message}`)
  if (result.status !== 0) fail(`${failure} (exit code ${result.status}).`)
}

function outputOf(tool, args) {
  // English output from the MSVC tools, so dumpbin's "Ordinal" lines parse on localized installs too.
  const result = spawnSync(tool, args, { encoding: 'utf8', env: { ...process.env, VSLANG: '1033' } })
  if (result.error) fail(`couldn't start ${tool}: ${result.error.message}`)
  if (result.status !== 0) {
    fail(`${tool} ${args.join(' ')} exited with code ${result.status}\n${result.stdout}${result.stderr}`)
  }
  return result.stdout
}

function findVisualStudio() {
  const programFiles = process.env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)'
  const vswhere = join(programFiles, 'Microsoft Visual Studio', 'Installer', 'vswhere.exe')
  if (!existsSync(vswhere)) fail(`vswhere.exe isn't at ${vswhere}. ${INSTALL_HINT}`)

  const installations = outputOf(vswhere, ['-version', '[17.0,18.0)', '-products', '*', '-requires',
    'Microsoft.VisualStudio.Component.VC.Tools.x86.x64', '-sort', '-utf8', '-property', 'installationPath'])
    .split(/\r?\n/)
    .filter(Boolean)
  if (installations.length === 0) fail(`no Visual Studio 2022 with the C++ tools found. ${INSTALL_HINT}`)

  for (const installation of installations) {
    const cmake = join(installation, BUNDLED_CMAKE)
    if (existsSync(cmake)) return { installation, cmake }
  }
  fail(`no CMake in ${installations.join(' or ')}. Add "C++ CMake tools for Windows" in the Visual Studio Installer.`)
}

function findDumpbin(installation) {
  const versionFile = join(installation, 'VC', 'Auxiliary', 'Build', 'Microsoft.VCToolsVersion.default.txt')
  const version = existsSync(versionFile) ? readFileSync(versionFile, 'utf8').trim() : ''
  const dumpbin = join(installation, 'VC', 'Tools', 'MSVC', version, 'bin', 'Hostx64', 'x64', 'dumpbin.exe')
  if (!version || !existsSync(dumpbin)) fail(`dumpbin.exe isn't in ${installation}. ${INSTALL_HINT}`)
  return dumpbin
}

// Every DLL in dumpbin's imports and delay-load imports, upper-cased, with the ordinals imported from it.
function ordinalsByDll(imports) {
  const dlls = new Map()
  let current = []
  for (const line of imports.split(/\r?\n/)) {
    const dll = line.match(/^\s+(\S+\.dll)\s*$/i)?.[1].toUpperCase()
    if (dll) {
      current = dlls.get(dll) ?? []
      dlls.set(dll, current)
    }
    const ordinal = line.match(/\bOrdinal\s+(\d+)\s*$/)?.[1]
    if (ordinal) current.push(ordinal)
  }
  return dlls
}

function apiNamesInBytes(file) {
  const bytes = readFileSync(file)
  return FORBIDDEN_APIS.flatMap((api) => STRING_ENCODINGS
    .filter(([, encoding]) => bytes.includes(Buffer.from(api, encoding)))
    .map(([label]) => `${api} (${label})`))
}

function checkHelperApis(dumpbin) {
  const imports = outputOf(dumpbin, ['/imports', HELPER])
  const dlls = ordinalsByDll(imports)
  if (dlls.size === 0) fail(`dumpbin listed no imported DLLs for ${HELPER}.`)

  const broken = [
    ['it imports a keyboard or hook API', [...new Set(imports.match(FORBIDDEN_IMPORT))]],
    ['its bytes name a keyboard or hook API', apiNamesInBytes(HELPER)],
    ['it imports from USER32.dll by ordinal', dlls.get('USER32.DLL') ?? []],
    ['it imports a network DLL', [...dlls.keys()].filter((dll) => NETWORK_DLLS.includes(dll))]
  ].filter(([, found]) => found.length > 0)
  if (broken.length > 0) {
    const rules = broken.map(([rule, found]) => `\n  - ${rule}: ${found.join(', ')}`).join('')
    fail(`${HELPER} breaks the helper's rules (no keyboard, no hooks, no network):${rules}`)
  }
}

if (process.platform !== 'win32') fail('the recorder helper builds on Windows only.')
process.chdir(fileURLToPath(new URL('..', import.meta.url)))

const { installation, cmake } = findVisualStudio()
const dumpbin = findDumpbin(installation)

run(cmake, ['-S', SOURCE_DIR, '-B', BUILD_DIR, '-G', 'Visual Studio 17 2022', '-A', 'x64',
  `-DCMAKE_GENERATOR_INSTANCE=${installation}`], `CMake couldn't configure ${SOURCE_DIR}`)
run(cmake, ['--build', BUILD_DIR, '--config', 'Release'], 'the build failed')
run(join(dirname(cmake), 'ctest.exe'),
  ['--test-dir', BUILD_DIR, '-C', 'Release', '--output-on-failure', '--no-tests=error'], 'the helper tests failed')
if (!existsSync(HELPER)) fail(`${HELPER} wasn't built.`)
checkHelperApis(dumpbin)
console.log(`\n${HELPER} is built and tested, and uses no keyboard, hook or network APIs.`)
