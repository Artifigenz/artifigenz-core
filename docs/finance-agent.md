# Finance Agent — Build Progress & Roadmap

Living document. What's shipped, what's next, and the shape of each stage.
Stage numbers map to phases of work, not commits. The earlier
`categorization-engine.md` covers the Stage 0 canonical model and is now
superseded by this file.

---

## Stage 1 · Onboarding ✅

Everything from "click activate" to "the DB has rows in
`finance_transactions`."

### 1.1 Plaid connection ✅
- Real Plaid Link flow against the production environment.
- `linkTokenCreate` requests 365 days of history.
- `transactionsSync` cursor-based pull, has-more loop.
- State machine on `data_source_connections`:
  `pending → in_progress → complete | needs_auth | failed`.
- Completion gating fixed (May 27): connection no longer marks itself
  `complete` with zero transactions if Plaid is still backfilling
  history. Either real txns + 3 empty syncs OR Plaid's
  `item.status.transactions.last_successful_update` must confirm.
- Local dev: ngrok HTTPS tunnel + Next.js `/api/*` proxy so Plaid OAuth
  redirect_uri validates against the prod env on `localhost`.

### 1.2 Statement upload ✅
- PDF / CSV / TXT / image accepted by `/api/upload`.
- Two-phase pipeline: `validateUpload` (Claude Haiku 4.5, ~3–5s, picks
  off institution / last4 / period) → `parseUploadFull` (Claude Sonnet 4,
  pulls every transaction).
- Large PDFs (>8 pages) are **chunked** by page via `pdf-lib`, parsed in
  bounded-parallel batches (4 at a time), and merged — fits any size
  statement under Claude's 200K context window.
- **Password-protected files (PDF / XLSX / ZIP)** detected by magic-byte
  inspection before bytes hit Claude. Mini-dialog prompts user inline,
  decrypts with `qpdf` / `officecrypto-tool` / `node-stream-zip`.
  Password held only in the request scope, never persisted, never
  logged, never sent to Claude.

### 1.3 Ingest + dedup + merge ✅
- Single canonical `Transaction` shape regardless of source (Plaid,
  statement, manual). Stage 0 migration `0009` added 14 spec fields
  including `user_id`, `institution_id`, `direction`,
  `normalized_description`, `account_type`, `currency`, etc.
- Cross-source account identity:
  `(agent_instance_id, institution_name, last4)` — one Plaid TD account
  and an uploaded TD statement collapse to one `finance_accounts` row.
- Cross-source transaction dedup: unique index
  `(account_id, transaction_date, amount, description_hash)` — same
  purchase ingested from both sources only lands once.
- Per-row insert diagnostics: if a single row fails (FK violation,
  varchar overflow, etc.), the row is logged with a redacted sample
  and the failure is bubbled up via `lastSyncError` or
  `file_uploads.parseError`.
- Plaid `modified` rows now route back through `prepareTransaction` so
  derived fields stay in sync after pending→posted or merchant rename.
- Statement uploads resolve `institution_id` cross-source (prior txn on
  the account → sibling Plaid connection → null).

### 1.4 Merchant normalization ✅
- `normalizeMerchant()` in `ingest/normalize-merchant.ts` strips store
  numbers, phone fragments, URLs, trailing city/state, punctuation.
  Runs at ingest time, populates `merchant_normalized`.
- Transfer descriptions (e-transfer, Interac, etc.) get collapsed to
  the transfer type so person-name suffixes don't fragment clusters.
- `description_hash` (used in the dedup key) currently runs over the
  raw lowercased description — flagged as a follow-up to make dedup
  source-agnostic (same purchase from Plaid and an uploaded statement
  should hash identically).

---

## Stage 2 · Merchant Resolution & Categorization

The next big chunk. Turns a pile of normalized transactions into
clusters with display names, logos, categories, and recurrence cadence.

### 2.1 Build merchant clusters
Group transactions by `merchant_normalized` into one
`merchant_clusters` row per (agent_instance, merchant_normalized).
Each cluster carries first/last seen date, txn count, total amount,
average monthly amount. `buildClusters()` already exists in
`categorize/build-clusters.ts` — needs to be wired to run automatically
after ingest completes, not just from the manual `/categorize` endpoint.

### 2.2 Merchant enrichment ("brand identity")
Resolve opaque merchant strings to a canonical brand entity:
- **Display name**: `"AMZN MKTP US*1H4XY" → "Amazon"`
- **Logo URL**: served alongside the display name
- **Website**: for "go to merchant" actions
- **Brand color** (optional): for UI accents
- **Industry hint**: for category fallback when LLM is unsure

Three sources to consider, in order of cost/quality:
1. **Plaid's `merchant_logo_url` and `personal_finance_category`** —
   free for Plaid-sourced rows, instant, decent coverage.
2. **Brand API** (Clearbit logo, Brandfetch, Logo Dev) — covers
   merchants Plaid misses, including small/regional and Indian brands.
3. **LLM fallback** — Sonnet 4.6 with web search for the long tail
   (already wired up in `llm-classify.ts` for categorization, can be
   extended).

Storage: extend `merchant_clusters` with `display_name`, `logo_url`,
`website`, `brand_color`. Or a sidecar `merchant_brands` table keyed by
`merchant_normalized` if we want to share enrichment across users.

### 2.3 LLM categorization
- 7 visible categories: `income`, `subscription`, `loan_emi`,
  `fee_interest`, `variable_recurring`, `internal_transfer`,
  `miscellaneous`.
- 6 hidden system labels: `refund_or_reversal`,
  `possible_internal_transfer`, `credit_card_payment`,
  `investment_transfer`, `cash_withdrawal`,
  `uncategorized_needs_review`.
- Classifier: Claude Sonnet 4.6 + server-executed web search (2-search
  budget per cluster, for opaque payment-processor strings). Concurrency
  cap of 8.
- Already shipped — see Stage 0.5 / 0.6 work. **Just needs to run
  automatically on ingest completion** instead of via the manual
  endpoint.

### 2.4 User-learning loop
- Per-txn category override (`finance_transactions.category` already
  supports per-row overrides; UI doesn't exist).
- Cluster-level overrides via the merchant clusters page.
- Override propagation: when a user changes a cluster's category, all
  txns on that cluster should pick it up; future txns to the same
  merchant should land in the new category by default.
- Confidence decay: low-confidence clusters surface in a review queue
  via the `needs_review` flag.

---

## Stage 3 · The Brief

The Finance agent's home-screen output. One per day per user.

### 3.1 Aggregate digest
- Already in `aggregate/digest.ts`. Takes classified transactions and
  produces a per-month rollup: income totals, outflow totals by visible
  category, breakdown by cluster, recurring obligations, days of data,
  risk flags.
- Needs `credit_card_payment` exclusion from spend totals,
  `refund_or_reversal` exclusion from income (using the system labels
  from 2.3).

### 3.2 LLM brief generation
- `aggregate/llm-brief.ts`: feeds the digest into Claude Opus 4.7,
  returns `{ verdict, numbers[], paragraph, data_scope }`.
- Already wired. **Currently shows placeholder content** in the UI
  because the brief generator isn't being triggered after ingest. The
  preview content on the homepage (added today) makes the empty state
  feel populated.

### 3.3 Brief delivery
- Email via Resend (already wired in delivery routes).
- Telegram (deep-link flow shipped, just needs trigger).
- Daily generation cron via the scheduler (BullMQ worker exists, needs
  reactivation after Stage 2 lands).

---

## Stage 4 · Skills & Insights

Beyond the daily brief — focused, actionable observations.

### 4.1 Subscription Radar (first skill)
The flagship use case. For every cluster categorized as `subscription`
or `loan_emi`:
- **Upcoming charge** ("Netflix will charge $17.99 tomorrow")
- **Observed charge** ("Spotify charged $12.99 — as expected")
- **New subscription detected** ("First $14.95 from Audible on May 24")
- **Price change** ("Adobe $19.99 → $22.99, +15%, +$36/year")
- **Cadence drift** ("Apple One usually monthly, none in 38 days")

Already scaffolded in `skills/subscription-radar.ts` (pre-Stage-0 work,
needs reconnection to the new categorization output).

### 4.2 Other skills (later)
- **Category trend**: "Groceries trending high — $612 vs $480 average"
- **Cash flow forecast**: project balance N days out
- **Tax-prep helper**: tag deductible categories
- **Refund tracker**: surface refund_or_reversal txns awaiting return

### 4.3 Insight feed UI
- The `CyclingInsight` component on the active-agent card on `/app`
  rotates verdict + insights (already shipped today with preview
  fallback content).
- The `/finance` page has an insights feed section that already renders
  whatever the API returns.
- Both surfaces will populate automatically once skills are actually
  generating real insights.

---

## Cross-cutting follow-ups

Items that don't belong to a single stage but need attention:

- **Description hash normalization** (Stage 1.4 follow-up): hash on
  `merchant_normalized`, not raw description, so the same purchase from
  Plaid and an uploaded PDF dedupes correctly.
- **Per-txn category override UI** (Stage 2.4): backend supports it,
  no frontend yet.
- **Review queue UI** (Stage 2.4): `needs_review` flag is populated,
  no place to act on it.
- **Brief aggregator + system labels wire-up** (Stage 3.1): subtract
  `credit_card_payment` from spend, exclude `refund_or_reversal` from
  income.
- **Account snapshot refresh** (Stage 1.3 nuance): if a user renames
  an account later, the denormalized `account_type`/`account_mask`/
  `currency` snapshots on existing txns don't refresh. Acceptable for
  now; revisit if it becomes a UX issue.

---

## How to add a stage entry

When a stage ships:
1. Tick the section header (`Stage N.M · Title ✅`).
2. Replace the planning bullets with what actually landed (file paths,
   key decisions, what got deferred).
3. If a sub-stage was deferred or descoped, note it in
   "Cross-cutting follow-ups" instead of leaving it open here.
