/**
 * POST /api/parse-rule
 *
 * Body:     { text: string, knownBrands?: string[], knownPlatforms?: string[] }
 * Response: { ok: true, parsed, model } | { ok: false, error, message }
 *
 * A server exists only to keep ANTHROPIC_API_KEY out of the browser bundle;
 * all pricing and rule validation stay client-side. Runs as a Vercel
 * function in production and through the Vite dev middleware locally
 * (see vite.config.js), so it sticks to plain Node req/res.
 */

import { readRequest, parseRuleWithClaude, RuleParserError, MODEL } from './_lib/ruleParser.js'

function send(res, status, payload) {
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json')
  res.setHeader('Cache-Control', 'no-store')
  res.end(JSON.stringify(payload))
}

async function readJsonBody(req) {
  if (req.body !== undefined) {
    return typeof req.body === 'string' ? JSON.parse(req.body) : req.body
  }
  let raw = ''
  for await (const chunk of req) {
    raw += chunk
    if (raw.length > 10_000) throw new Error('body too large')
  }
  return raw ? JSON.parse(raw) : {}
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST')
    return send(res, 405, { ok: false, error: 'METHOD_NOT_ALLOWED', message: 'Use POST.' })
  }

  let body
  try {
    body = await readJsonBody(req)
  } catch {
    return send(res, 400, { ok: false, error: 'BAD_REQUEST', message: 'Request body must be JSON.' })
  }

  const { input, error } = readRequest(body)
  if (error) return send(res, 400, { ok: false, error: 'BAD_REQUEST', message: error })

  if (!process.env.ANTHROPIC_API_KEY) {
    return send(res, 503, {
      ok: false,
      error: 'LLM_NOT_CONFIGURED',
      message: 'Natural-language rules are off: ANTHROPIC_API_KEY is not set on the server.',
    })
  }

  try {
    const parsed = await parseRuleWithClaude(input)
    return send(res, 200, { ok: true, parsed, model: MODEL })
  } catch (err) {
    if (err instanceof RuleParserError) {
      return send(res, err.status, { ok: false, error: err.code, message: err.message })
    }
    console.error('parse-rule failed', err)
    return send(res, 500, { ok: false, error: 'INTERNAL', message: 'Something went wrong parsing the rule.' })
  }
}
