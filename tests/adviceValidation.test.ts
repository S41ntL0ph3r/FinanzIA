import assert from 'node:assert/strict'
import test from 'node:test'

import {
  ADVICE_TEXT_LIMITS,
  getAdviceValidationIssue,
  getEligibleRecommendations,
  isValidAiAdvice,
} from '../src/data/advice.ts'

const facts = {
  incomeCents: 150050,
  expensesCents: 53909,
  balanceCents: 96141,
  categorySummaries: [
    { category: 'Estudos', amountCents: 44900, percentage: 83 },
    { category: 'Moradia', amountCents: 9009, percentage: 17 },
  ],
  goalTargetCents: 400030,
  goalSavedCents: 20000,
  remainingGoalCents: 380030,
  goalMonths: 8,
  monthlyRequiredCents: 47504,
}
const eligible = getEligibleRecommendations(facts)
const valid = () => ({
  source: 'ai',
  summary: 'A meta cabe no saldo informado.',
  insights: [
    {
      id: eligible[0].id,
      text: 'Revise a distribuição das despesas.',
      action: 'Compare suas prioridades antes de ajustar gastos.',
      factKeys: ['categorySummaries'],
    },
  ],
  limitations: [],
})

test('valid advice passes', () => assert.equal(isValidAiAdvice(valid(), facts, eligible), true))
test('invented ID rejected with precise code', () => {
  const response = valid()
  response.insights[0].id = 'invented'
  assert.equal(getAdviceValidationIssue(response, facts, eligible), 'insight-id')
})
test('digits rejected, without weakening financial guard', () => {
  const response = valid()
  response.summary = 'Guarde 100 por mês.'
  assert.equal(getAdviceValidationIssue(response, facts, eligible), 'summary-numbers')
})
test('oversized text and unknown fact reference rejected', () => {
  const response = valid()
  response.insights[0].text = 'a'.repeat(ADVICE_TEXT_LIMITS.text + 1)
  assert.equal(getAdviceValidationIssue(response, facts, eligible), 'insight-text-length-or-type')
  response.insights[0].text = 'Revise os gastos.'
  response.insights[0].factKeys = ['invented']
  assert.equal(getAdviceValidationIssue(response, facts, eligible), 'fact-keys')
})
test('malformed objects do not crash validator', () => {
  for (const response of [
    null,
    [],
    {},
    { ...valid(), insights: [null] },
    { ...valid(), insights: [42] },
  ]) {
    assert.equal(isValidAiAdvice(response, facts, eligible), false)
  }
})

test('expanded explanation passes within shared limits', () => {
  const response = valid()
  response.summary = 'Uma explicação contextualizada. '.repeat(12)
  response.insights[0].text = 'Considere suas prioridades ao revisar gastos. '.repeat(10)
  response.insights[0].action = 'Avalie um ajuste possível sem comprometer necessidades. '.repeat(5)
  assert.equal(isValidAiAdvice(response, facts, eligible), true)
})

test('all expanded text limits remain enforced', () => {
  const summary = valid()
  summary.summary = 'a'.repeat(ADVICE_TEXT_LIMITS.summary + 1)
  assert.equal(getAdviceValidationIssue(summary, facts, eligible), 'summary-length-or-type')
  const action = valid()
  action.insights[0].action = 'a'.repeat(ADVICE_TEXT_LIMITS.action + 1)
  assert.equal(getAdviceValidationIssue(action, facts, eligible), 'insight-action-length-or-type')
  const limitation = { ...valid(), limitations: ['a'.repeat(ADVICE_TEXT_LIMITS.limitation + 1)] }
  assert.equal(getAdviceValidationIssue(limitation, facts, eligible), 'limitations')
})

test('duplicate tips and numeric claims in limitations are rejected', () => {
  const response = valid()
  response.insights.push({ ...response.insights[0] })
  assert.equal(getAdviceValidationIssue(response, facts, eligible), 'duplicate-insight-id')
  assert.equal(
    getAdviceValidationIssue({ ...valid(), limitations: ['Renda de R$ 100.'] }, facts, eligible),
    'limitations',
  )
})
