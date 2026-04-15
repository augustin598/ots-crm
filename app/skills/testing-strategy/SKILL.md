---
name: testing-strategy
description: Use when writing tests, debugging test failures, or when any other skill requires verification. Also use when the user mentions "test," "fixture," "golden file," "negative test," "smoke test," "integration test," "replay test," "regression," "coverage," or "test strategy." Triggers when implementing any feature, fixing a bug, or before marking work as complete.
---

# Testing Strategy — OTS CRM

## Context
- Runtime: Bun (no Jest/Vitest — scripts run with `bun run test-*.ts`)
- Test files: `test-*.ts` scripts in project root + `scripts/` + `src/lib/server/`
- DB testing: Direct SQLite connection with `createClient({ url: 'file:local-ots.db' })`
- Pattern: Lightweight assertion scripts, not a full test framework
- Existing tests: `test-contract-audit.ts`, `scripts/test-smtp.ts`, `scripts/test-recurring-invoices.ts`, `src/lib/server/gmail/test-pdf.ts`

## Core Testing Philosophy
- Multiple layers: unit → integration → replay → negative → smoke
- The key question is not "does it work?" but "does it still work under retry, drift, partial failure, and rollout overlap?"
- Test boundaries (DB, Redis, MinIO, SMTP, provider APIs), not just pure logic
- Every security boundary needs a negative test
- Every deterministic output needs a golden-file test

---

## Test Layers

### 1. Unit Tests — Pure logic and local rules
**When:** For mappers, formatters, validators, utility functions
**How:** Direct Bun script, import function, assert output
**Example areas:**
- `fmtNum()` number formatting
- Invoice calculation logic
- Date parsing (Keez YYYYMMDD, ISO, etc.)
- Email template variable resolution
- Tenant ID validation

### 2. Integration Tests — System boundaries
**When:** For DB queries, Redis operations, MinIO uploads, SMTP sends
**How:** Bun script with real local DB/Redis, assert side effects
**Example areas:**
- Query returns only current tenant's data (multi-tenant)
- Migration applies correctly on empty + populated DB
- Cache key isolation between tenants
- Email outbox persist → retry flow
- PDF generation → MinIO upload → presigned URL

### 3. Replay Tests — Recorded real-world payloads
**When:** For API integrations, webhook/event processing
**How:** Save real provider payloads as fixtures, replay through handlers
**Example areas:**
- Keez invoice sync with known payloads
- Meta Ads campaign data parsing
- SmartBill response handling
- ANAF XML responses

### 4. Negative Tests — Security & isolation boundaries
**When:** For every tenant-scoped operation, every auth check
**How:** Attempt cross-tenant access, assert rejection
**Example areas:**
- Tenant A cannot read Tenant B's invoices by ID
- Unauthenticated request returns 401/403
- Bounced email address is suppressed on retry
- Expired presigned URL returns AccessDenied
- Invalid SMTP credentials don't crash the worker

### 5. Golden-File Tests — Deterministic output stability
**When:** For PDFs, email templates, API response shapes
**How:** Generate output, compare against saved reference file
**Example areas:**
- Invoice PDF layout (short, long, multi-page)
- Contract PDF with signature block
- Email HTML template rendering
- Report PDF with Romanian diacritics

### 6. Smoke Tests — Post-deploy verification
**When:** After every deploy, one test per critical path
**How:** Hit key endpoints, verify basic functionality
**Example areas:**
- App starts against post-migration schema
- SMTP connection succeeds for each tenant
- Each integration can authenticate
- PDF generation produces valid file
- Login flow works

---

## Must

### Writing Tests
1. **Test the boundary, not the mock** — For DB/Redis/MinIO/SMTP, test against real (local) instances. Mocks hide real failures
2. **Name tests clearly** — `test-{module}-{scenario}.ts` (e.g., `test-invoice-cross-tenant.ts`)
3. **Include cleanup** — Every test must clean up created records. Use `cleanup(ids)` helper with error suppression
4. **Make tests idempotent** — Must be safe to run multiple times without side effects
5. **Use realistic data** — Don't test with `"test"`, `"foo"`, `123`. Use Romanian names, real CUI numbers, realistic amounts

### Test Fixtures
6. **Per-area fixtures** — Each skill area needs its own set:

**Database Migrations:**
- Empty dataset
- Small realistic dataset
- Legacy/messy dataset (nulls, duplicates)
- Tenant-heavy dataset (multiple tenants)

**API Integrations:**
- Valid provider payload
- Duplicate payload (test idempotency)
- Rate-limited response (429)
- Timeout scenario
- Schema drift payload (unknown fields)
- Provider outage sequence

**PDF Generation:**
- Short invoice (1-3 items)
- Long invoice (20+ items, multi-page)
- Contract with signature block
- Report with wide table
- Document with all Romanian diacritics (ă, î, ș, ț, â)

**Multi-Tenant:**
- Two tenants with overlapping entity IDs
- Shared system-scoped resources
- Cross-tenant access attempts

**Email Delivery:**
- Valid send
- Bounced recipient
- Unsubscribed recipient
- Preview mode
- Template version change

### Assertions
7. **Assert the right thing** — Don't just check `status === 200`. Check the data shape, tenant ownership, side effects
8. **Assert absence** — For negative tests, verify data is NOT returned, not just that no error occurred
9. **Assert side effects** — Check DB records, Redis keys, MinIO objects — not just function return values

### When to Write Tests
10. **Before marking work complete** — Every feature/bugfix must have at least one test
11. **After finding a bug** — Write the test that would have caught it BEFORE fixing the bug
12. **After integration incidents** — Save the failing payload as a replay test fixture
13. **For every security boundary** — Cross-tenant, auth, suppression → negative tests mandatory

---

## Never
- Never mock the database when testing tenant isolation — mocks hide real query bugs
- Never skip negative tests because "the code looks obviously correct"
- Never use generic test data (`foo`, `bar`, `test@test.com`) — use realistic Romanian business data
- Never leave test records in the database — always clean up
- Never write tests that depend on execution order
- Never test only the happy path
- Never ship a fix without a regression test for the bug
- Never assume a passing unit test means the integration works
- Never use production credentials in test scripts
- Never let test coverage substitute for understanding — test the meaningful paths, not lines of code

---

## Failure Smells

### Blockers
- No negative tests exist for cross-tenant data access
- PDF output tested only by visual inspection ("it looks right")
- Integration tests use mocks instead of real local services
- Test relies on external provider being available (flaky)
- Cleanup is missing — test pollutes DB for next run

### Needs Review
- Only happy path is tested
- No replay tests exist for integration payloads
- No golden-file tests for deterministic outputs (PDFs, emails)
- Test data is unrealistic (ASCII-only, no diacritics)
- No post-deploy smoke tests defined
- Test fixture is too simple to catch edge cases

---

## Test Script Template

```typescript
// test-{module}-{scenario}.ts
import { createClient } from '@libsql/client';
import { drizzle } from 'drizzle-orm/libsql';
import * as schema from './src/lib/server/db/schema';

const client = createClient({ url: 'file:local-ots.db' });
const db = drizzle(client, { schema });

function assert(name: string, condition: boolean, detail?: string) {
  if (!condition) {
    console.error(`❌ FAIL: ${name}${detail ? ` — ${detail}` : ''}`);
    process.exit(1);
  }
  console.log(`✅ PASS: ${name}`);
}

async function cleanup(ids: { table: any; id: string }[]) {
  for (const { table, id } of ids) {
    try { await db.delete(table).where(eq(table.id, id)); } catch {}
  }
}

async function main() {
  const createdIds: { table: any; id: string }[] = [];
  
  try {
    // Setup
    // ... create test data, push to createdIds
    
    // Test
    // ... run assertions
    
    // Negative test
    // ... verify cross-tenant rejection
    
  } finally {
    await cleanup(createdIds);
  }
  
  console.log('\n✅ All tests passed');
}

main().catch(console.error);
```

---

## Review Checklist (before marking work complete)
- [ ] Is there at least one test for the change?
- [ ] Is there a negative test for security boundaries?
- [ ] Are test fixtures realistic (Romanian data, real amounts)?
- [ ] Does the test clean up after itself?
- [ ] Is the test idempotent (safe to re-run)?
- [ ] For bugs: is there a regression test?
- [ ] For integrations: is there a replay fixture?
- [ ] For PDFs/emails: is there a golden-file comparison?
- [ ] For deploy: is there a smoke test?
