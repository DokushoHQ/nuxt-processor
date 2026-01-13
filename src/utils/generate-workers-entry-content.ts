export function generateWorkersEntryContent(workerFiles: string[], buildTimeDefaults: string): string {
  const toImportArray = workerFiles.map(id => `() => import(${JSON.stringify(id)})`).join(',\n    ')
  return `
import { fileURLToPath } from 'node:url'
import { resolve as resolvePath } from 'node:path'
import { consola } from 'consola'
import { $workers } from '#processor-utils'

function getRedisConfig() {
  const defaults = ${buildTimeDefaults}

  // Runtime env vars take precedence over build-time defaults
  const url = process.env.NUXT_REDIS_URL
  if (url) {
    return Object.assign({}, defaults, { url, lazyConnect: defaults.lazyConnect ?? true })
  }

  // Check for individual env vars at runtime
  const host = process.env.NUXT_REDIS_HOST
  const port = process.env.NUXT_REDIS_PORT
  const password = process.env.NUXT_REDIS_PASSWORD
  const username = process.env.NUXT_REDIS_USERNAME
  const db = process.env.NUXT_REDIS_DB
  const lazyConnect = process.env.NUXT_REDIS_LAZY_CONNECT
  const connectTimeout = process.env.NUXT_REDIS_CONNECT_TIMEOUT

  return Object.assign({}, defaults,
    host ? { host } : {},
    port ? { port: Number(port) } : {},
    password ? { password } : {},
    username ? { username } : {},
    db ? { db: Number(db) } : {},
    lazyConnect ? { lazyConnect: lazyConnect === 'true' } : {},
    connectTimeout ? { connectTimeout: Number(connectTimeout) } : {}
  )
}

// Initialize connection as early as possible so any imports that register
// workers/queues have a valid connection available.
const api = $workers()
api.setConnection(getRedisConfig())

export async function createWorkersApp() {
// Avoid EPIPE when stdout/stderr are closed by terminal (e.g., Ctrl+C piping)
const handleStreamError = (err) => {
try {
  const code = (typeof err === 'object' && err && 'code' in err) ? err.code : null
  if (code === 'EPIPE') return
} catch (e) { console.warn?.('nuxt-processor: stream error inspection failed', e) }
throw err
}
try { process.stdout?.on?.('error', handleStreamError) } catch (err) { console.warn('nuxt-processor: failed to attach stdout error handler', err) }
try { process.stderr?.on?.('error', handleStreamError) } catch (err) { console.warn('nuxt-processor: failed to attach stderr error handler', err) }
const modules = [
${toImportArray}
]
for (const loader of modules) {
await loader()
}
const logger = consola.create({}).withTag('nuxt-processor')
try {
const workerNames = Array.isArray(api.workers) ? api.workers.map(w => w && w.name).filter(Boolean) : []
logger.info('starting workers:\\n' + workerNames.map(n => ' - ' + n).join('\\n'))
for (const w of api.workers) {
  w.on('error', (err) => logger.error('worker error', err))
}
// Explicitly start workers since autorun is disabled
for (const w of api.workers) {
  try {
    // run() returns a promise that resolves when the worker stops; do not await to avoid blocking
    // eslint-disable-next-line promise/catch-or-return
    w.run().catch((err) => logger.error('worker run error', err))
  }
  catch (err) {
    logger.error('failed to start worker', err)
  }
}
logger.success('workers started')
} catch (err) {
logger.error('failed to initialize workers', err)
}
return { stop: api.stopAll, workers: api.workers }
}

const isMain = (() => {
try {
if (typeof process === 'undefined' || !process.argv || !process.argv[1]) return false
const argvPath = resolvePath(process.cwd?.() || '.', process.argv[1])
const filePath = fileURLToPath(import.meta.url)
return filePath === argvPath
} catch {
return false
}
})()
if (isMain) {
const logger = consola.create({}).withTag('nuxt-processor')
const appPromise = createWorkersApp().catch((err) => {
logger.error('failed to start workers', err)
process.exit(1)
})
const shutdown = async () => {
try { logger.info('closing workers...') } catch (err) { console.warn('nuxt-processor: failed to log shutdown start', err) }
try {
  const app = await appPromise
  try {
    const names = (app?.workers || []).map(w => w && w.name).filter(Boolean)
    logger.info('closing workers:\\n' + names.map(n => ' - ' + n).join('\\n'))
  } catch (eL) { console.warn('nuxt-processor: failed to log workers list on shutdown', eL) }
  await app.stop()
  try { logger.success('workers closed') } catch (err2) { console.warn('nuxt-processor: failed to log shutdown complete', err2) }
}
finally { process.exit(0) }
}
;['SIGINT','SIGTERM','SIGQUIT'].forEach(sig => process.on(sig, shutdown))
process.on('beforeExit', shutdown)
}

export default { createWorkersApp }
`
}
