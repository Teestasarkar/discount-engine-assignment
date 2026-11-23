/**
 * Input registry — the list of ways rules and carts can enter the app.
 *
 * Every file adapter has the same contract:
 *     read(file: File) → Promise<{ data: DiscountRule[] | CartItem[], errors: string[] }>
 * and builds its objects through engine/schema.js. The engine and the UI
 * never branch on where data came from, so adding an input mode (XLSX,
 * JSON, an order-API import…) means writing an adapter and adding one entry
 * here — nothing in engine/ changes.
 *
 * The natural-language rule input is not a file, so it lives in nlRule.js /
 * NlRuleInput.jsx, but it ends in the same validateRule gate.
 */

import { parseRulesCSV, parseCartCSV } from './csv.js'
import { parseCartPDF } from './pdfCart.js'
import { loadPdfjs } from './pdfjsBrowser.js'

const MAX_FILE_BYTES = 5 * 1024 * 1024

export const RULE_FILE_INPUTS = [
  { label: 'CSV', extensions: ['.csv'], read: async (file) => parseRulesCSV(await file.text()) },
]

export const CART_FILE_INPUTS = [
  { label: 'CSV', extensions: ['.csv'], read: async (file) => parseCartCSV(await file.text()) },
  { label: 'PDF', extensions: ['.pdf'], read: async (file) => parseCartPDF(await file.arrayBuffer(), await loadPdfjs()) },
]

export const acceptAttr = (inputs) => inputs.flatMap((i) => i.extensions).join(',')

/** Picks the adapter for this file by extension and runs it. Never throws. */
export async function readFile(inputs, file) {
  const name = file.name.toLowerCase()
  const input = inputs.find((i) => i.extensions.some((ext) => name.endsWith(ext)))
  if (!input) {
    return { data: [], errors: [`“${file.name}” isn’t supported. Upload a ${inputs.map((i) => i.label).join(' or ')} file.`] }
  }
  if (file.size > MAX_FILE_BYTES) {
    return { data: [], errors: [`“${file.name}” is larger than 5 MB.`] }
  }
  try {
    return await input.read(file)
  } catch (err) {
    return { data: [], errors: [`Couldn’t read “${file.name}”: ${err.message}`] }
  }
}
