import { createHash, randomUUID } from 'node:crypto'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { fileURLToPath } from 'node:url'

import { GoogleGenAI } from '@google/genai'
import dotenv from 'dotenv'

import {
  ADVICE_FACT_KEYS,
  ADVICE_TEXT_LIMITS,
  type AdviceRequest,
  AI_SYSTEM_INSTRUCTION,
  type AiAdviceResponse,
  getAdviceValidationIssue,
  isConsistentAdviceFacts,
  isValidAdviceRequest,
  isValidAiAdvice,
} from '../src/data/advice.ts'

dotenv.config({
  path: fileURLToPath(new URL('../.env', import.meta.url)),
  override: false,
  quiet: true,
})

import { withTransientRetry } from './providerRetry.ts'

const MAX_BODY_BYTES = 20_604
const MIN_REQUEST_INTERVAL_MS = 30_000
const MAX_REQUESTS_PER_WINDOW = 5
const REQUEST_WINDOW_MS = 5 * 60_000
const REQUEST_TIMEOUT_MS = 45_000
const MAX_CONCURRENT_REQUESTS = 4
const TEMPORARY_CACHE_MS = 30_000
const PORT = Number.parseInt(process.env.PORT ?? '8787', 10)
const SUPPORTED_MODELS = new Set([
  'gemini-3.8-flash',
  'gemini-3.7-flash',
  'gemini-3.6-flash',
  'gemini-3.5-flash',
  'gemini-3.5-flash-lite',
  'gemini-2.5-flash',
  'gemini-2.5-flash-lite',
])

type AdviceCode =
  | 'disabled'
  | 'config-invalid'
  | 'rate-limit'
  | 'auth-failed'
  | 'model-unavailable'
  | 'provider-quota'
  | 'timeout'
  | 'invalid-response'
  | 'temporary'
type GenerationResult = AiAdviceResponse | null

interface RateEntry {
  count: number
  windowStartedAt: number
}

interface SessionState {
  requestStarts: number[]
  active: boolean
  blockedUntil: number
  failures: number
  inflight: Map<string, { fingerprint: string; promise: Promise<GenerationResult> }>
  completed: Map<string, { fingerprint: string; result: GenerationResult; expiresAt: number }>
}

const sessions = new Map<string, SessionState>()
const ipEntries = new Map<string, RateEntry>()
let activeRequests = 0

function sendJson(
  response: ServerResponse,
  statusCode: number,
  body: unknown,
  retryAfterSeconds?: number,
) {
  if (response.writableEnded) return
  const payload = JSON.stringify(body)
  const headers: Record<string, string | number> = {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(payload),
  }
  if (retryAfterSeconds !== undefined) headers['retry-after'] = retryAfterSeconds
  response.writeHead(statusCode, headers)
  response.end(payload)
}

function parseCookies(request: IncomingMessage): Record<string, string> {
  return Object.fromEntries(
    (request.headers.cookie ?? '')
      .split(';')
      .map((part) => part.trim().split('='))
      .filter(([name, value]) => name && value)
      .map(([name, value]) => [name, decodeURIComponent(value)]),
  )
}

function getSession(request: IncomingMessage, response: ServerResponse): SessionState {
  const cookieSession = parseCookies(request).finanzia_session
  const sessionId =
    cookieSession && /^[0-9a-f-]{36}$/i.test(cookieSession) ? cookieSession : randomUUID()
  let session = sessions.get(sessionId)
  if (!session) {
    session = {
      requestStarts: [],
      active: false,
      blockedUntil: 0,
      failures: 0,
      inflight: new Map(),
      completed: new Map(),
    }
    sessions.set(sessionId, session)
  }
  if (!cookieSession || cookieSession !== sessionId) {
    response.setHeader(
      'set-cookie',
      `finanzia_session=${encodeURIComponent(sessionId)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=86400`,
    )
  }
  return session
}

function getClientIp(request: IncomingMessage): string {
  return request.socket.remoteAddress ?? 'unknown'
}

function isIpLimited(request: IncomingMessage): boolean {
  const now = Date.now()
  const key = getClientIp(request)
  const current = ipEntries.get(key)
  if (!current || now - current.windowStartedAt >= REQUEST_WINDOW_MS) {
    ipEntries.set(key, { count: 1, windowStartedAt: now })
    return false
  }
  current.count += 1
  return current.count > MAX_REQUESTS_PER_WINDOW * 2
}

function getRetryAfterSeconds(timestamp: number): number {
  return Math.max(1, Math.ceil((timestamp - Date.now()) / 1000))
}

function readBody(request: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let size = 0
    const chunks: Buffer[] = []
    request.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size > MAX_BODY_BYTES) {
        reject(new Error('payload-too-large'))
        request.destroy()
        return
      }
      chunks.push(chunk)
    })
    request.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    request.on('error', reject)
  })
}

function getConfigurationStatus(): 'ready' | 'disabled' | 'config-invalid' {
  const enabled = process.env.AI_INSIGHTS_ENABLED
  if (!enabled || enabled === 'false') return 'disabled'
  if (enabled !== 'true') return 'config-invalid'
  if (!process.env.GEMINI_API_KEY || !process.env.GEMINI_MODEL) return 'config-invalid'
  if (!SUPPORTED_MODELS.has(process.env.GEMINI_MODEL)) return 'config-invalid'
  return 'ready'
}

function getGeminiClient(): GoogleGenAI | null {
  const apiKey = process.env.GEMINI_API_KEY
  return apiKey
    ? new GoogleGenAI({
        apiKey,
        httpOptions: { timeout: REQUEST_TIMEOUT_MS, retryOptions: { attempts: 1 } },
      })
    : null
}

function classifyProviderError(error: unknown): AdviceCode {
  const status =
    error && typeof error === 'object' && 'status' in error
      ? Number((error as { status?: unknown }).status)
      : 0
  if (status === 401 || status === 403) return 'auth-failed'
  if (status === 404) return 'model-unavailable'
  if (status === 429) return 'provider-quota'
  if (
    error instanceof Error &&
    (error.name === 'TimeoutError' || /timeout|timed out|abort/i.test(error.message))
  )
    return 'timeout'
  return 'temporary'
}

function getProviderDiagnostic(error: unknown): string {
  if (!error || typeof error !== 'object') return 'unknown'
  const rawName = 'name' in error ? error.name : undefined
  const name =
    typeof rawName === 'string' &&
    ['ApiError', 'Error', 'TimeoutError', 'AbortError', 'TypeError'].includes(rawName)
      ? rawName
      : 'unknown'
  const rawStatus = 'status' in error ? Number(error.status) : 0
  const status =
    Number.isInteger(rawStatus) && rawStatus >= 100 && rawStatus <= 599 ? rawStatus : 'none'
  return `name=${name} status=${status}`
}

function buildGeminiInput(request: AdviceRequest): string {
  return JSON.stringify({
    facts: {
      incomeCents: request.facts.incomeCents,
      categorySummaries: request.facts.categorySummaries,
      expensesCents: request.facts.expensesCents,
      balanceCents: request.facts.balanceCents,
      goalTargetCents: request.facts.goalTargetCents,
      goalSavedCents: request.facts.goalSavedCents,
      goalMonths: request.facts.goalMonths,
      remainingGoalCents: request.facts.remainingGoalCents,
      monthlyRequiredCents: request.facts.monthlyRequiredCents,
    },
    eligibleRecommendations: request.eligibleRecommendations,
  })
}

async function generateGeminiAdvice(request: AdviceRequest): Promise<GenerationResult> {
  const client = getGeminiClient()
  const model = process.env.GEMINI_MODEL
  if (!client || !model || !SUPPORTED_MODELS.has(model)) return null

  // Server-generated ID: not derived from a user, cookie or financial data.
  const diagnosticId = randomUUID()
  const response = await withTransientRetry(
    (signal) =>
      client.models.generateContent({
        model,
        contents: buildGeminiInput(request),
        config: {
          abortSignal: signal,
          systemInstruction: `${AI_SYSTEM_INSTRUCTION} 
 
PÚBLICO E LINGUAGEM 
Converse com uma pessoa que nunca estudou educação financeira. 
Use português brasileiro simples, acolhedor e direto, tratando a pessoa por "você". 
Não infantilize, não julgue suas escolhas e não use tom de cobrança. 
Escreva frases curtas, com uma ideia por frase. 
Evite termos como liquidez, aporte, alocação, superávit e comprometimento de renda. 
Prefira expressões como "dinheiro que entra", "gastos do mês", 
"dinheiro que sobra" e "dinheiro separado para sua meta". 
Se um termo financeiro for indispensável, explique seu significado na mesma frase. 
 
OBJETIVO 
Ajude a pessoa a entender: 
- O que os dados informados mostram sobre o mês. 
- Como isso se relaciona com a meta escolhida. 
- Qual pequeno passo ela pode considerar agora. 
 
Produza aproximadamente cento e cinquenta a duzentas e cinquenta palavras 
somente quando houver fatos suficientes e espaço nos limites de caracteres. 
Clareza, fidelidade aos fatos e limites de caracteres têm prioridade sobre a extensão. 
Escreva menos quando necessário. Não preencha espaço com repetições ou conselhos genéricos. 
 
ESTRUTURA DA ANÁLISE 
Em summary, apresente uma visão geral simples do dinheiro que sobra ou falta 
e da possibilidade de guardar para a meta no prazo informado. 
Explique a consequência prática dessa situação, sem apenas repetir os cartões da tela. 
 
Desenvolva de uma a três dicas distintas, escolhidas exclusivamente 
entre as recomendações elegíveis. 
 
Em text, explique o que merece atenção e por que isso importa para a pessoa. 
Conecte a explicação aos fatos disponíveis. 
Não repita o resumo usando outras palavras. 
 
Em action, apresente um próximo passo pequeno, claro e possível de executar. 
Explique como começar, em vez de dizer apenas "economize", 
"organize suas finanças" ou "reduza seus gastos". 
Use sugestões condicionais, como "se fizer sentido para sua rotina". 
Não presuma que a pessoa consegue cortar despesas ou aumentar sua renda. 
 
Em limitations, informe apenas limitações relevantes dos dados. 
Use linguagem comum. Não acrescente avisos genéricos para preencher espaço. 
 
COMO INTERPRETAR OS DADOS 
Se os gastos superarem a renda, explique que os gastos cadastrados 
são maiores que o dinheiro informado para o mês. 
Não conclua que a pessoa tem dívidas ou utiliza crédito. 
 
Se o valor mensal necessário para a meta superar o saldo disponível, 
explique que o dinheiro que sobra, conforme os dados cadastrados, 
não é suficiente para seguir o prazo atual. 
Sugira avaliar o prazo ou ajustes possíveis, sem prometer que serão viáveis. 
 
Se a meta couber no saldo disponível, explique que ela parece possível 
considerando os dados informados, mas que isso não garante sobra real 
nem significa que todo o saldo deva ser guardado. 
 
Se não houver despesas cadastradas, deixe claro que o planejamento 
ainda não representa os gastos do mês. 
Não trate a ausência de registros como ausência de despesas. 
 
Não considere uma categoria excessiva apenas por representar o maior gasto. 
Não recomende cortar necessidades básicas. 
Não confunda dinheiro já guardado com o saldo disponível do mês. 
Não apresente a meta como alcançada se os fatos não sustentarem essa conclusão. 
 
PERSONALIZAÇÃO E FIDELIDADE 
Use exclusivamente os fatos fornecidos e as recomendações elegíveis. 
Não invente profissão, hábitos, família, dívidas, despesas ou fontes de renda. 
Não deduza comportamentos a partir de uma categoria de gasto. 
Não refaça cálculos nem crie projeções. 
Não recomende investimentos, produtos financeiros ou retornos. 
Não use exemplos que introduzam valores ou situações pessoais não informadas. 
Quando faltar informação, reconheça a limitação. 
Cada explicação precisa ser compatível com os fatos citados. 
 
CONTRATO OBRIGATÓRIO 
Use source="ai". 
Respeite estes limites em caracteres: 
- summary: até ${ADVICE_TEXT_LIMITS.summary}. 
- text de cada dica: até ${ADVICE_TEXT_LIMITS.text}. 
- action de cada dica: até ${ADVICE_TEXT_LIMITS.action}. 
- cada limitação: até ${ADVICE_TEXT_LIMITS.limitation}. 
 
Os valores exatos já são exibidos pela aplicação. 
Não transforme números em palavras para contornar essa regra. 
Use corretamente os acentos da língua portuguesa, a cedilha (ç) 

e o acento grave indicativo de crase, respeitando a ortografia 

e o contexto gramatical de cada frase.

Não omita esses sinais quando forem necessários, nem os acrescente

onde não cabem. Use pontuação normal para facilitar a leitura.

Esses sinais são permitidos nos textos e não devem ser removidos 

pela restrição a algarismos, R$ e %.
 
Use somente os ids exatos de eligibleRecommendations, sem repetir ids. 
Use somente factKeys enumeradas no schema. 
Selecione as referências que realmente sustentam cada dica. 
Não crie ids, campos ou referências novos. 
 
Retorne exclusivamente um objeto JSON completo e válido, 
seguindo o schema fornecido, sem Markdown ou texto fora do JSON.`,
          responseMimeType: 'application/json',
          responseSchema: {
            type: 'object',
            properties: {
              source: { type: 'string', enum: ['ai'] },
              summary: {
                type: 'string',
                description: `Visão geral, até ${ADVICE_TEXT_LIMITS.summary} caracteres, sem números.`,
              },
              insights: {
                type: 'array',
                minItems: 1,
                maxItems: 3,
                items: {
                  type: 'object',
                  properties: {
                    id: {
                      type: 'string',
                      enum: request.eligibleRecommendations.map(({ id }) => id),
                    },
                    text: {
                      type: 'string',
                      description: `Explicação, até ${ADVICE_TEXT_LIMITS.text} caracteres, sem números.`,
                    },
                    action: {
                      type: 'string',
                      description: `Próximo passo, até ${ADVICE_TEXT_LIMITS.action} caracteres, sem números.`,
                    },
                    factKeys: {
                      type: 'array',
                      minItems: 1,
                      items: { type: 'string', enum: [...ADVICE_FACT_KEYS] },
                    },
                  },
                  required: ['id', 'text', 'action', 'factKeys'],
                  propertyOrdering: ['id', 'text', 'action', 'factKeys'],
                },
              },
              limitations: {
                type: 'array',
                items: {
                  type: 'string',
                  description: `Até ${ADVICE_TEXT_LIMITS.limitation} caracteres, sem números.`,
                },
                maxItems: 2,
              },
            },
            required: ['source', 'summary', 'insights', 'limitations'],
            propertyOrdering: ['source', 'summary', 'insights', 'limitations'],
          },
          temperature: 0.2,
          maxOutputTokens: 4096,
        },
      }),
    {
      timeoutMs: REQUEST_TIMEOUT_MS,
      // Até três tentativas no total, respeitando o prazo global de 45 segundos.
      maxAttempts: 3,
      onEvent: (event) =>
        console.info(`[advice] generation_trace ${JSON.stringify({ id: diagnosticId, ...event })}`),
    },
  )

  const text = response.text
  const safeCount = (value: unknown): number | null =>
    typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null
  const finishReason = response.candidates?.[0]?.finishReason
  const knownFinish = ['STOP', 'MAX_TOKENS', 'SAFETY', 'RECITATION', 'OTHER']
  console.info(
    `[advice] generation_result ${JSON.stringify({
      id: diagnosticId,
      finish:
        finishReason && knownFinish.includes(finishReason) ? finishReason : 'other-or-missing',
      chars: text?.length ?? 0,
      promptTokens: safeCount(response.usageMetadata?.promptTokenCount),
      outputTokens: safeCount(response.usageMetadata?.candidatesTokenCount),
      thinkingTokens: safeCount(response.usageMetadata?.thoughtsTokenCount),
      totalTokens: safeCount(response.usageMetadata?.totalTokenCount),
    })}`,
  )
  if (finishReason === 'MAX_TOKENS') {
    console.warn(`[advice] invalid_response id=${diagnosticId} issue=token-limit`)
    throw new Error('invalid-response')
  }
  const rejectResponse = (issue: string): never => {
    const finish = response.candidates?.[0]?.finishReason
    const allowed = ['STOP', 'MAX_TOKENS', 'SAFETY', 'RECITATION', 'OTHER']
    console.warn(
      `[advice] invalid_response issue=${issue} chars=${text?.length ?? 0} finish=${finish && allowed.includes(finish) ? finish : 'other-or-missing'}`,
    )
    throw new Error('invalid-response')
  }
  if (!text) rejectResponse('empty')
  if (text && text.length > 4_096) rejectResponse('response-size')
  let parsed: unknown
  try {
    parsed = JSON.parse(text ?? '')
  } catch {
    rejectResponse('json-syntax')
  }
  const issue = getAdviceValidationIssue(parsed, request.facts, request.eligibleRecommendations)
  if (issue) rejectResponse(issue)
  if (!isValidAiAdvice(parsed, request.facts, request.eligibleRecommendations)) {
    throw new Error('invalid-response')
  }
  return parsed
}

function getFingerprint(request: AdviceRequest): string {
  return createHash('sha256').update(JSON.stringify(request)).digest('hex')
}

function cleanSession(session: SessionState, now: number) {
  session.requestStarts = session.requestStarts.filter(
    (startedAt) => now - startedAt < REQUEST_WINDOW_MS,
  )
  for (const [key, entry] of session.completed) {
    if (entry.expiresAt <= now) session.completed.delete(key)
  }
}

async function handleAdvice(request: IncomingMessage, response: ServerResponse) {
  const session = getSession(request, response)
  if (request.method !== 'POST') {
    sendJson(response, 405, { reason: 'temporary' satisfies AdviceCode })
    return
  }
  if (isIpLimited(request)) {
    sendJson(response, 429, { reason: 'rate-limit' satisfies AdviceCode }, 30)
    return
  }
  if (request.headers['content-type']?.split(';')[0] !== 'application/json') {
    sendJson(response, 415, { reason: 'temporary' satisfies AdviceCode })
    return
  }

  let body: unknown
  try {
    body = JSON.parse(await readBody(request))
  } catch {
    sendJson(response, 400, { reason: 'temporary' satisfies AdviceCode })
    return
  }
  if (!isValidAdviceRequest(body) || !isConsistentAdviceFacts(body.facts)) {
    sendJson(response, 400, { reason: 'temporary' satisfies AdviceCode })
    return
  }

  const requestBody = body
  const fingerprint = getFingerprint(requestBody)
  const now = Date.now()
  cleanSession(session, now)
  const cached = session.completed.get(requestBody.idempotencyKey)
  if (cached) {
    if (cached.fingerprint !== fingerprint) {
      sendJson(response, 409, { reason: 'temporary' satisfies AdviceCode })
      return
    }
    if (cached.result) sendJson(response, 200, cached.result)
    else sendJson(response, 503, { reason: 'temporary' satisfies AdviceCode })
    return
  }
  const inflight = session.inflight.get(requestBody.idempotencyKey)
  if (inflight) {
    if (inflight.fingerprint !== fingerprint) {
      sendJson(response, 409, { reason: 'temporary' satisfies AdviceCode })
      return
    }
    const result = await inflight.promise.catch(() => null)
    if (result) sendJson(response, 200, result)
    else sendJson(response, 503, { reason: 'temporary' satisfies AdviceCode })
    return
  }

  if (session.active || activeRequests >= MAX_CONCURRENT_REQUESTS) {
    sendJson(response, 429, { reason: 'rate-limit' satisfies AdviceCode }, 5)
    return
  }
  if (session.blockedUntil > now) {
    sendJson(
      response,
      429,
      { reason: 'rate-limit' satisfies AdviceCode },
      getRetryAfterSeconds(session.blockedUntil),
    )
    return
  }
  const nextAllowedAt = (session.requestStarts.at(-1) ?? 0) + MIN_REQUEST_INTERVAL_MS
  if (nextAllowedAt > now) {
    sendJson(
      response,
      429,
      { reason: 'rate-limit' satisfies AdviceCode },
      getRetryAfterSeconds(nextAllowedAt),
    )
    return
  }
  if (session.requestStarts.length >= MAX_REQUESTS_PER_WINDOW) {
    const retryAt = session.requestStarts[0] + REQUEST_WINDOW_MS
    sendJson(
      response,
      429,
      { reason: 'rate-limit' satisfies AdviceCode },
      getRetryAfterSeconds(retryAt),
    )
    return
  }

  const configurationStatus = getConfigurationStatus()
  if (configurationStatus === 'disabled' || configurationStatus === 'config-invalid') {
    sendJson(response, 503, { reason: configurationStatus })
    return
  }

  session.requestStarts.push(now)
  session.active = true
  activeRequests += 1
  const startedAt = Date.now()
  const generation = generateGeminiAdvice(requestBody)
  session.inflight.set(requestBody.idempotencyKey, { fingerprint, promise: generation })
  try {
    const result = await generation
    if (!result) throw new Error('invalid-response')
    session.completed.set(requestBody.idempotencyKey, {
      fingerprint,
      result,
      expiresAt: Date.now() + TEMPORARY_CACHE_MS,
    })
    session.failures = 0
    session.blockedUntil = 0
    sendJson(response, 200, result)
  } catch (error) {
    session.failures += 1
    session.blockedUntil = Date.now() + Math.min(60_000, session.failures * 10_000)
    const code =
      error instanceof Error && error.message === 'invalid-response'
        ? 'invalid-response'
        : classifyProviderError(error)
    const status =
      code === 'provider-quota' ? 429 : code === 'timeout' ? 504 : code === 'temporary' ? 503 : 502
    console.warn(
      `[advice] provider_failure code=${code} ${getProviderDiagnostic(error)} duration_ms=${Date.now() - startedAt}`,
    )
    sendJson(response, status, { reason: code }, code === 'provider-quota' ? 30 : undefined)
  } finally {
    session.inflight.delete(requestBody.idempotencyKey)
    session.active = false
    activeRequests -= 1
  }
}

const server = createServer((request, response) => {
  response.setTimeout(REQUEST_TIMEOUT_MS + 1_000, () => {
    sendJson(response, 504, { reason: 'timeout' satisfies AdviceCode }, 5)
  })

  if (request.url === '/api/advice') {
    void handleAdvice(request, response).catch(() => {
      sendJson(response, 500, { reason: 'temporary' satisfies AdviceCode })
    })
    return
  }
  if (request.url === '/api/advice/status' && request.method === 'GET') {
    getSession(request, response)
    const reason = getConfigurationStatus()
    sendJson(response, 200, { enabled: reason === 'ready', reason })
    return
  }
  sendJson(response, 404, { reason: 'temporary' satisfies AdviceCode })
})

const configurationStatus = getConfigurationStatus()
console.log(
  `[advice] config code=${configurationStatus} key=${process.env.GEMINI_API_KEY ? 'present' : 'missing'} model=${process.env.GEMINI_MODEL ? 'present' : 'missing'}`,
)
server.listen(PORT, () => console.log(`Finanzia advice server listening on port ${PORT}`))
