---
name: api-integrations
description: Use when working on, debugging, or testing external API integrations — Keez, Meta Ads, Google Ads, TikTok Ads, ANAF SPV, SmartBill, or Gmail. Also use when the user mentions "sync," "token refresh," "rate limit," "decrypt failed," "integration deactivated," "cache collision," "API error," "circuit breaker," "dead letter," "provider outage," or "contract drift." Triggers on work in src/lib/server/plugins/, src/lib/server/gmail/, src/lib/server/google-ads/, src/lib/server/meta-ads/, src/lib/server/tiktok-ads/, or api/ routes for these integrations.
---

# API Integration & Sync Engine — OTS CRM

## Context
- Plugin system: `src/lib/server/plugins/` (manager.ts, registry.ts, hooks.ts, types.ts)
- Integrations: Keez, SmartBill, ANAF SPV (plugins), Meta Ads, Google Ads, TikTok Ads, Gmail (standalone)
- Architecture: All polling/pull-based (no inbound webhooks currently)
- Scale: ~50 tenants, each with 1-3 integrations
- Each integration has tenant-scoped credentials stored encrypted in DB

## Core Design Principles
- Treat external integrations as unstable boundaries
- Assume provider behavior changes without warning
- Design for duplicate delivery, partial failure, and replay
- Separate verification, normalization, and business side effects
- Favor observable failure over silent corruption
- Assume integration logic must survive provider-side outages and contract drift

---

## Must

### Authentication & Tokens
1. **Token refresh** — On 401/403, trigger `refresh_token` flow and persist new tokens to DB immediately
2. **Decrypt with retry** — Transient Turso reads can cause decrypt failures. Retry 2-3 times before marking integration as inactive
3. **Never deactivate on first failure** — Log the error, retry with backoff, only deactivate after 3+ consecutive failures with different error types
4. **Add a "degraded" state** — Before full deactivation, mark integration as degraded with recovery window

### Caching
5. **Cache key format** — Always: `{tenantId}:{provider}:{resource}:{params}` — Example: `tenant123:keez:invoices:2026-04`
6. **Include integrationId** — When a tenant has multiple accounts for same provider, add integrationId to key
7. **No generic keys** — Never use `api_response`, `data`, or keys without tenantId prefix
8. **Presigned URLs** — Use `command()` not `query()` for MinIO presigned URLs. `query()` caches per arguments → expired URLs

### Sync Operations
9. **Concurrency lock** — Use in-memory locks per tenant to prevent concurrent syncs
10. **Idempotent processing** — Use upsert patterns keyed by provider event/record ID. Duplicates must be harmless
11. **Error classification** — Distinguish transient (network, timeout, 500) from permanent (invalid credentials, 403, account suspended). Only retry transient
12. **Log raw responses** — Write API responses to `debugLog` table (redact tokens/PII) for troubleshooting
13. **Explicit timeout** — Put timeout budgets on ALL provider calls. No call should run forever
14. **Track sync state** — Maintain explicit state: `pending → syncing → synced | retrying → degraded → disabled | dead-lettered`
15. **Track last success** — Store `lastSuccessfulSyncAt` and `lastFailureReason` per integration

### Circuit Breaker (simple)
16. **Trip on consecutive failures** — After 5 consecutive failures for a tenant+provider, stop polling for 15 minutes
17. **Auto-recover** — After cooldown, attempt one sync. If successful, reset breaker. If not, extend cooldown
18. **Per-tenant isolation** — One tenant's broken integration must NOT saturate shared workers or affect other tenants

### Rate Limiting
19. **Exponential backoff** — On 429: wait 1s, 2s, 4s with jitter
20. **Respect headers** — Check `Retry-After` or `X-RateLimit-Reset` before applying default backoff
21. **Batch requests** — Where APIs support it, batch multiple operations in one call

### Failed Sync Tracking (lightweight DLQ)
22. **Log failed syncs** — Track which tenant/provider poll failed, when, why, and whether it's retryable
23. **Replay support** — Failed syncs must be replayable without manual reconstruction from logs
24. **Don't retry permanently** — After max retries, move to dead-letter state and alert

---

## Never
- Never retry signature failures, malformed payloads, or unsupported API versions as transient errors
- Never let one tenant's failing integration saturate shared workers
- Never log raw provider payloads without redacting tokens, secrets, and PII
- Never hardcode provider versions or assume API contracts stay stable
- Never disable an integration solely because of a short burst of transient errors
- Never assume provider retries are at-most-once
- Never let integration code directly mutate core records without an idempotent guard
- Never use one generic retry policy for all providers
- Never treat provider deprecation notices as non-actionable noise
- Never silence unknown event types without a metric or log signal

---

## Failure Smells

### Blockers
- No dedup/idempotency key exists for sync processing
- All failures use the same retry policy regardless of error type
- No failed-sync log or replay path exists for exhausted retries
- A provider call can run forever with no timeout
- A high-volume tenant can take down shared integration workers
- Unknown response fields crash the handler instead of being surfaced safely

### Needs Review
- Provider version/deprecation handling is undocumented
- Contract tests only cover the happy path
- Observability stops at application logs with no metrics
- Response parsing assumes stable provider schemas
- Retry behavior not differentiated by status code or provider type
- No clear state machine for sync lifecycle
- Integration can fail silently if provider changes field meaning

---

## Integration-Specific Notes

### Keez
- Date format: `YYYYMMDD` — validate/parse, null checks prevent crashes
- Sync lock: in-memory per tenant
- Mapper: `src/lib/server/plugins/keez/mapper.ts`
- Known issue (April 2026): Transient Turso reads caused decrypt failures → fixed with retry

### Meta Ads / Google Ads / TikTok Ads
- Cache keys MUST include `integrationId` (tenant may have multiple ad accounts)
- `isActive` filter: Always check before processing accounts
- Error display: User-friendly messages in UI, technical details to debugLog

### SmartBill
- Crypto module: `src/lib/server/plugins/smartbill/crypto.ts` — shared encryption/decryption
- Invoice sync: bidirectional CRM ↔ SmartBill

### Gmail
- OAuth flow: `src/lib/server/google-client-auth.ts`
- Test utilities: `src/lib/server/gmail/test-pdf.ts`, `test-status.ts`

### ANAF SPV
- Romanian tax authority — specific XML formats
- Certificate-based auth

---

## Common Failure Modes
- Provider changes a field/enum and client silently mis-maps data instead of failing clearly
- Retry storms hit a degraded provider and amplify the outage
- Failed sync payloads disappear with no replay path, forcing manual reconstruction
- One tenant's broken configuration creates noisy-neighbor problem for the whole system
- Provider deprecates an endpoint and integration keeps "working" until sudden failure
- Temporary auth issue interpreted as permanently broken tenant → premature deactivation
- Provider-side retry + internal retry creates multiplicative retry storm

---

## Review Checklist
- [ ] Are duplicates harmless (idempotent processing)?
- [ ] Are permanent failures separated from transient ones?
- [ ] Is there a circuit breaker, timeout, and failed-sync log?
- [ ] Are unknown response fields handled safely (not crashing)?
- [ ] Can the system be safely replayed after a failure?
- [ ] Is retry behavior provider-aware?
- [ ] Is there a clear degraded state before deactivation?
- [ ] Are cache keys tenant+integration scoped?
- [ ] Is last sync time and failure reason tracked?
