'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from '@clerk/nextjs';
import { DEFAULT_MODEL_ID } from '@artifigenz/shared';
import Header from '@/components/layout/Header';
import Hero from '@/components/sections/Hero';
import AgentGrid from '@/components/sections/AgentGrid';
import ChatInput, { type ChatAttachmentDraft } from '@/components/sections/ChatInput';
import HomeChatMessages, { type ChatMessage } from '@/components/sections/HomeChatMessages';
import ChatHistoryModal from '@/components/sections/ChatHistoryModal';
import styles from './page.module.css';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

// Typewriter pacing — chars revealed per animation frame.
const REVEAL_BASE = 3;
const REVEAL_CATCHUP = 12;
const CATCHUP_THRESHOLD = 240;

export default function AppHome() {
  const { getToken } = useAuth();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [toolStatus, setToolStatus] = useState<string | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [attachments, setAttachments] = useState<ChatAttachmentDraft[]>([]);
  const [modelId, setModelId] = useState<string>(DEFAULT_MODEL_ID);

  // Restore last selected model from localStorage on mount.
  useEffect(() => {
    const stored = localStorage.getItem('artifigenz.chat.model');
    if (stored) setModelId(stored);
  }, []);

  const changeModel = useCallback((id: string) => {
    setModelId(id);
    try {
      localStorage.setItem('artifigenz.chat.model', id);
    } catch {
      // localStorage can throw in some private-browsing modes; ignore.
    }
  }, []);

  const bufferRef = useRef<Map<string, { pending: string; displayed: string }>>(new Map());
  const rafRef = useRef<number | null>(null);
  const streamDoneRef = useRef<Set<string>>(new Set());
  const abortRef = useRef<AbortController | null>(null);

  const inChat = messages.length > 0;

  const tick = useCallback(() => {
    let dirty = false;
    let stillAnimating = false;

    bufferRef.current.forEach((entry, id) => {
      const remaining = entry.pending.length - entry.displayed.length;
      if (remaining <= 0) {
        if (streamDoneRef.current.has(id)) {
          bufferRef.current.delete(id);
          streamDoneRef.current.delete(id);
        }
        return;
      }
      const step =
        remaining > CATCHUP_THRESHOLD ? REVEAL_CATCHUP : REVEAL_BASE;
      entry.displayed = entry.pending.slice(0, entry.displayed.length + step);
      dirty = true;
      stillAnimating = true;
    });

    if (dirty) {
      const snap = new Map<string, string>();
      bufferRef.current.forEach((e, id) => snap.set(id, e.displayed));
      setMessages((prev) =>
        prev.map((m) => (snap.has(m.id) ? { ...m, content: snap.get(m.id)! } : m)),
      );
    }

    if (stillAnimating || bufferRef.current.size > 0) {
      rafRef.current = requestAnimationFrame(tick);
    } else {
      rafRef.current = null;
      setStreaming(false);
    }
  }, []);

  const startTicker = useCallback(() => {
    if (rafRef.current == null) {
      rafRef.current = requestAnimationFrame(tick);
    }
  }, [tick]);

  useEffect(() => {
    return () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    };
  }, []);

  const addAttachmentFiles = useCallback(
    async (files: File[]) => {
      const token = await getToken();
      if (!token) return;
      for (const file of files) {
        const tempId = `tmp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        const previewUrl = file.type.startsWith('image/')
          ? URL.createObjectURL(file)
          : undefined;
        setAttachments((prev) => [
          ...prev,
          {
            fileId: tempId,
            filename: file.name,
            mimeType: file.type,
            sizeBytes: file.size,
            previewUrl,
            status: 'uploading',
          },
        ]);
        try {
          const formData = new FormData();
          formData.append('file', file);
          const res = await fetch(`${API_URL}/api/me/chat/attachments`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${token}` },
            body: formData,
          });
          if (!res.ok) {
            const err = await res.json().catch(() => ({ error: 'Upload failed' }));
            throw new Error(err.error ?? `Upload failed (${res.status})`);
          }
          const data = (await res.json()) as {
            fileId: string;
            filename: string;
            mimeType: string;
            sizeBytes: number;
            extension: string;
          };
          setAttachments((prev) =>
            prev.map((a) =>
              a.fileId === tempId
                ? {
                    ...a,
                    fileId: data.fileId,
                    extension: data.extension,
                    status: 'ready',
                  }
                : a,
            ),
          );
        } catch (err) {
          setAttachments((prev) =>
            prev.map((a) =>
              a.fileId === tempId
                ? {
                    ...a,
                    status: 'error',
                    error:
                      err instanceof Error ? err.message : 'Upload failed',
                  }
                : a,
            ),
          );
        }
      }
    },
    [getToken],
  );

  const removeAttachment = useCallback((fileId: string) => {
    setAttachments((prev) => {
      const target = prev.find((a) => a.fileId === fileId);
      if (target?.previewUrl) URL.revokeObjectURL(target.previewUrl);
      return prev.filter((a) => a.fileId !== fileId);
    });
  }, []);

  /** Sends a message. If `truncateFromMessageId` is set, the server deletes
   *  that message and everything newer (used by edit + regenerate). */
  const runSend = useCallback(
    async (
      text: string,
      opts?: {
        truncateFromMessageId?: string;
        attachments?: ChatAttachmentDraft[];
        model?: string;
      },
    ) => {
      if ((!text && (!opts?.attachments || opts.attachments.length === 0)) || streaming) return;

      const localUserId = `u-${Date.now()}`;
      const localAssistantId = `a-${Date.now()}`;
      const sendAtts = (opts?.attachments ?? []).filter(
        (a) => a.status === 'ready',
      );
      const userMsg: ChatMessage = {
        id: localUserId,
        role: 'user',
        content: text,
        attachments: sendAtts.map((a) => ({
          fileId: a.fileId,
          filename: a.filename,
          mimeType: a.mimeType,
          sizeBytes: a.sizeBytes,
        })),
      };

      bufferRef.current.set(localAssistantId, { pending: '', displayed: '' });
      setMessages((prev) => {
        let truncated = prev;
        if (opts?.truncateFromMessageId) {
          const i = prev.findIndex(
            (m) => m.serverId === opts.truncateFromMessageId,
          );
          if (i >= 0) truncated = prev.slice(0, i);
        }
        return [
          ...truncated,
          userMsg,
          { id: localAssistantId, role: 'assistant', content: '' },
        ];
      });
      setStreaming(true);
      setToolStatus(null);

      try {
        const token = await getToken();
        if (!token) throw new Error('Not authenticated');

        const controller = new AbortController();
        abortRef.current = controller;
        const res = await fetch(`${API_URL}/api/me/chat`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            message: text,
            model: opts?.model ?? modelId,
            conversationId: conversationId || undefined,
            truncateFromMessageId: opts?.truncateFromMessageId,
            attachments: sendAtts.map((a) => ({
              fileId: a.fileId,
              filename: a.filename,
              mimeType: a.mimeType,
              sizeBytes: a.sizeBytes,
              extension: a.extension,
            })),
          }),
          signal: controller.signal,
        });

        if (!res.ok) {
          const err = await res.json().catch(() => ({ error: 'Chat failed' }));
          throw new Error((err as { error?: string }).error ?? `Error ${res.status}`);
        }

        const reader = res.body?.getReader();
        if (!reader) throw new Error('No response stream');
        const decoder = new TextDecoder();
        let buf = '';
        // SSE: each event is a `event: <type>\ndata: <json>\n\n` block.
        // We track the current event type as we walk lines.
        let currentEvent = '';

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });
          const lines = buf.split('\n');
          buf = lines.pop() ?? '';

          for (const line of lines) {
            if (line === '') {
              currentEvent = '';
              continue;
            }
            if (line.startsWith('event: ')) {
              currentEvent = line.slice(7).trim();
              continue;
            }
            if (!line.startsWith('data: ')) continue;
            let data: Record<string, unknown>;
            try {
              data = JSON.parse(line.slice(6));
            } catch {
              continue;
            }

            switch (currentEvent) {
              case 'conversation':
                if (typeof data.conversationId === 'string') {
                  setConversationId(data.conversationId);
                }
                break;
              case 'user_message':
                if (typeof data.messageId === 'string') {
                  const serverId = data.messageId;
                  setMessages((prev) =>
                    prev.map((m) =>
                      m.id === localUserId ? { ...m, serverId } : m,
                    ),
                  );
                }
                break;
              case 'delta':
                if (typeof data.content === 'string') {
                  const entry = bufferRef.current.get(localAssistantId);
                  if (entry) entry.pending += data.content;
                  startTicker();
                }
                break;
              case 'tool_use': {
                const toolName = String(data.tool ?? '');
                const label =
                  toolName === 'web_search'
                    ? 'Searching the web'
                    : toolName
                        .replace(/([A-Z])/g, ' $1')
                        .replace(/^get\s/i, 'Looking up ')
                        .trim();
                setToolStatus(`${label}...`);
                break;
              }
              case 'tool_result':
                setToolStatus(null);
                break;
              case 'citations':
                if (Array.isArray(data.citations)) {
                  const citations = data.citations as Array<{
                    url: string;
                    title: string;
                    citedText?: string;
                  }>;
                  setMessages((prev) =>
                    prev.map((m) =>
                      m.id === localAssistantId ? { ...m, citations } : m,
                    ),
                  );
                }
                break;
              case 'done':
                if (typeof data.messageId === 'string') {
                  const serverId = data.messageId;
                  setMessages((prev) =>
                    prev.map((m) =>
                      m.id === localAssistantId ? { ...m, serverId } : m,
                    ),
                  );
                }
                setToolStatus(null);
                break;
              case 'error':
                bufferRef.current.delete(localAssistantId);
                setMessages((prev) =>
                  prev.map((m) =>
                    m.id === localAssistantId
                      ? { ...m, content: `Error: ${data.message ?? 'Unknown error'}` }
                      : m,
                  ),
                );
                break;
            }
          }
        }

        streamDoneRef.current.add(localAssistantId);
        startTicker();
      } catch (err) {
        const isAbort =
          err instanceof DOMException && err.name === 'AbortError';
        if (isAbort) {
          // User clicked stop — flush whatever's already in the buffer so it
          // stays visible, then let the ticker drain.
          const entry = bufferRef.current.get(localAssistantId);
          if (entry) entry.displayed = entry.pending;
          streamDoneRef.current.add(localAssistantId);
          startTicker();
        } else {
          bufferRef.current.delete(localAssistantId);
          streamDoneRef.current.delete(localAssistantId);
          setMessages((prev) =>
            prev.map((m) =>
              m.id === localAssistantId
                ? {
                    ...m,
                    content: `Error: ${err instanceof Error ? err.message : 'Something went wrong'}`,
                  }
                : m,
            ),
          );
          setStreaming(false);
        }
        setToolStatus(null);
      } finally {
        abortRef.current = null;
        setToolStatus(null);
      }
    },
    [streaming, conversationId, getToken, startTicker, modelId],
  );

  const sendMessage = useCallback(async () => {
    const text = input.trim();
    const ready = attachments.filter((a) => a.status === 'ready');
    if (!text && ready.length === 0) return;
    setInput('');
    setAttachments([]);
    await runSend(text, { attachments: ready });
  }, [input, attachments, runSend]);

  const stopGenerating = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const newChat = useCallback(() => {
    abortRef.current?.abort();
    bufferRef.current.clear();
    streamDoneRef.current.clear();
    if (rafRef.current != null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    setMessages([]);
    setInput('');
    setConversationId(null);
    setStreaming(false);
    setToolStatus(null);
  }, []);

  const loadConversation = useCallback(
    async (id: string) => {
      // Abort whatever's in flight, then fetch the conversation's messages.
      abortRef.current?.abort();
      bufferRef.current.clear();
      streamDoneRef.current.clear();
      if (rafRef.current != null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
      setStreaming(false);
      setToolStatus(null);

      try {
        const token = await getToken();
        if (!token) throw new Error('Not authenticated');
        const res = await fetch(`${API_URL}/api/me/conversations/${id}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) throw new Error(`Failed to load: ${res.status}`);
        const data = (await res.json()) as {
          conversation: { id: string };
          messages: Array<{
            id: string;
            role: 'user' | 'assistant';
            content: string;
            metadata?: {
              citations?: ChatMessage['citations'];
              attachments?: ChatMessage['attachments'];
            } | null;
          }>;
        };
        setConversationId(data.conversation.id);
        setMessages(
          data.messages.map((m) => ({
            id: `${m.role[0]}-${m.id}`,
            serverId: m.id,
            role: m.role,
            content: m.content,
            citations: m.metadata?.citations,
            attachments: m.metadata?.attachments,
          })),
        );
        // Scroll to bottom on next paint
        requestAnimationFrame(() => {
          window.scrollTo({ top: document.documentElement.scrollHeight });
        });
      } catch (err) {
        console.error('[chat] load failed', err);
      }
    },
    [getToken],
  );

  const onEditSubmit = useCallback(
    async (messageId: string, newText: string) => {
      const target = messages.find((m) => m.id === messageId);
      if (!target?.serverId) return;
      await runSend(newText, { truncateFromMessageId: target.serverId });
    },
    [messages, runSend],
  );

  const onRegenerate = useCallback(
    async (assistantMessageId: string, overrideModelId?: string) => {
      const idx = messages.findIndex((m) => m.id === assistantMessageId);
      if (idx <= 0) return;
      const prevUser = messages[idx - 1];
      const assistant = messages[idx];
      if (prevUser?.role !== 'user' || !assistant.serverId) return;
      // If user retried with a different model, also flip the picker so the
      // next manual send keeps that model — matches ChatGPT's behavior.
      if (overrideModelId && overrideModelId !== modelId) {
        changeModel(overrideModelId);
      }
      await runSend(prevUser.content, {
        truncateFromMessageId: assistant.serverId,
        model: overrideModelId,
      });
    },
    [messages, runSend, modelId, changeModel],
  );

  return (
    <div className={styles.page}>
      <Header />
      <ChatHistoryModal
        open={historyOpen}
        onClose={() => setHistoryOpen(false)}
        onSelect={loadConversation}
        currentConversationId={conversationId}
      />
      <main className={styles.main}>
        <div
          className={`${styles.introWrap} ${inChat ? styles.introWrapHidden : ''}`}
          aria-hidden={inChat}
        >
          <div className={styles.intro}>
            <Hero />
            <AgentGrid />
          </div>
        </div>
        {inChat && (
          <HomeChatMessages
            messages={messages}
            streaming={streaming}
            toolStatus={toolStatus}
            onEdit={onEditSubmit}
            onRegenerate={onRegenerate}
          />
        )}
        <ChatInput
          value={input}
          onChange={setInput}
          onSend={sendMessage}
          streaming={streaming}
          onStop={stopGenerating}
          attachments={attachments}
          onAddFiles={addAttachmentFiles}
          onRemoveAttachment={removeAttachment}
          onNewChat={inChat ? newChat : undefined}
          onShowHistory={() => setHistoryOpen(true)}
          modelId={modelId}
          onModelChange={changeModel}
        />
      </main>
    </div>
  );
}
