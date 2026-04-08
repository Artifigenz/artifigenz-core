# Artifigenz — Build Progress

*Tracks implementation status against the architecture plan in `../research/docs/architecture.md`*
*Last updated: 2026-04-08*

---

## Phase 1: Platform Foundation — DONE

- [x] 1.1 Create `apps/api` — Hono server, TypeScript config, env setup
- [x] 1.2 Create `packages/db` — Drizzle schema, Supabase PostgreSQL connection, migrations
- [x] 1.3 Platform types — `AgentTypeDefinition`, `SkillDefinition`, `DataSourceAdapter`, `SkillExecutionContext`
- [x] 1.4 `AgentRegistry` — register agents, query agent types/skills/data sources
- [x] 1.5 `EventBus` — in-process event emitter
- [x] 1.6 `InsightService` — persist, deduplicate, query insight feed
- [x] 1.7 `SkillExecutor` — build execution context, call `skill.analyze()`, persist output
- [x] 1.8 BullMQ + Redis — queues, scheduler, workers (skill, sync, delivery)
- [x] 1.9 API routes — generic agent-agnostic HTTP endpoints
- [x] 1.10 Clerk auth middleware — JWT verification + auto-create user on first request
- [x] 1.11 Update `turbo.json` — add api to dev/build/lint pipelines
- [x] 1.12 Seed database — agent_types, skills, data_source_types, insight_types

## Phase 2: Finance Agent (MVP) — DONE

- [x] 2.1 Create `agents/finance/` directory with registration
- [x] 2.2 `plaid.adapter.ts` — Plaid Link token, public_token exchange, /transactions/sync, webhooks — **verified with sandbox (385 txs synced)**
- [x] 2.3 `file-upload.adapter.ts` — file upload + Claude API extraction — **verified with CSV (22 txs extracted, 4 subscriptions detected)**
- [x] 2.4 `subscriptions.skill.ts` — 5 job categories (Visibility, Timing, Change, Cleanup, Insight)
- [x] 2.5 `recurring-detection.ts` — pattern matching for subscriptions with category filtering
- [x] 2.6 Register Finance agent in `bootstrap.ts`
- [x] 2.7 End-to-end test: Plaid sandbox → sync → detect subscriptions → produce insights

## Phase 3: Delivery — DONE (WhatsApp deferred)

- [x] 3.1 `DeliveryService` — route insights to channels based on prefs
- [x] 3.2 `EmailChannel` — Resend integration — **verified**
- [ ] 3.3 `WhatsAppChannel` — Meta Business API *(deferred; requires business verification)*
- [x] 3.4 `TelegramChannel` — Telegram Bot API — **verified**
- [x] 3.5 Wire delivery to insight pipeline via BullMQ delivery worker

## Phase 3.5: Chat (MVP) — DONE

- [x] 3.6 `conversations` and `messages` tables (created in Phase 1)
- [x] 3.7 `ChatService` — create conversation, send message, persist, get history
- [x] 3.8 `PromptBuilder` — 5-layer system prompt (identity, user, agents, insights, finance snapshot)
- [x] 3.9 `ToolExecutor` — register platform + agent tools, execute with user scoping
- [x] 3.10 SSE streaming via Hono `streamSSE` with tool-use loop
- [x] 3.11 Finance chat tools — 5 tools (getSubscriptions, getUpcomingCharges, getTransactions, getSubscriptionHistory, getSpendingSummary)
- [x] 3.12 Chat API routes — POST /chat (SSE), GET /conversations, GET/DELETE :id
- [ ] 3.14 Deferred for later: file uploads, edit/regenerate branching, custom instructions, search, pin/archive

---

## Frontend Integration (Finance only)

### Phase A: Auth foundation — DONE

- [x] A.1 Backend: `clerkAuth` middleware auto-creates user row on first request
- [x] A.2 Install `@clerk/nextjs` in web workspace + `.env.local`
- [x] A.3 `<ClerkProvider>` wraps root layout (static-export compatible, no middleware)
- [x] A.4 `/sign-in` and `/sign-up` pages using hash routing
- [x] A.5 `ProtectedRoute` client wrapper (redirect to /sign-in)
- [x] A.6 `apps/web/lib/api-client.ts` — typed fetch wrapper with auto-attached Clerk JWT
- [x] A.7 `useApiClient` hook — memoized ApiClient bound to current Clerk session
- [x] A.8 `ProfileMenu` shows real Clerk user + working sign-out
- [x] A.9 `/settings` fetches real profile from `/api/me`

### Phase B: Finance happy path — NOT STARTED

- [ ] B.1 Strip hardcoded `AGENT_DATA["finance"]` from `AgentDetail.tsx`
- [ ] B.2 Rewire `useActivatedAgents` hook to backend (`GET /api/me/instances`)
- [ ] B.3 Home page: show user's activated agents from API
- [ ] B.4 Activation flow: `POST /api/agents/me/finance/activate` on button click
- [ ] B.5 Agent detail page: real insights from `GET /api/me/insights?agentTypeId=finance`
- [ ] B.6 Agent detail page: real subscriptions list (new endpoint needed?)
- [ ] B.7 Wrap `/agent/[name]` with `ProtectedRoute`
- [ ] B.8 **Backend: add `POST /api/upload`** — multipart receiver, writes to disk, creates file_uploads row
- [ ] B.9 File upload UI on agent detail page (drag-drop)
- [ ] B.10 Plaid Link integration (`react-plaid-link` + init/finalize)
- [ ] B.11 Wire `ChatInput` to `POST /api/me/chat` with SSE streaming consumer
- [ ] B.12 Render streaming deltas + tool call indicators in chat UI

### Phase C: Peripherals — NOT STARTED

- [ ] C.1 Delivery preferences page (email toggle + input, Telegram toggle + chat ID)
- [ ] C.2 Sign out flow polish
- [ ] C.3 Empty states (no insights yet, no agents activated, etc.)

---

## Deferred (out of current MVP scope)

### Phase 4: Unified Context

- [ ] 4.1 `ContextService` — read/write 4-layer user context
- [ ] 4.2 `ContextReasoner` — LLM-powered cross-agent inference
- [ ] 4.3 Context fact emission from Finance Subscriptions skill
- [ ] 4.4 Cross-agent coordination infrastructure

### Phase 5: Next Agent

- [ ] 5.1 Second agent (Travel / Health / Job Search)
- [ ] 5.2 Agent-specific data sources and skills
- [ ] 5.3 Register in bootstrap
- [ ] 5.4 Cross-agent signals via unified context

*These are blocked on MVP validation — not high priority until finance agent is fully integrated and users are actively using it.*
