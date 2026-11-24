# Opptra Discount Engine

Cart pricing engine for the Opptra FDE Intern assignment. It finds the best offer for each item, stacks rules marked stackable, applies cart-level offers, and explains every price in plain language. Rules can come from a CSV or from plain English (parsed by an LLM). Carts can come from a CSV or a PDF.

**Live:** _LIVE_URL_PLACEHOLDER_

## Run locally

```bash
npm install
npm run dev        # → http://localhost:5173
```

Everything works without configuration except the plain-English rule input. To enable it, put `GROQ_API_KEY=…` in `.env.local` before step 2 (see `.env.example`). A free key from [the Groq console](https://console.groq.com/keys) works, or set `ANTHROPIC_API_KEY=…` to use Claude instead. Without a key, that input shows a clear "not configured" message and the rest of the app is unaffected.

`npm test` runs 114 tests: the brief's expected-results table, threshold edge cases, LLM-output validation, and real PDFs parsed through pdf.js.

## Try it

| Load | What you should see |
|---|---|
| `sample-data/rules.csv` + `sample-data/cart.csv` → **Calculate** | The brief's table: Rs.1,104 / 629 / 509 / 2,499 / 382 / 809, subtotal Rs.5,932, "Cart offer: 10% off — Rs.593 saved", total **Rs.5,339** |
| `sample-data/cart.pdf` or `cart-plain-text.pdf` | The same cart (one-run-per-cell and monospace layouts) |
| `sample-data/cart-below-threshold.pdf` | Base prices total Rs.4,179, but item offers bring the cart to **Rs.3,999**. No cart offer row; instead "Add Rs.1 more to unlock…" |
| `sample-data/cart-malformed.pdf` | 2 items load; 3 rows are skipped, each with its reason |
| The example chips under "describe a rule" | The four examples from the brief, including the ambiguous one |

## How it's built

```
src/
  engine/                  pure, no idea where data came from
    schema.js              the input contract: validateRule / validateCartItem (the one gate every input passes)
    discountEngine.js      item offers → subtotal → cart offer → total, plus customer-facing reasoning
  inputs/                  adapters: some source → engine objects (via schema.js)
    index.js               registry of file inputs: { extensions, read(file) → { data, errors } }
    csv.js                 rules.csv / cart.csv
    pdfCart.js, pdfTable.js  cart PDF → positioned text → table → CartItem[]
    nlRule.js              sentence → /api/parse-rule → validated DiscountRule
  components/              React UI (CartSummary, NlRuleInput, FileUploader, …)
api/
  parse-rule.js            serverless function: holds the API key, calls the LLM
  _lib/ruleParser.js       prompt, JSON schema, error codes, the Claude call
  _lib/groqParser.js       the same request through Groq's REST API
  _lib/pickParser.js       picks the provider from whichever key is set
tests/                     vitest
```

**Adding a third input mode** (XLSX, JSON, an order-API import…) means writing an adapter that returns `{ data, errors }` using `validateRule` / `validateCartItem`, then adding one entry to `src/inputs/index.js`. Nothing in `engine/` changes. The engine never branches on where data came from, and the only engine changes in this repo are the ones Task 1 asked for.

### Pricing rules (as implemented)

1. **Item level:** among matching non-stackable rules, the largest rupee saving wins, whatever its scope (a tie goes to the rule listed first). Stackable rules then apply on top, each to the running price. With no match, the reasoning says why: *"No offers available for LivSpace Pro on Noon"*.
2. **Cart level:** cart rules are checked against the **sum of item final prices**, using `>=`. Eligible cart rules go through the same best-offer/stacking policy and appear as one separate "Cart offer" line. When no cart rule qualifies there is no cart offer row; the customer sees "Add Rs.X more to unlock …" instead.
3. Amounts are rounded to whole rupees at each step (ITEM-01: Rs.194.85 → Rs.195, as in the brief). A discount can never take a price below zero.

## Decisions and tradeoffs

**I added a small server, although the brief says to add one only if PDF parsing needs it.** The LLM key must not ship in a static bundle, where anyone could extract it. `api/parse-rule.js` is the smallest server that avoids that: it receives the sentence and returns the LLM's structured reading. All pricing and validation stay in the browser. The alternative, asking each user to paste their own key, works without a server but makes the feature unusable for most people opening the demo. PDF parsing needed no server: it runs client-side with pdf.js, which is lazy-loaded only when a PDF is uploaded.

**The LLM is never trusted.** It answers in a fixed JSON schema with `status: ok | ambiguous | unsupported`, the parsed fields, and the assumptions it made. The browser then runs that answer through the same `validateRule` as CSV rows:
- A rule the LLM calls "ok" that is invalid (150% off, a zero value, a brand rule with no brand) is rejected, with the reasons shown.
- A cart threshold attached to a brand or platform rule is **rejected**, not dropped. Dropping it would silently make a conditional offer unconditional.
- "Give a discount for big orders" comes back `ambiguous` with a specific question (in testing: *"What is the discount amount and the minimum cart value for a big order?"*), and nothing is added.
- Things the engine can't express (buy-one-get-one, date windows, brand + platform combinations) come back `unsupported`, with the closest rule that would work.
- Refusals, truncated output, invalid JSON, rate limits, timeouts and a missing or invalid key each produce a specific message instead of a crash.

**Which LLM.** The live demo uses `openai/gpt-oss-120b` on Groq's free tier, so it costs nothing to run. I picked it because it's Groq's strongest production text model with *strict* structured outputs (decoding is constrained to the JSON schema, so the reply always has the right shape) and the free tier allows 1,000 requests a day. The same endpoint uses Claude (Opus 5.5) instead when `ANTHROPIC_API_KEY` is set. Both get the same prompt and schema, return the same error codes, and their answers pass the same `validateRule` check, so switching provider is one environment variable and nothing in the browser changes. The free tier's tight limit is about 8,000 tokens a minute (roughly five rule parses), so the server waits out a short `retry-after` once before reporting "busy"; when the daily quota is gone, the input says so and the rest of the app keeps working. In production I'd use a paid tier and add per-IP rate limiting.

**The confirmation step shows consequences, not just fields.** Besides scope, value and so on, it shows the assumptions the LLM reports (for example that "more than Rs.5,000" is treated as inclusive, or that "amazon" means the known platform "Amazon India"), warnings (the rule matches nothing in the current cart; it duplicates RULE-02), and the before → after cart total. The assumption list is best-effort: the model doesn't flag every default it picks. That's why the card always shows every field, Stackable included, instead of relying on the list. *Alternative I'd propose:* make the parsed fields editable in that card, so fixing a misread value doesn't need another LLM round trip. I kept plain confirm/discard to match the brief, and because rephrasing is cheap.

**"More than Rs.5,000" vs `>=`.** The brief's example parses "more than Rs.5,000" as a Rs.5,000 minimum, while the engine applies cart rules at `>=`, so the Rs.5,000.00 boundary differs by one rupee from the literal English. I followed the brief and surface it as an assumption in the confirmation card, so the merchant sees it before adding the rule.

**PDF format assumption.** I don't assume fixed column positions or fixed column order. The parser looks for a header row with Product, Brand, Platform and Base Price (in any order) and assigns each piece of text to the column it starts under. That handles real invoices (one text run per cell) as well as plain-text layouts like the brief's figure. Text above the header (order number, date) is ignored, as are separator and "Total" lines. Prices like `Rs.1,299`, `₹1,299` and `1,299.00` are all accepted.
- **Malformed rows:** a row with a missing cell or a non-numeric price is skipped and listed with its row number and reason. Item IDs follow the PDF's row numbers (ITEM-01, ITEM-05), so a skipped row leaves a visible gap rather than silently renumbering the rest.
- **Import policy:** a file with at least one valid row replaces the cart, with warnings for anything skipped. A file with no valid rows (scanned image, wrong table, not a PDF) leaves the current cart untouched and explains why. The other option, rejecting the whole file on any bad row, is safer for checkout but worse for a merchant fixing one typo. Showing the skipped rows prominently was my middle ground.
- **Not handled:** product names that wrap onto a second line, and scanned PDFs (no OCR). *Proposal:* when no header is found, send the page text to the LLM as a fallback extractor and reuse the same confirmation pattern as Task 2, instead of failing.

**Other calls:**
- **Results are live:** after the first *Calculate*, any change (a confirmed rule, a new cart, a removed rule) re-runs the engine automatically, as Tasks 2 and 3 require.
- **Stacking order:** stackable rules apply after the winning non-stackable rule, as the brief's ITEM-02 example requires. Applying percentage before flat would be slightly cheaper for the customer, but it would change the brief's expected results.
- **Rule uploads:** re-uploading `rules.csv` replaces the whole rule set, including rules added in plain English.
- **Base repo fixes:** the repo's `sample-data/rules.csv` was missing RULE-04 and the `min_cart_value` column shown in the brief, so I added both. The CSV parser still accepts the original 6-column format.

**Known limits:** there's no rate limiting on `/api/parse-rule` beyond a 500-character input cap. For anything beyond a demo, I'd add per-IP limits and rely on a spend limit on the API key.

## Deploying

Deployed on Vercel, which auto-detects Vite and builds to `dist/`. `api/parse-rule.js` becomes a serverless function automatically. Set `GROQ_API_KEY` (or `ANTHROPIC_API_KEY`) in the Vercel project's environment variables.
