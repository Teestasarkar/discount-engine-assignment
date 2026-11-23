import { readFileSync } from 'node:fs'
import { describe, it, expect } from 'vitest'
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs'
import { extractTableRows } from '../src/inputs/pdfTable.js'
import { cartFromTextRuns, parseCartPDF } from '../src/inputs/pdfCart.js'
import { parseRulesCSV, parseCartCSV } from '../src/inputs/csv.js'
import { calculateCart } from '../src/engine/discountEngine.js'

const sample = (f) => readFileSync(new URL(`../sample-data/${f}`, import.meta.url))
const RULES = parseRulesCSV(sample('rules.csv').toString('utf8')).data
const CSV_CART = parseCartCSV(sample('cart.csv').toString('utf8')).data

// Helper: one text run, ~5pt per character at 10pt.
const run = (str, x, y) => ({ str, x, y, width: str.length * 5, fontSize: 10 })

describe('extractTableRows (synthetic layouts)', () => {
  it('reads one-run-per-cell tables and ignores everything above the header', () => {
    const { headerFound, rows } = extractTableRows([[
      run('Order #OP-1 | Date: 1 Jan', 50, 800),
      run('Product', 50, 700), run('Brand', 200, 700), run('Platform', 320, 700), run('Base Price', 440, 700),
      run('Cushion Cover', 50, 680), run('Natura Casa', 200, 680), run('Amazon India', 320, 680), run('Rs.1,299', 440, 680),
    ]])
    expect(headerFound).toBe(true)
    expect(rows.map((r) => r.cells)).toEqual([
      { product: 'Cushion Cover', brand: 'Natura Casa', platform: 'Amazon India', basePrice: 'Rs.1,299' },
    ])
  })

  it('splits plain-text rows on wide gaps', () => {
    const { rows } = extractTableRows([[
      run('Product            Brand          Platform       Base Price', 50, 700),
      run('-------------------------------------------------------------', 50, 690),
      run('Bed Sheet Set      Natura Casa    Flipkart       Rs.849', 50, 680),
    ]])
    expect(rows.map((r) => r.cells)).toEqual([
      { product: 'Bed Sheet Set', brand: 'Natura Casa', platform: 'Flipkart', basePrice: 'Rs.849' },
    ])
  })

  it('handles columns in a different order and slightly uneven baselines', () => {
    const { rows } = extractTableRows([[
      run('Brand', 50, 700), run('Product', 200, 700), run('Price', 320, 700), run('Platform', 440, 700),
      run('Nordic Basics', 50, 680), run('Cutting Board', 200, 681.5), run('449', 330, 680), run('Amazon India', 440, 679),
    ]])
    expect(rows[0].cells).toEqual({ product: 'Cutting Board', brand: 'Nordic Basics', platform: 'Amazon India', basePrice: '449' })
  })

  it('re-anchors on a header repeated on the next page and skips total lines', () => {
    const header = (y) => [run('Product', 50, y), run('Brand', 200, y), run('Platform', 320, y), run('Base Price', 440, y)]
    const { rows } = extractTableRows([
      [...header(700), run('A', 50, 680), run('B', 200, 680), run('C', 320, 680), run('Rs.1', 440, 680)],
      [...header(700), run('D', 50, 680), run('E', 200, 680), run('F', 320, 680), run('Rs.2', 440, 680),
        run('Total', 50, 660), run('Rs.3', 440, 660)],
    ])
    expect(rows.map((r) => r.cells.product)).toEqual(['A', 'D'])
  })

  it('reports when there is no header', () => {
    expect(extractTableRows([[run('Just a letter', 50, 700)]]).headerFound).toBe(false)
  })
})

describe('cartFromTextRuns', () => {
  it('explains a PDF with no text layer (scanned image)', () => {
    expect(cartFromTextRuns([[], []]).errors[0]).toMatch(/no selectable text/)
  })

  it('explains a PDF without the expected table', () => {
    expect(cartFromTextRuns([[run('Invoice', 50, 700)]]).errors[0]).toMatch(
      /Expected a header row with: Product, Brand, Platform, Base Price/
    )
  })
})

describe('parseCartPDF (real PDFs through pdf.js)', () => {
  it.each(['cart.pdf', 'cart-plain-text.pdf'])('%s produces exactly the CSV cart', async (file) => {
    const { data, errors } = await parseCartPDF(sample(file), pdfjs)
    expect(errors).toEqual([])
    expect(data).toEqual(CSV_CART)
  })

  it('cart.pdf through the engine gives the brief’s final total', async () => {
    const { data } = await parseCartPDF(sample('cart.pdf'), pdfjs)
    expect(calculateCart(data, RULES).total).toBe(5339)
  })

  it('skips and explains malformed rows, keeps the good ones, ignores the Total line', async () => {
    const { data, errors } = await parseCartPDF(sample('cart-malformed.pdf'), pdfjs)
    expect(data.map((i) => [i.itemId, i.product, i.basePrice])).toEqual([
      ['ITEM-01', 'Cushion Cover', 1299],
      ['ITEM-05', 'Cutting Board', 449],
    ])
    expect(errors).toEqual([
      'Row 2 (“Bed Sheet Set Natura Casa Flipkart”): missing base_price — skipped',
      'Row 3 (“Wall Shelf LivSpace Pro Amazon India Rs.TBD”): base_price must be a positive amount (got "Rs.TBD") — skipped',
      'Row 4 (“Ceramic Vase Noon Rs.2,499”): missing brand — skipped',
    ])
  })

  it('a cart Rs.1 below the threshold (after item offers) gets no cart offer', async () => {
    const { data, errors } = await parseCartPDF(sample('cart-below-threshold.pdf'), pdfjs)
    expect(errors).toEqual([])
    expect(data.reduce((s, i) => s + i.basePrice, 0)).toBe(4179) // base prices would qualify…
    const summary = calculateCart(data, RULES)
    expect(summary.subtotal).toBe(3999) // …but the threshold is checked after item offers
    expect(summary.cartOffer).toBeNull()
    expect(summary.nextCartOffer.shortBy).toBe(1)
  })

  it('rejects a file that is not a PDF without throwing', async () => {
    const { data, errors } = await parseCartPDF(new TextEncoder().encode('item_id,product\n1,2'), pdfjs)
    expect(data).toEqual([])
    expect(errors[0]).toMatch(/not a valid PDF|Could not open/)
  })
})
