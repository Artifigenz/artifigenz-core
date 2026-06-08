/**
 * API client — wraps fetch() with Clerk JWT auth.
 *
 * Typical usage via the useApiClient() hook, which creates an instance
 * bound to the current Clerk session's getToken() function.
 */

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

export type GetToken = () => Promise<string | null>;

export interface ApiError {
  status: number;
  message: string;
}

export interface StatementMetadata {
  institutionName: string | null;
  accountLast4: string | null;
  accountType: string | null;
  statementPeriod: { start: string; end: string } | null;
}

export type UploadResult =
  | {
      status: 'validated';
      fileId: string;
      file: { name: string; size: number; type: string };
      metadata: StatementMetadata;
    }
  | {
      status: 'needs_password';
      fileId: string;
      encryptedKind: 'pdf' | 'xlsx' | 'zip';
      file: { name: string; size: number; type: string };
    };

export type UnlockResult =
  | { status: 'validated'; metadata: StatementMetadata }
  | { status: 'rejected'; reason: string }
  | { status: 'wrong_password' }
  | { status: 'unsupported'; reason?: string };

export class ApiClient {
  constructor(private getToken: GetToken) {}

  async request<T>(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<T> {
    const token = await this.getToken();
    if (!token) {
      throw { status: 401, message: 'Not authenticated' } satisfies ApiError;
    }

    const res = await fetch(`${API_URL}${path}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: body ? JSON.stringify(body) : undefined,
    });

    if (res.status === 204) return undefined as T;

    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
      throw {
        status: res.status,
        message: (data as { error?: string }).error ?? `Request failed (${res.status})`,
      } satisfies ApiError;
    }

    return data as T;
  }

  get<T>(path: string) {
    return this.request<T>('GET', path);
  }
  post<T>(path: string, body?: unknown) {
    return this.request<T>('POST', path, body);
  }
  put<T>(path: string, body?: unknown) {
    return this.request<T>('PUT', path, body);
  }
  patch<T>(path: string, body?: unknown) {
    return this.request<T>('PATCH', path, body);
  }
  delete<T>(path: string) {
    return this.request<T>('DELETE', path);
  }

  // ─── Typed endpoint wrappers ──────────────────────────────────

  async getMe() {
    return this.get<{
      id: string;
      email: string;
      name: string | null;
      avatarUrl: string | null;
      timezone: string | null;
      locale: string | null;
      currency: string | null;
      onboardingCompleted: boolean;
      chatCustomInstructions: string | null;
    }>('/api/me');
  }

  async patchMe(updates: {
    name?: string;
    timezone?: string;
    locale?: string;
    currency?: string;
    onboardingCompleted?: boolean;
    chatCustomInstructions?: string | null;
  }) {
    return this.patch<{ user: unknown }>('/api/me', updates);
  }

  async getChatInstructions() {
    return this.get<{ instructions: string | null }>('/api/me/chat/instructions');
  }

  async updateChatInstructions(instructions: string | null) {
    return this.put<void>('/api/me/chat/instructions', { instructions });
  }

  async requestAccountDeletion() {
    return this.post<{ sent: true }>('/api/me/delete/request');
  }

  async confirmAccountDeletion(code: string) {
    return this.post<void>('/api/me/delete/confirm', { code });
  }

  async getAgents() {
    return this.get<Array<{
      id: string;
      name: string;
      description: string;
      icon?: string;
      skills: Array<{ id: string; name: string; description: string }>;
      dataSources: Array<{ typeId: string; name: string; description: string; connectionFlow: string }>;
    }>>('/api/agents');
  }

  async getMyAgents() {
    return this.get<Array<{
      id: string;
      agentTypeId: string;
      status: string;
      goal: string | null;
      lastAnalyzedAt: string | null;
      createdAt: string | null;
      updatedAt: string | null;
    }>>('/api/agents/me/instances');
  }

  async activateAgent(agentTypeId: string, goal?: string, status?: 'active' | 'onboarding') {
    return this.post<{ agentInstance: { id: string; agentTypeId: string; status: string } }>(
      `/api/agents/me/${agentTypeId}/activate`,
      { goal, status },
    );
  }

  async updateAgentInstance(agentInstanceId: string, updates: { goal?: string; status?: string }) {
    return this.patch<{ agentInstance: { id: string; status: string } }>(
      `/api/agents/me/instances/${agentInstanceId}`,
      updates,
    );
  }

  async deactivateAgent(agentInstanceId: string) {
    return this.delete<void>(`/api/agents/me/instances/${agentInstanceId}`);
  }

  /** Get existing instance for this user+agentType, or create one. */
  async getOrCreateAgentInstance(
    agentTypeId: string,
    opts?: { goal?: string; status?: 'active' | 'onboarding' },
  ) {
    const instances = await this.getMyAgents();
    const existing = instances.find((i) => i.agentTypeId === agentTypeId);
    if (existing) return existing;
    const { agentInstance } = await this.activateAgent(agentTypeId, opts?.goal, opts?.status);
    return { ...agentInstance, goal: opts?.goal ?? null, lastAnalyzedAt: null };
  }

  // ─── Data source connections (Plaid etc.) ─────────────────────

  async listConnections(agentInstanceId: string) {
    return this.get<Array<{
      id: string;
      dataSourceTypeId: string;
      displayName: string | null;
      status: string;
      lastSyncedAt: string | null;
      institutionId: string | null;
      institutionName: string | null;
      accounts: Array<{ id: string; name: string; mask: string | null }>;
      health: {
        isHealthy: boolean;
        lastSyncStatus: string | null;
        lastSyncError: string | null;
        requiresReauth: boolean;
        consecutiveFailures: number;
        suggestedAction: 'reconnect' | 'upload' | null;
      };
    }>>(`/api/me/agents/${agentInstanceId}/connections`);
  }

  async getConnectionsHealth(agentInstanceId: string) {
    return this.get<Record<string, {
      isHealthy: boolean;
      lastSyncStatus: string | null;
      lastSyncError: string | null;
      requiresReauth: boolean;
      consecutiveFailures: number;
      suggestedAction: 'reconnect' | 'upload' | null;
    }>>(`/api/me/agents/${agentInstanceId}/connections/health`);
  }

  async initConnection(
    agentInstanceId: string,
    dataSourceTypeId: string,
    options?: { redirectUri?: string; institutionId?: string },
  ) {
    return this.post<{ linkToken: string; expiration: string }>(
      `/api/me/agents/${agentInstanceId}/connections/${dataSourceTypeId}/init`,
      options ?? {},
    );
  }

  async getPopularInstitutions(country: string) {
    return this.get<{
      institutions: Array<{
        id: string;
        name: string;
        logo: string | null;
        primaryColor: string | null;
        url: string | null;
        countries: string[];
      }>;
      country: string;
      supported: boolean;
    }>(`/api/plaid/institutions?country=${encodeURIComponent(country)}`);
  }

  async finalizeConnection(
    agentInstanceId: string,
    dataSourceTypeId: string,
    body: {
      publicToken: string;
      metadata: {
        institutionName?: string;
        institutionId?: string;
        accounts?: Array<{ id: string; name: string; mask: string | null }>;
      };
    },
  ) {
    return this.post<{ connection: { id: string; dataSourceTypeId: string } }>(
      `/api/me/agents/${agentInstanceId}/connections/${dataSourceTypeId}/finalize`,
      body,
    );
  }

  async disconnectConnection(agentInstanceId: string, connectionId: string) {
    return this.delete<void>(
      `/api/me/agents/${agentInstanceId}/connections/${connectionId}`,
    );
  }

  /** Sync all Plaid connections + run skill inline. Takes ~10-15s in sandbox. */
  async syncAgent(agentInstanceId: string) {
    return this.post<{ transactions: number; insights: number }>(
      `/api/upload/sync/${agentInstanceId}`,
    );
  }

  /**
   * Run LLM categorization across all transactions for the user's finance
   * agent. Takes ~30-90s depending on how many unique merchants the user has.
   */
  async categorizeFinance() {
    return this.post<{
      clustersAnalyzed: number;
      clustersSkippedCached: number;
      txnsBackfilled: number;
      orphansBackfilled: number;
      errors: Array<{ merchant: string; error: string }>;
    }>(`/api/finance/categorize`);
  }

  /**
   * Fetch every consolidated transaction for the user's finance agent — the
   * source-of-truth table backing the breakdown page.
   */
  /**
   * Devtools: nuke all finance data and the agent instance for the caller.
   * Plaid OAuth tokens are deleted — you'll re-link banks on the next
   * onboarding pass.
   */
  async wipeFinanceAgent() {
    return this.post<{
      success: boolean;
      message: string;
      removed: Record<string, number>;
    }>('/api/finance/wipe');
  }

  /**
   * Per-connection ingestion progress. The onboarding loading screen polls
   * this every ~3s; each call also opportunistically kicks throttled syncs
   * for connections still pulling history.
   */
  async getAgentStatus() {
    return this.get<{
      agentExists: boolean;
      agentInstanceId?: string;
      agentStatus?: string;
      ingestionComplete: boolean;
      totalTransactions: number;
      connections: Array<{
        id: string;
        dataSourceTypeId: string;
        displayName: string | null;
        ingestionState: 'pending' | 'in_progress' | 'complete' | 'needs_auth' | 'failed';
        ingestionStartedAt: string | null;
        ingestionCompletedAt: string | null;
        lastSyncedAt: string | null;
        lastSyncStatus: string | null;
        lastSyncError: string | null;
        lastSyncAddedCount: number | null;
        consecutiveEmptySyncs: number | null;
        transactionCount: number;
        accountCount: number;
        syncTriggered: boolean;
        files: Array<{
          id: string;
          filename: string;
          parseState: 'pending' | 'validated' | 'parsing' | 'complete' | 'failed';
          parseError: string | null;
          institutionName: string | null;
          accountLast4: string | null;
          statementPeriodStart: string | null;
          statementPeriodEnd: string | null;
        }>;
      }>;
    }>('/api/finance/agent-status');
  }

  /**
   * Re-pull Plaid history for all active bank connections on the user's
   * finance agent, then re-categorize. Useful when Plaid's historical
   * backfill landed after the initial sync.
   */
  async resyncFinance() {
    return this.post<{
      success: boolean;
      perConnection: Array<{
        displayName: string | null;
        inserted: number;
        skipped: number;
        accounts: number;
        error?: string;
      }>;
      categorize: {
        clustersAnalyzed: number;
        clustersSkippedCached: number;
        txnsBackfilled: number;
      };
    }>('/api/finance/resync');
  }

  /**
   * One row per finance_account joined with its sources (Plaid + uploads).
   * Powers /finance/accounts.
   */
  async getFinanceAccounts() {
    return this.get<{
      accounts: Array<{
        id: string;
        institutionName: string | null;
        accountLast4: string | null;
        name: string | null;
        type: string | null;
        subtype: string | null;
        currentBalance: number | null;
        availableBalance: number | null;
        isoCurrencyCode: string | null;
        transactionCount: number;
        plaid: {
          connectionId: string;
          displayName: string | null;
          status: string;
          lastSyncedAt: string | null;
          requiresReauth: boolean;
          ingestionState: string;
        } | null;
        upload: {
          connectionId: string;
          statements: Array<{
            id: string;
            filename: string;
            parseState: 'pending' | 'validated' | 'parsing' | 'complete' | 'failed';
            uploadedAt: string | null;
            statementPeriodStart: string | null;
            statementPeriodEnd: string | null;
            transactionCount: number | null;
          }>;
        } | null;
      }>;
    }>('/api/finance/accounts');
  }

  async getFinanceTransactions() {
    return this.get<{
      count: number;
      totals: { income: number; expenses: number; net: number };
      transactions: Array<{
        id: string;
        date: string;
        description: string;
        merchantName: string | null;
        merchantNormalized: string | null;
        amount: number;
        source: string;
        category: string | null;
        isRecurring: boolean | null;
        accountName: string | null;
        institutionName: string | null;
        accountLast4: string | null;
      }>;
    }>('/api/finance/transactions');
  }

  async getFinanceClusters() {
    return this.get<{
      count: number;
      clusters: Array<{
        /** Stable per-cluster id — brand_slug if resolved, else first alias */
        key: string;
        /** Canonical brand identity (null until resolved) */
        brandSlug: string | null;
        /** Every merchant_normalized variant that landed in this cluster */
        aliases: string[];
        /** Kept for backwards compat with older UI — first alias */
        merchantNormalized: string;
        displayName: string;
        logoUrl: string | null;
        website: string | null;
        txnCount: number;
        totalAmount: number;
        inflowAmount: number;
        outflowAmount: number;
        firstSeen: string;
        lastSeen: string;
        category: string | null;
        systemCategory: string | null;
        isRecurring: boolean | null;
      }>;
    }>('/api/finance/clusters');
  }

  async getFinanceCategories() {
    return this.get<{
      categories: Array<{
        category: string;
        label: string;
        count: number;
        totalAbs: number;
        inflow: number;
        outflow: number;
      }>;
    }>('/api/finance/categories');
  }

  async getFinanceMiscellaneous() {
    return this.get<{
      subtypes: Array<{
        subtype: string;
        label: string;
        total: number;
        brands: Array<{
          brandSlug: string;
          displayName: string;
          logoUrl: string | null;
          txnCount: number;
          total: number;
          avgAmount: number;
          firstDate: string;
          lastDate: string;
          sampleDescriptions: string[];
        }>;
      }>;
      total: number;
    }>('/api/finance/categories/miscellaneous');
  }

  async getFinanceVariableRecurring() {
    return this.get<{
      brands: Array<{
        brandSlug: string;
        displayName: string;
        logoUrl: string | null;
        systemCategory: string | null;
        txnCount: number;
        total: number;
        avgAmount: number;
        firstDate: string;
        lastDate: string;
        sampleDescriptions: string[];
      }>;
      total: number;
    }>('/api/finance/categories/variable-recurring');
  }

  async getFinanceLoanEmi() {
    return this.get<{
      brands: Array<{
        brandSlug: string;
        displayName: string;
        logoUrl: string | null;
        systemCategory: string | null;
        txnCount: number;
        total: number;
        avgAmount: number;
        firstDate: string;
        lastDate: string;
        sampleDescriptions: string[];
      }>;
      total: number;
    }>('/api/finance/categories/loan-emi');
  }

  async getFinanceFeeInterest() {
    return this.get<{
      brands: Array<{
        brandSlug: string;
        displayName: string;
        logoUrl: string | null;
        systemCategory: string | null;
        txnCount: number;
        total: number;
        avgAmount: number;
        firstDate: string;
        lastDate: string;
        sampleDescriptions: string[];
      }>;
      total: number;
    }>('/api/finance/categories/fee-interest');
  }

  async getFinanceSubscriptions() {
    return this.get<{
      active: Array<{
        brandSlug: string;
        displayName: string;
        logoUrl: string | null;
        txnCount: number;
        total: number;
        avgAmount: number;
        firstDate: string;
        lastDate: string;
        cadence: string;
        daysSinceLast: number;
        active: boolean;
      }>;
      potentiallyCancelled: Array<{
        brandSlug: string;
        displayName: string;
        logoUrl: string | null;
        txnCount: number;
        total: number;
        avgAmount: number;
        firstDate: string;
        lastDate: string;
        cadence: string;
        daysSinceLast: number;
        active: boolean;
      }>;
      activeTotal: number;
      cancelledTotal: number;
      total: number;
      asOf: string | null;
    }>('/api/finance/categories/subscriptions');
  }

  async getFinanceIncome() {
    return this.get<{
      subtypes: Array<{
        subtype: string;
        label: string;
        total: number;
        streams: Array<{
          brandSlug: string;
          displayName: string;
          logoUrl: string | null;
          txnCount: number;
          total: number;
          firstDate: string;
          lastDate: string;
          cadence: string;
        }>;
      }>;
      total: number;
    }>('/api/finance/categories/income');
  }

  async getFinanceInternalTransfers() {
    return this.get<{
      pairs: Array<{
        pairId: string;
        fromLabel: string;
        toLabel: string;
        amount: number;
        date: string;
        systemCategory: string | null;
        outDescription: string;
        inDescription: string;
        outId: string;
        inId: string;
      }>;
      unpaired: Array<{
        id: string;
        label: string;
        direction: 'in' | 'out' | null;
        amount: number;
        date: string;
        description: string;
        systemCategory: string | null;
        reasoning: string | null;
      }>;
      total: number;
    }>('/api/finance/categories/internal-transfers');
  }

  async getInsights(options?: {
    unreadOnly?: boolean;
    agentTypeId?: string;
    skillId?: string;
    page?: number;
    limit?: number;
  }) {
    const params = new URLSearchParams();
    if (options?.unreadOnly) params.set('unreadOnly', 'true');
    if (options?.agentTypeId) params.set('agentTypeId', options.agentTypeId);
    if (options?.skillId) params.set('skillId', options.skillId);
    if (options?.page) params.set('page', String(options.page));
    if (options?.limit) params.set('limit', String(options.limit));
    const qs = params.toString() ? `?${params.toString()}` : '';
    return this.get<{
      insights: Array<{
        id: string;
        title: string;
        description: string | null;
        insightTypeId: string;
        data: Record<string, unknown>;
        isCritical: boolean;
        isRead: boolean;
        createdAt: string;
      }>;
      unreadCount: number;
      pagination: { page: number; limit: number; hasMore: boolean };
    }>(`/api/me/insights${qs}`);
  }

  async markInsightRead(insightId: string) {
    return this.patch<void>(`/api/me/insights/${insightId}/read`);
  }

  async getUploadHistory() {
    return this.get<{
      uploads: Array<{
        id: string;
        filename: string;
        fileType: string;
        status: string;
        transactionCount: number | null;
        uploadedAt: string;
        processedAt: string | null;
        statementPeriod: { start: string; end: string } | null;
      }>;
      lastSyncedAt: string | null;
    }>('/api/upload/history');
  }

  /**
   * Upload a bank statement file. Uses FormData (not JSON), so we bypass
   * the normal request() method and construct the fetch manually.
   */
  /**
   * Correct the institution name on an uploaded statement. Used when the
   * validator misread or returned null and the user knows the right bank.
   */
  async renameFileUpload(fileId: string, institutionName: string) {
    return this.patch<{ success: boolean; institutionName: string }>(
      `/api/finance/file-uploads/${fileId}`,
      { institutionName },
    );
  }

  async uploadFile(formData: FormData): Promise<UploadResult> {
    const token = await this.getToken();
    if (!token) throw { status: 401, message: 'Not authenticated' } satisfies ApiError;

    const res = await fetch(`${API_URL}/api/upload`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: formData,
    });

    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
      throw {
        status: res.status,
        message: (data as { error?: string }).error ?? `Upload failed (${res.status})`,
      } satisfies ApiError;
    }

    return data as UploadResult;
  }

  /**
   * Unlock a password-protected upload. Returns the post-validation state.
   * The password is sent in the request body over TLS, held in memory on
   * the server only for the duration of decryption, and never persisted.
   */
  async unlockUpload(
    fileId: string,
    password: string,
  ): Promise<UnlockResult> {
    const token = await this.getToken();
    if (!token) throw { status: 401, message: 'Not authenticated' } satisfies ApiError;

    const res = await fetch(`${API_URL}/api/upload/${fileId}/unlock`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ password }),
    });
    const data = await res.json().catch(() => ({}));
    // 401 here is specifically wrong_password — bubble as a normal result,
    // not an auth error.
    if (res.status === 401 && (data as { status?: string }).status === 'wrong_password') {
      return { status: 'wrong_password' };
    }
    if (!res.ok) {
      throw {
        status: res.status,
        message: (data as { error?: string }).error ?? `Unlock failed (${res.status})`,
      } satisfies ApiError;
    }
    return data as UnlockResult;
  }

  /**
   * Upload a health data export (Apple Health XML, CSV, etc.).
   */
  async uploadHealthFile(formData: FormData): Promise<{ metrics: number; insights: number }> {
    const token = await this.getToken();
    if (!token) throw { status: 401, message: 'Not authenticated' } satisfies ApiError;

    const res = await fetch(`${API_URL}/api/upload/health`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: formData,
    });

    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
      throw {
        status: res.status,
        message: (data as { error?: string }).error ?? `Upload failed (${res.status})`,
      } satisfies ApiError;
    }

    return data as { metrics: number; insights: number };
  }

  // ─── The Brief ─────────────────────────────────────────────────

  /** Kick off Brief generation. Returns a generation_id to subscribe to. */
  async generateBrief() {
    return this.post<{ generation_id: string }>('/api/brief/generate');
  }

  /**
   * Open the SSE stream of Brief-generation progress events. Uses fetch()
   * manually because native EventSource can't send an Authorization header.
   * Returns the Response — caller reads response.body as a ReadableStream.
   */
  async briefEventsResponse(generationId: string): Promise<Response> {
    const token = await this.getToken();
    if (!token) {
      throw { status: 401, message: 'Not authenticated' } satisfies ApiError;
    }
    const res = await fetch(
      `${API_URL}/api/brief/generate/${generationId}/events`,
      {
        method: 'GET',
        headers: { Authorization: `Bearer ${token}`, Accept: 'text/event-stream' },
      },
    );
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw {
        status: res.status,
        message:
          (data as { error?: string }).error ??
          `Brief event stream failed (${res.status})`,
      } satisfies ApiError;
    }
    return res;
  }

  async getCurrentBrief() {
    return this.get<{
      id: string;
      verdict: string;
      numbers: Array<{ value: string; phrase: string }>;
      paragraph: string;
      summary: {
        income: number;
        outflow: number;
        leftover: number;
        breakdown: Array<{
          id: string;
          label: string;
          sublabel: string;
          amount: number;
          count?: number;
        }>;
      };
      data_scope: string;
      generated_at: string;
    }>('/api/brief/current');
  }

  async getBriefBreakdown() {
    // Shared item type for all categories
    type BreakdownItem = {
      id: string;
      merchantName: string;
      description: string | null;
      amount: number;
      monthlyAmount: number;
      frequency: string;
      lastDate: string | null;
      nextDate: string | null;
      accountId: string | null;
      accountName: string | null;
      accountMask: string | null;
      category: string | null;
      categoryConfidence: number | null;
      pfcPrimary: string | null;
    };
    type CategorySection = { total: number; count: number; items: BreakdownItem[] };

    return this.get<{
      generatedAt: string;
      accounts: Array<{
        id: string;
        name: string | null;
        mask: string | null;
        type: string | null;
        subtype: string | null;
        currentBalance: number;
        availableBalance: number | null;
        currency: string | null;
      }>;
      income: { total: number; items: BreakdownItem[] };
      transfersIn: CategorySection;
      transfersOut: CategorySection;
      subscriptions: CategorySection;
      loans: CategorySection;
      fees: CategorySection;
      rent: CategorySection;
      utilities: CategorySection;
      insurance: CategorySection;
      variable: CategorySection;
      other: CategorySection;
      totals: {
        income: number;
        fixedRecurring: number;
        variableRecurring: number;
        recurringOutflow: number;
        totalExpenses: number;
        leftover: number;
      };
      diagnostics?: {
        connections: Array<{
          id: string;
          institution: string;
          status: string;
          accountCount: number;
          streamCount: number;
          lastSynced: string | null;
        }>;
        totalStreams: number;
        streamsByAccount: Array<{ account: string; streams: number }>;
      };
    }>('/api/brief/breakdown');
  }

  async resetAllCategories() {
    return this.post<{ success: boolean; message: string }>('/api/brief/categories/reset');
  }

  async overrideStreamCategory(streamId: string, category: string) {
    return this.patch<{
      success: boolean;
      streamId: string;
      category: string;
      merchantName: string;
      message: string;
    }>(`/api/brief/streams/${streamId}/category`, { category });
  }

  async getDeliveryPreferences() {
    return this.get<{
      email: { enabled: boolean; address: string | null };
      whatsapp: { enabled: boolean; number: string | null };
      telegram: { enabled: boolean; chatId: string | null };
    }>('/api/me/delivery');
  }

  async updateDeliveryPreferences(prefs: {
    email?: { enabled?: boolean; address?: string };
    telegram?: { enabled?: boolean; chatId?: string };
  }) {
    return this.patch<{ deliveryPreferences: unknown }>('/api/me/delivery', prefs);
  }

  async generateTelegramLink() {
    return this.post<{ linkUrl: string; expiresAt: string }>('/api/me/delivery/telegram/link');
  }

  async getTelegramStatus() {
    return this.get<{ connected: boolean; linkPending: boolean }>('/api/me/delivery/telegram/status');
  }

  async getConversations() {
    return this.get<{
      conversations: Array<{
        id: string;
        title: string | null;
        messageCount: number | null;
        pinned: boolean;
        updatedAt: string | null;
        lastUserText: string | null;
        lastAssistantText: string | null;
        lastAssistantModelId: string | null;
        hasAttachments: boolean;
      }>;
    }>('/api/me/conversations');
  }

  async updateConversation(
    id: string,
    updates: { title?: string; pinned?: boolean },
  ) {
    return this.patch<{ conversation: { id: string; title: string | null; pinned: boolean } }>(
      `/api/me/conversations/${id}`,
      updates,
    );
  }

  async getConversation(id: string) {
    return this.get<{
      conversation: { id: string; title: string };
      messages: Array<{ id: string; role: string; content: string; createdAt: string }>;
    }>(`/api/me/conversations/${id}`);
  }

  async deleteConversation(id: string) {
    return this.delete<void>(`/api/me/conversations/${id}`);
  }

  /** Devtools: wipe every conversation for the current user. */
  async wipeAllConversations() {
    return this.delete<{ removed: number }>('/api/me/conversations');
  }

  /**
   * Send a chat message — returns a ReadableStream of SSE events.
   * Caller is responsible for parsing the stream.
   */
  async sendChatMessage(params: {
    message: string;
    agentInstanceId?: string;
    conversationId?: string;
    anchoredInsightId?: string;
  }): Promise<Response> {
    const token = await this.getToken();
    if (!token) {
      throw { status: 401, message: 'Not authenticated' } satisfies ApiError;
    }

    const res = await fetch(`${API_URL}/api/me/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(params),
    });

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw {
        status: res.status,
        message: (data as { error?: string }).error ?? `Chat request failed (${res.status})`,
      } satisfies ApiError;
    }

    return res;
  }

  // ─── Dev Tools ──────────────────────────────────────────────────

  async resetSkillState(agentInstanceId: string, skillId: string) {
    return this.post<void>(`/api/agents/me/instances/${agentInstanceId}/skills/${skillId}/reset`);
  }

  async clearInsights(agentInstanceId: string) {
    return this.delete<void>(`/api/agents/me/instances/${agentInstanceId}/insights`);
  }

  async getDebugInfo(agentInstanceId: string) {
    return this.get<{
      agentInstanceId: string;
      userId: string;
      transactionCount: number;
      insightCount: number;
      skillRecord: {
        exists: boolean;
        isEnabled?: boolean;
        state?: unknown;
        lastRunAt?: string;
      };
      sampleTransactions: Array<{
        id: string;
        date: string;
        merchant: string | null;
        description: string;
        amount: string;
        category: string | null;
        accountName: string | null;
      }>;
    }>(`/api/agents/me/instances/${agentInstanceId}/debug`);
  }

  // ─── Memories ─────────────────────────────────────────────────

  async listMemories(opts?: { source?: MemorySource; includeInactive?: boolean }) {
    const params = new URLSearchParams();
    if (opts?.source) params.set("source", opts.source);
    if (opts?.includeInactive) params.set("includeInactive", "true");
    const qs = params.toString();
    return this.get<{ memories: MemoryRow[] }>(
      `/api/me/memories${qs ? `?${qs}` : ""}`,
    );
  }

  async createMemory(input: { text: string; type?: string; source?: MemorySource }) {
    return this.post<{ memory: MemoryRow }>(`/api/me/memories`, input);
  }

  async updateMemory(id: string, updates: { text?: string; type?: string; active?: boolean }) {
    return this.patch<{ memory: MemoryRow }>(`/api/me/memories/${id}`, updates);
  }

  async deleteMemory(id: string) {
    return this.delete<void>(`/api/me/memories/${id}`);
  }

  async importMemories(input: { source: MemorySource; text: string }) {
    return this.post<{ imported: number; memories: MemoryRow[] }>(
      `/api/me/memories/import`,
      input,
    );
  }

  async deleteMemoriesBySource(source: MemorySource) {
    return this.delete<void>(`/api/me/memories/source/${source}`);
  }

  async getMemoryImportPrompt() {
    return this.get<{ prompt: string }>(`/api/me/memories/import-prompt`);
  }

  // ─── Chat sharing ───────────────────────────────────────────────

  async createShare(conversationId: string, showOwnerName = true) {
    return this.post<{ share: ShareRecord }>(`/api/me/shares`, {
      conversationId,
      showOwnerName,
    });
  }

  async listShares() {
    return this.get<{ shares: ShareRecord[] }>(`/api/me/shares`);
  }

  async revokeShare(token: string) {
    return this.delete<void>(`/api/me/shares/${token}`);
  }
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

export type MemorySource =
  | "artifigenz_chat"
  | "chatgpt_import"
  | "claude_import"
  | "manual";

export interface MemoryRow {
  id: string;
  userId: string;
  type: string;
  text: string;
  source: MemorySource;
  active: boolean;
  createdAt: string | null;
}
