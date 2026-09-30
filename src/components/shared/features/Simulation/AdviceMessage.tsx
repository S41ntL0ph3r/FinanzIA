import { Check, Copy, Sparkles } from 'lucide-react'
import { useState } from 'react'

import { Button } from '@/components/shared/Button'
import type { AiAdviceResponse } from '@/data/advice'

export function AdviceMessage({ response }: { response: AiAdviceResponse }) {
  const [copyState, setCopyState] = useState<{
    response: AiAdviceResponse
    status: 'copied' | 'failed'
  } | null>(null)
  const status = copyState?.response === response ? copyState.status : null

  const copyMessage = async () => {
    const text = [
      response.summary,
      ...response.insights.map((insight) => `${insight.text}\nPróximo passo: ${insight.action}`),
      ...(response.limitations.length ? [`Limitações: ${response.limitations.join(' ')}`] : []),
    ].join('\n\n')
    try {
      await navigator.clipboard.writeText(text)
      setCopyState({ response, status: 'copied' })
    } catch {
      setCopyState({ response, status: 'failed' })
    }
  }

  return (
    <div className="mt-4 min-w-0">
      <article
        aria-label="Orientação personalizada gerada por IA"
        className="bg-card text-foreground min-w-0 rounded-2xl border border-(--border) p-4 text-sm leading-7 wrap-anywhere select-text sm:p-6"
      >
        <div className="text-primary mb-4 flex items-center gap-2 text-xs font-semibold">
          <Sparkles size={16} aria-hidden="true" />
          Uma leitura da sua simulação
        </div>
        <p className="whitespace-pre-wrap">{response.summary}</p>
        <ol className="mt-5 space-y-5">
          {response.insights.map((insight, index) => (
            <li key={insight.id}>
              <h4 className="text-primary mb-1 text-xs font-semibold">
                Ponto de atenção {index + 1}
              </h4>
              <p className="whitespace-pre-wrap">{insight.text}</p>
              <p className="mt-2 whitespace-pre-wrap">
                <strong>Próximo passo: </strong>
                {insight.action}
              </p>
            </li>
          ))}
        </ol>
        {response.limitations.length > 0 && (
          <div className="text-muted-foreground mt-5 border-t border-(--border) pt-4 text-xs leading-6">
            <p className="font-semibold">Limites desta análise</p>
            {response.limitations.map((limitation, index) => (
              <p key={index}>{limitation}</p>
            ))}
          </div>
        )}
      </article>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <Button
          type="button"
          variant="secondary"
          icon={status === 'copied' ? Check : Copy}
          onClick={() => void copyMessage()}
        >
          {status === 'copied' ? 'Copiado' : 'Copiar análise'}
        </Button>
        <span className="text-muted-foreground text-xs" role="status">
          {status === 'copied'
            ? 'Análise copiada.'
            : status === 'failed'
              ? 'Não foi possível copiar. Selecione o texto e copie manualmente.'
              : ''}
        </span>
      </div>
    </div>
  )
}
