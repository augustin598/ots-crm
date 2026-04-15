---
name: multi-tenant
description: Use when debugging data isolation issues, adding new queries/tables, or verifying tenant scoping. Also use when the user mentions "tenant," "data leak," "cross-tenant," "wrong data," "tenant not found," "403," "multi-tenant," "tenantId missing," "Redis cache wrong data," "GDPR," "tenant export," "tenant deletion," or "audit log." Triggers on any new database query, API endpoint, cache operation, or background job.
---

# Multi-Tenant Data Isolation — OTS CRM

## Context
- Architecture: URL-based tenant resolution (`/[tenant]/...`)
- Schema pattern: Every data table has `tenantId: text('tenant_id').references(() => tenant.id)`
- Global tables (NO tenantId): `user`, `session`, `tenant`, `tenant_user`
- Junction: `tenant_user` connects users to tenants with roles ('owner', 'admin', 'member')
- Tenant context: Resolved in SvelteKit middleware → `locals.tenantId`
- Scale: ~50 tenants, 38+ tables with tenantId column
- Storage: MinIO paths scoped by tenant, Redis keys prefixed by tenant

## Core Design Principles
- Tenant isolation must be enforced by construction, not convention
- Assume every forgotten filter becomes a security incident
- Treat cache, queue, and storage isolation as part of data isolation
- Make tenant context explicit and unforgeable
- Validate cross-tenant denial paths as carefully as success paths

---

## Must

### Query Scoping (every query, every time)
1. **WHERE clause** — Every `db.select()`, `db.update()`, `db.delete()` on a tenant-scoped table MUST include `eq(table.tenantId, tenantId)`
2. **JOINs** — When joining tables, BOTH sides must be tenant-scoped. Don't assume a JOIN naturally filters by tenant
3. **ID lookups** — Never fetch by ID alone: `where(eq(table.id, id))` is WRONG. Always: `where(and(eq(table.id, id), eq(table.tenantId, tenantId)))`
4. **Subqueries** — Tenant filter must be in EACH subquery, not just the outer query
5. **Aggregations** — Reporting/analytics queries MUST include tenant filter. An unfiltered COUNT() leaks data
6. **Use repository helpers** — Prefer tenant-aware wrapper functions that enforce filters by default so feature code cannot forget them

### Tenant Resolution
7. **Resolve once in middleware** — `locals.tenantId` from trusted server context. Downstream code must NOT infer tenant from request body/params
8. **Validate membership** — User must be a member of the tenant (check `tenant_user` table)
9. **Never trust client-supplied tenant** — Don't derive tenant ownership from a UI-only value

### Cache & Storage Isolation
10. **Redis key prefix** — ALL Redis keys: `{tenantId}:{resource}:{identifier}`
11. **Never share keys** — Different tenants must never hit the same cache entry
12. **Invalidation** — When data changes, invalidate cache for THAT tenant only
13. **Integration cache** — Include `integrationId` in key when tenant has multiple accounts for same service
14. **MinIO paths** — Follow `uploads/{tenantId}/{module}/{fileId}` pattern

### Background Jobs
15. **Explicit tenant context** — Background jobs MUST carry tenantId explicitly through payloads. Never infer from global state
16. **Tenant-aware rate limiting** — Prevent one tenant's heavy operation from degrading service for all 49 others

### API Endpoints
17. **Extract tenantId** — From `locals.tenantId` (set by middleware), never from request body
18. **Response filtering** — Never return data for other tenants in lists or search results
19. **Admin override** — Admin/support paths must be explicit, rare, and auditable

### Audit & Monitoring
20. **Log cross-tenant attempts** — Log actor, resolved tenant, requested tenant, route, and resource for any cross-tenant access attempt
21. **Audit trail** — For sensitive operations (invoice status change, credential update), log who changed what and when

### GDPR Lifecycle (roadmap)
22. **Tenant export** — Must cover: DB rows, Redis keys, MinIO objects, pending jobs, email artifacts
23. **Tenant deletion** — Same scope as export. Verify cleanup is complete across ALL stores
24. **Don't export/delete only DB** — Cache, storage, and queue data must be included

---

## Never
- Never fetch tenant-scoped entities by bare ID alone
- Never JOIN tenant-scoped tables unless both sides are filtered by tenant
- Never use unscoped Redis keys, object paths, or queue names for tenant-owned data
- Never trust client-supplied tenant identifiers without server-side authorization
- Never implement export/deletion that only handles SQL while ignoring caches and object storage
- Never allow a helper to bypass tenant filtering silently
- Never mix tenant-scoped and system-scoped data in the same keyspace without namespacing
- Never let admin override behavior leak into general application paths
- Never let background jobs assume they can infer tenant context from global state
- Never skip tenant isolation tests because the query "looks obviously correct"

---

## Failure Smells

### Blockers
- Query or repository method fetches by ID alone without tenantId
- Tenant resolution derived from request payload before auth/context checks
- Shared cache or storage keys omit tenantId
- Background job accesses resources without tenant context
- Report or aggregate endpoint omits tenant filtering

### Needs Review
- Admin endpoints bypass tenant enforcement without audit logging
- Export/deletion features don't enumerate every storage system touched
- No negative tests for cross-tenant access
- Queue payloads don't contain enough context to enforce isolation
- "Temporary" bypasses exist to make admin tasks work faster
- System-scoped and tenant-scoped resources share naming without clear convention
- Support flow can read tenant data without audit evidence

---

## Common Failure Modes
- SQL is tenant-safe, but Redis or MinIO paths leak data across tenants (under-scoped keys)
- A helper method bypasses tenant filtering and exposes another tenant's record by ID
- Deletion/export flows leave orphaned files, cached data, or queued jobs in secondary systems
- A noisy tenant degrades shared worker throughput because limits are global
- A reporting endpoint accidentally aggregates all tenants because filter omitted in one branch
- A support/admin path becomes a backdoor reused in normal features
- A cache warmup job seeds derived data for the wrong tenant
- A background worker processes one tenant's data while writing to another tenant's storage namespace

---

## Debugging Cross-Tenant Issues

### Step 1: Identify the Leak
```bash
# Find queries that might miss tenantId
grep -rn "from(tableName)" src/lib/ --include="*.ts" | grep -v tenantId
```

### Step 2: Check Redis
```bash
# Find cache operations missing tenant prefix
grep -rn "redis\.\(get\|set\)" src/lib/ --include="*.ts"
```
Verify every key includes `{tenantId}:` prefix.

### Step 3: Negative Test
Test with 2 tenants with overlapping entity IDs. Verify Tenant A cannot access Tenant B's data even with a valid-looking ID.

---

## Testing Requirements

### Negative Cross-Tenant Tests (priority)
- Create records for Tenant A
- Attempt to read/update/delete from Tenant B's context
- Verify 403 or empty result (never data from wrong tenant)

### Fixtures
- Two tenants with overlapping entity IDs
- Shared system-scoped resources alongside tenant data
- Mixed tenant/system background jobs
- Export/delete request and cleanup verification

---

## Review Checklist
- [ ] Is tenant context resolved centrally (middleware)?
- [ ] Is every query, cache key, and storage path tenant-scoped?
- [ ] Are negative cross-tenant tests present?
- [ ] Are export/delete flows complete across all systems?
- [ ] Are admin overrides auditable and rare?
- [ ] Can a malicious request cross tenant boundaries anywhere?
- [ ] Is tenant scope enforced in jobs, caches, and analytics?
- [ ] Is there any hidden bypass path?
- [ ] Are JOINs filtered on both sides by tenantId?
