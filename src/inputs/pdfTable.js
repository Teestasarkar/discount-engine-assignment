/**
 * pdfTable.js — rebuilds the cart table from positioned PDF text.
 *
 * A PDF has no notion of rows or columns, only text runs at (x, y). This
 * module:
 *   1. groups runs into lines by their y position,
 *   2. finds the header line (Product, Brand, Platform, Base Price — any order),
 *   3. uses each header's x position as the left edge of its column, and
 *   4. puts every run of the following lines into the column it starts under.
 *
 * Runs that contain wide gaps ("Cushion Cover    Natura Casa", as produced by
 * plain-text/monospace PDFs) are split on 2+ spaces first, so both
 * "one run per cell" and "one run per line" layouts work.
 *
 * Pure: takes plain objects, returns plain objects. pdfCart.js does the PDF I/O.
 *
 * TextRun { str: string, x: number, y: number, width: number, fontSize: number }   (y grows upward)
 */

export const COLUMNS = [
  { field: 'product', label: 'Product', match: /^product( name)?$/i },
  { field: 'brand', label: 'Brand', match: /^brand$/i },
  { field: 'platform', label: 'Platform', match: /^(platform|marketplace)$/i },
  { field: 'basePrice', label: 'Base Price', match: /^(base )?price( \(.*\))?$/i },
]

const SEPARATOR = /^[\s\-–—─_=.·|]+$/
const FOOTER = /^(grand\s+)?(sub\s*-?\s*)?total\b/i

/** Splits a run on 2+ spaces/tabs, estimating each piece's x from its character offset. */
function splitRun(run) {
  const charWidth = run.str.length > 0 ? run.width / run.str.length : 0
  const pieces = []
  const re = /\S+(?: \S+)*/g // words joined by single spaces
  let m
  while ((m = re.exec(run.str.replace(/\t/g, '  '))) !== null) {
    pieces.push({
      text: m[0],
      x: run.x + m.index * charWidth,
      width: m[0].length * charWidth,
      y: run.y,
      fontSize: run.fontSize || 10,
    })
  }
  return pieces
}

/** Groups pieces into lines (top to bottom), each sorted left to right, with close neighbours merged. */
function toLines(runs) {
  const pieces = runs.flatMap(splitRun).sort((a, b) => b.y - a.y || a.x - b.x)
  const lines = []
  for (const p of pieces) {
    const last = lines[lines.length - 1]
    if (last && Math.abs(last.y - p.y) <= Math.max(2, p.fontSize * 0.4)) last.pieces.push(p)
    else lines.push({ y: p.y, pieces: [p] })
  }

  for (const line of lines) {
    line.pieces.sort((a, b) => a.x - b.x)
    // Merge pieces separated by less than ~one character width ("Base" + "Price").
    const merged = []
    for (const p of line.pieces) {
      const prev = merged[merged.length - 1]
      if (prev && p.x - (prev.x + prev.width) < p.fontSize * 0.6) {
        prev.text += ' ' + p.text
        prev.width = p.x + p.width - prev.x
      } else {
        merged.push({ ...p })
      }
    }
    line.pieces = merged
    line.text = merged.map((p) => p.text).join(' ')
  }
  return lines
}

/** If this line is the table header, returns the columns' left edges; otherwise null. */
function readHeader(line) {
  const anchors = []
  for (const col of COLUMNS) {
    const piece = line.pieces.find((p) => col.match.test(p.text.trim()))
    if (!piece) return null
    anchors.push({ field: col.field, x: piece.x })
  }
  return anchors.sort((a, b) => a.x - b.x)
}

/** Assigns each piece of a data line to the column whose left edge it starts at or after. */
function readRow(line, anchors) {
  const cells = Object.fromEntries(anchors.map((a) => [a.field, '']))
  for (const p of line.pieces) {
    const tolerance = p.fontSize * 0.8 // right-aligned values may start slightly left of the header
    let col = anchors[0]
    for (const a of anchors) if (p.x + tolerance >= a.x) col = a
    cells[col.field] = cells[col.field] ? `${cells[col.field]} ${p.text}` : p.text
  }
  return cells
}

/**
 * pages: TextRun[][] (one array per page)
 * Returns { headerFound, rows: [{ cells, text }] } — rows are the lines under
 * a header, minus separator and total lines, in document order.
 */
export function extractTableRows(pages) {
  let anchors = null
  const rows = []

  for (const runs of pages) {
    for (const line of toLines(runs)) {
      const header = readHeader(line)
      if (header) {
        anchors = header // a repeated header on a later page re-anchors the columns
        continue
      }
      if (!anchors) continue // title, order number, address… above the table
      if (SEPARATOR.test(line.text)) continue

      const cells = readRow(line, anchors)
      if (FOOTER.test(cells.product || line.text)) continue
      rows.push({ cells, text: line.text })
    }
  }

  return { headerFound: anchors !== null, rows }
}
