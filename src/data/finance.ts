export interface Expense {
  id: string
  description: string
  category: string
  amountCents: number
}

export interface InvalidExpenseRecord {
  id: string
  raw: unknown
}

export interface Goal {
  name: string
  targetCents: number
  savedCents: number | null
  months: number
}

export interface SimulationData {
  incomeCents: number
  expenses: Expense[]
  invalidExpenses?: InvalidExpenseRecord[]
  invalidData?: unknown
  goal: Goal
}

export interface CategorySummary {
  category: string
  amountCents: number
  percentage: number
}

export interface SimulationResult {
  expensesCents: number
  balanceCents: number
  categorySummaries: CategorySummary[]
  remainingGoalCents: number
  monthlyRequiredCents: number
  monthsAtCurrentBalance: number | null
  alternativeMonths: number | null
}

export const MAX_MONEY_CENTS = 100_000_000
export const MIN_MONEY_CENTS = 5_000

export type CurrencyValidation =
  | { valid: true; cents: number | null }
  | { valid: false; message: string }

function isBrazilianCurrencyFormat(value: string): boolean {
  return /^(?:\d+|\d{1,3}(?:\.\d{3})+)(?:,\d{1,2})?$/.test(value)
}

export function parseBrazilianCurrency(value: string): number | null {
  const normalized = value.trim().replace(/^R\$\s*/i, '')
  if (!normalized || !isBrazilianCurrencyFormat(normalized)) return null
  const parsed = Number(normalized.replace(/\./g, '').replace(',', '.'))
  if (!Number.isFinite(parsed) || parsed < 0) return null
  const cents = Math.round(parsed * 100)
  return Number.isSafeInteger(cents) ? cents : null
}

export function validateCurrencyInput(
  value: string,
  options: { required?: boolean; minimumCents?: number } = {},
): CurrencyValidation {
  const trimmed = value.trim()
  if (!trimmed) {
    return options.required
      ? { valid: false, message: 'Preencha este valor.' }
      : { valid: true, cents: null }
  }

  const rawValue = trimmed.replace(/^R\$\s*/i, '')
  const commaCount = (rawValue.match(/,/g) ?? []).length
  if (commaCount > 1) {
    return { valid: false, message: 'Use o formato brasileiro, como 1.250,75.' }
  }
    const decimalPart = rawValue.split(',')[1]
    if (decimalPart && decimalPart.length > 2) {
      return { valid: false, message: 'Use no máximo duas casas decimais após a vírgula.' }
    }
  if (!isBrazilianCurrencyFormat(rawValue)) {
    return { valid: false, message: 'Use o formato brasileiro, como 1.250,75.' }
  }
  const cents = parseBrazilianCurrency(trimmed)
  if (cents === null) {
    return { valid: false, message: 'Use o formato brasileiro, como 1.250,75.' }
  }
  const minimumCents = options.minimumCents ?? MIN_MONEY_CENTS
  if (cents < minimumCents) {
    return { valid: false, message: 'Informe um valor de pelo menos R$ 50,00.' }
  }
  if (cents > MAX_MONEY_CENTS) {
    return { valid: false, message: 'O valor máximo permitido é R$ 1.000.000,00.' }
  }
  return { valid: true, cents }
}

export function normalizeExpenseDescription(value: string): string {
  return value.normalize('NFC').trim().replace(/ +/g, ' ')
}

export function validateExpenseDescription(value: string):
  | { valid: true; description: string }
  | { valid: false; message: string } {
  const description = normalizeExpenseDescription(value)
  if (description.length < 20) {
    return { valid: false, message: 'A descrição deve ter pelo menos 20 caracteres.' }
  }
  if (!/^[\p{L}0-9 ]+$/u.test(description)) {
    return { valid: false, message: 'Use apenas letras, números e espaços.' }
  }
  return { valid: true, description }
}

export function formatCurrency(cents: number): string {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  }).format(Math.max(0, cents) / 100)
}

export function calculateSimulation(data: SimulationData): SimulationResult {
  const expensesCents = data.expenses.reduce(
    (total, expense) => total + expense.amountCents,
    0,
  )
  const balanceCents = data.incomeCents - expensesCents
  const byCategory = new Map<string, number>()

  for (const expense of data.expenses) {
    byCategory.set(
      expense.category,
      (byCategory.get(expense.category) ?? 0) + expense.amountCents,
    )
  }

  const categorySummaries = [...byCategory.entries()]
    .map(([category, amountCents]) => ({
      category,
      amountCents,
      percentage:
        expensesCents > 0 ? Math.round((amountCents / expensesCents) * 100) : 0,
    }))
    .sort((first, second) => second.amountCents - first.amountCents)

  const remainingGoalCents = Math.max(
    0,
    data.goal.targetCents - (data.goal.savedCents ?? 0),
  )
  const monthlyRequiredCents =
    remainingGoalCents > 0 && data.goal.months > 0
      ? Math.ceil(remainingGoalCents / data.goal.months)
      : 0
  const monthsAtCurrentBalance =
    remainingGoalCents > 0 && balanceCents > 0
      ? Math.ceil(remainingGoalCents / balanceCents)
      : null
  const alternativeMonths =
    remainingGoalCents > 0 && balanceCents > 0 && monthlyRequiredCents > balanceCents
      ? Math.ceil(remainingGoalCents / balanceCents)
      : null

  return {
    expensesCents,
    balanceCents,
    categorySummaries,
    remainingGoalCents,
    monthlyRequiredCents,
    monthsAtCurrentBalance,
    alternativeMonths,
  }
}
