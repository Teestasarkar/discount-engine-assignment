/**
 * Generates the sample cart PDFs in sample-data/ (run: npm run samples).
 *
 *   cart.pdf                  the brief's cart, one text run per cell (like a real invoice)
 *   cart-plain-text.pdf       the same cart with each row as one monospace line (like the brief's figure)
 *   cart-malformed.pdf        2 good rows + rows with a missing price, a non-numeric price and a missing brand
 *   cart-below-threshold.pdf  base prices total Rs.4,179 but item offers bring it to Rs.3,999 —
 *                             Rs.1 short of RULE-04, so no cart offer row appears
 */

import { writeFileSync } from 'node:fs'
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib'

const out = (name) => new URL(`../sample-data/${name}`, import.meta.url)

const BRIEF_CART = [
  ['Cushion Cover', 'Natura Casa', 'Amazon India', 'Rs.1,299'],
  ['Bed Sheet Set', 'Natura Casa', 'Flipkart', 'Rs.849'],
  ['Wall Shelf', 'LivSpace Pro', 'Amazon India', 'Rs.599'],
  ['Ceramic Vase', 'LivSpace Pro', 'Noon', 'Rs.2,499'],
  ['Cutting Board', 'Nordic Basics', 'Amazon India', 'Rs.449'],
  ['Desk Organiser', 'Nordic Basics', 'Flipkart', 'Rs.899'],
]

async function tableCart(rows, { title, footer }) {
  const doc = await PDFDocument.create()
  const page = doc.addPage([595, 842]) // A4
  const font = await doc.embedFont(StandardFonts.Helvetica)
  const bold = await doc.embedFont(StandardFonts.HelveticaBold)
  const cols = [50, 190, 310, 430]
  let y = 780

  page.drawText('Opptra', { x: 50, y, size: 18, font: bold, color: rgb(0.07, 0.1, 0.28) })
  y -= 24
  page.drawText(title, { x: 50, y, size: 10, font })
  y -= 36

  ;['Product', 'Brand', 'Platform', 'Base Price'].forEach((h, i) =>
    page.drawText(h, { x: cols[i], y, size: 10, font: bold })
  )
  y -= 8
  page.drawLine({ start: { x: 50, y }, end: { x: 545, y }, thickness: 0.8 })
  y -= 16

  for (const row of rows) {
    row.forEach((cell, i) => {
      if (cell) page.drawText(cell, { x: cols[i], y, size: 10, font })
    })
    y -= 18
  }

  if (footer) {
    y -= 4
    page.drawLine({ start: { x: 50, y: y + 12 }, end: { x: 545, y: y + 12 }, thickness: 0.5 })
    page.drawText(footer[0], { x: cols[0], y, size: 10, font: bold })
    page.drawText(footer[1], { x: cols[3], y, size: 10, font: bold })
  }

  doc.setTitle(title)
  return doc.save()
}

async function plainTextCart(rows, title) {
  const doc = await PDFDocument.create()
  const page = doc.addPage([595, 842])
  const mono = await doc.embedFont(StandardFonts.Courier)
  const pad = (s, n) => s.padEnd(n, ' ')
  const line = (cells) => pad(cells[0], 19) + pad(cells[1], 15) + pad(cells[2], 15) + cells[3]
  let y = 780

  page.drawText(title, { x: 50, y, size: 10, font: mono })
  y -= 30
  page.drawText(line(['Product', 'Brand', 'Platform', 'Base Price']), { x: 50, y, size: 10, font: mono })
  y -= 14
  page.drawText('-'.repeat(58), { x: 50, y, size: 10, font: mono })
  y -= 14
  for (const row of rows) {
    page.drawText(line(row), { x: 50, y, size: 10, font: mono })
    y -= 14
  }
  return doc.save()
}

const files = {
  'cart.pdf': await tableCart(BRIEF_CART, { title: 'Order #OP-9921  |  Date: 15 Jan 2025' }),
  'cart-plain-text.pdf': await plainTextCart(BRIEF_CART, 'Order #OP-9921 | Date: 15 Jan 2025'),
  'cart-malformed.pdf': await tableCart(
    [
      ['Cushion Cover', 'Natura Casa', 'Amazon India', 'Rs.1,299'],
      ['Bed Sheet Set', 'Natura Casa', 'Flipkart', ''],
      ['Wall Shelf', 'LivSpace Pro', 'Amazon India', 'Rs.TBD'],
      ['Ceramic Vase', '', 'Noon', 'Rs.2,499'],
      ['Cutting Board', 'Nordic Basics', 'Amazon India', 'Rs.449'],
    ],
    { title: 'Order #OP-9922  |  Date: 16 Jan 2025', footer: ['Total', 'Rs.4,247'] }
  ),
  'cart-below-threshold.pdf': await tableCart(
    [
      ['Ceramic Vase', 'LivSpace Pro', 'Noon', 'Rs.2,499'],
      ['Wall Shelf', 'LivSpace Pro', 'Amazon India', 'Rs.599'],
      ['Desk Organiser', 'Nordic Basics', 'Flipkart', 'Rs.899'],
      ['Coaster Set', 'Nordic Basics', 'Noon', 'Rs.182'],
    ],
    { title: 'Order #OP-9923  |  Date: 17 Jan 2025', footer: ['Total', 'Rs.4,179'] }
  ),
}

for (const [name, bytes] of Object.entries(files)) {
  writeFileSync(out(name), bytes)
  console.log(`wrote sample-data/${name} (${bytes.length} bytes)`)
}
