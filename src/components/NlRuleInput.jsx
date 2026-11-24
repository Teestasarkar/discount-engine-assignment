/**
 * NlRuleInput.jsx
 *
 * "Describe a rule in plain English" → parsed by an LLM → confirmation step →
 * onAddRule(rule). Shows the parsed fields, the LLM's assumptions, warnings
 * and the effect on the current cart before anything is added.
 */

import { useRef, useState } from 'react'
import { requestRuleParse, interpretParsedRule, knownNames } from '../inputs/nlRule.js'
import { calculateCart, describeRule } from '../engine/discountEngine.js'

const EXAMPLES = [
  '20% off for Natura Casa brand, stackable with other offers',
  'Rs.100 flat discount on all Flipkart items',
  '10% off if cart value is more than Rs.5,000',
  'Give a discount for big orders',
]

const rupees = (n) => `Rs.${n.toLocaleString('en-IN')}`

const box = (border, bg) => ({
  border: `1px solid ${border}`, borderLeft: `3px solid ${border}`, background: bg,
  borderRadius: 4, padding: '0.7rem 0.9rem', marginTop: '0.75rem', fontSize: 12, color: '#131A48',
})
const btn = (bg, color = '#fff') => ({
  background: bg, color, border: bg === '#fff' ? '1px solid #CECECE' : 'none', borderRadius: 4,
  padding: '0.5rem 1rem', fontSize: 12, fontWeight: 700, cursor: 'pointer',
})

function Field({ label, value }) {
  return (
    <div>
      <div style={{ fontSize: 10, color: '#888', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{label}</div>
      <div style={{ fontWeight: 700, fontSize: 13 }}>{value}</div>
    </div>
  )
}

function ConfirmCard({ result, rules, cartItems, onConfirm, onDiscard }) {
  const { rule, assumptions, warnings } = result
  const capital = (s) => s.charAt(0).toUpperCase() + s.slice(1)

  let impact = 'No cart is loaded yet — the rule will apply when you load one.'
  if (cartItems.length > 0) {
    const before = calculateCart(cartItems, rules).total
    const after = calculateCart(cartItems, [...rules, rule]).total
    impact =
      before === after
        ? `Current cart total stays at ${rupees(before)}.`
        : `Current cart total: ${rupees(before)} → ${rupees(after)}.`
  }

  return (
    <div style={box('#1a3d8f', '#f3f6ff')} data-testid="nl-confirm">
      <div style={{ fontWeight: 700, marginBottom: 8 }}>Check this rule before adding it</div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(110px, 1fr))', gap: '0.6rem' }}>
        <Field label="Rule ID" value={rule.ruleId} />
        <Field label="Scope" value={capital(rule.scope)} />
        {rule.scope !== 'cart' && <Field label="Applies to" value={rule.appliesTo} />}
        <Field label="Type" value={capital(rule.type)} />
        <Field label="Value" value={rule.type === 'percentage' ? `${rule.value}%` : rupees(rule.value)} />
        {rule.scope === 'cart' && (
          <Field label="Min cart value" value={rule.minCartValue > 0 ? rupees(rule.minCartValue) : 'None'} />
        )}
        <Field label="Stackable" value={rule.stackable ? 'Yes' : 'No'} />
      </div>
      <div style={{ marginTop: 8, color: '#444' }}>
        Customers will see: <strong>{describeRule(rule)}</strong>
      </div>

      {assumptions.length > 0 && (
        <ul style={{ margin: '8px 0 0', paddingLeft: 18, color: '#555' }}>
          {assumptions.map((a, i) => <li key={i}>Assumed: {a}</li>)}
        </ul>
      )}
      {warnings.map((w, i) => (
        <div key={i} style={{ marginTop: 6, color: '#8a4b00', fontWeight: 600 }}>⚠ {w}</div>
      ))}

      <div style={{ marginTop: 8, fontWeight: 600 }}>{impact}</div>

      <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
        <button style={btn('#1e5c2c')} onClick={onConfirm}>Add rule &amp; recalculate</button>
        <button style={btn('#fff', '#131A48')} onClick={onDiscard}>Discard</button>
      </div>
    </div>
  )
}

export default function NlRuleInput({ rules, cartItems, onAddRule }) {
  const [text, setText] = useState('')
  const [phase, setPhase] = useState('idle') // idle | parsing | done | error
  const [result, setResult] = useState(null)
  const [error, setError] = useState('')
  const abortRef = useRef(null)

  async function handleSubmit(e) {
    e.preventDefault()
    const trimmed = text.trim()
    if (!trimmed || phase === 'parsing') return

    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller

    setPhase('parsing')
    setResult(null)
    setError('')
    try {
      const parsed = await requestRuleParse(trimmed, knownNames(rules, cartItems), { signal: controller.signal })
      setResult(interpretParsedRule(parsed, { rules, cartItems }))
      setPhase('done')
    } catch (err) {
      if (err.name === 'AbortError') return
      setError(err.message)
      setPhase('error')
    }
  }

  function reset() {
    setResult(null)
    setPhase('idle')
  }

  function confirm() {
    onAddRule({ ...result.rule, source: 'ai', sourceText: text.trim() })
    setText('')
    reset()
  }

  const parsing = phase === 'parsing'

  return (
    <div>
      <form onSubmit={handleSubmit} style={{ display: 'flex', gap: 8 }}>
        <input
          type="text"
          value={text}
          maxLength={500}
          onChange={(e) => setText(e.target.value)}
          placeholder="e.g. 15% off all Nordic Basics products"
          aria-label="Describe a discount rule"
          disabled={parsing}
          style={{
            flex: 1, minWidth: 0, padding: '0.55rem 0.7rem', fontSize: 13, border: '1px solid #CECECE',
            borderRadius: 4, fontFamily: 'inherit',
          }}
        />
        <button type="submit" disabled={!text.trim() || parsing} style={{ ...btn(!text.trim() || parsing ? '#CECECE' : '#FF5800'), whiteSpace: 'nowrap' }}>
          {parsing ? 'Reading…' : 'Parse rule'}
        </button>
      </form>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
        {EXAMPLES.map((ex) => (
          <button
            key={ex}
            type="button"
            disabled={parsing}
            onClick={() => { setText(ex); reset() }}
            style={{
              fontSize: 11, padding: '3px 9px', borderRadius: 20, border: '1px solid #d6dbf0',
              background: '#f7f8fd', color: '#131A48', cursor: 'pointer',
            }}
          >
            {ex}
          </button>
        ))}
      </div>

      {phase === 'error' && (
        <div style={box('#c0392b', '#fce8e8')}>
          <strong>Couldn’t parse that.</strong> {error}
        </div>
      )}

      {result?.kind === 'clarify' && (
        <div style={box('#d48a00', '#fff8e6')} data-testid="nl-clarify">
          <strong>Need a bit more detail.</strong> {result.message}
          <div style={{ marginTop: 4, color: '#666' }}>Edit the description above and parse again. Nothing was added.</div>
        </div>
      )}

      {result?.kind === 'unsupported' && (
        <div style={box('#888', '#f4f4f4')}>
          <strong>The engine can’t express this rule yet.</strong> {result.message}
        </div>
      )}

      {result?.kind === 'invalid' && (
        <div style={box('#c0392b', '#fce8e8')}>
          <strong>The parsed rule didn’t pass validation, so it was not added.</strong>
          <ul style={{ margin: '4px 0 0', paddingLeft: 18 }}>
            {result.errors.map((e, i) => <li key={i}>{e}</li>)}
          </ul>
          <div style={{ marginTop: 4, color: '#666' }}>Try rephrasing with an explicit amount and target.</div>
        </div>
      )}

      {result?.kind === 'ready' && (
        <ConfirmCard result={result} rules={rules} cartItems={cartItems} onConfirm={confirm} onDiscard={reset} />
      )}
    </div>
  )
}
