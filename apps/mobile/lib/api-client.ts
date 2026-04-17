/**
 * API client — wraps fetch() with Clerk JWT auth.
 * Mirrors the web ApiClient so both platforms share the same contract.
 */

import { API_URL } from './config';

export type GetToken = () => Promise<string | null>;

export interface ApiError {
  status: number;
  message: string;
}

export class ApiClient {
  constructor(private getToken: GetToken) {}

  async request<T>(method: string, path: string, body?: unknown): Promise<T> {
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
    }>>('/api/agents/me/instances');
  }

  async activateAgent(agentTypeId: string, goal?: string) {
    return this.post<{ agentInstance: { id: string; agentTypeId: string; status: string } }>(
      `/api/agents/me/${agentTypeId}/activate`,
      { goal },
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
