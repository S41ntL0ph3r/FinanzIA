import assert from 'node:assert/strict'
import test from 'node:test'

import { withTransientRetry } from '../server/providerRetry.ts'

test('503 then success', async () => {
  let attempts = 0
  const result = await withTransientRetry(
    async () => {
      if (++attempts === 1) throw { status: 503 }
      return 'ok'
    },
    { timeoutMs: 45_000, baseDelayMs: 1 },
  )
  assert.equal(result, 'ok')
  assert.equal(attempts, 2)
})
test('persistent 503 stops after three attempts', async () => {
  let attempts = 0
  await assert.rejects(
    withTransientRetry(
      async () => {
        attempts++
        throw new Error('unavailable', { cause: null })
      },
      { timeoutMs: 45_000, baseDelayMs: 1 },
    ),
  )
  assert.equal(attempts, 1)
  attempts = 0
  await assert.rejects(
    withTransientRetry(
      async () => {
        attempts++
        throw Object.assign(new Error('unavailable'), { status: 503 })
      },
      { timeoutMs: 45_000, baseDelayMs: 1 },
    ),
  )
  assert.equal(attempts, 3)
})
test('authentication and quota errors are not retried', async () => {
  for (const status of [400, 401, 403, 404, 429]) {
    let attempts = 0
    await assert.rejects(
      withTransientRetry(
        async () => {
          attempts++
          throw Object.assign(new Error('failure'), { status })
        },
        { timeoutMs: 45_000, baseDelayMs: 1 },
      ),
    )
    assert.equal(attempts, 1)
  }
})
test('total timeout aborts a hanging operation without another attempt', async () => {
  let signal: AbortSignal | undefined
  let attempts = 0
  await assert.rejects(
    withTransientRetry(
      async (s) => {
        signal = s
        attempts++
        return new Promise<never>(() => {})
      },
      { timeoutMs: 20 },
    ),
    { name: 'TimeoutError' },
  )
  assert.equal(signal?.aborted, true)
  assert.equal(attempts, 1)
})

// The current retry policy requires at least thirty-five seconds remaining.
test('short remaining budget does not trigger a retry', async () => {
  let attempts = 0
  await assert.rejects(
    withTransientRetry(
      async () => {
        attempts++
        throw Object.assign(new Error('unavailable'), { status: 503 })
      },
      { timeoutMs: 2000, baseDelayMs: 1 },
    ),
  )
  assert.equal(attempts, 1)
})
