/**
 * FileUploader.jsx
 *
 * Click-or-drop upload area for a single file. Hands the File object to
 * onFile(file); deciding how to read it is the input registry's job.
 */

import { useRef, useState } from 'react'

export default function FileUploader({ label, description, accept, onFile, hasData, fileName, busy = false }) {
  const inputRef = useRef(null)
  const [dragging, setDragging] = useState(false)

  function take(file) {
    if (file && !busy) onFile(file)
  }

  function handleChange(e) {
    take(e.target.files[0])
    e.target.value = '' // allow re-uploading the same file
  }

  function handleDrop(e) {
    e.preventDefault()
    setDragging(false)
    take(e.dataTransfer.files[0])
  }

  const borderColor = dragging ? '#FF5800' : hasData ? '#1e5c2c' : '#CECECE'

  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={`Upload ${label}`}
      style={{
        border: `2px dashed ${borderColor}`,
        borderRadius: 6,
        padding: '1rem 1.2rem',
        background: dragging ? '#fff6f0' : hasData ? '#f0faf2' : '#fafafa',
        cursor: busy ? 'progress' : 'pointer',
        transition: 'border-color 0.15s',
      }}
      onClick={() => inputRef.current?.click()}
      onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && inputRef.current?.click()}
      onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
      onDragLeave={() => setDragging(false)}
      onDrop={handleDrop}
    >
      <input ref={inputRef} type="file" accept={accept} style={{ display: 'none' }} onChange={handleChange} />
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
        <span style={{ fontSize: 20 }}>{busy ? '⏳' : hasData ? '✅' : '📄'}</span>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontWeight: 700, fontSize: 13, color: '#131A48' }}>{label}</div>
          <div style={{ fontSize: 11, color: '#888', marginTop: 2, overflowWrap: 'anywhere' }}>
            {busy ? 'Reading file…' : hasData ? fileName : description}
          </div>
        </div>
        <div style={{ marginLeft: 'auto' }}>
          <span
            style={{
              fontSize: 11, fontWeight: 700, color: hasData ? '#1e5c2c' : '#FF5800',
              textTransform: 'uppercase', letterSpacing: '0.05em',
            }}
          >
            {hasData ? 'Change' : 'Upload'}
          </span>
        </div>
      </div>
    </div>
  )
}
