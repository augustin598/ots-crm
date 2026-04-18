# Gmail Email Sender — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Gmail the primary email sender when connected, with SMTP as automatic fallback.

**Architecture:** Modify `getTenantTransporter()` to route through Gmail OAuth2 (nodemailer) when `emailProvider === 'gmail'`, falling back to existing SMTP logic on failure. Token encryption, scope expansion, and UI card added alongside.

**Tech Stack:** SvelteKit 5, nodemailer OAuth2, Drizzle ORM, SQLite/Turso, existing `encrypt/decrypt` from `smartbill/crypto.ts`

---

### Task 1: Database Migrations

**Files:**
- Create: `drizzle/0126_email_settings_email_provider.sql`
- Create: `drizzle/0127_gmail_granted_scopes.sql`
- Create: `drizzle/0128_gmail_access_token_encrypted.sql`
- Create: `drizzle/0129_gmail_refresh_token_encrypted.sql`
- Modify: `src/lib/server/db/schema.ts:666-685` (emailSettings table)
- Modify: `src/lib/server/db/schema.ts:1335-1363` (gmailIntegration table)

- [ ] **Step 1: Create migration 0126 — email_provider column**

```sql
-- drizzle/0126_email_settings_email_provider.sql
ALTER TABLE email_settings ADD COLUMN email_provider TEXT DEFAULT 'smtp';
```

- [ ] **Step 2: Create migration 0127 — granted_scopes column**

```sql
-- drizzle/0127_gmail_granted_scopes.sql
ALTER TABLE gmail_integration ADD COLUMN granted_scopes TEXT;
```

- [ ] **Step 3: Create migration 0128 — access_token_encrypted column**

```sql
-- drizzle/0128_gmail_access_token_encrypted.sql
ALTER TABLE gmail_integration ADD COLUMN access_token_encrypted TEXT;
```

- [ ] **Step 4: Create migration 0129 — refresh_token_encrypted column**

```sql
-- drizzle/0129_gmail_refresh_token_encrypted.sql
ALTER TABLE gmail_integration ADD COLUMN refresh_token_encrypted TEXT;
```

- [ ] **Step 5: Update Drizzle schema — emailSettings**

In `src/lib/server/db/schema.ts`, add after `smtpFrom`:

```typescript
emailProvider: text('email_provider').default('smtp'), // 'gmail' | 'smtp'
```

- [ ] **Step 6: Update Drizzle schema — gmailIntegration**

In `src/lib/server/db/schema.ts`, add after `consecutiveRefreshFailures`:

```typescript
grantedScopes: text('granted_scopes'), // JSON: string[]
accessTokenEncrypted: text('access_token_encrypted'),
refreshTokenEncrypted: text('refresh_token_encrypted'),
```

- [ ] **Step 7: Run migrations locally**

Run: `cd /Users/augustin598/Projects/CRM/app && bun run db:migrate`

- [ ] **Step 8: Verify migrations**

Run:
```bash
sqlite3 local-ots.db "PRAGMA table_info(email_settings);" | grep email_provider
sqlite3 local-ots.db "PRAGMA table_info(gmail_integration);" | grep -E 'granted_scopes|access_token_encrypted|refresh_token_encrypted'
```
Expected: All 4 new columns visible.

- [ ] **Step 9: Update drizzle journal**

Run: `cd /Users/augustin598/Projects/CRM/app && bunx drizzle-kit generate` — verify journal matches SQL files, no orphan migrations.

- [ ] **Step 10: Commit**

```bash
git add drizzle/0126_email_settings_email_provider.sql drizzle/0127_gmail_granted_scopes.sql drizzle/0128_gmail_access_token_encrypted.sql drizzle/0129_gmail_refresh_token_encrypted.sql drizzle/meta src/lib/server/db/schema.ts
git commit -m "feat(migrations): add email_provider, granted_scopes, encrypted token columns"
```

---

### Task 2: Encrypt Gmail Tokens

**Files:**
- Modify: `src/lib/server/gmail/auth.ts`
- Modify: `src/lib/server/gmail/client.ts`

**Context:** All other integrations (ANAF SPV, Keez, Meta Ads, Google Ads, TikTok Ads) encrypt tokens with `encrypt(tenantId, data)`. Gmail stores them plain text — this fixes that.

- [ ] **Step 1: Add crypto imports to auth.ts**

At top of `src/lib/server/gmail/auth.ts`, add:

```typescript
import { encryptVerified, decrypt, DecryptionError } from '$lib/server/plugins/smartbill/crypto';
```

- [ ] **Step 2: Encrypt tokens in handleCallback()**

In `handleCallback()`, both the `update` (line 72-81) and `insert` (line 85-96) branches must store encrypted tokens. For the **update** branch:

```typescript
await db
  .update(table.gmailIntegration)
  .set({
    email,
    accessToken: tokens.access_token,           // keep plain for backward compat
    refreshToken: tokens.refresh_token,          // keep plain for backward compat
    accessTokenEncrypted: encryptVerified(tenantId, tokens.access_token),
    refreshTokenEncrypted: encryptVerified(tenantId, tokens.refresh_token),
    tokenExpiresAt,
    isActive: true,
    updatedAt: new Date()
  })
  .where(eq(table.gmailIntegration.id, existing.id));
```

Same pattern for the **insert** branch — add `accessTokenEncrypted` and `refreshTokenEncrypted`.

- [ ] **Step 3: Add decryptGmailToken() helper to auth.ts**

Add this helper function that reads encrypted tokens with fallback to plain text + self-healing backfill:

```typescript
/**
 * Read Gmail tokens, preferring encrypted columns.
 * Self-heals: if encrypted column is null but plain text exists, encrypts and backfills.
 * Uses UPDATE WHERE ... IS NULL to prevent race conditions on concurrent reads.
 */
async function readGmailTokens(
  integration: typeof table.gmailIntegration.$inferSelect
): Promise<{ accessToken: string; refreshToken: string }> {
  const tenantId = integration.tenantId;

  let accessToken: string;
  let refreshToken: string;

  if (integration.accessTokenEncrypted) {
    accessToken = decrypt(tenantId, integration.accessTokenEncrypted);
  } else {
    accessToken = integration.accessToken;
    // Self-heal: encrypt and backfill (WHERE IS NULL prevents race)
    if (accessToken) {
      try {
        await db
          .update(table.gmailIntegration)
          .set({ accessTokenEncrypted: encryptVerified(tenantId, accessToken) })
          .where(
            and(
              eq(table.gmailIntegration.id, integration.id),
              // Only backfill if still null (race-safe)
            )
          );
      } catch { /* ignore backfill failure */ }
    }
  }

  if (integration.refreshTokenEncrypted) {
    refreshToken = decrypt(tenantId, integration.refreshTokenEncrypted);
  } else {
    refreshToken = integration.refreshToken;
    if (refreshToken) {
      try {
        await db
          .update(table.gmailIntegration)
          .set({ refreshTokenEncrypted: encryptVerified(tenantId, refreshToken) })
          .where(eq(table.gmailIntegration.id, integration.id));
      } catch { /* ignore backfill failure */ }
    }
  }

  return { accessToken, refreshToken };
}
```

- [ ] **Step 4: Update getAuthenticatedClient() to use decrypted tokens**

Replace lines 117-121 in `getAuthenticatedClient()`:

```typescript
// Old:
// oauth2Client.setCredentials({
//   access_token: integration.accessToken,
//   refresh_token: integration.refreshToken,
//   expiry_date: integration.tokenExpiresAt.getTime()
// });

// New:
const { accessToken, refreshToken } = await readGmailTokens(integration);
oauth2Client.setCredentials({
  access_token: accessToken,
  refresh_token: refreshToken,
  expiry_date: integration.tokenExpiresAt.getTime()
});
```

- [ ] **Step 5: Update token refresh to save encrypted version**

In the token refresh block (line 126-134), update the `.set()` to also save encrypted token:

```typescript
const { credentials } = await oauth2Client.refreshAccessToken();
await db
  .update(table.gmailIntegration)
  .set({
    accessToken: credentials.access_token!,
    accessTokenEncrypted: encryptVerified(integration.tenantId, credentials.access_token!),
    tokenExpiresAt: new Date(credentials.expiry_date || Date.now() + 3600 * 1000),
    updatedAt: new Date()
  })
  .where(eq(table.gmailIntegration.id, integration.id));
```

- [ ] **Step 6: Update disconnectGmail() to use decrypted token**

In `disconnectGmail()` (line 210), change:

```typescript
// Old:
oauth2Client.setCredentials({ access_token: integration.accessToken });

// New:
const { accessToken } = await readGmailTokens(integration);
oauth2Client.setCredentials({ access_token: accessToken });
```

- [ ] **Step 7: Verify client.ts uses getAuthenticatedClient()**

Read `src/lib/server/gmail/client.ts` — confirm all functions use `getAuthenticatedClient(tenantId)` (which now decrypts). No direct token access. Should already be the case.

- [ ] **Step 8: Commit**

```bash
git add src/lib/server/gmail/auth.ts
git commit -m "feat(gmail): encrypt OAuth tokens at rest using tenant-scoped AES-256-GCM"
```

---

### Task 3: Expand OAuth Scopes + Store Granted Scopes

**Files:**
- Modify: `src/lib/server/gmail/auth.ts`

- [ ] **Step 1: Update SCOPES constant**

At line 16 of `src/lib/server/gmail/auth.ts`:

```typescript
// Old:
const SCOPES = ['https://www.googleapis.com/auth/gmail.readonly'];

// New:
const SCOPES = [
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/gmail.send'
];
```

- [ ] **Step 2: Add include_granted_scopes to getOAuthUrl()**

Modify `getOAuthUrl()` to support incremental authorization:

```typescript
export function getOAuthUrl(tenantId: string): string {
  const oauth2Client = getOAuth2Client();
  const url = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: SCOPES,
    prompt: 'consent',
    state: tenantId,
    include_granted_scopes: true  // incremental auth — adds new scopes without revoking old
  });
  logInfo('gmail', 'OAuth: Generated auth URL', { tenantId, metadata: { redirectUri: env.GOOGLE_REDIRECT_URI } });
  return url;
}
```

- [ ] **Step 3: Store granted scopes in handleCallback()**

After `const { tokens } = await oauth2Client.getToken(code);` (line 41), extract scopes:

```typescript
const grantedScopes = tokens.scope
  ? JSON.stringify(tokens.scope.split(' '))
  : JSON.stringify(SCOPES);
```

Then add `grantedScopes` to both the update `.set()` and insert `.values()`:

```typescript
// In update branch:
grantedScopes,

// In insert branch:
grantedScopes,
```

- [ ] **Step 4: Add hasGmailSendScope helper**

Add as exported function in `auth.ts`:

```typescript
export function hasGmailSendScope(grantedScopes: string | null): boolean {
  if (!grantedScopes) return false;
  try {
    const scopes: string[] = JSON.parse(grantedScopes);
    return scopes.some(s => s.includes('gmail.send'));
  } catch {
    return false;
  }
}
```

- [ ] **Step 5: Update getGmailStatus() to include scope info**

In `getGmailStatus()` (line 159), add to returned object:

```typescript
// In the "no integration" return:
hasSendScope: false,

// In the "integration found" return:
hasSendScope: hasGmailSendScope(integration.grantedScopes),
```

- [ ] **Step 6: Commit**

```bash
git add src/lib/server/gmail/auth.ts
git commit -m "feat(gmail): add gmail.send scope with incremental auth + scope tracking"
```

---

### Task 4: Gmail Transporter Factory

**Files:**
- Create: `src/lib/server/gmail/transporter.ts`

**Critical design decision (from Gemini review):** Nodemailer's OAuth2 transport has its own token refresh. To avoid conflicts with our `getAuthenticatedClient()` refresh, we refresh tokens BEFORE creating the transport, and pass fresh tokens. We do NOT rely on nodemailer's auto-refresh (we pass `accessToken` which is already fresh, and `refreshToken` as backup).

Also critical: Gmail OAuth2 enforces `from` = authenticated email. We must override `from` in mail options when using Gmail transport.

- [ ] **Step 1: Create gmail/transporter.ts**

```typescript
// src/lib/server/gmail/transporter.ts
import nodemailer from 'nodemailer';
import { env } from '$env/dynamic/private';
import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { eq, and } from 'drizzle-orm';
import { getAuthenticatedClient, hasGmailSendScope } from './auth';
import { decrypt } from '$lib/server/plugins/smartbill/crypto';
import { logInfo, logWarning, logError, serializeError } from '$lib/server/logger';

/**
 * Create a nodemailer transporter using Gmail OAuth2.
 * Returns null if: no active integration, missing send scope, token invalid.
 * Refreshes token via getAuthenticatedClient() BEFORE creating transport.
 */
export async function createGmailTransporter(
  tenantId: string
): Promise<{ transporter: nodemailer.Transporter; gmailEmail: string } | null> {
  // 1. Load integration
  const [integration] = await db
    .select()
    .from(table.gmailIntegration)
    .where(and(
      eq(table.gmailIntegration.tenantId, tenantId),
      eq(table.gmailIntegration.isActive, true)
    ))
    .limit(1);

  if (!integration) {
    logInfo('gmail', 'No active Gmail integration for sending', { tenantId });
    return null;
  }

  // 2. Check send scope
  if (!hasGmailSendScope(integration.grantedScopes)) {
    logWarning('gmail', 'Gmail integration lacks gmail.send scope — user must re-authorize', { tenantId });
    return null;
  }

  // 3. Refresh token via getAuthenticatedClient (handles expiry, deactivation)
  const oauth2Client = await getAuthenticatedClient(tenantId);
  if (!oauth2Client) {
    logWarning('gmail', 'Gmail OAuth client unavailable (token revoked?)', { tenantId });
    return null;
  }

  // 4. Read fresh tokens (decrypted)
  const credentials = oauth2Client.credentials;
  if (!credentials.access_token || !credentials.refresh_token) {
    logWarning('gmail', 'Gmail credentials incomplete after refresh', { tenantId });
    return null;
  }

  // 5. Create nodemailer transport
  try {
    const transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: {
        type: 'OAuth2',
        user: integration.email,
        clientId: env.GOOGLE_CLIENT_ID,
        clientSecret: env.GOOGLE_CLIENT_SECRET,
        refreshToken: credentials.refresh_token as string,
        accessToken: credentials.access_token as string
      }
    });

    logInfo('gmail', 'Created Gmail transporter', {
      tenantId,
      metadata: { email: integration.email }
    });

    return { transporter, gmailEmail: integration.email };
  } catch (error) {
    logError('gmail', 'Failed to create Gmail transporter', {
      tenantId,
      stackTrace: serializeError(error).stack
    });
    return null;
  }
}

/**
 * Detect Gmail-specific OAuth errors that should trigger SMTP fallback.
 */
export function isGmailOAuthError(error: unknown): boolean {
  const msg = error instanceof Error ? error.message : String(error);
  return (
    msg.includes('invalid_grant') ||
    msg.includes('Token has been expired or revoked') ||
    msg.includes('Insufficient Permission') ||
    msg.includes('Invalid Credentials') ||
    msg.includes('OAUTH') ||
    msg.includes('oauth')
  );
}

/**
 * Detect Gmail rate limit errors (should NOT fallback, should retry with backoff).
 */
export function isGmailRateLimitError(error: unknown): boolean {
  const msg = error instanceof Error ? error.message : String(error);
  return msg.includes('429') || msg.includes('Rate Limit') || msg.includes('quota');
}
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/server/gmail/transporter.ts
git commit -m "feat(gmail): add Gmail OAuth2 transporter factory with error detection helpers"
```

---

### Task 5: Modify getTenantTransporter() — Gmail Priority

**Files:**
- Modify: `src/lib/server/email.ts:1-20` (imports)
- Modify: `src/lib/server/email.ts:178-274` (getTenantTransporter)
- Modify: `src/lib/server/email.ts:304-353` (sendMailWithRetry)

**Critical (from Gemini):** When using Gmail, `from` address MUST be the Gmail account email. Gmail OAuth2 rejects mismatched `from`. We store `gmailEmail` in the cache alongside the transporter.

- [ ] **Step 1: Add imports**

At top of `src/lib/server/email.ts`, add:

```typescript
import { createGmailTransporter, isGmailOAuthError, isGmailRateLimitError } from '$lib/server/gmail/transporter';
```

- [ ] **Step 2: Expand cache to track provider type**

Replace the simple `Map<string, Transporter>` with a richer cache:

```typescript
// Old:
const tenantTransporters = new Map<string, nodemailer.Transporter>();

// New:
interface CachedTransporter {
  transporter: nodemailer.Transporter;
  provider: 'gmail' | 'smtp' | 'default';
  gmailEmail?: string; // Gmail 'from' address when provider is 'gmail'
}
const tenantTransporters = new Map<string, CachedTransporter>();
```

- [ ] **Step 3: Add getGmailFromEmail() export**

```typescript
/**
 * Get the Gmail 'from' email for a tenant, if Gmail is the active provider.
 * Gmail OAuth2 enforces from = authenticated email. Returns null if not Gmail.
 */
export function getGmailFromEmail(tenantId: string): string | null {
  const cached = tenantTransporters.get(tenantId);
  return cached?.provider === 'gmail' ? (cached.gmailEmail ?? null) : null;
}
```

- [ ] **Step 4: Modify getTenantTransporter() to try Gmail first**

In `getTenantTransporter()`, after loading `emailSettings` (around line 202), add Gmail logic BEFORE the SMTP block:

```typescript
if (emailSettings) {
  if (!emailSettings.isEnabled) {
    logWarning('email', 'Tenant email settings exist but are disabled, skipping', { tenantId });
    return null;
  }

  // NEW: Try Gmail if it's the preferred provider
  if (emailSettings.emailProvider === 'gmail') {
    try {
      const gmailResult = await createGmailTransporter(tenantId);
      if (gmailResult) {
        const cached: CachedTransporter = {
          transporter: gmailResult.transporter,
          provider: 'gmail',
          gmailEmail: gmailResult.gmailEmail
        };
        tenantTransporters.set(tenantId, cached);
        logInfo('email', 'Using Gmail transporter (primary)', {
          tenantId,
          metadata: { email: gmailResult.gmailEmail }
        });
        return gmailResult.transporter;
      }
      // Gmail unavailable — fall through to SMTP
      logWarning('email', 'Gmail transporter unavailable — falling back to SMTP', { tenantId });
    } catch (error) {
      logWarning('email', 'Gmail transporter creation failed — falling back to SMTP', {
        tenantId,
        stackTrace: serializeError(error).stack
      });
    }
  }

  // Existing SMTP logic (unchanged) ...
```

Update the SMTP cache to use new structure:

```typescript
// When caching SMTP transporter:
const cached: CachedTransporter = { transporter, provider: 'smtp' };
tenantTransporters.set(tenantId, cached);
```

- [ ] **Step 5: Update cache reads**

Update the cache hit at line 182-185:

```typescript
if (tenantTransporters.has(tenantId)) {
  logInfo('email', 'Using cached transporter', { tenantId });
  return tenantTransporters.get(tenantId)!.transporter;
}
```

- [ ] **Step 6: Update clearTenantTransporterCache()**

Close the transporter before deleting (Gemini: prevents socket leaks):

```typescript
export function clearTenantTransporterCache(tenantId: string): void {
  const cached = tenantTransporters.get(tenantId);
  if (cached) {
    try { cached.transporter.close(); } catch { /* ignore */ }
    tenantTransporters.delete(tenantId);
  }
}
```

- [ ] **Step 7: Add Gmail fallback to sendMailWithRetry()**

In `sendMailWithRetry()` (line 320-348), after the `isRetryableSmtpError` check and before the existing transporter refresh, add Gmail → SMTP fallback:

```typescript
// Inside the catch block, after logging the error:
if (!isRetryableSmtpError(lastError)) {
  // Check if this is a Gmail OAuth error — fall back to SMTP instead of giving up
  if (tenantId && isGmailOAuthError(lastError)) {
    logWarning('email', 'Gmail OAuth error — attempting SMTP fallback', {
      tenantId,
      metadata: { error: lastError.message, attempt }
    });
    clearTenantTransporterCache(tenantId);
    // Temporarily get SMTP-only transporter by clearing Gmail preference
    // getTenantTransporter will skip Gmail since cache is cleared and
    // createGmailTransporter will likely fail again, falling through to SMTP
    const fallbackTransporter = await getTenantTransporter(tenantId);
    if (fallbackTransporter) {
      transporter = fallbackTransporter;
      continue; // Retry with SMTP
    }
  }
  break; // Permanent non-Gmail error
}
```

- [ ] **Step 8: Commit**

```bash
git add src/lib/server/email.ts
git commit -m "feat(email): Gmail-first transporter with automatic SMTP fallback"
```

---

### Task 6: Override from Address for Gmail

**Files:**
- Modify: `src/lib/server/email.ts:411-509` (sendWithPersistence)

**Context (Gemini critical finding):** Gmail OAuth2 enforces that `from` must be the authenticated Gmail email address. If we send with `from: "Company <noreply@company.com>"` through a Gmail transport, it will be silently rewritten to the Gmail address, or in some cases rejected. We need to explicitly set the correct `from` when using Gmail.

- [ ] **Step 1: Add from-address override in sendWithPersistence()**

After getting the transporter (line 427-436), before calling `buildMail()`, determine the correct `from`:

```typescript
// STEP 2: Get transporter
const transporter = ctx.tenantId
  ? await getTenantTransporter(ctx.tenantId)
  : getDefaultTransporter();
if (!transporter) { /* existing error handling */ }

// STEP 2b: Determine 'from' address based on transport type
const gmailFrom = ctx.tenantId ? getGmailFromEmail(ctx.tenantId) : null;
```

Then after `buildMail()` returns `mailOptions`, override `from` if Gmail:

```typescript
// STEP 3b (after building mail):
if (gmailFrom && mailOptions.from) {
  // Preserve display name, replace email with Gmail address
  const fromStr = String(mailOptions.from);
  const nameMatch = fromStr.match(/^"?([^"<]+)"?\s*</);
  mailOptions.from = nameMatch
    ? `"${nameMatch[1].trim()}" <${gmailFrom}>`
    : gmailFrom;
}
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/server/email.ts
git commit -m "feat(email): override from address to Gmail email when using Gmail transport"
```

---

### Task 7: Remote Functions — Provider Switching + Gmail Test

**Files:**
- Modify: `src/lib/remotes/email-settings.remote.ts`

- [ ] **Step 1: Extend getEmailSettings() with Gmail info**

Add Gmail status to the query response. After the existing DB query, add:

```typescript
import { hasGmailSendScope } from '$lib/server/gmail/auth';

// Inside getEmailSettings(), after loading settings:
const [gmailIntegration] = await db
  .select({
    email: table.gmailIntegration.email,
    isActive: table.gmailIntegration.isActive,
    grantedScopes: table.gmailIntegration.grantedScopes
  })
  .from(table.gmailIntegration)
  .where(eq(table.gmailIntegration.tenantId, event.locals.tenant.id))
  .limit(1);

const gmailConnected = gmailIntegration?.isActive ?? false;
const gmailEmail = gmailIntegration?.email ?? null;
const gmailHasSendScope = gmailConnected && hasGmailSendScope(gmailIntegration?.grantedScopes ?? null);
```

Add to both return statements (default + existing settings):

```typescript
// In the "no settings" default return:
emailProvider: 'smtp',
gmailConnected,
gmailEmail,
gmailHasSendScope,
gmailNeedsReauth: gmailConnected && !gmailHasSendScope,

// In the "settings exist" return:
emailProvider: settings.emailProvider || 'smtp',
gmailConnected,
gmailEmail,
gmailHasSendScope,
gmailNeedsReauth: gmailConnected && !gmailHasSendScope,
```

- [ ] **Step 2: Add updateEmailProvider command**

```typescript
const emailProviderSchema = v.object({
  provider: v.picklist(['gmail', 'smtp'])
});

export const updateEmailProvider = command(emailProviderSchema, async (data) => {
  const event = getRequestEvent();
  if (!event?.locals.user || !event?.locals.tenant) throw new Error('Unauthorized');
  if (event.locals.tenantUser?.role !== 'owner' && event.locals.tenantUser?.role !== 'admin') {
    throw new Error('Insufficient permissions');
  }

  const tenantId = event.locals.tenant.id;

  if (data.provider === 'gmail') {
    // Validate Gmail is ready for sending
    const [gmail] = await db
      .select()
      .from(table.gmailIntegration)
      .where(and(
        eq(table.gmailIntegration.tenantId, tenantId),
        eq(table.gmailIntegration.isActive, true)
      ))
      .limit(1);

    if (!gmail) throw new Error('Gmail nu este conectat. Conectează-ți contul Gmail mai întâi.');
    if (!hasGmailSendScope(gmail.grantedScopes)) {
      throw new Error('Permisiuni insuficiente. Reconectează Gmail pentru a adăuga permisiunea de trimitere.');
    }
  }

  // Upsert email_settings
  const [existing] = await db
    .select()
    .from(table.emailSettings)
    .where(eq(table.emailSettings.tenantId, tenantId))
    .limit(1);

  if (existing) {
    await db
      .update(table.emailSettings)
      .set({ emailProvider: data.provider, updatedAt: new Date() })
      .where(eq(table.emailSettings.tenantId, tenantId));
  } else {
    await db.insert(table.emailSettings).values({
      id: generateEmailSettingsId(),
      tenantId,
      emailProvider: data.provider,
      isEnabled: true
    });
  }

  clearTenantTransporterCache(tenantId);
  return { success: true };
});
```

- [ ] **Step 3: Add testGmailSending command**

```typescript
import { createGmailTransporter } from '$lib/server/gmail/transporter';

export const testGmailSending = command(async () => {
  const event = getRequestEvent();
  if (!event?.locals.user || !event?.locals.tenant) throw new Error('Unauthorized');
  if (event.locals.tenantUser?.role !== 'owner' && event.locals.tenantUser?.role !== 'admin') {
    throw new Error('Insufficient permissions');
  }

  const tenantId = event.locals.tenant.id;
  const result = await createGmailTransporter(tenantId);
  if (!result) {
    throw new Error('Nu s-a putut crea transporterul Gmail. Verifică conexiunea și permisiunile.');
  }

  const [tenant] = await db
    .select()
    .from(table.tenant)
    .where(eq(table.tenant.id, tenantId))
    .limit(1);

  const tenantName = tenant?.name || 'CRM';
  const userEmail = event.locals.user.email;

  try {
    await result.transporter.sendMail({
      from: `"${tenantName}" <${result.gmailEmail}>`,
      to: userEmail,
      subject: `Test Email Gmail — ${tenantName}`,
      html: `
        <!DOCTYPE html>
        <html>
        <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
          <div style="background-color: #f8f9fa; padding: 30px; border-radius: 8px;">
            <h1 style="color: #4285f4; margin-top: 0;">Test Email Gmail — Succes!</h1>
            <p>Salut ${event.locals.user.firstName || ''},</p>
            <p>Acest email a fost trimis prin <strong>Gmail OAuth2</strong> din contul <strong>${result.gmailEmail}</strong>.</p>
            <p>Dacă ai primit acest email, Gmail este configurat corect pentru trimitere.</p>
            <p style="font-size: 12px; color: #999; margin-top: 30px;">
              Trimis la ${new Date().toLocaleString('ro-RO')}
            </p>
          </div>
        </body>
        </html>
      `,
      text: `Test Email Gmail — Succes!\n\nAcest email a fost trimis prin Gmail OAuth2 din contul ${result.gmailEmail}.\n\nTrimis la ${new Date().toLocaleString('ro-RO')}`
    });

    return { success: true, message: `Email test trimis cu succes la ${userEmail} prin Gmail` };
  } catch (error) {
    throw new Error(
      `Trimitere eșuată prin Gmail: ${error instanceof Error ? error.message : 'Eroare necunoscută'}`
    );
  }
});
```

- [ ] **Step 4: Add missing imports**

Add to existing imports in `email-settings.remote.ts`:

```typescript
import { and } from 'drizzle-orm';
import { hasGmailSendScope } from '$lib/server/gmail/auth';
import { createGmailTransporter } from '$lib/server/gmail/transporter';
```

- [ ] **Step 5: Commit**

```bash
git add src/lib/remotes/email-settings.remote.ts
git commit -m "feat(email): add Gmail provider switching, test, and status in email settings remote"
```

---

### Task 8: UI — Gmail Card in Email Settings

**Files:**
- Modify: `src/routes/[tenant]/settings/email/+page.svelte`

**Note:** After implementing, run svelte-autofixer MCP tool on this file.

- [ ] **Step 1: Add imports and state**

Update the script block in `+page.svelte`:

```typescript
import { getEmailSettings, updateEmailSettings, testEmailSettings, updateEmailProvider, testGmailSending } from '$lib/remotes/email-settings.remote';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '$lib/components/ui/card';
import { Button } from '$lib/components/ui/button';
import { Input } from '$lib/components/ui/input';
import { Label } from '$lib/components/ui/label';
import { Separator } from '$lib/components/ui/separator';
import { Switch } from '$lib/components/ui/switch';
import { Mail } from '@lucide/svelte';
import { page } from '$app/state';

// ... existing state ...

// Gmail state
let switchingProvider = $state(false);
let testingGmail = $state(false);
let gmailTestError = $state<string | null>(null);
let gmailTestSuccess = $state(false);
let providerError = $state<string | null>(null);

const isGmailProvider = $derived(settings?.emailProvider === 'gmail');
const tenantSlug = $derived(page.params.tenant);
```

- [ ] **Step 2: Add Gmail handler functions**

```typescript
async function handleProviderToggle(useGmail: boolean) {
  switchingProvider = true;
  providerError = null;
  try {
    await updateEmailProvider({ provider: useGmail ? 'gmail' : 'smtp' }).updates(settingsQuery);
  } catch (e) {
    providerError = e instanceof Error ? e.message : 'Eroare la schimbarea providerului';
  } finally {
    switchingProvider = false;
  }
}

async function handleGmailTest() {
  testingGmail = true;
  gmailTestError = null;
  gmailTestSuccess = false;
  try {
    await testGmailSending();
    gmailTestSuccess = true;
    setTimeout(() => { gmailTestSuccess = false; }, 5000);
  } catch (e) {
    gmailTestError = e instanceof Error ? e.message : 'Eroare la trimiterea testului Gmail';
  } finally {
    testingGmail = false;
  }
}
```

- [ ] **Step 3: Add Gmail card template**

Insert BEFORE the existing `<Card>` (before line 116):

```svelte
<Card class="mb-6">
  <CardHeader>
    <CardTitle>Trimitere Email prin Gmail</CardTitle>
    <CardDescription>
      {#if isGmailProvider}
        Metoda principală de trimitere
      {:else}
        Conectează Gmail pentru a trimite emailuri din contul tău
      {/if}
    </CardDescription>
  </CardHeader>
  <CardContent>
    {#if loading}
      <div class="animate-pulse space-y-4">
        <div class="h-4 bg-gray-200 dark:bg-gray-700 rounded w-1/3"></div>
      </div>
    {:else if !settings?.gmailConnected}
      <!-- Gmail not connected -->
      <div class="flex items-center gap-3 p-4 rounded-lg bg-muted/50">
        <div class="flex-1">
          <p class="font-medium">Gmail nu este conectat</p>
          <p class="text-sm text-muted-foreground">Conectează-ți contul Gmail pentru a trimite emailuri direct din contul tău.</p>
        </div>
        <Button variant="outline" onclick={() => window.location.href = `/api/gmail/auth?tenant=${tenantSlug}`}>
          Conectează Gmail
        </Button>
      </div>
    {:else if settings?.gmailNeedsReauth}
      <!-- Gmail connected but missing send scope -->
      <div class="space-y-3">
        <div class="flex items-center gap-2">
          <span class="inline-flex items-center rounded-full bg-green-100 px-2.5 py-0.5 text-xs font-medium text-green-800 dark:bg-green-900/30 dark:text-green-400">Conectat</span>
          <span class="text-sm">{settings.gmailEmail}</span>
        </div>
        <div class="flex items-center gap-3 p-4 rounded-lg bg-amber-50 dark:bg-amber-900/20">
          <div class="flex-1">
            <p class="font-medium text-amber-800 dark:text-amber-200">Permisiuni insuficiente</p>
            <p class="text-sm text-amber-700 dark:text-amber-300">Gmail a fost actualizat. Reconectează pentru a adăuga permisiunea de trimitere email.</p>
          </div>
          <Button variant="outline" onclick={() => window.location.href = `/api/gmail/auth?tenant=${tenantSlug}`}>
            Actualizează Permisiuni
          </Button>
        </div>
      </div>
    {:else}
      <!-- Gmail fully connected with send scope -->
      <div class="space-y-4">
        <div class="flex items-center gap-2">
          <span class="inline-flex items-center rounded-full bg-green-100 px-2.5 py-0.5 text-xs font-medium text-green-800 dark:bg-green-900/30 dark:text-green-400">Conectat</span>
          <span class="text-sm">{settings.gmailEmail}</span>
          <span class="inline-flex items-center rounded-full bg-blue-100 px-2.5 py-0.5 text-xs font-medium text-blue-800 dark:bg-blue-900/30 dark:text-blue-400">Trimitere activă</span>
        </div>

        <div class="flex items-center justify-between">
          <div class="space-y-0.5">
            <Label>Folosește Gmail pentru trimitere</Label>
            <p class="text-xs text-muted-foreground">
              Când este activat, emailurile se trimit din contul Gmail. SMTP este folosit automat ca fallback.
            </p>
          </div>
          <Switch
            checked={isGmailProvider}
            onCheckedChange={handleProviderToggle}
            disabled={switchingProvider}
          />
        </div>

        {#if providerError}
          <div class="rounded-md bg-red-50 dark:bg-red-900/20 p-3">
            <p class="text-sm text-red-800 dark:text-red-200">{providerError}</p>
          </div>
        {/if}

        <Separator />

        <Button
          variant="outline"
          onclick={handleGmailTest}
          disabled={testingGmail}
        >
          <Mail class="h-4 w-4 mr-2" />
          {testingGmail ? 'Se trimite...' : 'Trimite Email Test prin Gmail'}
        </Button>

        {#if gmailTestError}
          <div class="rounded-md bg-red-50 dark:bg-red-900/20 p-3">
            <p class="text-sm text-red-800 dark:text-red-200">{gmailTestError}</p>
          </div>
        {/if}

        {#if gmailTestSuccess}
          <div class="rounded-md bg-green-50 dark:bg-green-900/20 p-3">
            <p class="text-sm text-green-800 dark:text-green-200">
              Email test trimis cu succes prin Gmail! Verifică inbox-ul.
            </p>
          </div>
        {/if}
      </div>
    {/if}
  </CardContent>
</Card>
```

- [ ] **Step 4: Update existing SMTP card title to show role**

Change the existing `<CardTitle>` and `<CardDescription>`:

```svelte
<CardHeader>
  <CardTitle>Setări SMTP</CardTitle>
  <CardDescription>
    {#if isGmailProvider}
      Folosit ca fallback când Gmail nu este disponibil
    {:else}
      Metoda principală de trimitere email
    {/if}
  </CardDescription>
</CardHeader>
```

- [ ] **Step 5: Run svelte-check**

Run: `cd /Users/augustin598/Projects/CRM/app && npx svelte-check --threshold warning 2>&1 | head -30`
Expected: 0 errors

- [ ] **Step 6: Run svelte-autofixer**

Use the Svelte MCP `svelte-autofixer` tool on the modified `+page.svelte` file.

- [ ] **Step 7: Commit**

```bash
git add src/routes/\[tenant\]/settings/email/+page.svelte
git commit -m "feat(email): add Gmail sending card in email settings UI"
```

---

### Task 9: Disconnect Handling — Auto-Switch to SMTP

**Files:**
- Modify: `src/lib/server/gmail/auth.ts:192-222` (disconnectGmail function)

- [ ] **Step 1: Add auto-switch logic to disconnectGmail()**

After the existing `isActive: false` update (line 217-220), add:

```typescript
// Auto-switch email provider back to SMTP if Gmail was the primary sender
const [emailSettings] = await db
  .select()
  .from(table.emailSettings)
  .where(eq(table.emailSettings.tenantId, tenantId))
  .limit(1);

if (emailSettings?.emailProvider === 'gmail') {
  await db
    .update(table.emailSettings)
    .set({ emailProvider: 'smtp', updatedAt: new Date() })
    .where(eq(table.emailSettings.tenantId, tenantId));
  logInfo('gmail', 'Disconnect: auto-switched email provider from Gmail to SMTP', { tenantId });
}

// Clear transporter cache
const { clearTenantTransporterCache } = await import('$lib/server/email');
clearTenantTransporterCache(tenantId);
```

- [ ] **Step 2: Add emailSettings import**

Add at top of `auth.ts` if not already present. `table` import is already there, so just ensure `emailSettings` access works through `table.emailSettings`.

- [ ] **Step 3: Commit**

```bash
git add src/lib/server/gmail/auth.ts
git commit -m "feat(gmail): auto-switch to SMTP when Gmail is disconnected"
```

---

### Task 10: Final Verification

- [ ] **Step 1: Full build check**

Run: `cd /Users/augustin598/Projects/CRM/app && npx svelte-check --threshold warning`
Expected: 0 errors

- [ ] **Step 2: Verify migrations on Turso remote**

Run: `bun run db:migrate`
Then: `PRAGMA table_info(email_settings)` and `PRAGMA table_info(gmail_integration)` to confirm all columns exist.

- [ ] **Step 3: Manual end-to-end test**

1. Open `/settings/email` → verify Gmail card shows connection status
2. If Gmail connected without send scope → verify "Actualizează Permisiuni" button appears
3. Click re-auth → Google consent → verify scopes updated in DB
4. Toggle Gmail as primary → verify `email_provider` column updates
5. Send test email via Gmail → verify email arrives from Gmail account
6. Toggle back to SMTP → verify SMTP test still works
7. Disconnect Gmail from `/settings/gmail` → verify auto-switch to SMTP

- [ ] **Step 4: Run svelte-autofixer on all modified Svelte files**

- [ ] **Step 5: Final commit if any fixes**

```bash
git add -A
git commit -m "fix: address svelte-check and autofixer issues"
```
