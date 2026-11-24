/**
 * Chooses which LLM reads rule descriptions, based on the keys the server has:
 * Claude when ANTHROPIC_API_KEY is set, otherwise Groq's free tier when
 * GROQ_API_KEY is set (GROQ_MODEL overrides the model). Returns null when
 * neither key is set.
 */

import { parseRuleWithClaude, MODEL as CLAUDE_MODEL } from './ruleParser.js'
import { parseRuleWithGroq, GROQ_DEFAULT_MODEL } from './groqParser.js'

export function pickParser(env = process.env) {
  if (env.ANTHROPIC_API_KEY) {
    return { model: CLAUDE_MODEL, parse: (input) => parseRuleWithClaude(input) }
  }
  if (env.GROQ_API_KEY) {
    const model = env.GROQ_MODEL || GROQ_DEFAULT_MODEL
    return { model, parse: (input) => parseRuleWithGroq(input, { apiKey: env.GROQ_API_KEY, model }) }
  }
  return null
}
