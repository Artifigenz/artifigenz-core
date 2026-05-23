import { and, eq } from "drizzle-orm";
import { db, financeAccounts } from "@artifigenz/db";

export interface AccountIdentity {
  agentInstanceId: string;
  institutionName: string;
  accountLast4: string;
}

export interface UpsertAccountInput extends AccountIdentity {
  dataSourceConnectionId?: string | null;
  plaidAccountId?: string | null;
  name?: string | null;
  mask?: string | null;
  type?: string | null;
  subtype?: string | null;
  currentBalance?: string | null;
  availableBalance?: string | null;
  isoCurrencyCode?: string | null;
}

/**
 * Normalize an institution name to a canonical lowercase form.
 * "RBC Royal Bank" and "Rbc royal bank " both become "rbc royal bank".
 */
export function normalizeInstitution(name: string | null | undefined): string {
  if (!name) return "unknown";
  return name.toLowerCase().replace(/\s+/g, " ").trim();
}

/**
 * Find an existing account by (agent_instance, institution, last4), or create one.
 * This is the cross-source identity: a Plaid-connected RBC account and an
 * uploaded RBC statement for the same account number resolve to the same row.
 *
 * Returns the account row's id.
 */
export async function upsertAccount(
  input: UpsertAccountInput,
): Promise<string> {
  const institution = normalizeInstitution(input.institutionName);
  const last4 = input.accountLast4.slice(-4);

  const [existing] = await db
    .select({ id: financeAccounts.id })
    .from(financeAccounts)
    .where(
      and(
        eq(financeAccounts.agentInstanceId, input.agentInstanceId),
        eq(financeAccounts.institutionName, institution),
        eq(financeAccounts.accountLast4, last4),
      ),
    )
    .limit(1);

  // No exact match — see if there's an "unknown" account with the same
  // last4 we can upgrade. This catches: first upload was Unknown ••X,
  // second upload now identifies as TD ••X — link to the existing row
  // and rename, instead of creating a parallel orphan.
  if (!existing && institution !== "unknown") {
    const [orphan] = await db
      .select({ id: financeAccounts.id })
      .from(financeAccounts)
      .where(
        and(
          eq(financeAccounts.agentInstanceId, input.agentInstanceId),
          eq(financeAccounts.institutionName, "unknown"),
          eq(financeAccounts.accountLast4, last4),
        ),
      )
      .limit(1);
    if (orphan) {
      await db
        .update(financeAccounts)
        .set({
          institutionName: institution,
          ...(input.dataSourceConnectionId !== undefined && {
            dataSourceConnectionId: input.dataSourceConnectionId,
          }),
          ...(input.plaidAccountId && { plaidAccountId: input.plaidAccountId }),
          ...(input.name && { name: input.name }),
          ...(input.mask && { mask: input.mask }),
          ...(input.type && { type: input.type }),
          ...(input.subtype && { subtype: input.subtype }),
          ...(input.currentBalance !== undefined && {
            currentBalance: input.currentBalance,
          }),
          ...(input.availableBalance !== undefined && {
            availableBalance: input.availableBalance,
          }),
          ...(input.isoCurrencyCode && { isoCurrencyCode: input.isoCurrencyCode }),
          lastSyncedAt: new Date(),
        })
        .where(eq(financeAccounts.id, orphan.id));
      return orphan.id;
    }
  }

  if (existing) {
    await db
      .update(financeAccounts)
      .set({
        ...(input.dataSourceConnectionId !== undefined && {
          dataSourceConnectionId: input.dataSourceConnectionId,
        }),
        ...(input.plaidAccountId && { plaidAccountId: input.plaidAccountId }),
        ...(input.name && { name: input.name }),
        ...(input.mask && { mask: input.mask }),
        ...(input.type && { type: input.type }),
        ...(input.subtype && { subtype: input.subtype }),
        ...(input.currentBalance !== undefined && {
          currentBalance: input.currentBalance,
        }),
        ...(input.availableBalance !== undefined && {
          availableBalance: input.availableBalance,
        }),
        ...(input.isoCurrencyCode && { isoCurrencyCode: input.isoCurrencyCode }),
        lastSyncedAt: new Date(),
      })
      .where(eq(financeAccounts.id, existing.id));
    return existing.id;
  }

  const [created] = await db
    .insert(financeAccounts)
    .values({
      agentInstanceId: input.agentInstanceId,
      dataSourceConnectionId: input.dataSourceConnectionId ?? null,
      institutionName: institution,
      accountLast4: last4,
      plaidAccountId: input.plaidAccountId ?? null,
      name: input.name ?? null,
      mask: input.mask ?? null,
      type: input.type ?? null,
      subtype: input.subtype ?? null,
      currentBalance: input.currentBalance ?? null,
      availableBalance: input.availableBalance ?? null,
      isoCurrencyCode: input.isoCurrencyCode ?? null,
      lastSyncedAt: new Date(),
    })
    .returning({ id: financeAccounts.id });

  return created.id;
}
