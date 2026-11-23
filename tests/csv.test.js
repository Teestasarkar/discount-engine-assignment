import { readFileSync } from 'node:fs'
import { describe, it, expect } from 'vitest'
import { parseRulesCSV, parseCartCSV } from '../src/inputs/csv.js'

const sample = (f) => readFileSync(new URL(`../sample-data/${f}`, import.meta.url), 'utf8')

describe('parseRulesCSV', () => {
  it('loads all four sample rules, including the cart rule', () => {
    const { data, errors } = parseRulesCSV(sample('rules.csv'))
    expect(errors).toEqual([])
    expect(data.map((r) => r.ruleId)).toEqual(['RULE-01', 'RULE-02', 'RULE-03', 'RULE-04'])
    expect(data[3]).toEqual({
      ruleId: 'RULE-04', scope: 'cart', appliesTo: '', type: 'percentage',
      value: 10, stackable: false, minCartValue: 4000,
    })
  })

  it('still accepts the original 6-column format (no min_cart_value)', () => {
    const csv = 'rule_id,scope,applies_to,type,value,stackable\r\nRULE-01,platform,Amazon India,percentage,15,false\r\n'
    const { data, errors } = parseRulesCSV(csv)
    expect(errors).toEqual([])
    expect(data[0].minCartValue).toBe(0)
  })

  it('reports bad rows with their row number and keeps the good ones', () => {
    const csv = [
      'rule_id,scope,applies_to,type,value,stackable,min_cart_value',
      'RULE-01,platform,Amazon India,percentage,15,false,',
      'RULE-02,category,Home,percentage,15,false,',
      'RULE-03,brand,Natura Casa,percentage,150,false,',
      'RULE-04,brand,Natura Casa,flat,100,false,2000',
    ].join('\n')
    const { data, errors } = parseRulesCSV(csv)
    expect(data.map((r) => r.ruleId)).toEqual(['RULE-01'])
    expect(errors).toHaveLength(3)
    expect(errors[0]).toMatch(/^Row 3: scope must be one of brand, platform, cart/)
    expect(errors[1]).toMatch(/^Row 4: a percentage discount cannot exceed 100%/)
    expect(errors[2]).toMatch(/^Row 5: min_cart_value only applies to cart rules/)
  })

  it('names a missing column instead of failing every row', () => {
    const { data, errors } = parseRulesCSV('rule_id,scope,type,value,stackable\nR,brand,flat,1,false')
    expect(data).toEqual([])
    expect(errors).toEqual(['Missing column(s): applies_to'])
  })
})

describe('parseCartCSV', () => {
  it('loads the six sample items', () => {
    const { data, errors } = parseCartCSV(sample('cart.csv'))
    expect(errors).toEqual([])
    expect(data).toHaveLength(6)
    expect(data[0]).toEqual({
      itemId: 'ITEM-01', product: 'Cushion Cover', brand: 'Natura Casa',
      platform: 'Amazon India', basePrice: 1299,
    })
  })

  it('accepts formatted prices and rejects non-numeric ones', () => {
    const csv = 'item_id,product,brand,platform,base_price\nA,P,B,X,"Rs.1,299"\nB,P,B,X,abc\n'
    const { data, errors } = parseCartCSV(csv)
    expect(data.map((i) => i.basePrice)).toEqual([1299])
    expect(errors).toEqual(['Row 3: base_price must be a positive amount (got "abc")'])
  })
})
