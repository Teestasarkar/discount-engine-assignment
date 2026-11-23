/**
 * App.jsx
 *
 * Top-level component. Holds the session state (rules + cart) and wires the
 * input adapters to the engine and the results view. Results are derived from
 * the current rules and cart, so any change (a new rule, a new cart) re-runs
 * the engine automatically once the first calculation has been requested.
 */

import { useMemo, useState } from 'react'
import CsvUploader from './components/CsvUploader.jsx'
import DataTable from './components/DataTable.jsx'
import ErrorBanner from './components/ErrorBanner.jsx'
import CartSummary from './components/CartSummary.jsx'
import NlRuleInput from './components/NlRuleInput.jsx'
import { parseRulesCSV, parseCartCSV } from './inputs/csv.js'
import { calculateCart } from './engine/discountEngine.js'
import { nextId } from './engine/schema.js'

// ── Column definitions ───────────────────────────────────────────

const capitalise = (v) => v.charAt(0).toUpperCase() + v.slice(1)

const rulesColumns = (onRemove) => [
  {
    key: 'ruleId',
    label: 'Rule ID',
    render: (v, row) => (
      <span style={{ whiteSpace: 'nowrap' }} title={row.sourceText ? `Added from: “${row.sourceText}”` : undefined}>
        {v}
        {row.source === 'ai' && (
          <span style={{ marginLeft: 5, fontSize: 9, fontWeight: 700, color: '#1a3d8f', background: '#e6edff', borderRadius: 10, padding: '1px 5px' }}>
            AI
          </span>
        )}
      </span>
    ),
  },
  { key: 'scope',     label: 'Scope',      render: capitalise },
  { key: 'appliesTo', label: 'Applies To', render: (v, row) => (row.scope === 'cart' ? 'Entire cart' : v) },
  { key: 'type',      label: 'Type',       render: capitalise },
  {
    key: 'value',
    label: 'Value',
    render: (v, row) => row.type === 'percentage' ? `${v}% off` : `Rs.${v.toLocaleString('en-IN')} off`,
  },
  {
    key: 'minCartValue',
    label: 'Condition',
    render: (v, row) => (row.scope === 'cart' && v > 0 ? `Cart ≥ Rs.${v.toLocaleString('en-IN')}` : '—'),
  },
  { key: 'stackable', label: 'Stackable',  render: (v) => (v ? 'Yes' : 'No') },
  {
    key: 'remove',
    label: '',
    render: (_, row) => (
      <button
        onClick={() => onRemove(row.ruleId)}
        title={`Remove ${row.ruleId}`}
        aria-label={`Remove ${row.ruleId}`}
        style={{ border: 'none', background: 'none', color: '#999', cursor: 'pointer', fontSize: 14, padding: 0 }}
      >
        ×
      </button>
    ),
  },
]

const CART_COLUMNS = [
  { key: 'itemId',    label: 'Item' },
  { key: 'product',   label: 'Product' },
  { key: 'brand',     label: 'Brand' },
  { key: 'platform',  label: 'Platform' },
  { key: 'basePrice', label: 'Base Price', render: (v) => `Rs.${v.toLocaleString('en-IN')}` },
]

// ── Styles ───────────────────────────────────────────────────────

const S = {
  page:    { minHeight: '100vh', background: '#f7f7f9', fontFamily: 'Arial, sans-serif' },
  header:  { background: '#131A48', padding: '0.85rem 2rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between' },
  logoTxt: { fontFamily: 'Georgia, serif', fontSize: 17, fontWeight: 700, color: '#fff', letterSpacing: '-0.02em' },
  logoSpan:{ color: '#FF5800' },
  headerSub: { fontSize: 11, color: 'rgba(255,255,255,0.5)', textTransform: 'uppercase', letterSpacing: '0.07em' },
  main:    { maxWidth: 1040, margin: '0 auto', padding: '1.8rem 1.5rem' },
  section: { background: '#fff', border: '1px solid #CECECE', borderRadius: 6, padding: '1.2rem 1.4rem', marginBottom: '1.2rem', minWidth: 0 },
  sectionTitle: { fontFamily: 'Georgia, serif', fontWeight: 700, fontSize: 14, color: '#131A48', marginBottom: '0.7rem', paddingBottom: 6, borderBottom: '2px solid #FF5800', display: 'inline-block' },
  btn:     {
    background: '#FF5800', color: '#fff', border: 'none', borderRadius: 4,
    padding: '0.65rem 2rem', fontSize: 13, fontWeight: 700, cursor: 'pointer',
    letterSpacing: '0.04em', textTransform: 'uppercase',
  },
  btnDisabled: {
    background: '#CECECE', color: '#fff', border: 'none', borderRadius: 4,
    padding: '0.65rem 2rem', fontSize: 13, fontWeight: 700, cursor: 'not-allowed',
    letterSpacing: '0.04em', textTransform: 'uppercase',
  },
  muted: { fontSize: 11, color: '#888', marginBottom: 4 },
}

// ── Component ────────────────────────────────────────────────────

export default function App() {
  const [rules, setRules]           = useState([])
  const [rulesErrors, setRulesErr]  = useState([])
  const [rulesFileName, setRulesFileName] = useState('')

  const [cartItems, setCartItems]   = useState([])
  const [cartErrors, setCartErrors] = useState([])
  const [cartFileName, setCartFileName]   = useState('')

  // Results appear after the first "Calculate" click and then stay live.
  const [showResults, setShowResults] = useState(false)

  const summary = useMemo(
    () => (showResults ? calculateCart(cartItems, rules) : null),
    [showResults, cartItems, rules]
  )

  // ── Handlers ──

  function handleRulesLoad(csvText, fileName) {
    const { data, errors } = parseRulesCSV(csvText)
    setRules(data)
    setRulesErr(errors)
    setRulesFileName(fileName)
  }

  function handleCartLoad(csvText, fileName) {
    const { data, errors } = parseCartCSV(csvText)
    setCartItems(data)
    setCartErrors(errors)
    setCartFileName(fileName)
  }

  // Confirmed natural-language rule: add it and show the re-run results.
  function handleAddRule(rule) {
    setRules((prev) => {
      const ids = prev.map((r) => r.ruleId)
      const ruleId = ids.includes(rule.ruleId) ? nextId(ids, 'RULE') : rule.ruleId
      return [...prev, { ...rule, ruleId }]
    })
    if (cartItems.length > 0) setShowResults(true)
  }

  function handleRemoveRule(ruleId) {
    setRules((prev) => prev.filter((r) => r.ruleId !== ruleId))
  }

  const canCalculate = rules.length > 0 && cartItems.length > 0

  // ── Render ──

  return (
    <div style={S.page}>
      {/* Header */}
      <div style={S.header}>
        <div style={S.logoTxt}>O<span style={S.logoSpan}>pp</span>tra</div>
        <div style={S.headerSub}>Discount Engine</div>
      </div>

      <div style={S.main}>

        {/* Upload row */}
        <div className="grid2">
          {/* Rules upload */}
          <div style={S.section}>
            <div style={S.sectionTitle}>Discount Rules</div>
            <CsvUploader
              label="rules.csv"
              description="Upload your discount rules CSV"
              onLoad={handleRulesLoad}
              hasData={rules.length > 0}
              fileName={rulesFileName}
            />
            <ErrorBanner errors={rulesErrors} />

            <div style={{ marginTop: '0.9rem' }}>
              <div style={{ ...S.muted, fontWeight: 700, color: '#131A48' }}>…or describe a rule in plain English</div>
              <NlRuleInput rules={rules} cartItems={cartItems} onAddRule={handleAddRule} />
            </div>

            {rules.length > 0 && (
              <div style={{ marginTop: '0.9rem' }}>
                <div style={S.muted}>{rules.length} rule{rules.length > 1 ? 's' : ''} active</div>
                <DataTable columns={rulesColumns(handleRemoveRule)} rows={rules} />
              </div>
            )}
          </div>

          {/* Cart upload */}
          <div style={S.section}>
            <div style={S.sectionTitle}>Cart Items</div>
            <CsvUploader
              label="cart.csv"
              description="Upload your cart CSV"
              onLoad={handleCartLoad}
              hasData={cartItems.length > 0}
              fileName={cartFileName}
            />
            <ErrorBanner errors={cartErrors} />
            {cartItems.length > 0 && (
              <div style={{ marginTop: '0.75rem' }}>
                <div style={S.muted}>{cartItems.length} item{cartItems.length > 1 ? 's' : ''} loaded</div>
                <DataTable columns={CART_COLUMNS} rows={cartItems} />
              </div>
            )}
          </div>
        </div>

        {/* Calculate button */}
        {!summary && (
          <div style={{ textAlign: 'center', marginBottom: '1.2rem' }}>
            <button
              style={canCalculate ? S.btn : S.btnDisabled}
              onClick={() => setShowResults(true)}
              disabled={!canCalculate}
            >
              Calculate Discounts
            </button>
            {!canCalculate && (
              <div style={{ fontSize: 11, color: '#888', marginTop: 6 }}>
                Load rules and a cart to calculate
              </div>
            )}
          </div>
        )}

        {/* Results */}
        {summary && (
          <div style={S.section}>
            <div style={S.sectionTitle}>Cart Summary</div>
            <CartSummary summary={summary} />
          </div>
        )}

      </div>
    </div>
  )
}
