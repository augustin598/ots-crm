---
name: ots-crm-dev
description: >
  Skill for developing the OTS CRM platform (One Top Solution CRM) built with SvelteKit, Bun, TypeScript, and Drizzle ORM with PostgreSQL. Use this skill whenever working on the OTS CRM codebase (repo: augustin598/ots-crm), building new pages or components for campaign reporting, invoice management, client operations, or API integrations (Google Ads, Meta Ads, TikTok Ads, GSC, GA4). Also triggers for any SvelteKit + Drizzle development patterns, TipTap rich text editor integration in Svelte, or when the user mentions clients.onetopsolution.ro, OTS CRM, campaign reporting pages, or ad platform API integrations. Follows the user's "Nu scrie cod inca" (Plan first) workflow convention.
---

# OTS CRM Development Skill

Skill for developing the OTS CRM platform: a centralized digital marketing agency management system.

## Stack

- **Framework**: SvelteKit (latest, with Svelte 5 runes syntax preferred)
- **Runtime**: Bun
- **Language**: TypeScript (strict mode)
- **ORM**: Drizzle ORM
- **Database**: PostgreSQL
- **Domain**: clients.onetopsolution.ro
- **Rich Text**: TipTap editor (Svelte integration)

## Development Workflow Convention

The user follows a strict **Plan-then-Code** workflow:

1. **Planning Phase**: When the user ends a prompt with "Nu scrie cod inca" (Don't write code yet), respond ONLY with analysis, architecture decisions, file structure, and implementation plan. No code output.
2. **Implementation Phase**: Only write code when explicitly asked to proceed. Use Cursor/Claude Code Plan mode at Max effort.
3. **Review Phase**: After implementation, summarize what was done and what remains.

Always respect this convention. If the prompt ends with "Nu scrie cod inca", provide a detailed plan without any code blocks.

## Architecture Patterns

### Route Structure
```
src/routes/
├── (auth)/              # Authenticated routes (layout with session check)
│   ├── dashboard/
│   ├── clients/
│   ├── campaigns/
│   │   ├── google-ads/
│   │   ├── meta-ads/
│   │   └── tiktok-ads/
│   ├── invoices/
│   └── reports/
├── api/
│   ├── google-ads/
│   ├── meta-ads/
│   ├── tiktok-ads/
│   │   └── callback/   # OAuth callback: /api/tiktok-ads/callback
│   └── invoices/
└── (public)/            # Login, public pages
```

### Drizzle Schema Conventions
- Table names: snake_case plural (e.g., `meta_invoice_downloads`, `campaign_reports`)
- Use `pgTable` from drizzle-orm/pg-core
- Always include `created_at` and `updated_at` timestamps
- Foreign keys reference with `references(() => table.id)`
- Use enums for status fields (`pgEnum`)

### API Integration Patterns

**Google Ads API** (via MCC, 77 total / 41 active accounts):
- Basic Access level
- CUI: RO39988493
- Use google-ads-api npm package or REST API
- Always handle rate limits and pagination

**Meta Ads API**:
- Campaign objective-to-metric mapping:
  - `OUTCOME_SALES` → Purchases, ROAS
  - `OUTCOME_LEADS` → Leads, CPL (Cost per Lead)
  - `OUTCOME_AWARENESS` → Reach, CPM
  - `OUTCOME_ENGAGEMENT` → Engagement, CPE
  - `OUTCOME_TRAFFIC` → Link Clicks, CPC
  - `OUTCOME_APP_PROMOTION` → App Installs, CPI
- Invoice automation via `invoices_generator` endpoint (requires Facebook session cookies, not standard API tokens)
- Store in `meta_invoice_downloads` table

**TikTok Ads API**:
- App name: "OTS CRM"
- Callback URL: `https://clients.onetopsolution.ro/api/tiktok-ads/callback`
- Full permission scope

### Component Patterns

SvelteKit components should:
- Use Svelte 5 runes (`$state`, `$derived`, `$effect`) where applicable
- Keep server logic in `+page.server.ts` / `+server.ts`
- Use `$props()` for component props
- Form actions for mutations (progressive enhancement)
- Load functions for data fetching

### TipTap Integration
- Use `@tiptap/core` with Svelte wrapper
- Extensions: StarterKit, Placeholder, Link, Image
- Mount via `onMount` lifecycle in Svelte component
- Handle content as HTML string, store in PostgreSQL text column

## Quality Checklist

Before completing any implementation:
- [ ] TypeScript strict: no `any` types without justification
- [ ] Drizzle migrations generated and reviewed
- [ ] Error handling for all API calls (try/catch + user-friendly messages)
- [ ] Loading states for async operations
- [ ] Romanian language for UI labels (unless specified otherwise)
- [ ] Mobile-responsive layout
- [ ] Server-side validation for all form inputs
