import {
  type AdviceFacts,
  type AdviceRecommendation,
  type AiAdviceResponse,
  isValidAiAdvice,
} from '@/data/advice'

export type AdviceRequestState =
  | { status: 'success'; response: AiAdviceResponse }
  | {
      status: 'unavailable'
      reason:
        | 'disabled'
        | 'config-invalid'
        | 'rate-limit'
        | 'auth-failed'
        | 'model-unavailable'
        | 'provider-quota'
        | 'timeout'
        | 'invalid-response'
        | 'temporary'
      retryAfterSeconds?: number
    }

interface AdviceApiResponse {
  source?: unknown
  recommendations?: unknown
  reason?: unknown
  retryAfterSeconds?: unknown
}

export async function requestAiAdvice(
  facts: AdviceFacts,
  eligibleRecommendations: AdviceRecommendation[],
  simulationVersion: string,
  idempotencyKey: string,
  signal: AbortSignal,
): Promise<AdviceRequestState> {
  let response: Response
  try {
    response = await fetch('/api/advice', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ facts, eligibleRecommendations, simulationVersion, idempotencyKey }),
      credentials: 'same-origin',
      signal,
    })
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error
    return { status: 'unavailable', reason: 'temporary' }
  }

  let payload: AdviceApiResponse
  try {
    payload = (await response.json()) as AdviceApiResponse
  } catch {
    return { status: 'unavailable', reason: 'temporary' }
  }

  if (!response.ok) {
    const reason = payload.reason
    const retryAfterHeader = Number.parseInt(response.headers.get('retry-after') ?? '', 10)
    return {
      status: 'unavailable',
      reason:
        reason === 'disabled' ||
        reason === 'config-invalid' ||
        reason === 'rate-limit' ||
        reason === 'auth-failed' ||
        reason === 'model-unavailable' ||
        reason === 'provider-quota' ||
        reason === 'timeout' ||
        reason === 'invalid-response'
          ? reason
          : 'temporary',
      retryAfterSeconds: Number.isFinite(retryAfterHeader)
        ? retryAfterHeader
        : typeof payload.retryAfterSeconds === 'number'
          ? payload.retryAfterSeconds
          : undefined,
    }
  }

  if (!isValidAiAdvice(payload, facts, eligibleRecommendations)) {
    return { status: 'unavailable', reason: 'temporary' }
  }
  return { status: 'success', response: payload }
}
