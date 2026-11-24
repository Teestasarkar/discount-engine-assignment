/**
 * discountEngine.js
 *
 * Pure discount calculation logic. No UI, no side effects, no knowledge of
 * where rules or cart items came from (CSV, PDF, LLM…). Inputs are the
 * DiscountRule and CartItem shapes defined in schema.js.
 *
 * DiscountResult {
 *   itemId, product, brand, platform: string
 *   basePrice:     number
 *   finalPrice:    number
 *   totalDiscount: number
 *   appliedRules:  string[]
 *   skippedRules:  string[]
 *   reasoning:     string   — customer-readable explanation
 * }
 *
 * CartSummary {
 *   items:         DiscountResult[]
 *   subtotal:      number          — sum of item final prices (before the cart offer)
 *   cartOffer:     CartOffer | null — null when no cart rule's threshold is met
 *   total:         number          — what the customer pays
 *   totalSavings:  number          — base prices minus total
 *   nextCartOffer: { ruleId, label, shortBy } | null — closest cart offer not yet unlocked
 * }
 *
 * CartOffer {
 *   appliedRules: string[]
 *   skippedRules: string[]
 *   discount:     number
 *   reasoning:    string   — e.g. "Cart offer: 10% off — Rs.593 saved"
 * }
 */

const SCOPE_LABELS = { brand: 'Brand', platform: 'Platform', cart: 'Cart' }

const rupees = (n) => `Rs.${n.toLocaleString('en-IN')}`

/**
 * Returns true if an item-level rule applies to this cart item.
 * Cart-scope rules never match an individual item.
 */
export function ruleMatchesItem(item, rule) {
  const normalise = (s) => String(s ?? '').trim().toLowerCase()
  if (rule.scope === 'brand') {
    return normalise(item.brand) === normalise(rule.appliesTo)
  }
  if (rule.scope === 'platform') {
    return normalise(item.platform) === normalise(rule.appliesTo)
  }
  return false
}

/**
 * Calculates the rupee discount a rule gives on a given price.
 * Uses the provided price, not the original base price — important for stacking.
 * Never returns more than the price itself, so a Rs.150-off rule on a Rs.100
 * item makes it free rather than negative.
 */
export function calculateDiscountAmount(price, rule) {
  let amount = 0
  if (rule.type === 'percentage') amount = Math.round((price * rule.value) / 100)
  if (rule.type === 'flat') amount = rule.value
  return Math.max(0, Math.min(amount, price))
}

/** "Platform offer: 15% off", "Brand offer: Rs.150 off", "Cart offer: 10% off". */
export function describeRule(rule) {
  const scopeLabel = SCOPE_LABELS[rule.scope] ?? 'Special'
  if (rule.type === 'percentage') return `${scopeLabel} offer: ${rule.value}% off`
  if (rule.type === 'flat') return `${scopeLabel} offer: ${rupees(rule.value)} off`
  return `${scopeLabel} offer applied`
}

/**
 * The selection policy shared by item-level and cart-level offers:
 *   1. Among non-stackable rules, apply the one with the largest rupee saving
 *      (ties go to the rule listed first).
 *   2. Apply every stackable rule on top, in list order, each on the running price.
 *
 * Returns { finalPrice, winner, skipped, stacked }.
 */
export function applyBestOffer(price, matchingRules) {
  const nonStackable = matchingRules.filter((r) => !r.stackable)
  const stackable = matchingRules.filter((r) => r.stackable)

  let winner = null
  let skipped = []
  if (nonStackable.length > 0) {
    const sorted = [...nonStackable].sort(
      (a, b) => calculateDiscountAmount(price, b) - calculateDiscountAmount(price, a)
    )
    winner = sorted[0]
    skipped = sorted.slice(1)
  }

  let running = price
  if (winner) running -= calculateDiscountAmount(running, winner)
  for (const rule of stackable) running -= calculateDiscountAmount(running, rule)

  return { finalPrice: Math.round(running), winner, skipped, stacked: stackable }
}

/**
 * Applies the active discount rules to a single cart item.
 * Returns a DiscountResult.
 */
export function applyDiscounts(item, rules) {
  const matchingRules = rules.filter((r) => ruleMatchesItem(item, r))

  const base = {
    itemId: item.itemId,
    product: item.product,
    brand: item.brand,
    platform: item.platform,
    basePrice: item.basePrice,
  }

  if (matchingRules.length === 0) {
    return {
      ...base,
      finalPrice: item.basePrice,
      totalDiscount: 0,
      appliedRules: [],
      skippedRules: [],
      reasoning: `No offers available for ${item.brand} on ${item.platform}`,
    }
  }

  const { finalPrice, winner, skipped, stacked } = applyBestOffer(item.basePrice, matchingRules)

  const reasoningParts = []
  if (winner) {
    // Only rules that saved less were beaten. A tie (for example a duplicate
    // rule) is not worth a "better than" comparison.
    const winnerSaving = calculateDiscountAmount(item.basePrice, winner)
    const beaten = skipped
      .filter((r) => calculateDiscountAmount(item.basePrice, r) < winnerSaving)
      .map(describeRule)
      .join(', ')
    reasoningParts.push(beaten ? `${describeRule(winner)} (better than ${beaten})` : describeRule(winner))
  }
  for (const rule of stacked) reasoningParts.push(describeRule(rule))

  return {
    ...base,
    finalPrice,
    totalDiscount: item.basePrice - finalPrice,
    appliedRules: [...(winner ? [winner.ruleId] : []), ...stacked.map((r) => r.ruleId)],
    skippedRules: skipped.map((r) => r.ruleId),
    reasoning: reasoningParts.join(' + '),
  }
}

/**
 * Runs applyDiscounts across every item in the cart.
 * Returns an array of DiscountResult objects.
 */
export function processCart(cartItems, rules) {
  return cartItems.map((item) => applyDiscounts(item, rules))
}

/**
 * Sums the final prices across all results.
 */
export function cartTotal(results) {
  return results.reduce((sum, r) => sum + r.finalPrice, 0)
}

/**
 * Applies cart-scope rules to a subtotal (the sum of item final prices).
 * A cart rule is eligible when subtotal >= its minCartValue. Eligible rules go
 * through the same best-offer/stacking policy as items.
 * Returns a CartOffer, or null when no cart rule is eligible.
 */
export function applyCartRules(subtotal, rules) {
  const eligible = rules.filter((r) => r.scope === 'cart' && subtotal >= (r.minCartValue ?? 0))
  if (eligible.length === 0) return null

  const { finalPrice, winner, skipped, stacked } = applyBestOffer(subtotal, eligible)
  const discount = subtotal - finalPrice
  if (discount <= 0) return null

  const applied = [...(winner ? [winner] : []), ...stacked]
  const offerText = applied
    .map((r) => (r.type === 'percentage' ? `${r.value}% off` : `${rupees(r.value)} off`))
    .join(' + ')

  return {
    appliedRules: applied.map((r) => r.ruleId),
    skippedRules: skipped.map((r) => r.ruleId),
    discount,
    reasoning: `Cart offer: ${offerText} — ${rupees(discount)} saved`,
  }
}

/**
 * The full checkout calculation: item-level offers first, then the cart offer
 * on the resulting subtotal.
 * Returns a CartSummary.
 */
export function calculateCart(cartItems, rules) {
  const items = processCart(cartItems, rules)
  const subtotal = cartTotal(items)
  const cartOffer = applyCartRules(subtotal, rules)
  const total = subtotal - (cartOffer?.discount ?? 0)
  const baseTotal = cartItems.reduce((sum, i) => sum + i.basePrice, 0)

  // The closest cart offer the customer hasn't unlocked yet, for an
  // "add Rs.X more" hint. Only shown when no cart offer applied.
  let nextCartOffer = null
  if (!cartOffer) {
    const locked = rules
      .filter((r) => r.scope === 'cart' && subtotal < (r.minCartValue ?? 0))
      .sort((a, b) => a.minCartValue - b.minCartValue)
    if (locked.length > 0) {
      const rule = locked[0]
      nextCartOffer = {
        ruleId: rule.ruleId,
        label: describeRule(rule),
        shortBy: rule.minCartValue - subtotal,
      }
    }
  }

  return { items, subtotal, cartOffer, total, totalSavings: baseTotal - total, nextCartOffer }
}
