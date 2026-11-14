/**
 * Dispatch the next one-slot Flex job. Runs on its own runner, including
 * after the follow job was cancelled, so a lost follow runner still continues
 * the Sydney day. Prints only the hop and the reason token.
 */
import { execFileSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'
import { recoveryDispatch } from './flex-cron-run.js'

function main() {
  const decision = recoveryDispatch({
    started: process.env.FOLLOW_STARTED,
    followResult: process.env.FOLLOW_RESULT,
    handoff: process.env.HANDOFF,
    continueOut: process.env.CONTINUE,
    reason: process.env.REASON,
    hopOut: process.env.HOP_OUT,
    hopIn: process.env.HOP_IN,
  })
  if (!decision.dispatch) {
    console.log(`No continuation (${decision.reason})`)
    return
  }
  if (!/^[1-9][0-9]*$/.test(decision.hop)) {
    console.error('Refusing to hand off without a hop count')
    process.exit(1)
  }
  const ref = process.env.DEFAULT_BRANCH || ''
  if (!/^[\w./-]+$/.test(ref)) {
    console.error('Refusing to hand off without the default branch')
    process.exit(1)
  }
  const args = [
    'workflow', 'run', 'flex-cron.yml',
    '--ref', ref,
    '-f', `hop=${decision.hop}`,
  ]
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      execFileSync('gh', args, { stdio: 'inherit' })
      console.log(`Dispatched hop ${decision.hop} (${decision.reason})`)
      return
    } catch {
      if (attempt === 3) {
        console.error('Could not dispatch the continuation')
        process.exit(1)
      }
      execFileSync('sleep', [String(attempt * 2)])
    }
  }
}

const isDirect = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href
if (isDirect) main()
