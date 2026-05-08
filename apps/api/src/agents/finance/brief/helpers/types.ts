/**
 * Internal shapes used by Phase 3 math. Kept narrow on purpose — the digest
 * the LLM sees is shaped separately in phase3-digest.ts.
 */

export interface DigestAccount {
  plaidAccountId: string;
  type: string | null; // depository | credit | loan
  subtype: string | null;
  currentBalance: number | null;
  availableBalance: number | null;
  isoCurrencyCode: string | null;
}

export interface DigestTransaction {
  transactionId: string;
  plaidAccountId: string | null;
  date: string; // ISO date YYYY-MM-DD
  amount: number; // Plaid convention: positive = outflow
  name: string;
  merchantName: string | null;
  pending: boolean;
  pfcPrimary: string | null;
  pfcDetailed: string | null;
}

export interface DigestStream {
  plaidStreamId: string;
  direction: "inflow" | "outflow";
  plaidAccountId: string | null;
  merchantName: string | null;
  description: string | null;
  averageAmount: number;
  frequency: string;
  lastDate: string | null;
  predictedNextDate: string | null;
  firstDate: string | null;
  status: string;
  pfcPrimary: string | null; // Plaid Personal Finance Category (INCOME, TRANSFER_IN, etc.)
}

export interface TopMerchant {
  merchant: string;
  count: number;
  total: number;
}

export interface BalancePoint {
  date: string;
  balance: number;
}

export interface RiskFlags {
  negative_balance_days: number;
  nsf_count: number;
}

export interface StreamSummary {
  merchant: string;
  amount_monthly: number;
  frequency: string;
  last_date: string | null;
}

export interface Digest {
  income_monthly: number;
  recurring_monthly: number;
  expenses_monthly: number;
  leftover_monthly: number;
  days_of_data: number;
  accounts_count: number;
  iso_currency_code: string;
  top_merchants: TopMerchant[];
  balance_series: BalancePoint[];
  new_recurring_count: number;
  risk_flags: RiskFlags;
  inflow_streams: StreamSummary[];
  outflow_streams: StreamSummary[];
}
