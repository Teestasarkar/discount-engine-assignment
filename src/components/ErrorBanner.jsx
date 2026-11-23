/**
 * ErrorBanner.jsx
 * Displays a list of parse or validation issues.
 * tone="error"   — nothing was loaded
 * tone="warning" — the file loaded, but some rows were skipped
 */

const TONES = {
  error: { bg: '#fce8e8', border: '#e57373', bar: '#c0392b', title: '#8a1a1a', text: '#5a1010' },
  warning: { bg: '#fff8e6', border: '#f0c36d', bar: '#d48a00', title: '#7a4a00', text: '#5a3a00' },
}

export default function ErrorBanner({ errors, tone = 'error', title }) {
  if (!errors || errors.length === 0) return null
  const c = TONES[tone] ?? TONES.error
  return (
    <div
      role={tone === 'error' ? 'alert' : 'status'}
      style={{
        background: c.bg,
        border: `1px solid ${c.border}`,
        borderLeft: `3px solid ${c.bar}`,
        borderRadius: 4,
        padding: '0.6rem 0.9rem',
        marginTop: '0.5rem',
      }}
    >
      <div style={{ fontWeight: 700, fontSize: 12, color: c.title, marginBottom: 4 }}>
        {title ?? `${errors.length} issue${errors.length > 1 ? 's' : ''} found`}
      </div>
      {errors.map((e, i) => (
        <div key={i} style={{ fontSize: 12, color: c.text, marginTop: 2 }}>
          {e}
        </div>
      ))}
    </div>
  )
}
