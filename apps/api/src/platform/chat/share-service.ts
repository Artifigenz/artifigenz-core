import { randomBytes } from "node:crypto";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import {
  db,
  conversations,
  messages,
  sharedConversations,
  users,
} from "@artifigenz/db";

const TOKEN_ALPHABET =
  "abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // ~57 chars; drops look-alikes
const TOKEN_LENGTH = 12; // ~70 bits of entropy

function generateShareToken(): string {
  const bytes = randomBytes(TOKEN_LENGTH);
  let out = "";
  for (let i = 0; i < TOKEN_LENGTH; i++) {
    out += TOKEN_ALPHABET[bytes[i] % TOKEN_ALPHABET.length];
  }
  return out;
}

export interface SnapshotMessage {
  role: string;
  content: string;
  createdAt: string | null;
}

export interface ShareRecord {
  id: string;
  shareToken: string;
  conversationId: string;
  title: string | null;
  showOwnerName: boolean;
  viewCount: number;
  revokedAt: string | null;
  createdAt: string;
}

export interface PublicShareView {
  shareToken: string;
  title: string | null;
  ownerName: string | null;
  messages: SnapshotMessage[];
  createdAt: string;
}

export const shareService = {
  /**
   * Create a public, read-only snapshot of a conversation. The snapshot is
   * frozen at create-time — later messages in the source conversation do not
   * appear in the share. Generates a unique 12-char token; if a duplicate
   * happens (cosmically unlikely) we retry with a fresh token.
   */
  async createShare(args: {
    userId: string;
    conversationId: string;
    showOwnerName: boolean;
  }): Promise<ShareRecord> {
    const [conv] = await db
      .select({
        id: conversations.id,
        userId: conversations.userId,
        title: conversations.title,
      })
      .from(conversations)
      .where(eq(conversations.id, args.conversationId))
      .limit(1);

    if (!conv) throw new Error("Conversation not found");
    if (conv.userId !== args.userId) throw new Error("Not your conversation");

    const rows = await db
      .select({
        role: messages.role,
        content: messages.content,
        createdAt: messages.createdAt,
      })
      .from(messages)
      .where(eq(messages.conversationId, args.conversationId))
      .orderBy(messages.createdAt);

    const snapshot: SnapshotMessage[] = rows.map((m) => ({
      role: m.role,
      content: m.content,
      createdAt: m.createdAt ? m.createdAt.toISOString() : null,
    }));

    if (snapshot.length === 0) {
      throw new Error("Cannot share an empty conversation");
    }

    let attempts = 0;
    while (attempts < 5) {
      attempts++;
      const token = generateShareToken();
      try {
        const [row] = await db
          .insert(sharedConversations)
          .values({
            shareToken: token,
            conversationId: args.conversationId,
            ownerUserId: args.userId,
            title: conv.title,
            messagesSnapshot: snapshot,
            showOwnerName: args.showOwnerName,
          })
          .returning();
        return toShareRecord(row);
      } catch (err) {
        // Unique-violation on share_token — retry with a new token. Anything
        // else propagates.
        const msg = err instanceof Error ? err.message : String(err);
        if (!msg.includes("idx_shared_conversations_token")) throw err;
      }
    }
    throw new Error("Could not generate a unique share token");
  },

  /** List all (non-revoked) shares for a user, newest first. */
  async listShares(userId: string): Promise<ShareRecord[]> {
    const rows = await db
      .select()
      .from(sharedConversations)
      .where(
        and(
          eq(sharedConversations.ownerUserId, userId),
          isNull(sharedConversations.revokedAt),
        ),
      )
      .orderBy(desc(sharedConversations.createdAt));
    return rows.map(toShareRecord);
  },

  /**
   * Revoke a share. Caller must own it. Idempotent — calling twice is fine,
   * second call is a no-op.
   */
  async revokeShare(args: { userId: string; token: string }): Promise<boolean> {
    const result = await db
      .update(sharedConversations)
      .set({ revokedAt: new Date(), updatedAt: new Date() })
      .where(
        and(
          eq(sharedConversations.shareToken, args.token),
          eq(sharedConversations.ownerUserId, args.userId),
          isNull(sharedConversations.revokedAt),
        ),
      )
      .returning({ id: sharedConversations.id });
    return result.length > 0;
  },

  /**
   * Public read of a share by token. Returns null if the token doesn't exist
   * or has been revoked. Bumps view_count on every read so the owner can see
   * basic engagement. (Cheap update — no race concerns at expected scale.)
   */
  async getPublicShare(token: string): Promise<PublicShareView | null> {
    const [row] = await db
      .select({
        id: sharedConversations.id,
        shareToken: sharedConversations.shareToken,
        title: sharedConversations.title,
        messagesSnapshot: sharedConversations.messagesSnapshot,
        showOwnerName: sharedConversations.showOwnerName,
        revokedAt: sharedConversations.revokedAt,
        createdAt: sharedConversations.createdAt,
        ownerName: users.name,
      })
      .from(sharedConversations)
      .innerJoin(users, eq(users.id, sharedConversations.ownerUserId))
      .where(eq(sharedConversations.shareToken, token))
      .limit(1);

    if (!row) return null;
    if (row.revokedAt) return null;

    // Fire-and-forget view bump. We don't await — readers shouldn't wait on
    // the counter and a missed bump now and then is fine.
    db.update(sharedConversations)
      .set({ viewCount: sql<number>`view_count + 1` })
      .where(eq(sharedConversations.id, row.id))
      .catch(() => {});

    return {
      shareToken: row.shareToken,
      title: row.title,
      ownerName: row.showOwnerName
        ? (row.ownerName ?? "").split(/\s+/)[0] || null
        : null,
      messages: row.messagesSnapshot as SnapshotMessage[],
      createdAt: row.createdAt.toISOString(),
    };
  },
};

function toShareRecord(row: typeof sharedConversations.$inferSelect): ShareRecord {
  return {
    id: row.id,
    shareToken: row.shareToken,
    conversationId: row.conversationId,
    title: row.title,
    showOwnerName: row.showOwnerName,
    viewCount: row.viewCount,
    revokedAt: row.revokedAt ? row.revokedAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
  };
}

