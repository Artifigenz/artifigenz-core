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
    }>>(`/api/me/agents/${agentInstanceId}/connections`);
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

  /**
   * Upload a bank statement file. Uses FormData (not JSON), so we bypass
   * the normal request() method and construct the fetch manually.
   */
  async uploadFile(formData: FormData): Promise<{ transactions: number; insights: number }> {
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

    return data as { transactions: number; insights: number };
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

  async getConversations() {
    return this.get<{
      conversations: Array<{
        id: string;
        title: string;
        agentInstanceId: string;
        updatedAt: string;
      }>;
    }>('/api/me/conversations');
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
}
