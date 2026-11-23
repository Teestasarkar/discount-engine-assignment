import { describe, it, expect } from 'vitest'
import { validateRule, validateCartItem, parseAmount, nextId } from '../src/engine/schema.js'

describe('parseAmount', () => {
  it.each([
    [1299, 1299], ['1299', 1299], ['1,299', 1299], ['Rs.1,299', 1299], ['Rs. 1,299.00', 1299],
    ['₹1,299', 1299], ['INR 4000', 4000], ['15%', 15],
  ])('%j → %d', (input, expected) => expect(parseAmount(input)).toBe(expected))

  it.each([['abc'], [''], ['12 34'], [null], [undefined], ['-5']])('%j → NaN', (input) => {
    expect(parseAmount(input)).toBeNaN()
  })
})

describe('validateRule', () => {
  const base = { ruleId: 'R-1', scope: 'brand', appliesTo: 'Natura Casa', type: 'flat', value: 150, stackable: false }

  it('normalises a valid rule', () => {
    expect(validateRule({ ...base, scope: ' Brand ', type: 'FLAT', stackable: 'yes' }).rule).toEqual({
      ...base, stackable: true, minCartValue: 0,
    })
  })

  it('drops applies_to on cart rules and keeps the threshold', () => {
    const { rule } = validateRule({ ...base, scope: 'cart', appliesTo: 'ignored', minCartValue: 'Rs.5,000' })
    expect(rule.appliesTo).toBe('')
    expect(rule.minCartValue).toBe(5000)
  })

  it.each([
    [{ value: 0 }, /value must be a positive number/],
    [{ value: undefined }, /value is missing/],
    [{ type: 'percentage', value: 101 }, /cannot exceed 100%/],
    [{ appliesTo: '' }, /applies_to is required/],
    [{ scope: 'category' }, /scope must be one of/],
    [{ type: 'bogo' }, /type must be percentage or flat/],
    [{ stackable: 'maybe' }, /stackable must be true or false/],
    [{ minCartValue: 2000 }, /only applies to cart rules/],
  ])('rejects %j', (overrides, message) => {
    const { rule, errors } = validateRule({ ...base, ...overrides })
    expect(rule).toBeNull()
    expect(errors.join(' ')).toMatch(message)
  })

  it('rejects non-objects without throwing', () => {
    expect(validateRule(null).errors).toEqual(['rule is empty'])
    expect(validateRule('20% off').errors).toEqual(['rule is empty'])
  })
})

describe('validateCartItem', () => {
  it('lists every missing field at once', () => {
    const { item, errors } = validateCartItem({ itemId: 'I', product: 'P' })
    expect(item).toBeNull()
    expect(errors).toEqual(['missing brand, platform, base_price'])
  })
})

describe('nextId', () => {
  it('continues the highest existing number', () => {
    expect(nextId(['RULE-01', 'RULE-04', 'RULE-02'], 'RULE')).toBe('RULE-05')
    expect(nextId([], 'RULE')).toBe('RULE-01')
    expect(nextId(['custom', 'RULE-9'], 'RULE')).toBe('RULE-10')
  })
})
