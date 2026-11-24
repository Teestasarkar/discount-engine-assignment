/**
 * groqParser.js: the same rule reading as parseRuleWithClaude, done through
 * Groq's API. The live demo uses it because Groq has a free tier.
 *
 * It uses the same prompt, the same JSON schema and the same error codes as
 * the Claude path, so the browser can't tell which provider answered, and the
 * answer goes through the same validateRule gate either way.
 *
 * Calls Groq's OpenAI-compatible REST endpoint with plain fetch: one request
 * shape, no extra dependency.
 */

import { SYSTEM_PROMPT, PARSED_RULE_SCHEMA, buildUserMessage, RuleParserError } from './ruleParser.js'

export const GROQ_DEFAULT_MODEL = 'openai/gpt-oss-120b'
const ENDPOINT = 'https://api.groq.com/openai/v1/chat/completions'
const TIMEOUT_MS = 25_000 // stays inside the function's 30s limit (vercel.json)
const MAX_RETRY_WAIT_MS = 8_000

export function buildGroqRequest(input, model) {
  return {
    model,
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: buildUserMessage(input) },
    ],
    // Strict mode constrains decoding to the schema, so the reply always has this shape.
    response_format: {
      type: 'json_schema',
      json_schema: { name: 'discount_rule', strict: true, schema: PARSED_RULE_SCHEMA },
    },
    // Short extraction with a person waiting: think briefly, return only the answer.
    reasoning_effort: 'low',
    include_reasoning: false,
    max_completion_tokens: 2048,
  }
}

/** How long to wait before the one retry, or null when retrying won't help. */
function retryDelay(res, serverErrorDelayMs) {
  if (res.status === 500 || res.status === 502 || res.status === 503) return serverErrorDelayMs
  if (res.status === 429) {
    // The free tier's per-minute limits clear in seconds and are worth waiting
    // out; a long retry-after means the daily quota is gone.
    const seconds = Number(res.headers?.get?.('retry-after'))
    if (Number.isFinite(seconds) && seconds >= 0 && seconds * 1000 <= MAX_RETRY_WAIT_MS) return seconds * 1000
  }
  return null
}

function httpError(status, payload) {
  const message = payload?.error?.message ?? ''
  if (status === 401 || status === 403) {
    return new RuleParserError('LLM_NOT_CONFIGURED', 'The rule parser’s API key was rejected. Check GROQ_API_KEY.', 503)
  }
  if (status === 429 || status === 498) {
    return new RuleParserError(
      'LLM_BUSY',
      'The rule parser hit its free-tier usage limit. Try again in a minute; if it keeps happening, today’s quota is used up.',
      429
    )
  }
  if (status === 400 && /does not match the expected schema|json_validate_failed/i.test(message)) return badOutput()
  return new RuleParserError('LLM_ERROR', `The rule parser failed (${status}). Try again.`, 502)
}

const badOutput = () =>
  new RuleParserError('LLM_BAD_OUTPUT', 'The rule parser returned something that isn’t a rule. Try again.', 502)

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * Asks Groq to read one rule description. `fetchImpl` and `sleep` are
 * injectable for tests. Returns the object described by PARSED_RULE_SCHEMA.
 */
export async function parseRuleWithGroq(
  input,
  { apiKey, model = GROQ_DEFAULT_MODEL, fetchImpl = fetch, sleep = wait, serverErrorDelayMs = 400 } = {}
) {
  const signal = AbortSignal.timeout(TIMEOUT_MS) // one deadline for both attempts
  const send = () =>
    fetchImpl(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify(buildGroqRequest(input, model)),
      signal,
    })

  let res, payload
  try {
    res = await send()
    const delay = retryDelay(res, serverErrorDelayMs)
    if (delay !== null) {
      await sleep(delay)
      res = await send()
    }
    payload = await res.json().catch(() => null)
  } catch (err) {
    if (err?.name === 'TimeoutError' || err?.name === 'AbortError') {
      throw new RuleParserError('LLM_TIMEOUT', 'The rule parser took too long to answer. Try again.', 504)
    }
    throw new RuleParserError('LLM_ERROR', 'The rule parser could not be reached. Try again.', 502)
  }

  if (!res.ok) throw httpError(res.status, payload)

  const choice = payload?.choices?.[0]
  if (!choice) throw badOutput()
  if (choice.finish_reason === 'length') {
    throw new RuleParserError('LLM_TRUNCATED', 'The rule parser’s answer was cut off. Try a shorter description.', 502)
  }
  if (choice.finish_reason === 'content_filter' || choice.message?.refusal) {
    throw new RuleParserError('LLM_REFUSED', 'The rule parser declined this text. Rephrase it as a discount rule.', 422)
  }
  try {
    return JSON.parse(choice.message?.content ?? '')
  } catch {
    throw badOutput()
  }
}
