# Mainline Chat — Task List for Jira

Each task below is one ticket. Copy the **Summary** line into the Jira title,
the **Description** into the description field, **Acceptance Criteria** into
the AC block, and use **Size** as story-point guidance (S = 1–2pt,
M = 3–5pt, L = 8pt+).

Sections are Jira **epics**.

The product bet: people use this chat instead of ChatGPT/Claude because it
knows them — it sees their connected Artifigenz agents and can act on their
data. The "differentiation" section is the moat; foundation is parity.

---

# Epic: Chat Foundation

Baseline that has to match Claude.ai / ChatGPT before anything else matters.

## CHAT-1 · Streaming responses with stop control

**Description:** Assistant replies stream token-by-token. User can interrupt
mid-stream; partial response is preserved.

**Acceptance Criteria:**
- Assistant text appears progressively as tokens arrive (no full-message
  swap-in at end)
- "Stop" button visible only while streaming; reverts to "Send" when done
- Clicking Stop cancels the upstream Claude request server-side
- Partial response remains in the transcript, marked as stopped
- No layout shift / scroll jump while tokens arrive

**Size:** M
**Depends on:** —

---

## CHAT-2 · Conversation sidebar with date grouping

**Description:** Left sidebar lists all of a user's conversations, grouped
by recency.

**Acceptance Criteria:**
- Groups: Today · Yesterday · Last 7 days · Last 30 days · Older
- Each row shows the auto-generated title and the first ~50 chars of the
  user's last message as a preview
- Click row → loads that conversation in the main pane
- Active conversation visibly highlighted
- Hover reveals a "…" menu (rename / delete / star / share)

**Size:** M
**Depends on:** CHAT-5

---

## CHAT-3 · Search across conversations

**Description:** Search box in the sidebar that filters by title and message
content.

**Acceptance Criteria:**
- Search input pinned at top of sidebar
- Filters update as user types (debounced ~150ms)
- Matches highlight in the preview line
- ⌘K / Ctrl-K opens and focuses search from anywhere
- Empty state when no results

**Size:** M
**Depends on:** CHAT-2

---

## CHAT-4 · Rich markdown rendering

**Description:** Assistant messages render full GFM markdown with code,
tables, math, and inline images.

**Acceptance Criteria:**
- Headings, lists, tables, blockquotes, horizontal rules
- Fenced code blocks with syntax highlighting, language label, copy button
  on hover
- Inline code styled distinctly from prose
- KaTeX math: inline `$x$` and block `$$x$$`
- Links open in a new tab with `rel="noopener noreferrer"`
- Images render inline; click to zoom

**Size:** M
**Depends on:** —

---

## CHAT-5 · Auto-generated conversation titles

**Description:** After the second assistant turn, a background call
summarises the conversation into a short title shown in the sidebar.

**Acceptance Criteria:**
- Title generation runs after exchange #2 (background, doesn't block UI)
- ≤6 words; uses Haiku model
- Title appears in the sidebar without page reload
- Pre-title rows show a placeholder, not "Untitled"
- User can rename anytime via the row's "…" menu

**Size:** S
**Depends on:** CHAT-1

---

## CHAT-6 · Edit + regenerate message

**Description:** Allow editing any past user message (re-runs the
conversation from that point) and regenerating any assistant message.

**Acceptance Criteria:**
- Hovering a user message reveals an "Edit" button
- Edit opens an inline textarea pre-filled with the message
- Save rewinds the conversation to that point (drops everything after) and
  submits the edited version
- Hovering an assistant message reveals "Regenerate"
- Regenerate removes the last assistant message and re-runs the same input
- Optional: history of prior versions accessible via arrows on the edited
  message

**Size:** M
**Depends on:** CHAT-1

---

## CHAT-7 · Keyboard shortcuts

**Description:** Standard power-user shortcuts so the chat is as fast to
operate as Claude.ai.

**Acceptance Criteria:**
- ⌘K — open conversation search
- ⌘⇧O — new conversation
- ⌘↑ / ⌘↓ — navigate between conversations in the sidebar
- Esc — cancel editing OR stop streaming
- / — focus the chat input
- ? — overlay listing all shortcuts

**Size:** S
**Depends on:** CHAT-2

---

## CHAT-8 · File attachments

**Description:** User can attach files (PDFs, CSVs, plain text, images) to
a message; they're sent to Claude as document/image content blocks.

**Acceptance Criteria:**
- Paperclip button next to input + drag-drop on the message area
- Supported types and limits:
  - PDF ≤ 25 MB
  - PNG / JPG / WebP ≤ 10 MB
  - CSV ≤ 10 MB
  - Plain text ≤ 5 MB
- File chips appear in the input area before sending; user can remove
- Attached files persist with the conversation and are downloadable from
  the transcript
- Files re-referenceable in later messages of the same conversation

**Size:** L
**Depends on:** CHAT-1, CHAT-4

---

## CHAT-9 · Voice input via microphone

**Description:** Mic button records audio in the browser and transcribes
via Whisper-compatible API.

**Acceptance Criteria:**
- Mic button next to send; click to start, click again to stop
- Recording state shows a waveform / level indicator
- On stop, audio is transcribed and the text fills the input
- User can edit transcription before sending
- Esc cancels recording without sending

**Size:** M
**Depends on:** CHAT-1

---

## CHAT-10 · Input handles very long pastes

**Description:** Pasting a 50KB error log doesn't crash the layout.

**Acceptance Criteria:**
- Input textarea grows up to ~50% viewport height, then internal-scrolls
- Pastes > 10 000 characters auto-collapse with a "show full" toggle
- Submit succeeds regardless of length
- Input character count visible when length exceeds 5 000

**Size:** S
**Depends on:** —

---

# Epic: Chat Differentiation

The reasons a user picks this chat over ChatGPT/Claude. Without these we are
a Claude wrapper.

## CHAT-11 · Chat reads from the user's active agents

**Description:** When a user has active Artifigenz agents (Finance, Health,
etc.), the chat gains tool access to those agents' data. Asking "what did I
spend on subscriptions?" works without specifying which account.

**Acceptance Criteria:**
- System prompt enumerates the user's active agents
- Tool-use catalog dynamically includes per-agent tools (Finance:
  get_transactions, get_subscriptions, get_account_balance, …)
- Model can call these mid-stream; results render inline like normal tool
  use
- Each factual claim from agent data shows a small pill ("from Finance
  agent") that the user can click to drill into source rows
- Tool results don't bloat the visible transcript by default (collapsed
  under a "Sources" disclosure)

**Size:** L
**Depends on:** Finance ingestion stable (out of scope of this epic)

---

## CHAT-12 · Cross-session memory

**Description:** The model can write/read user-level facts that persist
across conversations. Solves "I told it last week I'm vegetarian; it forgot".

**Acceptance Criteria:**
- `remember(fact)` tool — writes to a per-user memory store
- `recall(topic)` tool — retrieves relevant facts
- On every new conversation, top-K (e.g. 8) most-relevant memories injected
  into system prompt
- "Memory" page lists all stored facts; user can edit or delete each
- User can say "forget X" and the model removes the matching fact
- Memory writes shown briefly in the transcript ("Saved: …") so the user
  knows it happened

**Size:** L
**Depends on:** —

---

## CHAT-13 · Web search tool

**Description:** Model can call a web-search tool and cite sources.

**Acceptance Criteria:**
- `web_search(query)` tool available to the model
- Returns top 5–10 results with title, URL, snippet, published date
- Results render as compact cards inside the assistant message
- Citations: factual claims show footnote-style superscript numbers
  linking to source URLs
- Per-conversation toggle ("Search the web") — off by default; sticky
- Provider picked and configured (Brave / Tavily / etc. — note in ticket)

**Size:** M
**Depends on:** —

---

## CHAT-14 · URL fetch tool

**Description:** Model can fetch and read a URL the user pastes — articles,
GitHub readmes, PDFs at URLs, YouTube transcripts.

**Acceptance Criteria:**
- `fetch_url(url)` tool returns clean Markdown content
- Article extraction via Readability (strips chrome/nav/ads)
- GitHub readme rendered as Markdown
- PDFs at URLs downloaded and parsed
- YouTube URLs return transcript when available
- Pages over 50K tokens truncated with a note in the result

**Size:** S
**Depends on:** —

---

## CHAT-15 · Code execution sandbox

**Description:** Model can run Python code with file access. Matches
ChatGPT's "Code Interpreter".

**Acceptance Criteria:**
- `run_python(code, files?)` tool executes in an isolated container
- pandas, numpy, matplotlib, requests pre-installed
- Attached files (CHAT-8) accessible as a mounted filesystem
- Stdout, stderr, and generated files (charts, CSVs) returned to model and
  rendered to user
- 30s wall-clock timeout, 1GB memory limit, network egress disabled
- Container provider chosen and documented (e2b.dev / Modal / etc.)

**Size:** L
**Depends on:** CHAT-8

---

## CHAT-16 · Daily insight injection from active agents

**Description:** On the first message of the day, the chat surfaces high-
priority insights the user's agents have generated since their last visit.

**Acceptance Criteria:**
- First message per calendar day → system prompt includes today's high-
  priority insights from all active agents
- A small "Today's heads-up" card appears above the input listing ≤3 items
- Card is dismissible and doesn't reappear in the same conversation
- Model can reference these insights naturally in its reply

**Size:** M
**Depends on:** CHAT-11, insight feed already exists

---

# Epic: Chat Quality

Model / generation controls for power users.

## CHAT-17 · Model picker

**Description:** Per-message model selection — Default / Smart / Fast.

**Acceptance Criteria:**
- Dropdown in the input toolbar: Default · Smart (Opus) · Fast (Haiku)
- "Default" routes by complexity heuristic (length, code presence,
  expected tool use)
- Selection is sticky within a conversation but each message can override
- Model used is shown discreetly on each assistant message

**Size:** S
**Depends on:** —

---

## CHAT-18 · Extended thinking toggle

**Description:** Optional deeper reasoning using Claude's extended thinking
parameter. Hidden behind a toggle so default UX stays fast.

**Acceptance Criteria:**
- "Think harder" toggle next to the model picker
- When on, request uses Claude's `thinking: { budget_tokens }` config
- Thinking trace appears in a collapsed "Reasoning" block above the final
  answer; click to expand
- Disabled for Haiku (unsupported)
- Slightly longer response time is acceptable and signaled in the UI

**Size:** S
**Depends on:** CHAT-17

---

## CHAT-19 · Auto 1M-context routing for long inputs

**Description:** When attached files + conversation history exceed ~150K
tokens, automatically use the 1M-context model variant.

**Acceptance Criteria:**
- Token estimate computed before each request
- If estimate > 150K, route to the 1M variant of the active model
- A small indicator on the message shows "1M context" so user sees why the
  response may be slower
- Falls back gracefully if 1M variant errors

**Size:** S
**Depends on:** CHAT-8

---

# Epic: Sharing & Export

## CHAT-20 · Shareable conversation link

**Description:** Generate a public read-only URL for a conversation.

**Acceptance Criteria:**
- "Share" button in the conversation header
- Generates `/share/:id` URL
- Snapshot at share-time (later messages in the original don't appear)
- Public page renders the conversation but no input box, no agent
  integration, no edit affordances
- Owner can revoke the share at any time
- Subtle Artifigenz branding on the shared page

**Size:** M
**Depends on:** CHAT-4

---

## CHAT-21 · Export conversation

**Description:** Download a conversation as Markdown or JSON.

**Acceptance Criteria:**
- Menu option "Export as Markdown" / "Export as JSON"
- Markdown: prose + code blocks preserved, attachments listed at the end
  with download links
- JSON: full structured format including tool calls, role labels, model
  used per message

**Size:** S
**Depends on:** —

---

# Epic: Mobile

## CHAT-22 · Responsive chat layout

**Description:** Chat works correctly on mobile web.

**Acceptance Criteria:**
- Sidebar collapses behind a hamburger on viewports < 768px
- Input bar pinned to the bottom; doesn't jump when soft-keyboard opens
- Code blocks scroll horizontally rather than wrap
- File-attach button opens the native file picker
- Voice button (CHAT-9) is thumb-reachable on iPhone-sized screens

**Size:** M
**Depends on:** CHAT-1, CHAT-2

---

## CHAT-23 · PWA install + offline support

**Description:** Chat installable as a progressive web app.

**Acceptance Criteria:**
- `manifest.json` + service worker registered
- Install prompt appears on supported browsers after 3 sessions
- Offline: cached conversations visible; outgoing messages queued and sent
  when network returns
- Installed app has its own icon and opens chrome-less

**Size:** S
**Depends on:** CHAT-22

---

# Epic: Personalization

## CHAT-24 · Custom instructions

**Description:** Per-user system-prompt addendum that the model sees in
every conversation.

**Acceptance Criteria:**
- Settings page has a single labelled textarea: "What should the chat
  know about you?"
- 1 500-character limit, character count visible
- Saved per-user (column already exists: `users.chatCustomInstructions`)
- Injected into the system prompt of every conversation
- Change takes effect on next user message (no reload required)

**Size:** S
**Depends on:** —

---

## CHAT-25 · Pin conversations to top of sidebar

**Description:** Star/pin a conversation to keep it at the top of the
sidebar regardless of recency.

**Acceptance Criteria:**
- Star icon on each conversation row (in the "…" menu and on hover)
- Pinned conversations appear in a separate "Pinned" section above the
  date groups
- Maximum 10 pinned items
- Unpin via the same icon

**Size:** S
**Depends on:** CHAT-2

---

# Epic: Activation

## CHAT-26 · First-run experience

**Description:** New user lands in an empty chat for the first time and
feels the value within 60 seconds.

**Acceptance Criteria:**
- Empty state shows 3–4 suggested prompts. If the user has any active
  agent, at least one prompt references their data (e.g., "What did I
  spend on subscriptions last month?"). Otherwise generic prompts.
- One-at-a-time dismissible tooltips introduce sidebar, model picker,
  voice input
- After the first assistant reply: small inline prompt — "Did this answer
  your question?" — capturing early-signal feedback (1-click + optional
  comment)

**Size:** M
**Depends on:** CHAT-11, CHAT-2

---

## CHAT-27 · Logged-out landing page

**Description:** A page at `/` that sells the differentiation in one
screen and drives signups.

**Acceptance Criteria:**
- Hero with the agent-integration pitch
- Side-by-side comparison: ChatGPT (stateless) vs. Artifigenz (knows you,
  acts across agents)
- One clear sign-up CTA above the fold
- Footer with privacy / terms / pricing links
- Mobile-responsive

**Size:** M
**Depends on:** —

---

# Cross-cutting (not user-facing but blocking)

## CHAT-28 · Observability for every Claude call

**Description:** Each model request logs model, input tokens, output
tokens, latency, cost; dashboard shows the running totals.

**Acceptance Criteria:**
- Every call writes a row with: timestamp, user_id, conversation_id,
  model, input_tokens, output_tokens, latency_ms, est_cost_usd, tool_calls
- Dashboard shows: requests/hour, tokens/day, cost/day, p50/p95 latency
- Per-user cost breakdown reachable from the admin view

**Size:** M
**Depends on:** —

---

## CHAT-29 · Rate limiting + free-tier caps

**Description:** Enforce per-user request and cost caps so a single user
can't run up an unbounded bill.

**Acceptance Criteria:**
- Configurable limits: messages/hour, cost/day
- Middleware checks limits before forwarding to Claude
- Over-limit response is graceful: explanation + when limits reset, not a
  raw 429
- Different caps for free vs. paid users (model-agnostic for now;
  monetisation epic owns paid tiers)

**Size:** M
**Depends on:** CHAT-28
