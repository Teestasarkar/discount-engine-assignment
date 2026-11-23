/**
 * pdfCart.js — PDF cart input adapter
 *
 *   PDF bytes ──► pdf.js text runs ──► pdfTable.extractTableRows ──► schema.validateCartItem ──► CartItem[]
 *
 * Returns { data, errors } like the CSV adapter. Malformed rows are skipped
 * and reported by row number; the item ids follow the PDF's row numbers
 * (ITEM-01 is the first row), so a skipped row leaves a visible gap instead
 * of silently renumbering everything after it.
 *
 * The pdf.js module is passed in (browser: pdfjsBrowser.js, tests: the Node
 * legacy build), so this file runs in both environments.
 */

import { extractTableRows, COLUMNS } from './pdfTable.js'
import { validateCartItem } from '../engine/schema.js'

export const MAX_PAGES = 20

const EXPECTED_HEADER = COLUMNS.map((c) => c.label).join(', ')

/** Reads every page's text runs. Throws an Error with a user-facing message on unreadable files. */
export async function readTextRuns(bytes, pdfjs) {
  let doc
  try {
    doc = await pdfjs.getDocument({
      data: new Uint8Array(bytes),
      isEvalSupported: false,
      verbosity: 0,
    }).promise
  } catch (err) {
    if (err?.name === 'PasswordException') throw new Error('This PDF is password-protected. Upload an unlocked copy.')
    if (err?.name === 'InvalidPDFException') throw new Error('This file is not a valid PDF.')
    throw new Error(`Could not open the PDF (${err?.message ?? 'unknown error'}).`)
  }

  try {
    if (doc.numPages > MAX_PAGES) {
      throw new Error(`This PDF has ${doc.numPages} pages; a cart PDF should have at most ${MAX_PAGES}.`)
    }
    const pages = []
    for (let n = 1; n <= doc.numPages; n++) {
      const page = await doc.getPage(n)
      const { items } = await page.getTextContent()
      pages.push(
        items
          .filter((i) => typeof i.str === 'string' && i.str.trim() !== '')
          .map((i) => ({
            str: i.str,
            x: i.transform[4],
            y: i.transform[5],
            width: i.width,
            fontSize: Math.hypot(i.transform[2], i.transform[3]) || i.height || 10,
          }))
      )
    }
    return pages
  } finally {
    await doc.destroy()
  }
}

/** Turns positioned text into { data: CartItem[], errors: string[] }. Pure. */
export function cartFromTextRuns(pages) {
  if (pages.every((p) => p.length === 0)) {
    return {
      data: [],
      errors: ['This PDF has no selectable text (it may be a scanned image). Upload a text-based PDF or a CSV.'],
    }
  }

  const { headerFound, rows } = extractTableRows(pages)
  if (!headerFound) {
    return { data: [], errors: [`Couldn’t find the cart table. Expected a header row with: ${EXPECTED_HEADER}.`] }
  }
  if (rows.length === 0) {
    return { data: [], errors: ['Found the table header but no item rows under it.'] }
  }

  const data = []
  const errors = []
  rows.forEach(({ cells, text }, i) => {
    const rowNo = i + 1
    const { item, errors: rowErrors } = validateCartItem({
      itemId: `ITEM-${String(rowNo).padStart(2, '0')}`,
      ...cells,
    })
    if (item) data.push(item)
    else errors.push(`Row ${rowNo} (“${text}”): ${rowErrors.join('; ')} — skipped`)
  })

  return { data, errors }
}

/** Full adapter: PDF bytes → { data, errors }. Never throws. */
export async function parseCartPDF(bytes, pdfjs) {
  try {
    return cartFromTextRuns(await readTextRuns(bytes, pdfjs))
  } catch (err) {
    return { data: [], errors: [err.message] }
  }
}
