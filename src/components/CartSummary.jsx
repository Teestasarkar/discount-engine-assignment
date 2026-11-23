/**
 * CartSummary.jsx
 *
 * The customer-facing checkout view: per-item final prices, the cart offer
 * line (only when a cart rule's threshold is met) and the amount to pay.
 * Renders a CartSummary from engine/discountEngine.js — no pricing logic here.
 */

import DataTable from './DataTable.jsx'

const rupees = (n) => `Rs.${n.toLocaleString('en-IN')}`

function statusTag(row) {
  if (row.appliedRules.length === 0) return { label: 'No offer', color: '#666', bg: '#eee' }
  if (row.skippedRules.length > 0) return { label: 'Max discount', color: '#8a4b00', bg: '#fff1df' }
  if (row.appliedRules.length > 1) return { label: 'Stacked', color: '#1a3d8f', bg: '#e6edff' }
  return { label: 'Discount applied', color: '#1e5c2c', bg: '#e3f4e7' }
}

const Tag = ({ label, color, bg }) => (
  <span
    style={{
      display: 'inline-block', fontSize: 10, fontWeight: 700, padding: '1px 7px', borderRadius: 20,
      background: bg, color, textTransform: 'uppercase', letterSpacing: '0.04em', whiteSpace: 'nowrap',
    }}
  >
    {label}
  </span>
)

const COLUMNS = [
  { key: 'itemId', label: 'Item' },
  { key: 'product', label: 'Product' },
  { key: 'basePrice', label: 'Base Price', render: (v) => rupees(v) },
  {
    key: 'finalPrice',
    label: 'Final Price',
    render: (v, row) => (
      <span style={{ fontWeight: 700, color: row.totalDiscount > 0 ? '#1e5c2c' : '#131A48' }}>{rupees(v)}</span>
    ),
  },
  {
    key: 'totalDiscount',
    label: 'You Save',
    render: (v) =>
      v > 0 ? <span style={{ color: '#1e5c2c', fontWeight: 600 }}>{rupees(v)}</span> : <span style={{ color: '#888' }}>—</span>,
  },
  {
    key: 'reasoning',
    label: 'Offer Applied',
    render: (v, row) => {
      const none = row.appliedRules.length === 0
      return (
        <div>
          <div style={{ display: 'flex', gap: 6, alignItems: 'baseline', flexWrap: 'wrap' }}>
            <Tag {...statusTag(row)} />
            <span style={{ color: none ? '#888' : '#131A48', fontStyle: none ? 'italic' : 'normal' }}>{v}</span>
          </div>
          {!none && (
            <div style={{ fontSize: 10, color: '#999', marginTop: 2 }}>{row.appliedRules.join(' · ')}</div>
          )}
        </div>
      )
    },
  },
]

const line = { display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: '1rem', padding: '0.45rem 0.2rem' }

export default function CartSummary({ summary }) {
  const { items, subtotal, cartOffer, total, totalSavings, nextCartOffer } = summary

  return (
    <div>
      <DataTable columns={COLUMNS} rows={items} emptyMessage="The cart is empty." />

      <div style={{ marginTop: '0.75rem', marginLeft: 'auto', maxWidth: 440 }}>
        <div style={{ ...line, color: '#131A48', fontSize: 13 }}>
          <span>Cart total before offer</span>
          <span style={{ fontWeight: 600 }}>{rupees(subtotal)}</span>
        </div>

        {cartOffer && (
          <div
            data-testid="cart-offer-row"
            style={{ ...line, background: '#fff8e6', borderRadius: 4, padding: '0.45rem 0.6rem', fontSize: 13 }}
          >
            <span style={{ color: '#8a4b00', fontWeight: 700 }}>
              {cartOffer.reasoning}
              <span style={{ fontSize: 10, color: '#b07a2a', fontWeight: 400, marginLeft: 6 }}>
                {cartOffer.appliedRules.join(' · ')}
              </span>
            </span>
            <span style={{ color: '#1e5c2c', fontWeight: 700 }}>−{rupees(cartOffer.discount)}</span>
          </div>
        )}

        <div style={{ ...line, borderTop: '2px solid #131A48', marginTop: 4, paddingTop: '0.6rem' }}>
          <span style={{ fontWeight: 700, fontSize: 14, color: '#131A48' }}>Final cart total</span>
          <span style={{ fontWeight: 700, fontSize: 20, color: '#131A48' }}>{rupees(total)}</span>
        </div>

        {totalSavings > 0 && (
          <div style={{ textAlign: 'right', fontSize: 12, color: '#1e5c2c', fontWeight: 600 }}>
            You save {rupees(totalSavings)} on this order
          </div>
        )}

        {nextCartOffer && (
          <div style={{ textAlign: 'right', fontSize: 12, color: '#666', marginTop: 6 }}>
            Add {rupees(nextCartOffer.shortBy)} more to unlock <strong>{nextCartOffer.label}</strong>
          </div>
        )}
      </div>
    </div>
  )
}
