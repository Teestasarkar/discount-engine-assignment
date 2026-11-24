/**
 * nlRule.js — natural-language rule input adapter
 *
 *   text ──► POST /api/parse-rule (LLM) ──► interpretParsedRule ──► schema.validateRule ──► DiscountRule
 *
 * The LLM only proposes a reading of the sentence. Nothing it returns reaches
 * the engine until it has passed validateRule (the same gate as CSV rows) and
 * the user has confirmed it in the UI.
 */

import { validateRule, nextId } from '../engine/schema.js'

/**
 * Calls the parse endpoint. Resolves to the LLM's parsed object, or throws an
 * Error whose message is safe to show the user.
 */
export async function requestRuleParse(text, { knownBrands = [], knownPlatforms = [] } = {}, { signal } = {}) {
  let res
  try {
    res = await fetch('/api/parse-rule', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, knownBrands, knownPlatforms }),
      signal,
    })
  } catch (err) {
    if (err.name === 'AbortError') throw err
    throw new Error('Could not reach the rule parser. Check your connection and try again.')
  }

  let payload = null
  try {
    payload = await res.json()
  } catch {
    // fall through to the generic message below
  }
  if (!res.ok || !payload?.ok) {
    throw new Error(payload?.message ?? `The rule parser is unavailable (HTTP ${res.status}).`)
  }
  return payload.parsed
}

const lower = (s) => String(s ?? '').trim().toLowerCase()

/** Brand and platform names already known from the cart and the active rules. */
export function knownNames(rules = [], cartItems = []) {
  const unique = (names) => [...new Set(names.map((n) => String(n ?? '').trim()).filter(Boolean))]
  return {
    knownBrands: unique([
      ...cartItems.map((i) => i.brand),
      ...rules.filter((r) => r.scope === 'brand').map((r) => r.appliesTo),
    ]),
    knownPlatforms: unique([
      ...cartItems.map((i) => i.platform),
      ...rules.filter((r) => r.scope === 'platform').map((r) => r.appliesTo),
    ]),
  }
}

/** Uses the canonical spelling when the name matches a known one case-insensitively. */
function canonicalName(name, knownNames) {
  return knownNames.find((k) => lower(k) === lower(name)) ?? String(name ?? '').trim()
}

function sameRule(a, b) {
  return (
    a.scope === b.scope && lower(a.appliesTo) === lower(b.appliesTo) && a.type === b.type &&
    a.value === b.value && a.stackable === b.stackable && (a.minCartValue ?? 0) === (b.minCartValue ?? 0)
  )
}

/**
 * Turns the LLM's parsed object into something the UI can act on.
 *
 * Returns one of:
 *   { kind: 'ready', rule, assumptions, warnings }       → show the confirmation step
 *   { kind: 'clarify', message }                         → ask the user to be more specific
 *   { kind: 'unsupported', message }                     → the engine can't express this rule
 *   { kind: 'invalid', errors }                          → the LLM said "ok" but the rule doesn't validate
 *
 * context: { rules: DiscountRule[], cartItems: CartItem[] }
 */
export function interpretParsedRule(parsed, { rules = [], cartItems = [] } = {}) {
  if (!parsed || typeof parsed !== 'object' || !['ok', 'ambiguous', 'unsupported'].includes(parsed.status)) {
    return { kind: 'invalid', errors: ['The rule parser returned an unexpected answer.'] }
  }

  if (parsed.status === 'ambiguous') {
    return {
      kind: 'clarify',
      message: parsed.message?.trim() || 'Please be more specific: what discount, and on which brand, platform or cart value?',
    }
  }
  if (parsed.status === 'unsupported') {
    return {
      kind: 'unsupported',
      message: parsed.message?.trim() || 'The discount engine can’t express this rule.',
    }
  }

  // status "ok" — still verify everything before trusting it.
  if (parsed.scope === 'unknown' || parsed.discountType === 'unknown') {
    return {
      kind: 'clarify',
      message: 'Please say what the discount is (a % or a rupee amount) and what it applies to (a brand, a platform or the whole cart).',
    }
  }

  const { knownBrands, knownPlatforms } = knownNames(rules, cartItems)
  let appliesTo = parsed.appliesTo
  if (parsed.scope === 'brand') appliesTo = canonicalName(appliesTo, knownBrands)
  if (parsed.scope === 'platform') appliesTo = canonicalName(appliesTo, knownPlatforms)

  const { rule, errors } = validateRule({
    ruleId: nextId(rules.map((r) => r.ruleId), 'RULE'),
    scope: parsed.scope,
    appliesTo,
    type: parsed.discountType,
    value: parsed.value,
    stackable: parsed.stackable,
    // Passed through even for brand/platform rules: a threshold the engine can't
    // honour must be rejected, not dropped (dropping it would make the offer unconditional).
    minCartValue: parsed.minCartValue,
  })
  if (!rule) return { kind: 'invalid', errors }

  const warnings = []
  if (cartItems.length > 0 && rule.scope !== 'cart') {
    const field = rule.scope === 'brand' ? 'brand' : 'platform'
    const matches = cartItems.filter((i) => lower(i[field]) === lower(rule.appliesTo))
    if (matches.length === 0) {
      warnings.push(`No item in the current cart has ${field} “${rule.appliesTo}”, so this rule won’t change today’s prices.`)
    }
  }
  const duplicate = rules.find((r) => sameRule(r, rule))
  if (duplicate) warnings.push(`This is identical to ${duplicate.ruleId}.`)
  if (rule.type === 'percentage' && rule.value === 100) warnings.push('100% off makes matching items free.')

  const assumptions = Array.isArray(parsed.assumptions)
    ? parsed.assumptions.filter((a) => typeof a === 'string' && a.trim()).map((a) => a.trim())
    : []

  return { kind: 'ready', rule, assumptions, warnings }
}
