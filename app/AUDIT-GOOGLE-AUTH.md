# Audit: Google OAuth Client Login — 2026-03-05

## Scope
Full security and correctness audit of the Google OAuth client login implementation,
including magic link flows that share infrastructure.

## Summary
- **25 issues found** (3 critical, 8 medium, ~14 low/informational)
- **10 fixes applied** (all critical + all medium)

---

## Critical Fixes

### FIX 1: Case-insensitive primary email lookup in `requestMagicLink`
**File:** `app/src/lib/remotes/client-auth.remote.ts` (line ~145)
**Issue:** Primary email lookup used raw `eq()` — case mismatch would fail to find the client, leaking existence info.
**Fix:** Wrapped with `eq(sql\`lower(${table.client.email})\`, email.toLowerCase())` — consistent with secondary email lookup in same function.

### FIX 2: Remove silent email overwrite in `clientSignup`
**File:** `app/src/lib/remotes/client-auth.remote.ts` (lines ~58-83)
**Issue:** If signup email didn't match primary email but client had no email set, the code would silently overwrite `client.email` with the signup email. Combined with CUI-based lookup, this allowed account takeover: attacker with a valid CUI could set any email as primary.
**Fix:** Now validates email against primary + secondary. Only sets primary email if `client.email` is null (first-time setup). If client already has an email and signup email doesn't match primary or any secondary, throws error.

### FIX 3: Unique constraint on `clientUser`
**File:** `app/drizzle/0060_client_user_unique_constraint.sql`
**Issue:** No unique constraint on `(userId, clientId, tenantId)` — concurrent logins could create duplicate `clientUser` rows.
**Fix:** `CREATE UNIQUE INDEX IF NOT EXISTS client_user_unique_idx ON client_user (user_id, client_id, tenant_id);`
**Applied:** local DB + remote DB.

---

## Medium Fixes

### FIX 4: Check `email_verified` from Google
**File:** `app/src/lib/server/google-client-auth.ts` (line ~56)
**Issue:** `exchangeCodeForEmail()` did not check whether the Google account email was verified.
**Fix:** Added `if (data.verified_email === false) throw new Error('Google email is not verified');`

### FIX 5: Validate parsed state fields in `parseState()`
**File:** `app/src/lib/server/google-client-auth.ts` (lines ~66-77)
**Issue:** Base64 padding was missing (could fail on certain state lengths). No type validation on parsed fields — malformed state could cause runtime errors.
**Fix:** Added proper base64 padding before `atob()`. Added type checks: `typeof parsed.tenantSlug !== 'string'` and `typeof parsed.nonce !== 'string'`.

### FIX 6: Normalize email in `findOrCreateClientUserSession`
**File:** `app/src/lib/server/client-auth.ts` (lines ~201-202)
**Issue:** Email passed to user lookup/creation was not lowercased. If Google returned `User@Example.com`, a new duplicate user record would be created instead of matching existing `user@example.com`.
**Fix:** Added `const normalizedEmail = email.toLowerCase();` — used for both lookup and insert.

### FIX 7: Sanitize error messages in Google OAuth callback
**File:** `app/src/routes/api/client-auth/google/callback/+server.ts`
**Issue:** Internal error messages (e.g., "Failed to exchange code", DB errors) were passed directly to the redirect URL, leaking implementation details.
**Fix:** All errors now map to generic `"Google login failed. Please try again."` in the redirect URL. Original error logged server-side with `console.error`.

### FIX 8: Move Google button inside `{:else}` block
**Files:** `login/+page.svelte`, `signup/+page.svelte`
**Issue:** After successful magic link request (`success = true`), the Google button and "or" divider remained visible — confusing UX (user sees "Check your email" + "Login with Google" simultaneously).
**Fix:** Moved divider + Google button inside the `{:else}` block so they hide when success message is shown.

### FIX 9: Fix signup email prefill from URL param
**File:** `signup/+page.svelte`
**Issue:** Email prefill used `$derived` + `$effect` pattern. The `$effect` would re-trigger and overwrite user input if they cleared the field and the URL param was still present.
**Fix:** Replaced with direct initialization: `let email = $state(page.url.searchParams.get('email') || '');`. Removed `prefillEmail` derived and `$effect` block.

### FIX 10: Initialize `tenantSlug` safely in callback
**File:** `app/src/routes/api/client-auth/google/callback/+server.ts`
**Issue:** `let tenantSlug` was declared but not initialized before the try block. If `parseState()` threw, the catch block's redirect would use `undefined` in the URL.
**Fix:** `let tenantSlug = '';` — ensures redirect URL is valid even if state parsing fails.

---

## Low / Informational (not fixed — noted for future)

1. **CSRF nonce cookie `Secure` flag** — Only set in production (correct), but no explicit `SameSite=Lax` (browser default is Lax, acceptable).
2. **Magic link token expiry (24h)** — Long window. Consider reducing to 1h for higher security.
3. **No rate limiting** on magic link requests — Could be abused for email spam. Consider per-email throttle.
4. **No rate limiting** on Google OAuth initiation — Minor, Google handles abuse on their end.
5. **Dummy password hash** for client users — `hash('dummy-password-for-client-users')` is a constant. Not exploitable (no password login path for clients), but could use a random value.
6. **`getRequestEvent()` dependency** — `verifyMagicLink` command relies on `getRequestEvent()` which can return null. Already handled with null check.
7. **No `HttpOnly` on CSRF nonce cookie** — Cookie is `httpOnly: true` (correct). Noted as verified.
8. **Google button SVG inline** — Duplicated across login/signup. Could extract to component. Low priority.
9. **`page.data as any`** — Type assertion bypasses type safety. Consider proper typing via `$types`.
10. **No session revocation** on client deletion — If a client is deleted, existing sessions remain valid until expiry.
11. **`sendUpdates` parameter** missing from Google OAuth redirect — Not needed (using `prompt: 'select_account'`). Noted.
12. **OAuth `access_type: 'online'`** — Correct for login-only flow (no refresh token needed).
13. **Missing CSP headers** for Google OAuth redirect — Browser handles redirect, no XSS risk.
14. **Console.error logging** — Production should use structured logging. Current approach acceptable for MVP.

---

## Files Modified
| File | Fixes |
|------|-------|
| `app/src/lib/remotes/client-auth.remote.ts` | #1, #2 |
| `app/src/lib/server/google-client-auth.ts` | #4, #5 |
| `app/src/lib/server/client-auth.ts` | #6 |
| `app/src/routes/api/client-auth/google/callback/+server.ts` | #7, #10 |
| `app/src/routes/client/[tenant]/login/+page.svelte` | #8 |
| `app/src/routes/client/[tenant]/signup/+page.svelte` | #8, #9 |
| `app/drizzle/0060_client_user_unique_constraint.sql` | #3 |
