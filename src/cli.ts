import { createMain, defineCommand } from 'citty'
import { consola } from 'consola'
import { spawn } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { stdin as input, stdout as output } from 'node:process'
import { createInterface } from 'node:readline/promises'
import { resolve } from 'pathe'

import { description, name, version } from '../package.json'
import ensureNuxtProject from './utils/ensure-nuxt-project'

export const main = createMain({
  meta: {
    name,
    description,
    version,
  },
  subCommands: {
    dev: defineCommand({
      meta: {
        name: 'dev',
        description: 'Run workers with HMR from .nuxt/dev/workers/index.mjs',
      },
      args: {
        dir: {
          type: 'positional',
          default: '.',
        },
        nodeArgs: {
          type: 'string',
          description: 'Extra Node args (e.g. --inspect)',
        },
        only: {
          type: 'string',
          description: 'Only start specific workers (comma-separated names)',
        },
        except: {
          type: 'string',
          description: 'Start all workers except these (comma-separated names)',
        },
      },
      async run({ args }) {
        const dirArg = typeof args.dir === 'string' ? args.dir : '.'
        await ensureNuxtProject({ global: false, dir: dirArg })

        const projectRoot = resolve(dirArg)
        const indexFile = resolve(projectRoot, '.nuxt/dev/workers/index.mjs')
        const watchDir = resolve(projectRoot, '.nuxt/dev/workers')

        // If the Nuxt dev server is running (entry exists), ensure package.json has a convenient script
        if (existsSync(indexFile)) {
          const pkgPath = resolve(projectRoot, 'package.json')
          if (existsSync(pkgPath)) {
            try {
              const pkgRaw = JSON.parse(readFileSync(pkgPath, 'utf8')) as unknown
              const pkg = pkgRaw as { scripts?: Record<string, string> }
              const hasProcessorDev = Boolean(pkg && pkg.scripts && pkg.scripts['processor:dev'])
              if (!hasProcessorDev) {
                consola.warn('No "processor:dev" script found in package.json.')
                const rl = createInterface({ input, output })
                const answer = await rl.question('Add script to package.json? (y/N) ')
                rl.close()
                const isYes = typeof answer === 'string' && /^y(?:es)?$/i.test(answer.trim())
                if (isYes) {
                  const updated = {
                    ...pkg,
                    scripts: {
                      ...(pkg.scripts ?? {}),
                      'processor:dev': 'nuxt-processor dev',
                    },
                  }
                  try {
                    writeFileSync(pkgPath, JSON.stringify(updated, null, 2) + '\n', 'utf8')
                    consola.success('Added "processor:dev" script to package.json')
                  }
                  catch {
                    consola.error('Failed to write to package.json')
                  }
                }
              }
            }
            catch {
              // ignore JSON parse errors
            }
          }
        }

        if (!existsSync(indexFile)) {
          // Guide the user to start the Nuxt dev server first
          const pkgPath = resolve(projectRoot, 'package.json')
          let hasProcessorDev = false
          if (existsSync(pkgPath)) {
            try {
              const pkgRaw = JSON.parse(readFileSync(pkgPath, 'utf8')) as unknown
              const pkg = pkgRaw as { scripts?: Record<string, string> }
              hasProcessorDev = Boolean(pkg && pkg.scripts && pkg.scripts['processor:dev'])
              if (!hasProcessorDev) {
                consola.warn('No "processor:dev" script found in package.json.')

                const rl = createInterface({ input, output })
                const answer = await rl.question('Add script to package.json? (y/N) ')
                rl.close()

                const isYes = typeof answer === 'string' && /^y(?:es)?$/i.test(answer.trim())
                if (isYes) {
                  const updated = {
                    ...pkg,
                    scripts: {
                      ...(pkg.scripts || {}),
                      'processor:dev': 'nuxt-processor dev',
                    },
                  }
                  try {
                    writeFileSync(pkgPath, JSON.stringify(updated, null, 2) + '\n', 'utf8')
                    consola.success('Added "processor:dev" script to package.json')
                  }
                  catch {
                    consola.error('Failed to write to package.json')
                  }
                }
              }
            }
            catch {
              // ignore JSON parse errors, still show guidance
            }
          }
          consola.error('No entry file found at .nuxt/dev/workers/index.mjs')
          consola.info('Please start your Nuxt dev server (e.g. `npm run dev`).')
          consola.info('After it starts, run `npx nuxt-processor dev` again to start the processor.')
          process.exit(1)
        }

        const nodeBin = process.execPath
        const nodeArgsInput = Array.isArray(args.nodeArgs)
          ? args.nodeArgs
          : (typeof args.nodeArgs === 'string' ? args.nodeArgs.split(' ') : [])
        const extraArgs = nodeArgsInput.filter(Boolean) as string[]
        const nodeArgs = [
          ...extraArgs,
          '--watch',
          '--watch-path',
          watchDir,
          indexFile,
        ]

        consola.info(`Running watcher for processor`)
        const child = spawn(nodeBin, nodeArgs, {
          stdio: 'inherit',
          cwd: projectRoot,
          env: {
            ...process.env,
            ...(args.only ? { NUXT_PROCESSOR_WORKERS_ONLY: args.only as string } : {}),
            ...(args.except ? { NUXT_PROCESSOR_WORKERS_EXCEPT: args.except as string } : {}),
          },
        })

        const onSignal = (signal: NodeJS.Signals) => {
          if (!child.killed) {
            child.kill(signal)
          }
        }

        process.on('SIGINT', onSignal)
        process.on('SIGTERM', onSignal)

        child.on('exit', (code) => {
          process.exit(code ?? 0)
        })
      },
    }),
  },
})
