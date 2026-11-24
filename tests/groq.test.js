import { describe, it, expect } from 'vitest'
import { parseRuleWithGroq, GROQ_DEFAULT_MODEL } from '../api/_lib/groqParser.js'
import { pickParser } from '../api/_lib/pickParser.js'
import { PARSED_RULE_SCHEMA, SYSTEM_PROMPT, MODEL as CLAUDE_MODEL } from '../api/_lib/ruleParser.js'

const input = { text: '20% off Natura Casa', knownBrands: ['Natura Casa'], knownPlatforms: [] }
const parsed = {
  status: 'ok', scope: 'brand', appliesTo: 'Natura Casa', discountType: 'percentage', value: 20,
  stackable: false, minCartValue: 0, assumptions: [], message: '',
}

/** A fetch stand-in that replays `responses` in order and records each call. */
function fakeFetch(...responses) {
  const calls = []
  const impl = async (url, init) => {
    calls.push({ url, init, body: JSON.parse(init.body) })
    const next = responses[Math.min(calls.length - 1, responses.length - 1)]
    if (next instanceof Error) throw next
    return {
      ok: next.status >= 200 && next.status < 300,
      status: next.status,
      headers: new Headers(next.headers ?? {}),
      json: async () => {
        if (next.body === undefined) throw new SyntaxError('no body')
        return next.body
      },
    }
  }
  impl.calls = calls
  return impl
}
const answer = (content, finish_reason = 'stop', extra = {}) => ({
  status: 200,
  body: { choices: [{ index: 0, message: { role: 'assistant', content, ...extra }, finish_reason }] },
})

function run(fetchImpl) {
  const waits = []
  const promise = parseRuleWithGroq(input, {
    apiKey: 'test-key', fetchImpl, serverErrorDelayMs: 0, sleep: async (ms) => { waits.push(ms) },
  })
  return Object.assign(promise, { waits })
}

describe('parseRuleWithGroq', () => {
  it('sends a strict schema-constrained request and returns the parsed JSON', async () => {
    const f = fakeFetch(answer(JSON.stringify(parsed)))
    expect(await run(f)).toEqual(parsed)

    const { url, init, body } = f.calls[0]
    expect(url).toBe('https://api.groq.com/openai/v1/chat/completions')
    expect(init.headers.Authorization).toBe('Bearer test-key')
    expect(body.model).toBe(GROQ_DEFAULT_MODEL)
    expect(body.messages[0]).toEqual({ role: 'system', content: SYSTEM_PROMPT })
    expect(body.messages[1].content).toContain('<rule>\n20% off Natura Casa\n</rule>')
    expect(body.response_format).toEqual({
      type: 'json_schema',
      json_schema: { name: 'discount_rule', strict: true, schema: PARSED_RULE_SCHEMA },
    })
    expect(body.include_reasoning).toBe(false)
  })

  it.each([
    ['a truncated reply', answer('{"status":', 'length'), 'LLM_TRUNCATED', 502],
    ['a content filter stop', answer('', 'content_filter'), 'LLM_REFUSED', 422],
    ['an explicit refusal', answer(null, 'stop', { refusal: 'I can’t help with that.' }), 'LLM_REFUSED', 422],
    ['non-JSON text', answer('Sure! Here is your rule'), 'LLM_BAD_OUTPUT', 502],
    ['no choices', { status: 200, body: { choices: [] } }, 'LLM_BAD_OUTPUT', 502],
    ['an unreadable body', { status: 200 }, 'LLM_BAD_OUTPUT', 502],
    ['a schema validation failure', {
      status: 400,
      body: { error: { message: 'Generated JSON does not match the expected schema. Please adjust your prompt.', type: 'invalid_request_error' } },
    }, 'LLM_BAD_OUTPUT', 502],
    ['a rejected key', { status: 401, body: { error: { message: 'Invalid API Key', type: 'invalid_request_error' } } }, 'LLM_NOT_CONFIGURED', 503],
    ['a permission error', { status: 403, body: { error: { message: 'Forbidden' } } }, 'LLM_NOT_CONFIGURED', 503],
    ['a used-up daily quota', { status: 429, headers: { 'retry-after': '3600' } }, 'LLM_BUSY', 429],
    ['a 429 without retry-after', { status: 429 }, 'LLM_BUSY', 429],
    ['flex capacity exceeded', { status: 498 }, 'LLM_BUSY', 429],
    ['any other 400', { status: 400, body: { error: { message: 'model does not support json_schema' } } }, 'LLM_ERROR', 502],
  ])('turns %s into a clear error', async (_, response, code, status) => {
    await expect(run(fakeFetch(response))).rejects.toMatchObject({ code, status })
  })

  it('waits out a short per-minute limit and retries once', async () => {
    const f = fakeFetch({ status: 429, headers: { 'retry-after': '2' } }, answer(JSON.stringify(parsed)))
    const p = run(f)
    expect(await p).toEqual(parsed)
    expect(p.waits).toEqual([2000])
    expect(f.calls).toHaveLength(2)
  })

  it('does not wait out a long limit', async () => {
    const f = fakeFetch({ status: 429, headers: { 'retry-after': '60' } }, answer(JSON.stringify(parsed)))
    await expect(run(f)).rejects.toMatchObject({ code: 'LLM_BUSY' })
    expect(f.calls).toHaveLength(1)
  })

  it('retries once on a transient 503, then gives up', async () => {
    const ok = fakeFetch({ status: 503 }, answer(JSON.stringify(parsed)))
    expect(await run(ok)).toEqual(parsed)
    expect(ok.calls).toHaveLength(2)

    const down = fakeFetch({ status: 503 }, { status: 503 })
    await expect(run(down)).rejects.toMatchObject({ code: 'LLM_ERROR', status: 502 })
    expect(down.calls).toHaveLength(2)
  })

  it('maps timeouts and network failures', async () => {
    const timeout = Object.assign(new Error('timed out'), { name: 'TimeoutError' })
    await expect(run(fakeFetch(timeout))).rejects.toMatchObject({ code: 'LLM_TIMEOUT', status: 504 })
    await expect(run(fakeFetch(new TypeError('fetch failed')))).rejects.toMatchObject({ code: 'LLM_ERROR' })
  })
})

describe('pickParser', () => {
  it('returns null when no key is set', () => {
    expect(pickParser({})).toBeNull()
  })

  it('uses Groq with the default model, or GROQ_MODEL', () => {
    expect(pickParser({ GROQ_API_KEY: 'g' }).model).toBe(GROQ_DEFAULT_MODEL)
    expect(pickParser({ GROQ_API_KEY: 'g', GROQ_MODEL: 'openai/gpt-oss-20b' }).model).toBe('openai/gpt-oss-20b')
  })

  it('prefers Claude when an Anthropic key is set', () => {
    expect(pickParser({ GROQ_API_KEY: 'g', ANTHROPIC_API_KEY: 'a' }).model).toBe(CLAUDE_MODEL)
  })
})
