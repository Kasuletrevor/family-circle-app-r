import { spawn } from 'node:child_process'

const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm'
const npxCommand = process.platform === 'win32' ? 'npx.cmd' : 'npx'

function run(command, args, options = {}) {
  return spawn(command, args, {
    stdio: 'inherit',
    shell: false,
    ...options,
  })
}

async function waitForVite(url, timeoutMs = 20000) {
  const startedAt = Date.now()
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(url)
      if (response.ok) return
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  throw new Error(`Vite did not become ready at ${url}`)
}

const build = run(npmCommand, ['run', 'build:electron'])
const buildExitCode = await new Promise((resolve) => build.on('exit', resolve))
if (buildExitCode !== 0) process.exit(buildExitCode ?? 1)

const children = []
const electronWatch = run(npxCommand, ['tsc', '-p', 'tsconfig.electron.json', '--watch', '--preserveWatchOutput'])
children.push(electronWatch)

const vite = run(npxCommand, ['vite', '--host', '127.0.0.1', '--port', '5173', '--strictPort'])
children.push(vite)

try {
  await waitForVite('http://127.0.0.1:5173')
  const electron = run(npxCommand, ['electron', '.'], {
    env: { ...process.env, VITE_DEV_SERVER_URL: 'http://127.0.0.1:5173' },
  })
  children.push(electron)
  electron.on('exit', (code) => process.exitCode = code ?? 0)
} catch (error) {
  console.error(error)
  process.exitCode = 1
}

function shutdown() {
  for (const child of children) {
    if (!child.killed) child.kill()
  }
}

process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
process.on('exit', shutdown)
