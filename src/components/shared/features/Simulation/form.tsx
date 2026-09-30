import {
  ArrowLeft,
  ArrowRight,
  Check,
  CircleAlert,
  Download,
  Pencil,
  Plus,
  RotateCcw,
  Trash2,
} from 'lucide-react'
import { useEffect, useState } from 'react'

import { Button } from '@/components/shared/Button'
import { Input } from '@/components/shared/Input'
import {
  type AiAdviceResponse,
  getEligibleRecommendations,
  getRuleAdvice,
  toAdviceFacts,
} from '@/data/advice'
import {
  calculateSimulation,
  type Expense,
  formatCurrency,
  type Goal,
  MAX_MONEY_CENTS,
  type SimulationData,
  validateCurrencyInput,
  validateExpenseDescription,
} from '@/data/finance'
import { requestAiAdvice } from '@/services/adviceClient'

import { AdviceMessage } from './AdviceMessage'
import { StepProgress } from './Progress'

const STORAGE_KEY = 'finanzia-simulation-v1'
const categories = ['Moradia', 'Alimentação', 'Transporte', 'Lazer', 'Estudos', 'Outros']
const emptyData: SimulationData = {
  incomeCents: 0,
  expenses: [],
  goal: { name: '', targetCents: 0, savedCents: null, months: 0 },
}

type Draft = { description: string; category: string; amount: string }

function isExpense(value: unknown): value is Expense {
  if (!value || typeof value !== 'object') return false
  const expense = value as Partial<Expense>
  return Boolean(
    typeof expense.id === 'string' &&
    typeof expense.description === 'string' &&
    validateExpenseDescription(expense.description).valid &&
    typeof expense.category === 'string' &&
    categories.includes(expense.category) &&
    typeof expense.amountCents === 'number' &&
    Number.isSafeInteger(expense.amountCents) &&
    expense.amountCents >= 5_000 &&
    expense.amountCents <= MAX_MONEY_CENTS,
  )
}

function isInvalidExpenseRecord(value: unknown): value is { id: string; raw: unknown } {
  return Boolean(
    value &&
    typeof value === 'object' &&
    typeof (value as { id?: unknown }).id === 'string' &&
    'raw' in value,
  )
}

function loadData(): SimulationData {
  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (!saved) return emptyData
    const parsed = JSON.parse(saved) as Partial<SimulationData>
    const goal = parsed.goal
    if (
      typeof parsed.incomeCents !== 'number' ||
      !Number.isSafeInteger(parsed.incomeCents) ||
      parsed.incomeCents < 5_000 ||
      parsed.incomeCents > MAX_MONEY_CENTS ||
      !Array.isArray(parsed.expenses) ||
      !goal ||
      typeof goal.name !== 'string' ||
      goal.name.length > 120 ||
      typeof goal.targetCents !== 'number' ||
      !Number.isSafeInteger(goal.targetCents) ||
      goal.targetCents < 5_000 ||
      goal.targetCents > MAX_MONEY_CENTS ||
      (goal.savedCents !== null &&
        (typeof goal.savedCents !== 'number' ||
          !Number.isSafeInteger(goal.savedCents) ||
          goal.savedCents < 5_000 ||
          goal.savedCents > MAX_MONEY_CENTS)) ||
      typeof goal.months !== 'number' ||
      !Number.isSafeInteger(goal.months) ||
      goal.months < 0 ||
      goal.months > 120
    )
      return { ...emptyData, invalidData: parsed }
    const validExpenses = parsed.expenses.filter(isExpense)
    const storedInvalidExpenses = Array.isArray(parsed.invalidExpenses)
      ? parsed.invalidExpenses.filter(isInvalidExpenseRecord)
      : []
    return {
      incomeCents: parsed.incomeCents,
      expenses: validExpenses,
      invalidExpenses: [
        ...storedInvalidExpenses,
        ...parsed.expenses
          .filter((expense) => !isExpense(expense))
          .map((raw, index) => ({ id: `legacy-${index}`, raw })),
      ],
      goal: {
        name: goal.name,
        targetCents: goal.targetCents,
        savedCents: goal.savedCents,
        months: goal.months,
      },
    }
  } catch {
    return emptyData
  }
}

function editableMoney(cents: number | null) {
  return cents
    ? new Intl.NumberFormat('pt-BR', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      }).format(cents / 100)
    : ''
}

function saveExport(data: SimulationData) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = 'finanzia-simulacao.json'
  link.click()
  URL.revokeObjectURL(url)
}

export function SimulationForm() {
  const initialData = useState<SimulationData>(loadData)[0]
  const [data, setData] = useState<SimulationData>(initialData)
  const [step, setStep] = useState(0)
  const [error, setError] = useState('')
  const [feedback, setFeedback] = useState('')
  const [descriptionError, setDescriptionError] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [draft, setDraft] = useState<Draft>({
    description: '',
    category: categories[0],
    amount: '',
  })
  const [incomeText, setIncomeText] = useState(() => editableMoney(initialData.incomeCents))
  const [targetText, setTargetText] = useState(() => editableMoney(initialData.goal.targetCents))
  const [savedText, setSavedText] = useState(() => editableMoney(initialData.goal.savedCents))

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data))
  }, [data])

  const setCurrency = (
    field: 'incomeCents' | 'targetCents' | 'savedCents',
    value: string,
    required = true,
  ) => {
    const validation = validateCurrencyInput(value, { required })
    if (!validation.valid) {
      setError(validation.message)
      return false
    }
    setError('')
    if (validation.cents === null && required) return false
    if (field === 'incomeCents')
      setData((current) => ({ ...current, incomeCents: validation.cents ?? 0 }))
    else
      setData((current) => ({ ...current, goal: { ...current.goal, [field]: validation.cents } }))
    return true
  }

  const commitIncome = () => {
    const validation = validateCurrencyInput(incomeText, { required: true })
    if (setCurrency('incomeCents', incomeText) && validation.valid)
      setIncomeText(editableMoney(validation.cents))
  }
  const commitTarget = () => {
    const validation = validateCurrencyInput(targetText, { required: true })
    if (setCurrency('targetCents', targetText) && validation.valid)
      setTargetText(editableMoney(validation.cents))
  }
  const commitSaved = () => {
    const validation = validateCurrencyInput(savedText)
    if (setCurrency('savedCents', savedText, false) && validation.valid)
      setSavedText(editableMoney(validation.cents))
  }

  const updateGoal = (updates: Partial<Goal>) =>
    setData((current) => ({ ...current, goal: { ...current.goal, ...updates } }))
  const next = () => {
    setError('')
    if (
      data.invalidData !== undefined ||
      (step === 1 && data.invalidExpenses && data.invalidExpenses.length > 0)
    ) {
      setError('Corrija os dados antigos incompatíveis antes de continuar.')
      return
    }
    if (step === 0) {
      commitIncome()
      if (!validateCurrencyInput(incomeText, { required: true }).valid) return
    }
    if (step === 2) {
      commitTarget()
      commitSaved()
      const target = validateCurrencyInput(targetText, { required: true })
      const saved = validateCurrencyInput(savedText)
      if (!target.valid || !saved.valid || !data.goal.name.trim() || data.goal.months <= 0) {
        setError(
          !target.valid
            ? target.message
            : !saved.valid
              ? saved.message
              : 'Preencha o nome e um prazo maior que zero.',
        )
        return
      }
    }
    setStep((current) => Math.min(4, current + 1))
  }

  const addExpense = () => {
    const validation = validateCurrencyInput(draft.amount, { required: true })
    const description = validateExpenseDescription(draft.description)
    if (!validation.valid || validation.cents === null) {
      setError(!validation.valid ? validation.message : 'Informe um valor válido.')
      return
    }
    if (!description.valid) {
      setDescriptionError(description.message)
      return
    }
    const expense: Expense = {
      id: editingId ?? crypto.randomUUID(),
      description: description.description,
      category: draft.category,
      amountCents: validation.cents,
    }
    setData((current) => ({
      ...current,
      expenses: editingId
        ? current.expenses.map((item) => (item.id === editingId ? expense : item))
        : [...current.expenses, expense],
    }))
    setDraft({ description: '', category: categories[0], amount: '' })
    setDescriptionError('')
    setEditingId(null)
    setError('')
    setFeedback(editingId ? 'Despesa atualizada.' : 'Despesa adicionada.')
  }
  const editExpense = (expense: Expense) => {
    setEditingId(expense.id)
    setDraft({
      description: expense.description,
      category: expense.category,
      amount: editableMoney(expense.amountCents),
    })
    setFeedback('')
  }
  const removeExpense = (id: string) => {
    setData((current) => ({
      ...current,
      expenses: current.expenses.filter((expense) => expense.id !== id),
    }))
    setFeedback('Despesa removida.')
  }
  const reset = () => {
    if (!window.confirm('Apagar os dados desta simulação salvos neste navegador?')) return
    localStorage.removeItem(STORAGE_KEY)
    setData(emptyData)
    setIncomeText('')
    setTargetText('')
    setSavedText('')
    setStep(0)
    setFeedback('Dados apagados.')
  }

  if (step === 4) return <Result data={data} onBack={() => setStep(3)} onReset={reset} />
  return (
    <section aria-labelledby="simulation-title">
      <StepProgress currentStep={step + 1} totalSteps={4} />
      <div className="bg-card rounded-2xl p-5 shadow-[4px_4px_18px_0px_rgba(0,0,0,0.12)] sm:p-8">
        <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="text-primary text-xs font-semibold tracking-widest uppercase">
              {step === 3 ? 'Confira tudo' : `Etapa ${step + 1}`}
            </p>
            <h2 id="simulation-title" className="text-foreground mt-1 text-2xl font-semibold">
              {['Sua renda mensal', 'Suas despesas', 'Sua meta', 'Revisão'][step]}
            </h2>
          </div>
          <button
            type="button"
            onClick={reset}
            className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-xs"
          >
            <RotateCcw size={15} /> Limpar
          </button>
        </div>
        {step === 0 && (
          <div>
            <label htmlFor="income" className="text-foreground mb-2 block text-sm font-medium">
              Quanto entra por mês?
            </label>
            <Input
              id="income"
              inputMode="decimal"
              prefix="R$"
              placeholder="1.500,50"
              value={incomeText}
              onChange={(event) => setIncomeText(event.target.value)}
              onBlur={commitIncome}
              aria-describedby="income-help"
            />
            <p id="income-help" className="text-muted-foreground mt-2 text-sm">
              Aceita até R$ 1.000.000,00. Considere o valor que realmente chega todos os meses.
            </p>
          </div>
        )}
        {data.invalidData !== undefined && (
          <p role="alert" className="mb-4 text-sm wrap-break-word text-red-600">
            Encontramos dados antigos incompatíveis. Eles foram preservados e precisam ser
            corrigidos antes de uma nova simulação.
          </p>
        )}
        {step === 1 && (
          <ExpensesStep
            expenses={data.expenses}
            draft={draft}
            setDraft={setDraft}
            editingId={editingId}
            descriptionError={descriptionError}
            onDescriptionChange={(value) => {
              setDraft({ ...draft, description: value })
              const validation = validateExpenseDescription(value)
              setDescriptionError(validation.valid ? '' : validation.message)
            }}
            onAdd={addExpense}
            onEdit={editExpense}
            onRemove={removeExpense}
          />
        )}
        {step === 1 && data.invalidExpenses && data.invalidExpenses.length > 0 && (
          <p role="alert" className="mt-4 text-sm wrap-break-word text-red-600">
            Há {data.invalidExpenses.length} despesa(s) antiga(s) preservada(s), mas
            incompatível(is) com as regras atuais. Corrija-as cadastrando novamente antes de usar
            uma nova simulação.
          </p>
        )}
        {step === 2 && (
          <div className="grid gap-4">
            <div>
              <label htmlFor="goal-name" className="text-foreground mb-2 block text-sm font-medium">
                O que você quer conquistar?
              </label>
              <Input
                id="goal-name"
                maxLength={120}
                placeholder="Ex.: curso de inglês"
                value={data.goal.name}
                onChange={(event) => updateGoal({ name: event.target.value })}
              />
            </div>
            <MoneyField
              id="goal-target"
              label="Valor total da meta"
              placeholder="2.000,00"
              value={targetText}
              onChange={setTargetText}
              onBlur={commitTarget}
            />
            <MoneyField
              id="goal-saved"
              label="Quanto você já guardou?"
              placeholder="0,00"
              value={savedText}
              onChange={setSavedText}
              onBlur={commitSaved}
            />
            <div>
              <label
                htmlFor="goal-months"
                className="text-foreground mb-2 block text-sm font-medium"
              >
                Em quantos meses?
              </label>
              <Input
                id="goal-months"
                type="number"
                min="1"
                max="120"
                suffix="meses"
                placeholder="12"
                value={data.goal.months || ''}
                onChange={(event) => updateGoal({ months: Number(event.target.value) || 0 })}
              />
            </div>
          </div>
        )}
        {step === 3 && <Review data={data} onEdit={setStep} />}
        {error && (
          <p
            role="alert"
            className="mt-4 flex min-w-0 items-start gap-2 text-sm wrap-break-word text-red-600"
          >
            <CircleAlert size={17} className="mt-0.5 shrink-0" />
            {error}
          </p>
        )}
        {feedback && (
          <p role="status" className="text-primary mt-4 text-sm">
            {feedback}
          </p>
        )}
        <div className="mt-8 flex flex-col-reverse gap-3 sm:flex-row sm:justify-between">
          <Button
            type="button"
            variant="ghost"
            icon={ArrowLeft}
            disabled={step === 0}
            onClick={() => setStep((current) => Math.max(0, current - 1))}
          >
            Voltar
          </Button>
          <Button
            type="button"
            variant="primary"
            icon={step === 3 ? Check : ArrowRight}
            onClick={next}
          >
            {step === 3 ? 'Ver resultado' : 'Continuar'}
          </Button>
        </div>
      </div>
      <p className="text-muted-foreground mt-4 text-center text-xs">
        Salvo apenas neste navegador. Nenhum dado é enviado para IA.
      </p>
    </section>
  )
}

function MoneyField({
  id,
  label,
  placeholder,
  value,
  onChange,
  onBlur,
}: {
  id: string
  label: string
  placeholder: string
  value: string
  onChange: (value: string) => void
  onBlur: () => void
}) {
  return (
    <div>
      <label htmlFor={id} className="text-foreground mb-2 block text-sm font-medium">
        {label}
      </label>
      <Input
        id={id}
        inputMode="decimal"
        prefix="R$"
        placeholder={placeholder}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onBlur={onBlur}
      />
      <p className="text-muted-foreground mt-1 text-xs">Até R$ 1.000.000,00 por campo.</p>
    </div>
  )
}

function ExpensesStep({
  expenses,
  draft,
  setDraft,
  editingId,
  descriptionError,
  onDescriptionChange,
  onAdd,
  onEdit,
  onRemove,
}: {
  expenses: Expense[]
  draft: Draft
  setDraft: (draft: Draft) => void
  editingId: string | null
  descriptionError: string
  onDescriptionChange: (value: string) => void
  onAdd: () => void
  onEdit: (expense: Expense) => void
  onRemove: (id: string) => void
}) {
  const normalizedLength = draft.description.normalize('NFC').trim().replace(/ +/g, ' ').length
  return (
    <div>
      <p className="text-muted-foreground mb-5 text-sm">
        Cadastre cada gasto mensal. Totais podem ultrapassar o limite individual do campo.
      </p>
      <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(130px,0.6fr)_minmax(150px,0.7fr)] lg:grid-cols-[minmax(0,1fr)_160px_180px_auto] lg:items-end">
        <div>
          <label
            htmlFor="expense-description"
            className="text-foreground mb-1 block text-xs font-medium"
          >
            Descrição
          </label>
          <Input
            id="expense-description"
            maxLength={120}
            placeholder="Ex.: Compras de alimentos do mês"
            value={draft.description}
            onChange={(event) => onDescriptionChange(event.target.value)}
            aria-describedby="description-help"
          />
          {descriptionError ? (
            <p
              id="description-help"
              role="alert"
              className="mt-1 text-xs wrap-break-word text-red-600"
            >
              {descriptionError}
            </p>
          ) : (
            <p id="description-help" className="text-muted-foreground mt-1 text-xs">
              {normalizedLength}/20 caracteres mínimos
            </p>
          )}
        </div>
        <div>
          <label
            htmlFor="expense-category"
            className="text-foreground mb-1 block text-xs font-medium"
          >
            Categoria
          </label>
          <select
            id="expense-category"
            className="bg-input text-foreground min-h-13 w-full rounded-2xl px-3 text-sm"
            value={draft.category}
            onChange={(event) => setDraft({ ...draft, category: event.target.value })}
          >
            {categories.map((category) => (
              <option key={category}>{category}</option>
            ))}
          </select>
        </div>
        <div>
          <label
            htmlFor="expense-amount"
            className="text-foreground mb-1 block text-xs font-medium"
          >
            Valor (R$ 50 a R$ 1 milhão)
          </label>
          <Input
            id="expense-amount"
            inputMode="decimal"
            prefix="R$"
            placeholder="50,00"
            value={draft.amount}
            onChange={(event) => setDraft({ ...draft, amount: event.target.value })}
          />
        </div>
        <Button
          type="button"
          variant="secondary"
          icon={editingId ? Check : Plus}
          onClick={onAdd}
          className="min-h-13 lg:col-auto"
        >
          {editingId ? 'Salvar' : 'Adicionar'}
        </Button>
      </div>
      <div className="mt-6 divide-y divide-(--border)">
        {expenses.length === 0 ? (
          <p className="text-muted-foreground border border-dashed border-(--border) p-4 text-center text-sm">
            Nenhuma despesa adicionada ainda.
          </p>
        ) : (
          expenses.map((expense) => (
            <div
              key={expense.id}
              className="flex flex-wrap items-center justify-between gap-3 py-3"
            >
              <div className="min-w-0 flex-1">
                <p className="text-foreground text-sm font-medium wrap-break-word">
                  {expense.description}
                </p>
                <p className="text-muted-foreground text-xs">{expense.category}</p>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <span className="text-foreground text-sm whitespace-nowrap">
                  {formatCurrency(expense.amountCents)}
                </span>
                <button
                  type="button"
                  aria-label={`Editar ${expense.description}`}
                  onClick={() => onEdit(expense)}
                  className="text-muted-foreground hover:text-foreground p-2"
                >
                  <Pencil size={16} />
                </button>
                <button
                  type="button"
                  aria-label={`Excluir ${expense.description}`}
                  onClick={() => onRemove(expense.id)}
                  className="text-muted-foreground p-2 hover:text-red-600"
                >
                  <Trash2 size={16} />
                </button>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  )
}

function Review({ data, onEdit }: { data: SimulationData; onEdit: (step: number) => void }) {
  const expenses = data.expenses.reduce((total, expense) => total + expense.amountCents, 0)
  return (
    <div className="grid gap-3 text-sm">
      <SummaryRow
        label="Renda mensal"
        value={formatCurrency(data.incomeCents)}
        onEdit={() => onEdit(0)}
      />
      <SummaryRow
        label={`${data.expenses.length} despesa(s)`}
        value={formatCurrency(expenses)}
        onEdit={() => onEdit(1)}
      />
      <SummaryRow
        label={`Meta: ${data.goal.name || 'sem nome'}`}
        value={`${formatCurrency(data.goal.targetCents)} em ${data.goal.months} meses`}
        onEdit={() => onEdit(2)}
      />
    </div>
  )
}
function SummaryRow({
  label,
  value,
  onEdit,
}: {
  label: string
  value: string
  onEdit: () => void
}) {
  return (
    <div className="bg-input flex flex-wrap items-center justify-between gap-3 rounded-xl p-4">
      <div className="min-w-0">
        <p className="text-muted-foreground text-xs">{label}</p>
        <p className="text-foreground mt-1 font-semibold wrap-break-word">{value}</p>
      </div>
      <button
        type="button"
        onClick={onEdit}
        className="text-primary inline-flex shrink-0 items-center gap-1 text-xs font-semibold"
      >
        <Pencil size={14} /> Editar
      </button>
    </div>
  )
}

function Result({
  data,
  onBack,
  onReset,
}: {
  data: SimulationData
  onBack: () => void
  onReset: () => void
}) {
  const result = calculateSimulation(data)
  const ruleAdvice = getRuleAdvice(result, data.goal)
  const [externalEnabled, setExternalEnabled] = useState(false)
  const [requestNonce, setRequestNonce] = useState(0)
  const [cooldownRemaining, setCooldownRemaining] = useState(0)
  const [pendingRequest, setPendingRequest] = useState<{
    facts: ReturnType<typeof toAdviceFacts>
    recommendations: ReturnType<typeof getEligibleRecommendations>
    simulationVersion: string
    idempotencyKey: string
  } | null>(null)
  const [aiState, setAiState] = useState<
    | { status: 'idle' }
    | { status: 'loading' }
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
  >({ status: 'idle' })
  const [lastAiResponse, setLastAiResponse] = useState<AiAdviceResponse | null>(null)
  const goalReached = result.remainingGoalCents === 0
  const viable = result.monthlyRequiredCents <= result.balanceCents
  const savedLabel =
    data.goal.savedCents === null ? 'não informado' : formatCurrency(data.goal.savedCents)

  useEffect(() => {
    if (cooldownRemaining === 0) return
    const interval = window.setInterval(
      () => setCooldownRemaining((current) => Math.max(0, current - 1)),
      1000,
    )
    return () => window.clearInterval(interval)
  }, [cooldownRemaining])

  useEffect(() => {
    if (!externalEnabled || !pendingRequest || requestNonce === 0) return
    const controller = new AbortController()
    void requestAiAdvice(
      pendingRequest.facts,
      pendingRequest.recommendations,
      pendingRequest.simulationVersion,
      pendingRequest.idempotencyKey,
      controller.signal,
    )
      .then((response) => {
        if (controller.signal.aborted) return
        setAiState(
          response.status === 'success'
            ? { status: 'success', response: response.response }
            : {
                status: 'unavailable',
                reason: response.reason,
                retryAfterSeconds: response.retryAfterSeconds,
              },
        )
        if (response.status === 'success') {
          setLastAiResponse(response.response)
        } else if (response.reason === 'disabled' || response.reason === 'config-invalid') {
          setCooldownRemaining(0)
        } else if (response.retryAfterSeconds) {
          setCooldownRemaining((current) => Math.max(current, response.retryAfterSeconds ?? 0))
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setAiState({ status: 'unavailable', reason: 'temporary' })
        }
      })
    return () => controller.abort()
  }, [externalEnabled, pendingRequest, requestNonce])

  const startAnalysis = () => {
    if (!externalEnabled || aiState.status === 'loading' || cooldownRemaining > 0) return
    const facts = toAdviceFacts(result, data.goal)
    setAiState({ status: 'loading' })
    setCooldownRemaining(30)
    setPendingRequest({
      facts,
      recommendations: getEligibleRecommendations(facts),
      simulationVersion: crypto.randomUUID(),
      idempotencyKey: crypto.randomUUID(),
    })
    setRequestNonce((current) => current + 1)
  }

  return (
    <section aria-labelledby="result-title">
      <div className="mb-6">
        <p className="text-primary text-xs font-semibold tracking-widest uppercase">
          Sua fotografia financeira
        </p>
        <h2 id="result-title" className="text-foreground mt-1 text-3xl font-semibold">
          O que seus números mostram
        </h2>
        <p className="text-muted-foreground mt-2 text-sm">
          Premissa: renda e despesas constantes, sem considerar rendimentos.
        </p>
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <Metric label="Renda mensal" value={formatCurrency(data.incomeCents)} />
        <Metric label="Despesas mensais" value={formatCurrency(result.expensesCents)} />
        <Metric
          label={result.balanceCents >= 0 ? 'Saldo disponível' : 'Déficit mensal'}
          value={formatCurrency(Math.abs(result.balanceCents))}
          negative={result.balanceCents < 0}
        />
      </div>
      <div className="bg-card mt-4 rounded-2xl p-5 shadow-[4px_4px_18px_0px_rgba(0,0,0,0.12)] sm:p-6">
        <h3 className="text-foreground text-lg font-semibold">Distribuição das despesas</h3>
        {result.categorySummaries.length === 0 ? (
          <p className="text-muted-foreground mt-3 text-sm">Nenhuma despesa foi cadastrada.</p>
        ) : (
          <div className="mt-3 space-y-3">
            {result.categorySummaries.map((summary) => (
              <div
                key={summary.category}
                className="flex flex-wrap items-center justify-between gap-2 text-sm"
              >
                <span className="text-foreground">{summary.category}</span>
                <span className="text-muted-foreground whitespace-nowrap">
                  {formatCurrency(summary.amountCents)} · {summary.percentage}%
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
      <div className="bg-card mt-4 rounded-2xl border border-(--border) p-5 sm:p-6">
        <h3 className="text-foreground text-lg font-semibold">Meta: {data.goal.name}</h3>
        {goalReached ? (
          <p className="text-primary mt-2 text-sm">
            Você já alcançou o valor da meta. O saldo disponível não é tratado automaticamente como
            dinheiro guardado.
          </p>
        ) : (
          <div className="mt-3 space-y-2 text-sm">
            <p className="text-foreground">
              Faltam <strong>{formatCurrency(result.remainingGoalCents)}</strong>. Para cumprir em{' '}
              {data.goal.months} meses, você precisaria guardar{' '}
              <strong>{formatCurrency(result.monthlyRequiredCents)} por mês</strong>.
            </p>
            <p className={viable ? 'text-primary' : 'text-red-600'}>
              {viable
                ? 'Esse valor cabe no saldo disponível, mas a decisão de guardar é sua.'
                : result.balanceCents > 0
                  ? `Com o saldo atual, o prazo calculado seria de aproximadamente ${result.monthsAtCurrentBalance} meses. Ampliar o prazo reduz a pressão mensal.`
                  : 'Com déficit mensal, primeiro será preciso ajustar despesas ou renda antes de guardar para a meta.'}
            </p>
          </div>
        )}
      </div>
      <div className="bg-primary/10 mt-4 rounded-2xl p-5 sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h3 className="text-foreground text-lg font-semibold">Sua análise personalizada</h3>
          <span className="text-muted-foreground text-xs">
            {externalEnabled && lastAiResponse
              ? 'Gerada por IA'
              : 'Orientação calculada por regras'}
          </span>
        </div>
        {externalEnabled && lastAiResponse ? (
          <AdviceMessage response={lastAiResponse} />
        ) : (
          <div className="bg-card mt-4 rounded-xl border border-(--border) p-4 sm:p-5">
            <ul className="text-foreground space-y-3 text-sm leading-7">
              {ruleAdvice.map((advice) => (
                <li key={advice.id}>{advice.text}</li>
              ))}
            </ul>
            <p className="text-muted-foreground mt-3 text-xs leading-5">
              Estas dicas são calculadas localmente a partir da simulação.
            </p>
          </div>
        )}
        <p className="text-muted-foreground mt-3 text-xs leading-5">
          O dinheiro já guardado ({savedLabel}) permanece separado do saldo disponível.
        </p>
        <div className="mt-5 border-t border-(--border) pt-4">
          <label className="text-foreground flex items-start gap-3 text-sm">
            <input
              type="checkbox"
              className="mt-0.5 size-4 accent-(--primary)"
              checked={externalEnabled}
              onChange={(event) => {
                setExternalEnabled(event.target.checked)
                if (!event.target.checked) {
                  setPendingRequest(null)
                  setAiState({ status: 'idle' })
                  setLastAiResponse(null)
                }
              }}
            />
            <span>
              <span className="font-medium">Permitir orientação gerada por IA</span>
              <span className="text-muted-foreground mt-1 block text-xs">
                Ao clicar em “Gerar orientação”, um resumo sem descrições, nome da meta ou
                identificadores pessoais será enviado ao Gemini para processamento externo.
              </span>
            </span>
          </label>
          {externalEnabled && (
            <div className="mt-4" aria-live="polite">
              {aiState.status === 'loading' && (
                <p className="text-muted-foreground flex items-center gap-2 text-sm" role="status">
                  <span
                    aria-hidden="true"
                    className="size-2 animate-pulse rounded-full bg-current"
                  />
                  Analisando seus dados…
                </p>
              )}
              {aiState.status === 'unavailable' && (
                <div className="mb-4 space-y-2">
                  <p className="text-muted-foreground text-sm">
                    {aiState.reason === 'disabled'
                      ? 'Orientação externa desativada no servidor.'
                      : aiState.reason === 'config-invalid'
                        ? 'Orientação externa indisponível: a configuração do Gemini não está válida.'
                        : aiState.reason === 'rate-limit'
                          ? `Limite local atingido. Nova tentativa em aproximadamente ${aiState.retryAfterSeconds ?? 0}s.`
                          : aiState.reason === 'auth-failed'
                            ? 'O servidor não conseguiu autenticar com o Gemini.'
                            : aiState.reason === 'model-unavailable'
                              ? 'O modelo Gemini configurado está indisponível.'
                              : aiState.reason === 'provider-quota'
                                ? 'A cota do Gemini foi atingida temporariamente.'
                                : aiState.reason === 'timeout'
                                  ? 'O Gemini demorou além do limite para responder.'
                                  : aiState.reason === 'invalid-response'
                                    ? 'A resposta do Gemini não pôde ser validada.'
                                    : aiState.retryAfterSeconds
                                      ? `Nova tentativa disponível em aproximadamente ${aiState.retryAfterSeconds}s.`
                                      : 'O serviço de IA está temporariamente indisponível.'}
                  </p>
                  <p className="text-muted-foreground text-xs">
                    {lastAiResponse
                      ? 'Mantivemos a última análise válida desta simulação.'
                      : 'As dicas locais continuam disponíveis acima.'}
                  </p>
                </div>
              )}
              <Button
                type="button"
                variant="secondary"
                disabled={aiState.status === 'loading' || cooldownRemaining > 0}
                onClick={startAnalysis}
                aria-busy={aiState.status === 'loading'}
              >
                {aiState.status === 'loading'
                  ? 'Analisando seus dados…'
                  : cooldownRemaining > 0
                    ? `Nova análise em ${cooldownRemaining}s`
                    : lastAiResponse
                      ? 'Atualizar orientação'
                      : 'Gerar orientação'}
              </Button>
            </div>
          )}
        </div>
      </div>
      <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:justify-between">
        <Button type="button" variant="ghost" icon={ArrowLeft} onClick={onBack}>
          Ajustar dados
        </Button>
        <div className="flex flex-col gap-3 sm:flex-row">
          <Button
            type="button"
            variant="secondary"
            icon={Download}
            onClick={() => saveExport(data)}
          >
            Exportar dados
          </Button>
          <Button type="button" variant="secondary" icon={RotateCcw} onClick={onReset}>
            Apagar simulação
          </Button>
        </div>
      </div>
    </section>
  )
}

function Metric({
  label,
  value,
  negative = false,
}: {
  label: string
  value: string
  negative?: boolean
}) {
  return (
    <div className="bg-card rounded-2xl border border-(--border) p-4">
      <p className="text-muted-foreground text-xs">{label}</p>
      <p
        className={`mt-2 text-xl font-semibold wrap-break-word ${negative ? 'text-red-600' : 'text-foreground'}`}
      >
        {value}
      </p>
    </div>
  )
}
