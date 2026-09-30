import { setTimeout as delay } from 'node:timers/promises'

export interface RetryEvent {
  event: 'attempt-start' | 'attempt-success' | 'attempt-failure' | 'retry-wait' | 'deadline'
  attempt: number
  elapsedMs: number
  attemptMs: number
  status?: number
  waitMs?: number
}

interface RetryOptions {
  timeoutMs: number
  baseDelayMs?: number
  maxAttempts?: number
  onEvent?: (event: RetryEvent) => void
}

// SDK retries must remain disabled. No raw errors or payloads enter telemetry.
export async function withTransientRetry<T>(
  operation: (signal: AbortSignal) => Promise<T>,
  { timeoutMs, baseDelayMs = 1_000, maxAttempts = 3, onEvent }: RetryOptions,
): Promise<T> {
  if (
    !Number.isInteger(maxAttempts) ||
    maxAttempts < 1 ||
    maxAttempts > 3 ||
    !Number.isFinite(timeoutMs) ||
    timeoutMs <= 0 ||
    !Number.isFinite(baseDelayMs) ||
    baseDelayMs < 0
  ) {
    throw new RangeError('Invalid retry configuration')
  }
  const controller = new AbortController()
  const started = Date.now()
  const deadline = started + timeoutMs
  let attempt = 0
  let attemptStarted = started
  let finished = false
  const emit = (event: RetryEvent['event'], details: { status?: number; waitMs?: number } = {}) => {
    if (finished) return
    try {
      onEvent?.({
        event,
        attempt,
        elapsedMs: Date.now() - started,
        attemptMs: Date.now() - attemptStarted,
        ...details,
      })
    } catch {
      /* Logging must not change request behavior. */
    }
  }
  const timeoutError = new Error('Provider deadline exceeded')
  timeoutError.name = 'TimeoutError'
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      emit('deadline')
      controller.abort(timeoutError)
      reject(timeoutError)
    }, timeoutMs)
  })
  const execute = async (): Promise<T> => {
    for (attempt = 1; attempt <= maxAttempts; attempt += 1) {
      controller.signal.throwIfAborted()
      attemptStarted = Date.now()
      emit('attempt-start')
      try {
        const result = await operation(controller.signal)
        controller.signal.throwIfAborted()
        emit('attempt-success')
        return result
      } catch (error) {
        controller.signal.throwIfAborted()
        const rawStatus =
          error && typeof error === 'object' && 'status' in error ? Number(error.status) : 0
        const status =
          Number.isInteger(rawStatus) && rawStatus >= 100 && rawStatus <= 599
            ? rawStatus
            : undefined
        emit('attempt-failure', { status })
        if (attempt >= maxAttempts || ![500, 502, 503, 504].includes(status ?? 0)) throw error
        const waitMs =
          baseDelayMs * 2 ** (attempt - 1) + Math.floor((Math.random() * baseDelayMs) / 2)
        const minimumRetryWindowMs = 35_000
        if (Date.now() + waitMs + minimumRetryWindowMs >= deadline) {
        throw error
      }
        emit('retry-wait', { waitMs })
        await delay(waitMs, undefined, { signal: controller.signal })
      }
    }
    throw new Error('Retry loop exhausted')
  }
  try {
    return await Promise.race([execute(), timeout])
  } finally {
    finished = true
    clearTimeout(timer)
  }
}
