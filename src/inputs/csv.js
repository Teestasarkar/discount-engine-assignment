/**
 * csv.js — CSV input adapter
 *
 * Converts raw CSV text into DiscountRule / CartItem objects. Papaparse turns
 * text into rows, this file maps column names onto the engine's field names,
 * and schema.js decides whether each row is valid.
 *
 * rules.csv columns: rule_id, scope, applies_to, type, value, stackable[, min_cart_value]
 *   (min_cart_value is optional so CSVs written for the original 6-column format still load)
 * cart.csv columns:  item_id, product, brand, platform, base_price
 *
 * Both functions return { data, errors } — invalid rows are skipped and
 * reported, valid rows are kept.
 */

import Papa from 'papaparse'
import { validateRule, validateCartItem } from '../engine/schema.js'

function parseCsv(csvText, requiredColumns) {
  const { data: rows, errors: parseErrors, meta } = Papa.parse(csvText.trim(), {
    header: true,
    skipEmptyLines: true,
    transformHeader: (h) => h.trim().toLowerCase().replace(/\s+/g, '_'),
  })

  if (parseErrors.length > 0) {
    return { rows: [], errors: parseErrors.map((e) => `Row ${(e.row ?? 0) + 2}: ${e.message}`) }
  }

  const missingColumns = requiredColumns.filter((c) => !meta.fields?.includes(c))
  if (missingColumns.length > 0) {
    return { rows: [], errors: [`Missing column(s): ${missingColumns.join(', ')}`] }
  }

  return { rows, errors: [] }
}

/**
 * Parses the raw text of rules.csv into an array of DiscountRule objects.
 */
export function parseRulesCSV(csvText) {
  const { rows, errors: fileErrors } = parseCsv(csvText, [
    'rule_id', 'scope', 'applies_to', 'type', 'value', 'stackable',
  ])
  if (fileErrors.length > 0) return { data: [], errors: fileErrors }

  const data = []
  const errors = []
  rows.forEach((row, i) => {
    const { rule, errors: rowErrors } = validateRule({
      ruleId: row.rule_id,
      scope: row.scope,
      appliesTo: row.applies_to,
      type: row.type,
      value: row.value,
      stackable: row.stackable,
      minCartValue: row.min_cart_value,
    })
    if (rule) data.push(rule)
    else errors.push(`Row ${i + 2}: ${rowErrors.join('; ')}`) // +2 for 1-based rows and the header
  })

  return { data, errors }
}

/**
 * Parses the raw text of cart.csv into an array of CartItem objects.
 */
export function parseCartCSV(csvText) {
  const { rows, errors: fileErrors } = parseCsv(csvText, [
    'item_id', 'product', 'brand', 'platform', 'base_price',
  ])
  if (fileErrors.length > 0) return { data: [], errors: fileErrors }

  const data = []
  const errors = []
  rows.forEach((row, i) => {
    const { item, errors: rowErrors } = validateCartItem({
      itemId: row.item_id,
      product: row.product,
      brand: row.brand,
      platform: row.platform,
      basePrice: row.base_price,
    })
    if (item) data.push(item)
    else errors.push(`Row ${i + 2}: ${rowErrors.join('; ')}`)
  })

  return { data, errors }
}
