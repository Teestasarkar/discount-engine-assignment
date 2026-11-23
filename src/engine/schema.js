/**
 * schema.js
 *
 * The engine's input contract. Every input mode (CSV upload, PDF upload,
 * natural-language rule, …) produces loosely-typed "raw" objects and passes
 * them through validateRule / validateCartItem before they reach the
 * calculator. This file is the only place that decides what a valid
 * DiscountRule or CartItem is, so a new input mode never needs its own rules
 * about scopes, prices or percentages.
 *
 * DiscountRule {
 *   ruleId:       string                         e.g. "RULE-01"
 *   scope:        "brand" | "platform" | "cart"
 *   appliesTo:    string                         brand/platform name; "" for cart rules
 *   type:         "percentage" | "flat"
 *   value:        number                         percentage as 0–100, flat in rupees
 *   stackable:    boolean
 *   minCartValue: number                         cart rules only; 0 = no threshold
 * }
 *
 * CartItem {
 *   itemId:    string                            e.g. "ITEM-01"
 *   product:   string
 *   brand:     string
 *   platform:  string
 *   basePrice: number                            whole rupees
 * }
 */

export const SCOPES = ['brand', 'platform', 'cart']
export const DISCOUNT_TYPES = ['percentage', 'flat']

/**
 * Parses a rupee amount written the way people write it:
 * 1299, "1299", "1,299", "Rs.1,299", "Rs 1,299.00", "₹1,299", "INR 1299".
 * Returns NaN when the text is not a single amount.
 */
export function parseAmount(input) {
  if (typeof input === 'number') return input
  if (typeof input !== 'string') return NaN
  const cleaned = input
    .trim()
    .replace(/^(rs\.?|inr|₹)\s*/i, '')
    .replace(/,/g, '')
    .replace(/%$/, '')
    .trim()
  if (!/^\d+(\.\d+)?$/.test(cleaned)) return NaN
  return Number(cleaned)
}

/** Accepts true/false, "true"/"false", "yes"/"no", "1"/"0", "y"/"n". */
export function parseBoolean(input) {
  if (typeof input === 'boolean') return input
  const s = String(input ?? '').trim().toLowerCase()
  if (['true', 'yes', 'y', '1'].includes(s)) return true
  if (['false', 'no', 'n', '0'].includes(s)) return false
  return undefined
}

const isBlank = (v) => v === undefined || v === null || String(v).trim() === ''
const text = (v) => (isBlank(v) ? '' : String(v).trim())

/**
 * Validates and normalises a raw rule.
 * Returns { rule, errors } — rule is null when errors is non-empty.
 */
export function validateRule(raw) {
  const errors = []
  if (!raw || typeof raw !== 'object') {
    return { rule: null, errors: ['rule is empty'] }
  }

  const ruleId = text(raw.ruleId)
  if (!ruleId) errors.push('rule_id is missing')

  const scope = text(raw.scope).toLowerCase()
  if (!scope) errors.push('scope is missing')
  else if (!SCOPES.includes(scope)) {
    errors.push(`scope must be one of ${SCOPES.join(', ')} (got "${raw.scope}")`)
  }

  const appliesTo = text(raw.appliesTo)
  if ((scope === 'brand' || scope === 'platform') && !appliesTo) {
    errors.push(`applies_to is required for a ${scope} rule (which ${scope}?)`)
  }

  const type = text(raw.type).toLowerCase()
  if (!type) errors.push('type is missing')
  else if (!DISCOUNT_TYPES.includes(type)) {
    errors.push(`type must be percentage or flat (got "${raw.type}")`)
  }

  const value = parseAmount(raw.value)
  if (isBlank(raw.value)) errors.push('value is missing')
  else if (!Number.isFinite(value) || value <= 0) {
    errors.push(`value must be a positive number (got "${raw.value}")`)
  } else if (type === 'percentage' && value > 100) {
    errors.push(`a percentage discount cannot exceed 100% (got ${value}%)`)
  }

  const stackable = parseBoolean(raw.stackable)
  if (stackable === undefined) {
    errors.push(`stackable must be true or false (got "${raw.stackable ?? ''}")`)
  }

  let minCartValue = 0
  if (!isBlank(raw.minCartValue)) {
    minCartValue = parseAmount(raw.minCartValue)
    if (!Number.isFinite(minCartValue) || minCartValue < 0) {
      errors.push(`min_cart_value must be a non-negative number (got "${raw.minCartValue}")`)
    } else if (scope !== 'cart' && minCartValue > 0) {
      errors.push('min_cart_value only applies to cart rules — brand/platform rules cannot have a cart threshold')
    }
  }

  if (errors.length > 0) return { rule: null, errors }

  return {
    rule: {
      ruleId,
      scope,
      appliesTo: scope === 'cart' ? '' : appliesTo,
      type,
      value,
      stackable,
      minCartValue: scope === 'cart' ? minCartValue : 0,
    },
    errors: [],
  }
}

/**
 * Validates and normalises a raw cart item.
 * Returns { item, errors } — item is null when errors is non-empty.
 */
export function validateCartItem(raw) {
  const errors = []
  if (!raw || typeof raw !== 'object') {
    return { item: null, errors: ['item is empty'] }
  }

  const fields = {
    itemId: 'item_id',
    product: 'product',
    brand: 'brand',
    platform: 'platform',
  }
  const missing = Object.entries(fields)
    .filter(([key]) => isBlank(raw[key]))
    .map(([, label]) => label)
  if (isBlank(raw.basePrice)) missing.push('base_price')
  if (missing.length > 0) errors.push(`missing ${missing.join(', ')}`)

  const basePrice = parseAmount(raw.basePrice)
  if (!isBlank(raw.basePrice) && (!Number.isFinite(basePrice) || basePrice <= 0)) {
    errors.push(`base_price must be a positive amount (got "${raw.basePrice}")`)
  }

  if (errors.length > 0) return { item: null, errors }

  return {
    item: {
      itemId: text(raw.itemId),
      product: text(raw.product),
      brand: text(raw.brand),
      platform: text(raw.platform),
      basePrice: Math.round(basePrice),
    },
    errors: [],
  }
}

/** Next free id in a "PREFIX-NN" sequence, e.g. nextId(rules, 'RULE') → "RULE-05". */
export function nextId(existingIds, prefix) {
  const re = new RegExp(`^${prefix}-(\\d+)$`, 'i')
  const max = existingIds.reduce((m, id) => {
    const match = re.exec(id ?? '')
    return match ? Math.max(m, Number(match[1])) : m
  }, 0)
  return `${prefix}-${String(max + 1).padStart(2, '0')}`
}
