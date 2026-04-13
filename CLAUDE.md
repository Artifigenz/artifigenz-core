# Artifigenz

AI-powered personal agent platform. Users activate domain-specific agents (starting with Finance) that analyze their data, surface insights, and deliver them via chat, email, or Telegram.

## Monorepo Layout

Turborepo + npm workspaces.

```
apps/
  web/        — Next.js 16 frontend (App Router, React 19, Clerk auth, deployed on Vercel)
  api/        — Hono backend (TypeScript, tsx watch for dev, tsup for build)
  mobile/     — Expo / React Native (early stage)
packages/
  db/         — Drizzle ORM schema + migrations (PostgreSQL via Supabase)
  shared/     — Shared types and constants
```

## Tech Stack

| Layer       | Tech                                                        |
|-------------|-------------------------------------------------------------|
| Frontend    | Next.js 16, React 19, Clerk (`@clerk/nextjs` v7)           |
| Backend     | Hono, BullMQ + Redis (job queues), Clerk (`@clerk/backend`) |
| AI          | Anthropic Claude (`@anthropic-ai/sdk`)                      |
| Database    | PostgreSQL (Supabase), Drizzle ORM                          |
| Integrations| Plaid (finance data), Resend (email), Telegram Bot API      |
| Webhooks    | Svix                                                        |
| Validation  | Zod                                                         |
| Build       | Turborepo, tsup, tsx                                        |

## Common Commands

```bash
# Dev
npm run dev:web          # Next.js dev server
npm run dev:api          # API server (tsx watch)
npm run dev:mobile       # Expo start
npm run dev              # All apps via Turbo

# Build
npm run build:web        # Next.js production build
npm run build:api        # tsup build
npm run build            # All apps via Turbo

# Lint
npm run lint             # All apps via Turbo

# Database (from root)
npm run db:generate      # Generate Drizzle migrations
npm run db:migrate       # Run migrations
npm run db:push          # Push schema directly (dev shortcut)
npm run db:seed          # Seed reference data
npm run db:studio        # Drizzle Studio GUI
```

## Architecture Patterns

- **Agent Registry** — agents register their types, skills, and data sources at bootstrap (`apps/api/src/bootstrap.ts`)
- **Skill Executor** — builds execution context, calls `skill.analyze()`, persists output as insights
- **Event Bus** — in-process event emitter for decoupled communication
- **BullMQ Workers** — skill, sync, and delivery job queues via Redis
- **SSE Streaming** — chat responses stream via Hono `streamSSE` with tool-use loop
- **Clerk Auth** — JWT verification middleware, auto-creates user row on first request

## Key Directories

- `apps/api/src/agents/finance/` — Finance agent (Plaid adapter, file upload adapter, subscription detection skills)
- `apps/api/src/platform/` — Core platform services (AgentRegistry, EventBus, InsightService, ChatService, DeliveryService, etc.)
- `apps/api/src/routes/` — Hono API route handlers
- `apps/web/app/` — Next.js App Router pages (landing, dashboard at `/app`, agent detail, settings, auth)
- `packages/db/src/schema/` — Drizzle table definitions

## Branch Strategy

- `main` — production branch
- `mvp` — active development branch

## Notes

- The web app uses Clerk hash-based routing for auth pages (no Next.js middleware)
- `@artifigenz/shared` is transpiled by Next.js via `transpilePackages` in `next.config.ts`
- Mobile app is early stage; not actively developed in current MVP scope
- See `BUILD_PROGRESS.md` for detailed implementation status and what's done vs. remaining
