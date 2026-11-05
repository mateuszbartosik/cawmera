import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const SOURCE_DIR = join('native', 'recorder')
const BUILD_DIR = join(SOURCE_DIR, 'build')
const HELPER = join(BUILD_DIR, 'Release', 'cawmera-recorder.exe')
const BUNDLED_CMAKE = join('Common7', 'IDE', 'CommonExtensions', 'Microsoft', 'CMake', 'CMake', 'bin', 'cmake.exe')
const FORBIDDEN_IMPORTS = /\b(?:SetWindowsHookEx|GetAsyncKeyState|GetKeyState|GetKeyboardState)[AW]?\b/g
const INSTALL_HINT = 'Install Visual Studio 2022 or its Build Tools with the "Desktop development with C++" workload.'

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
  const result = spawnSync(tool, args, { encoding: 'utf8' })
  if (result.error) fail(`couldn't start ${tool}: ${result.error.message}`)
  if (result.status !== 0) {
    fail(`${tool} ${args.join(' ')} exited with code ${result.status}\n${result.stdout}${result.stderr}`)
  }
  return result.stdout
}

function findVisualStudio() {
  const programFiles = process.env['ProgramFiles(x86)'] ?? 'C:\Program Files (x86)'
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

function checkImports(dumpbin) {
  const imports = outputOf(dumpbin, ['/imports', HELPER])
  if (!/^\s+\S+\.dll\s*$/im.test(imports)) fail(`dumpbin listed no imported DLLs for ${HELPER}`)
  const forbidden = [...new Set(imports.match(FORBIDDEN_IMPORTS))]
  if (forbidden.length > 0) {
    fail(`${HELPER} imports ${forbidden.join(', ')}. The helper must never read the keyboard or install hooks.`)
  }
}

if (process.platform !== 'win32') fail('the recorder helper builds on Windows only.')
process.chdir(fileURLToPath(new URL('..', import.meta.url)))

const { installation, cmake } = findVisualStudio()
const dumpbin = findDumpbin(installation)

run(cmake, ['-S', SOURCE_DIR, '-B', BUILD_DIR, '-G', 'Visual Studio 17 2022', '-A', 'x64',
  `-DCMAKE_GENERATOR_INSTANCE=${installation}`], `CMake couldn't configure ${SOURCE_DIR}`)
run(cmake, ['--build', BUILD_DIR, '--config', 'Release'], 'the build failed')
run(join(dirname(cmake), 'ctest.exe'), ['--test-dir', BUILD_DIR, '-C', 'Release', '--output-on-failure'],
  'the helper tests failed')
if (!existsSync(HELPER)) fail(`${HELPER} wasn't built.`)
checkImports(dumpbin)
console.log(`\n${HELPER} is built and tested, and imports no keyboard or hook APIs.`)
