# Categorization Engine — Build Log

A step-by-step log of how we're building the finance categorization engine,
the decisions made at each stage, and what's deliberately deferred.

Each entry: **date · stage · what shipped · what we deferred and why**.

---

## 2026-05-23 · Stage 0 — Canonical Transaction Model

**Spec reference:** the canonical `Transaction` type from the build plan
(see image 23 of the engagement). Every transaction — Plaid pull, CSV
statement, PDF statement, manual upload — must land in the same shape
before any categorization logic runs.

**Ground truth in the codebase:** `packages/db/src/schema/finance.ts` →
`financeTransactions` table.

### What landed

Migration `0009_canonical_transaction_model.sql` added 14 columns to
`finance_transactions` to match the canonical model:

| Spec field | Column | Notes |
|---|---|---|
| `userId` | `user_id` (uuid → users) | Denormalized for direct queries |
| `institutionId` | `institution_id` (varchar 100) | Plaid institution_id when present |
| `source` | `source` — `'plaid' \| 'statement' \| 'manual'` | Renamed existing `'upload'` rows to `'statement'` |
| `sourceTransactionId` | `source_transaction_id` (varchar 255) | Generic; mirrors plaid_transaction_id for Plaid |
| `postedDate` | `posted_date` (date) | |
| `authorizedDate` | `authorized_date` (date) | |
| `direction` | `direction` — `'in' \| 'out'` | Derived from sign at write time |
| `normalizedDescription` | `normalized_description` (text) | Lowercase + collapse whitespace |
| `accountType` | `account_type` (varchar 20) | Denormalized snapshot from accounts |
| `accountMask` | `account_mask` (varchar 10) | Denormalized last4 |
| `currency` | `currency` (varchar 3) | Denormalized ISO code |
| `confidence` | `confidence` (numeric 3,2) | Per-txn confidence — currently null, populated by classifier |
| `categorizationSource` | `categorization_source` (varchar 10) | `'system' \| 'ai' \| 'user' \| 'mixed'` |
| `reasoning` | `reasoning` (text) | Per-txn reasoning string |
| `needsReview` | `needs_review` (boolean default false) | Review-queue flag |

### Backfill (in the same migration)

For the 2042 existing transactions:

- `user_id` ← `agent_instances.user_id` via JOIN
- `direction` ← `CASE WHEN amount > 0 THEN 'out' WHEN amount < 0 THEN 'in' END`
- `source` ← `'statement'` for existing `'upload'` rows (renaming to match the spec naming)
- `source_transaction_id` ← `plaid_transaction_id` for Plaid rows
- `account_type` / `account_mask` / `currency` ← JOIN on `finance_accounts`
- `normalized_description` ← `lower(trim(description))` with whitespace collapse

**Verification (post-migration):**

```
total: 2042
with_user_id:           2042
with_direction:         2042
with_account_type:      2042
with_normalized_desc:   2042
source=statement:        371
source=plaid:           1671
source=upload remaining:   0
```

### Ingest pipeline updates

`apps/api/src/agents/finance/ingest/dedup.ts`:
- `prepareTransaction()` now derives `direction` and `normalizedDescription`
  automatically, and mirrors `plaidTransactionId` → `sourceTransactionId`
  for Plaid rows.
- Added optional `accountType`, `accountMask`, `currency`, `institutionId`
  fields on `RawTransaction` so callers can pass account context.

`plaid-ingest.ts`:
- Loads `userId` from `agentInstances` at the start of `runIngest`.
- Builds a per-account snapshot map (`type`, `mask`, `currency`) at the
  same time it upserts accounts.
- Passes `authorized_date`, `currency`, account snapshot, and
  `institutionId` (from Plaid metadata) into every prepared txn.

`upload-ingest.ts`:
- Loads `userId` from `agent_instances` and an account snapshot from
  `finance_accounts` before preparing rows.
- Writes `source: 'statement'` (not `'upload'`) going forward.

### Things we deferred (deliberate)

- **System labels (image 24, hidden `SystemCategory` enum)**: discussed
  below — design note follows, but no schema change yet. The 14 columns
  above already include `needs_review`, `confidence`, `reasoning`, and
  `categorization_source`, which carry most of the spec's intent for
  per-txn metadata. Adding a `system_category` enum is the next step
  once we know it's actually doing work for us downstream.

- **Per-txn category overrides**: schema supports it now (every txn has
  its own `category` column already), but the UI to override one txn
  without touching the cluster doesn't exist. Tracked as a follow-up.

- **`accountId` / `accountMask` consistency for older rows**: backfilled
  via JOIN at migration time. New uploads from a re-uploaded statement
  that lands in an already-merged account will pick up the new snapshot
  automatically — but if the user renames an account later, denormalized
  snapshots on past txns won't refresh. Fine for now; revisit if it
  becomes a UX issue.

---

## Design note — visible categories vs hidden system labels (image 24)

**The spec proposes:**

```ts
type FinalCategory =
  | "Income"
  | "Subscriptions"
  | "Loan/EMI"
  | "Banking fee/Interest charges"
  | "Internal transfer"
  | "Miscellaneous spending"

type SystemCategory =
  | "refund_or_reversal"
  | "possible_internal_transfer"
  | "credit_card_payment"
  | "investment_transfer"
  | "cash_withdrawal"
  | "uncategorized_needs_review"
```

**What we have today (`apps/api/src/agents/finance/categorize/llm-classify.ts`):**

```ts
const CATEGORIES = [
  "income", "subscription", "loan_emi", "fee_interest",
  "variable_recurring", "internal_transfer", "miscellaneous",
] as const;
```

Seven visible categories, no system labels.

### What I think — yes, do the two-layer split

**Why it's a good idea:**

1. **`credit_card_payment` is the killer use-case.** Without it, your
   monthly "money out" double-counts: once for each card swipe (which
   shows as outflow on the card account) and again for the bank-account
   transfer that pays the card statement. Tagging the second one
   `credit_card_payment` lets the brief subtract it from spend totals.
2. **`refund_or_reversal`** prevents a refund from inflating the income
   number. Currently a negative on a credit card looks like income to
   the engine.
3. **`possible_internal_transfer`** is a soft flag — useful when the
   sign convention plus the post-check guard isn't 100% confident.
   Lets us show "Looks like a transfer — confirm?" UX instead of
   silently miscategorizing.
4. **`investment_transfer`** is the edge case our `internal_transfer`
   currently swallows. Moving money to Wealthsimple isn't really
   "between own accounts" in the same sense as a checking↔savings move,
   and treating it the same hides actual investing behavior.
5. **`cash_withdrawal`** is currently a black hole — we mark it
   `miscellaneous` but it should be its own thing so the brief can
   say "you took out $X in cash this month."
6. **`uncategorized_needs_review`** maps neatly onto the existing
   `needs_review` boolean we just added in Stage 0.

### How I'd adapt it to our existing 7 categories

I would NOT collapse our 7 visible categories down to the spec's 6.
We have `variable_recurring` (utilities, phone, insurance — bills with
varying amounts), and that's earned its keep — it's distinct from
fixed-amount subscriptions and from one-off miscellaneous spending
in a way the user cares about. Keep it.

**Proposed shape for the engine going forward:**

```ts
// Visible to user — what shows up in the brief and the breakdown table.
const FINAL_CATEGORIES = [
  "income",
  "subscription",
  "loan_emi",
  "fee_interest",
  "variable_recurring",
  "internal_transfer",
  "miscellaneous",
] as const;

// Hidden — extra context the engine uses to make aggregations smarter.
// Lives alongside category, not as a replacement.
const SYSTEM_CATEGORIES = [
  "refund_or_reversal",
  "possible_internal_transfer",
  "credit_card_payment",
  "investment_transfer",
  "cash_withdrawal",
  "uncategorized_needs_review",
] as const;
```

A txn has exactly one `category` (one of the 7) and zero or one
`system_category`. Most txns won't carry a system tag; the system tag
is for the cases where the visible category alone doesn't carry enough
context.

**Where each one would flow:**

| System tag | Visible category it usually attaches to | Downstream effect |
|---|---|---|
| `refund_or_reversal` | `miscellaneous` (a returned purchase) | Excluded from money-in totals |
| `possible_internal_transfer` | `internal_transfer` with low confidence | Triggers review pill |
| `credit_card_payment` | `internal_transfer` | Excluded from spend totals (already counted on the card side) |
| `investment_transfer` | `internal_transfer` | Reported separately as "moved to investments" |
| `cash_withdrawal` | `miscellaneous` | Reported separately as "cash out" |
| `uncategorized_needs_review` | `miscellaneous` (default) | Triggers `needs_review = true` |

### Implementation plan (when we get there)

1. Add `system_category varchar(40)` column to `finance_transactions`
   (nullable). Don't enforce check constraint — keep the list in
   application code so we can add new ones without a migration.
2. Update the LLM classifier prompt to optionally return a system tag.
3. Update the brief aggregator to subtract `credit_card_payment` from
   spend totals and exclude `refund_or_reversal` from income.
4. Surface `cash_withdrawal` and `investment_transfer` as their own
   tiles on the breakdown page.
5. Wire `uncategorized_needs_review` to the existing `needs_review`
   flag so the review queue picks them up.

Not doing it now because: the LLM classifier hasn't been re-run yet
since we paused brief generation. Adding the system_category column
without a working classifier is just a dead column. Better to land
it together with the classifier wake-up so we can verify the labels
are actually populating.

---

## How to read this file going forward

Every time we ship a new stage of the categorization engine, append
a new dated section here. Keep the format:

- **Date · Stage · short title**
- **What landed** — the concrete schema / code changes
- **What we deferred** — the decisions we explicitly punted, with the
  one-sentence reason
- Optionally: **Design notes** — when the decision is non-obvious,
  capture the reasoning so future-you doesn't re-litigate it
