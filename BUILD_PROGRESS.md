# Artifigenz — Backend Build Progress

*Tracks implementation status against the architecture plan in `../research/docs/architecture.md`*
*Last updated: 2026-04-07*

---

## Phase 1: Platform Foundation

- [x] 1.1 Create `apps/api` — Hono server, TypeScript config, env setup
- [x] 1.2 Create `packages/db` — Drizzle schema, Supabase PostgreSQL connection, migrations
- [x] 1.3 Platform types — `AgentTypeDefinition`, `SkillDefinition`, `DataSourceAdapter`, `SkillExecutionContext`
- [x] 1.4 `AgentRegistry` — register agents, query agent types/skills/data sources
- [x] 1.5 `EventBus` — in-process event emitter
- [x] 1.6 `InsightService` — persist, deduplicate, query insight feed
- [x] 1.7 `SkillExecutor` — build execution context, call `skill.analyze()`, persist output
- [x] 1.8 BullMQ + Redis — queues, scheduler, workers (skill, sync, delivery)
- [x] 1.9 API routes — generic agent-agnostic HTTP endpoints
- [x] 1.10 Clerk auth middleware — JWT verification + Clerk webhook handler
- [x] 1.11 Update `turbo.json` — add api to dev/build/lint pipelines
- [x] 1.12 Seed database — agent_types, skills, data_source_types, insight_types

## Phase 2: Finance Agent (MVP)

- [x] 2.1 Create `agents/finance/` directory with registration
- [x] 2.2 `plaid.adapter.ts` — Plaid Link token, public_token exchange, /transactions/sync, webhooks — **verified with sandbox (385 txs synced)**
- [x] 2.3 `file-upload.adapter.ts` — file upload + Claude API extraction — **verified with CSV (22 txs extracted, 4 subscriptions detected)**
- [x] 2.4 `subscriptions.skill.ts` — 5 job categories (Visibility, Timing, Change, Cleanup, Insight)
- [x] 2.5 `recurring-detection.ts` — pattern matching for subscriptions with category filtering
- [x] 2.6 Register Finance agent in `bootstrap.ts`
- [x] 2.7 End-to-end test: Plaid sandbox → sync → detect subscriptions → produce insights

## Phase 3: Delivery

- [ ] 3.1 `DeliveryService` — route insights to channels based on prefs
- [ ] 3.2 `EmailChannel` — Resend integration
- [ ] 3.3 `WhatsAppChannel` — Meta Business API
- [ ] 3.4 `TelegramChannel` — Telegram Bot API
- [ ] 3.5 Wire delivery to insight pipeline via BullMQ delivery worker

## Phase 3.5: Chat

- [ ] 3.6 Create `conversations` and `messages` tables
- [ ] 3.7 `ChatService` — create conversation, send message, persist, get history
- [ ] 3.8 `PromptBuilder` — 7-layer system prompt assembly from live data
- [ ] 3.9 `ToolExecutor` — register agent tools, validate inputs, execute with user scoping
- [ ] 3.10 `StreamHandler` — SSE streaming adapter for Hono with tool call interruptions
- [ ] 3.11 Finance chat config — prompt section, data summary, 5 tools
- [ ] 3.12 Chat API routes — POST /chat, GET /conversations, DELETE
- [ ] 3.13 Client integration — SSE consumption in web (Next.js) + mobile (Expo)

## Phase 4: Unified Context

- [ ] 4.1 `ContextService` — read/write 4-layer user context
- [ ] 4.2 `ContextReasoner` — LLM-powered cross-agent inference
- [ ] 4.3 Add context fact emission to Finance Subscriptions skill
- [ ] 4.4 Infrastructure ready for cross-agent coordination

## Phase 5: Next Agent

- [ ] 5.1 Create `agents/travel/` following the same structure
- [ ] 5.2 Implement travel-specific data sources and skills
- [ ] 5.3 Register in bootstrap — no platform changes needed
- [ ] 5.4 Travel agent reads Finance signals from unified context
