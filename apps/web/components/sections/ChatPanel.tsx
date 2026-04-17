'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { useApiClient } from '@/hooks/useApiClient';
import styles from './ChatPanel.module.css';

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  toolCalls?: Array<{ tool: string }>;
}

interface ChatPanelProps {
  agentName: string;
  agentInstanceId?: string;
}

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

export default function ChatPanel({ agentName, agentInstanceId }: ChatPanelProps) {
  const api = useApiClient();
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [toolStatus, setToolStatus] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, toolStatus, scrollToBottom]);

  const sendMessage = async () => {
    const text = input.trim();
    if (!text || streaming) return;

    // Add user message
    const userMsg: Message = { id: `u-${Date.now()}`, role: 'user', content: text };
    setMessages((prev) => [...prev, userMsg]);
    setInput('');
    setStreaming(true);
    setToolStatus(null);

    // Create placeholder for assistant response
    const assistantId = `a-${Date.now()}`;
    setMessages((prev) => [...prev, { id: assistantId, role: 'assistant', content: '' }]);

    try {
      const token = await (api as unknown as { getToken: () => Promise<string | null> }).getToken();
      if (!token) throw new Error('Not authenticated');

      const res = await fetch(`${API_URL}/api/me/chat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          message: text,
          agentInstanceId: agentInstanceId || undefined,
          conversationId: conversationId || undefined,
        }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Chat failed' }));
        throw new Error((err as { error?: string }).error ?? `Error ${res.status}`);
      }

      // Parse SSE stream
      const reader = res.body?.getReader();
      if (!reader) throw new Error('No response stream');

      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          if (line.startsWith('event: ')) {
            const eventType = line.slice(7).trim();
            // Next line should be data:
            continue;
          }
          if (line.startsWith('data: ')) {
            const dataStr = line.slice(6);
            try {
              const data = JSON.parse(dataStr);

              if ('conversationId' in data) {
                setConversationId(data.conversationId);
              }
              if ('content' in data && typeof data.content === 'string') {
                // Delta — append to assistant message
                setMessages((prev) =>
                  prev.map((m) =>
                    m.id === assistantId
                      ? { ...m, content: m.content + data.content }
                      : m,
                  ),
                );
              }
              if ('tool' in data && 'input' in data) {
                // Tool use
                const toolName = data.tool as string;
                const label = toolName
                  .replace(/([A-Z])/g, ' $1')
                  .replace(/^get\s/i, 'Looking up ')
                  .trim();
                setToolStatus(label + '...');
              }
              if ('tool' in data && 'result' in data) {
                // Tool result
                setToolStatus(null);
              }
              if ('messageId' in data) {
                // Done
                setToolStatus(null);
              }
              if ('code' in data && 'message' in data) {
                // Error
                setMessages((prev) =>
                  prev.map((m) =>
                    m.id === assistantId
                      ? { ...m, content: `Error: ${data.message}` }
                      : m,
                  ),
                );
              }
            } catch {
              // Skip unparseable lines
            }
          }
        }
      }
    } catch (err) {
      setMessages((prev) =>
        prev.map((m) =>
          m.id === assistantId
            ? { ...m, content: `Error: ${err instanceof Error ? err.message : 'Something went wrong'}` }
            : m,
        ),
      );
    } finally {
      setStreaming(false);
      setToolStatus(null);
      inputRef.current?.focus();
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  return (
    <div className={styles.panel}>
      {/* Messages */}
      {messages.length > 0 && (
        <div className={styles.messages}>
          {messages.map((msg) => (
            <div key={msg.id} className={`${styles.message} ${styles[msg.role]}`}>
              <div className={styles.messageContent}>
                {msg.role === 'assistant' && msg.content === '' && streaming ? (
                  <span className={styles.typing}>Thinking...</span>
                ) : (
                  <div className={styles.messageText}>
                    {msg.content.split('\n').map((line, i) => (
                      <span key={i}>
                        {line.startsWith('**') && line.endsWith('**')
                          ? <strong>{line.slice(2, -2)}</strong>
                          : line.startsWith('- ')
                            ? <span style={{ display: 'block', paddingLeft: '12px' }}>{line}</span>
                            : line}
                        {i < msg.content.split('\n').length - 1 && <br />}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </div>
          ))}
          {toolStatus && (
            <div className={`${styles.message} ${styles.assistant}`}>
              <div className={styles.messageContent}>
                <span className={styles.toolStatus}>{toolStatus}</span>
              </div>
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>
      )}

      {/* Input bar */}
      <div className={styles.bar}>
        <div className={styles.inputWrap}>
          <input
            ref={inputRef}
            type="text"
            className={styles.input}
            placeholder={`Ask ${agentName}...`}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={streaming}
          />
          <button
            className={styles.sendBtn}
            onClick={sendMessage}
            disabled={!input.trim() || streaming}
            aria-label="Send"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="5" y1="12" x2="19" y2="12" />
              <polyline points="12 5 19 12 12 19" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}
