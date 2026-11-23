import { readFileSync } from 'node:fs'
import { describe, it, expect } from 'vitest'
import { parseRulesCSV, parseCartCSV } from '../src/inputs/csv.js'
import {
  applyDiscounts,
  calculateCart,
  calculateDiscountAmount,
} from '../src/engine/discountEngine.js'

const sample = (f) => readFileSync(new URL(`../sample-data/${f}`, import.meta.url), 'utf8')
const RULES = parseRulesCSV(sample('rules.csv')).data
const CART = parseCartCSV(sample('cart.csv')).data

const rule = (overrides) => ({
  ruleId: 'R', scope: 'brand', appliesTo: 'X', type: 'percentage',
  value: 10, stackable: false, minCartValue: 0, ...overrides,
})
const item = (overrides) => ({
  itemId: 'I', product: 'P', brand: 'X', platform: 'Y', basePrice: 1000, ...overrides,
})

describe('expected results from the brief', () => {
  const summary = calculateCart(CART, RULES)
  const byId = Object.fromEntries(summary.items.map((r) => [r.itemId, r]))

  it.each([
    ['ITEM-01', 1104, ['RULE-01'], ['RULE-02']],
    ['ITEM-02', 629, ['RULE-02', 'RULE-03'], []],
    ['ITEM-03', 509, ['RULE-01'], []],
    ['ITEM-04', 2499, [], []],
    ['ITEM-05', 382, ['RULE-01'], []],
    ['ITEM-06', 809, ['RULE-03'], []],
  ])('%s → Rs.%i', (id, finalPrice, applied, skipped) => {
    expect(byId[id].finalPrice).toBe(finalPrice)
    expect(byId[id].appliedRules).toEqual(applied)
    expect(byId[id].skippedRules).toEqual(skipped)
  })

  it('cart subtotal, cart offer and final total match', () => {
    expect(summary.subtotal).toBe(5932)
    expect(summary.cartOffer.appliedRules).toEqual(['RULE-04'])
    expect(summary.cartOffer.discount).toBe(593)
    expect(summary.cartOffer.reasoning).toBe('Cart offer: 10% off — Rs.593 saved')
    expect(summary.total).toBe(5339)
    expect(summary.nextCartOffer).toBeNull()
  })

  it('explains why ITEM-01 got the platform offer', () => {
    expect(byId['ITEM-01'].reasoning).toBe(
      'Platform offer: 15% off (better than Brand offer: Rs.150 off)'
    )
  })

  it('stacks ITEM-02 and says so', () => {
    expect(byId['ITEM-02'].reasoning).toBe('Brand offer: Rs.150 off + Platform offer: 10% off')
  })

  it('gives ITEM-04 a meaningful no-offer note', () => {
    expect(byId['ITEM-04'].reasoning).toBe('No offers available for LivSpace Pro on Noon')
    expect(byId['ITEM-04'].totalDiscount).toBe(0)
  })

  it('cart rules never leak into item-level pricing', () => {
    for (const r of summary.items) expect(r.appliedRules).not.toContain('RULE-04')
  })
})

describe('cart offer threshold', () => {
  const cartRule = rule({ ruleId: 'CART', scope: 'cart', appliesTo: '', minCartValue: 4000 })

  it('does not apply Rs.1 below the threshold, and says how far off it is', () => {
    const s = calculateCart([item({ basePrice: 3999 })], [cartRule])
    expect(s.cartOffer).toBeNull()
    expect(s.total).toBe(3999)
    expect(s.nextCartOffer).toEqual({ ruleId: 'CART', label: 'Cart offer: 10% off', shortBy: 1 })
  })

  it('applies exactly at the threshold (≥, not >)', () => {
    const s = calculateCart([item({ basePrice: 4000 })], [cartRule])
    expect(s.cartOffer.discount).toBe(400)
    expect(s.total).toBe(3600)
  })

  it('checks the threshold against the total *after* item discounts', () => {
    // Rs.4,400 base, but a 10% brand offer brings it to Rs.3,960 — below Rs.4,000.
    const s = calculateCart([item({ basePrice: 4400 })], [rule({ ruleId: 'B' }), cartRule])
    expect(s.subtotal).toBe(3960)
    expect(s.cartOffer).toBeNull()
    expect(s.nextCartOffer.shortBy).toBe(40)
  })

  it('picks the cart rule with the bigger saving when several qualify', () => {
    const flat = rule({ ruleId: 'FLAT', scope: 'cart', appliesTo: '', type: 'flat', value: 300, minCartValue: 1000 })
    const s = calculateCart([item({ basePrice: 5000 })], [cartRule, flat])
    expect(s.cartOffer.appliedRules).toEqual(['CART']) // 10% of 5000 = 500 > 300
    expect(s.cartOffer.skippedRules).toEqual(['FLAT'])
  })

  it('stacks a stackable cart rule on top', () => {
    const extra = rule({ ruleId: 'EXTRA', scope: 'cart', appliesTo: '', type: 'flat', value: 100, stackable: true })
    const s = calculateCart([item({ basePrice: 5000 })], [cartRule, extra])
    expect(s.cartOffer.discount).toBe(600) // 500, then Rs.100 more
    expect(s.cartOffer.reasoning).toBe('Cart offer: 10% off + Rs.100 off — Rs.600 saved')
  })

  it('an empty cart has no offers and no crash', () => {
    const s = calculateCart([], RULES)
    expect(s.subtotal).toBe(0)
    expect(s.cartOffer).toBeNull()
    expect(s.total).toBe(0)
  })
})

describe('item-level edge cases', () => {
  it('never discounts below zero (flat discount larger than the price)', () => {
    expect(calculateDiscountAmount(100, rule({ type: 'flat', value: 150 }))).toBe(100)
    const r = applyDiscounts(item({ basePrice: 100 }), [rule({ type: 'flat', value: 150 })])
    expect(r.finalPrice).toBe(0)
  })

  it('a stackable rule applies on its own when nothing else matches', () => {
    const r = applyDiscounts(item(), [rule({ stackable: true })])
    expect(r.finalPrice).toBe(900)
    expect(r.appliedRules).toEqual(['R'])
  })

  it('breaks ties in favour of the rule listed first', () => {
    const a = rule({ ruleId: 'A', type: 'flat', value: 100 })
    const b = rule({ ruleId: 'B', scope: 'platform', appliesTo: 'Y', type: 'percentage', value: 10 })
    expect(applyDiscounts(item(), [a, b]).appliedRules).toEqual(['A'])
    expect(applyDiscounts(item(), [b, a]).appliedRules).toEqual(['B'])
  })

  it('matches brand and platform names case-insensitively', () => {
    const r = applyDiscounts(item({ brand: 'natura casa ' }), [rule({ appliesTo: 'Natura Casa' })])
    expect(r.appliedRules).toEqual(['R'])
  })
})
