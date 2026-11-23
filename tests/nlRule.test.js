import { readFileSync } from 'node:fs'
import { describe, it, expect } from 'vitest'
import Anthropic from '@anthropic-ai/sdk'
import { interpretParsedRule, knownNames } from '../src/inputs/nlRule.js'
import { parseRulesCSV, parseCartCSV } from '../src/inputs/csv.js'
import { calculateCart } from '../src/engine/discountEngine.js'
import {
  parseRuleWithClaude, readRequest, buildUserMessage, RuleParserError, PARSED_RULE_SCHEMA, MODEL,
} from '../api/_lib/ruleParser.js'

const sample = (f) => readFileSync(new URL(`../sample-data/${f}`, import.meta.url), 'utf8')
const rules = parseRulesCSV(sample('rules.csv')).data
const cartItems = parseCartCSV(sample('cart.csv')).data
const ctx = { rules, cartItems }

// What Claude returns for the brief's examples (shape fixed by PARSED_RULE_SCHEMA).
const parsed = (overrides) => ({
  status: 'ok', scope: 'brand', appliesTo: 'Natura Casa', discountType: 'percentage', value: 20,
  stackable: false, minCartValue: 0, assumptions: [], message: '', ...overrides,
})

describe('interpretParsedRule — the brief’s examples', () => {
  it('"20% off for Natura Casa brand, stackable with other offers"', () => {
    const r = interpretParsedRule(parsed({ stackable: true }), ctx)
    expect(r.kind).toBe('ready')
    expect(r.rule).toEqual({
      ruleId: 'RULE-05', scope: 'brand', appliesTo: 'Natura Casa', type: 'percentage',
      value: 20, stackable: true, minCartValue: 0,
    })
  })

  it('"Rs.100 flat discount on all Flipkart items"', () => {
    const r = interpretParsedRule(
      parsed({ scope: 'platform', appliesTo: 'flipkart', discountType: 'flat', value: 100,
        assumptions: ['Not stated as stackable, so it does not stack.'] }),
      ctx
    )
    expect(r.kind).toBe('ready')
    expect(r.rule).toMatchObject({ scope: 'platform', appliesTo: 'Flipkart', type: 'flat', value: 100, stackable: false })
    expect(r.assumptions).toEqual(['Not stated as stackable, so it does not stack.'])
  })

  it('"10% off if cart value is more than Rs.5,000"', () => {
    const r = interpretParsedRule(parsed({ scope: 'cart', appliesTo: '', value: 10, minCartValue: 5000 }), ctx)
    expect(r.kind).toBe('ready')
    expect(r.rule).toMatchObject({ scope: 'cart', appliesTo: '', type: 'percentage', value: 10, minCartValue: 5000 })
  })

  it('"Give a discount for big orders" → ask the user to be specific', () => {
    const r = interpretParsedRule(
      parsed({ status: 'ambiguous', scope: 'cart', appliesTo: '', discountType: 'unknown', value: 0,
        message: 'How much is the discount, and what cart value counts as a big order?' }),
      ctx
    )
    expect(r).toEqual({ kind: 'clarify', message: 'How much is the discount, and what cart value counts as a big order?' })
  })
})

describe('interpretParsedRule — never trusts the LLM blindly', () => {
  it.each([
    ['a percentage above 100', { value: 150 }, /cannot exceed 100%/],
    ['a zero value', { value: 0 }, /value must be a positive number/],
    ['a brand rule with no brand', { appliesTo: '' }, /applies_to is required/],
    // Rejected rather than dropped: dropping the threshold would make the offer unconditional.
    ['a cart threshold on a brand rule', { minCartValue: 2000 }, /only applies to cart rules/],
    ['a negative threshold', { scope: 'cart', appliesTo: '', minCartValue: -1 }, /non-negative/],
  ])('Claude says "ok" but returns %s', (_, overrides, message) => {
    const r = interpretParsedRule(parsed(overrides), ctx)
    expect(r.kind).toBe('invalid')
    expect(r.errors.join(' ')).toMatch(message)
  })

  it('treats "ok" with unknown fields as needing clarification', () => {
    expect(interpretParsedRule(parsed({ discountType: 'unknown' }), ctx).kind).toBe('clarify')
  })

  it.each([[null], ['20% off'], [{}], [{ status: 'maybe' }]])('rejects malformed output %j without crashing', (bad) => {
    expect(interpretParsedRule(bad, ctx).kind).toBe('invalid')
  })

  it('passes "unsupported" explanations through', () => {
    const r = interpretParsedRule(parsed({ status: 'unsupported', message: 'Buy-one-get-one isn’t supported.' }), ctx)
    expect(r).toEqual({ kind: 'unsupported', message: 'Buy-one-get-one isn’t supported.' })
  })

  it('warns when the rule matches nothing in the cart, and on duplicates', () => {
    const myntra = interpretParsedRule(parsed({ scope: 'platform', appliesTo: 'Myntra' }), ctx)
    expect(myntra.warnings[0]).toMatch(/No item in the current cart has platform “Myntra”/)

    const dup = interpretParsedRule(parsed({ appliesTo: 'natura casa', discountType: 'flat', value: 150 }), ctx)
    expect(dup.warnings).toContain('This is identical to RULE-02.')
  })
})

describe('end to end: a confirmed rule re-runs the engine with accurate reasoning', () => {
  it('adding "20% off Natura Casa, stackable" changes ITEM-01 and ITEM-02', () => {
    const { rule } = interpretParsedRule(parsed({ stackable: true }), ctx)
    const after = calculateCart(cartItems, [...rules, rule])
    const item1 = after.items.find((i) => i.itemId === 'ITEM-01')
    // RULE-01 still wins (Rs.195 > Rs.150) → Rs.1,104, then 20% stacks → Rs.883
    expect(item1.finalPrice).toBe(883)
    expect(item1.reasoning).toBe('Platform offer: 15% off (better than Brand offer: Rs.150 off) + Brand offer: 20% off')
    expect(item1.appliedRules).toEqual(['RULE-01', 'RULE-05'])
  })
})

describe('knownNames', () => {
  it('collects brands and platforms from the cart and from rules', () => {
    const names = knownNames(rules, [])
    expect(names).toEqual({ knownBrands: ['Natura Casa'], knownPlatforms: ['Amazon India', 'Flipkart'] })
  })
})

// ── Server side ───────────────────────────────────────────────────

const fakeClient = (responseOrError) => ({
  beta: {
    messages: {
      create: async (params) => {
        fakeClient.lastParams = params
        if (responseOrError instanceof Error) throw responseOrError
        return responseOrError
      },
    },
  },
})
const reply = (text, stop_reason = 'end_turn') => ({ stop_reason, content: [{ type: 'text', text }] })

describe('parseRuleWithClaude', () => {
  const input = { text: '20% off Natura Casa', knownBrands: ['Natura Casa'], knownPlatforms: [] }

  it('sends the schema-constrained request and returns the parsed JSON', async () => {
    const out = await parseRuleWithClaude(input, fakeClient(reply(JSON.stringify(parsed()))))
    expect(out).toEqual(parsed())
    const p = fakeClient.lastParams
    expect(p.model).toBe(MODEL)
    expect(p.output_config.format).toEqual({ type: 'json_schema', schema: PARSED_RULE_SCHEMA })
    expect(p.messages[0].content).toContain('<rule>\n20% off Natura Casa\n</rule>')
  })

  it.each([
    ['a refusal', reply('', 'refusal'), 'LLM_REFUSED'],
    ['a truncated reply', reply('{"status":', 'max_tokens'), 'LLM_TRUNCATED'],
    ['non-JSON text', reply('Sure! Here is your rule'), 'LLM_BAD_OUTPUT'],
    ['no text block', { stop_reason: 'end_turn', content: [] }, 'LLM_BAD_OUTPUT'],
  ])('turns %s into a clear error', async (_, response, code) => {
    await expect(parseRuleWithClaude(input, fakeClient(response))).rejects.toMatchObject({ code })
  })

  it('maps a bad API key to a configuration error', async () => {
    const err = new Anthropic.AuthenticationError(401, { type: 'error' }, 'invalid x-api-key', new Headers())
    await expect(parseRuleWithClaude(input, fakeClient(err))).rejects.toBeInstanceOf(RuleParserError)
    await expect(parseRuleWithClaude(input, fakeClient(err))).rejects.toMatchObject({ code: 'LLM_NOT_CONFIGURED', status: 503 })
  })
})

describe('readRequest', () => {
  it('rejects empty and over-long text', () => {
    expect(readRequest({ text: '   ' }).error).toMatch(/Describe the discount rule/)
    expect(readRequest({ text: 'x'.repeat(501) }).error).toMatch(/under 500 characters/)
    expect(readRequest(null).error).toBeTruthy()
  })

  it('cleans the known-name lists', () => {
    const { input } = readRequest({ text: 'hi', knownBrands: [' A ', 'A', 42, ''], knownPlatforms: 'nope' })
    expect(input).toEqual({ text: 'hi', knownBrands: ['A'], knownPlatforms: [] })
    expect(buildUserMessage(input)).toContain('Known platforms: (none loaded)')
  })
})
