const { app, utilityProcess } = require('electron')
const fs = require('node:fs')
const path = require('node:path')

const RESULT_PATH = path.resolve(process.cwd(), 'moonshine-spike-result.json')
const WORKER_PATH = path.resolve(__dirname, 'utility-worker.mjs')
const TIMEOUT_MS = 5 * 60 * 1000

let finished = false
let child
let timeout

function finish(code, result) {
  if (finished) return
  finished = true
  clearTimeout(timeout)
  try {
    fs.writeFileSync(RESULT_PATH, `${JSON.stringify(result, null, 2)}\n`, 'utf8')
  } catch (error) {
    console.error('failed to write spike result', error)
    code = 1
  }
  if (child && child.pid) child.kill()
  console.log(JSON.stringify(result))
  app.exit(code)
}

app.whenReady().then(() => {
  child = utilityProcess.fork(WORKER_PATH, [], {
    serviceName: 'Family Circle Moonshine Spike',
    stdio: 'pipe',
  })

  child.stdout?.on('data', (chunk) => process.stdout.write(`[moonshine-worker] ${chunk}`))
  child.stderr?.on('data', (chunk) => process.stderr.write(`[moonshine-worker] ${chunk}`))

  child.on('message', (message) => {
    if (message?.type === 'success') {
      finish(0, message)
    } else if (message?.type === 'failure') {
      finish(1, message)
    }
  })

  child.on('error', (error) => {
    finish(1, { type: 'failure', message: `utility process error: ${error.message}` })
  })

  child.on('exit', (code) => {
    if (!finished) {
      finish(1, { type: 'failure', message: `utility process exited before result (code ${code})` })
    }
  })

  timeout = setTimeout(() => {
    finish(1, { type: 'failure', message: `Moonshine spike timed out after ${TIMEOUT_MS} ms` })
  }, TIMEOUT_MS)
})

app.on('window-all-closed', (event) => event.preventDefault())
