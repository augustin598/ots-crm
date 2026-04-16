---
name: email-delivery
description: Use when working on email sending, templates, SMTP configuration, or debugging delivery issues. Also use when the user mentions "email," "SMTP," "outbox," "email stuck," "email not sent," "retry," "email template," "sendMail," "sendWithPersistence," "email log," "email status," "PDF attachment in email," "bounce," "unsubscribe," "DKIM," "SPF," "DMARC," "deliverability," or "RFC 8058." Triggers on work in src/lib/server/email.ts or email-related API routes.
---

# Email Delivery & Outbox — OTS CRM

## Context
- Main file: `src/lib/server/email.ts` (79KB — grep for specific functions, don't read entirely)
- Pattern: "Log first, send later" — DB persistence before SMTP attempt
- Table: `emailLog` with status: pending → active → completed | failed | delayed
- Retry: Up to `maxAttempts` (default 3) with backoff (1m → 5m → 15m)
- Payload replay: `{ sendFn, args }` stored as JSON for idempotent retry
- SMTP audit: `smtpMessageId` and `smtpResponse` persisted
- Scale: ~50 tenants, <1000 emails/day, per-tenant SMTP config

## Email Types
invitation, invoice, magic-link, admin-magic-link, password-reset, task-assignment, task-update, task-reminder, task-client-notification, daily-reminder, contract-signing, invoice-paid, invoice-overdue-reminder

## Core Design Principles
- Treat email as a multi-stage pipeline, not a simple send
- Preserve the exact rendered message across retries
- Make suppression and complaint state first-class
- Distinguish operational/transactional email from list-style/marketing email
- Keep preview, test, and production sending separated
- Assume every outgoing email can become a support, compliance, or reputation issue

---

## Must

### Outbox Pattern (core flow)
1. **Persist before send** — Create `emailLog` row BEFORE SMTP attempt. This guarantees DB record exists regardless of SMTP outcome
2. **Idempotent replay** — Retries use the stored `payload` (sendFn + args) to reproduce exact same email. Don't regenerate content during retry
3. **Error classification** — Before retrying, classify: transient (SMTP timeout, connection refused) vs permanent (invalid address, auth failure). Only retry transient
4. **Error context** — Always populate `errorReason` with actionable details. Not just "failed" — include SMTP error code/message

### Sender Domain Authentication (priority)
5. **SPF check** — Before enabling tenant sending, verify SPF record is published for sender domain
6. **DKIM signing** — Ensure DKIM is configured and valid for the sending domain
7. **DMARC alignment** — Verify DMARC policy is present with aligned domains (From: domain matches DKIM/SPF domain)
8. **Pre-send validation** — Don't enable a new tenant's custom SMTP without verifying domain authentication state
9. **Re-validate on change** — When tenant changes sender domain or SMTP settings, re-verify before allowing sends

### Bounce & Complaint Suppression (priority)
10. **Suppress bounced addresses** — When an email bounces (hard bounce), mark the address as bounced. Do NOT retry to bounced addresses
11. **Suppress complained addresses** — When a complaint signal is received, suppress future sends to that address
12. **Check before send** — Before every SMTP send, check suppression table. Never send to a suppressed address
13. **Durable suppression** — Suppression state must persist across retries and survive app restarts

### RFC 8058 Unsubscribe (required by Gmail/Yahoo since Feb 2024)
14. **List-Unsubscribe header** — Add `List-Unsubscribe` and `List-Unsubscribe-Post` headers for bulk/marketing-style emails
15. **One-click unsubscribe** — Implement the RFC 8058 one-click POST endpoint
16. **Category-aware** — Transactional emails (invoice, password-reset) don't need unsubscribe. Marketing/notification emails do

### Templates
17. **Romanian translations** — All customer-facing emails must have Romanian versions
18. **Dynamic placeholders** — Never hardcode dates, amounts, names. Use template variables with fallbacks
19. **HTML body capture** — Populate `htmlBody` in emailLog for admin preview UI
20. **Template versioning** — Store `templateId` and version with each send. Retries must use the SAME template version, not current version
21. **HTML + plain text** — Keep both versions aligned for each template
22. **Subject line** — Include relevant context (invoice number, task name, etc.)

### Attachments (PDF)
23. **Write before send** — PDF must be fully written to MinIO AND stream closed BEFORE calling sendWithPersistence
24. **Presigned URLs** — Use `command()` not `query()` for MinIO URLs
25. **Buffer attachment** — When attaching inline, pass Buffer directly to nodemailer, don't rely on URL fetch

### Email Transport (Gmail API + SMTP)
26. **Gmail as primary** — When `emailSettings.emailProvider === 'gmail'`, emails are sent via Gmail API (`gmail.users.messages.send`), NOT SMTP. Nodemailer compiles RFC 5322 → base64url encode → Gmail API sends. Works with Google Workspace.
27. **SMTP as fallback** — If Gmail transporter fails (token revoked, scope missing), automatically falls back to tenant SMTP, then env default SMTP
28. **Never use SMTP OAuth2 for Gmail** — Google Workspace blocks SMTP XOAUTH2 (535-5.7.8 BadCredentials). Always use Gmail API for sending.
29. **Gmail from override** — Gmail OAuth2 enforces `from` = authenticated email. `sendWithPersistence()` auto-overrides `from` when Gmail is active, preserving display name
30. **skipGmail flag** — `getTenantTransporter(tenantId, { skipGmail: true })` forces SMTP, used during Gmail→SMTP fallback in `sendMailWithRetry()` to prevent re-creating failed Gmail transporter
31. **Transporter cache** — `CachedTransporter` interface tracks `provider` ('gmail' | 'smtp' | 'default') + `gmailEmail`. `clearTenantTransporterCache()` calls `transporter.close()` to prevent socket leaks
32. **Gmail token refresh** — `getAuthenticatedClient()` auto-refreshes tokens 5min before expiry. Transporter factory calls it BEFORE creating transport. On 401 during send, fallback to SMTP automatically

### SMTP Configuration
33. **Per-tenant SMTP** — Each tenant can have custom SMTP settings (encrypted in DB)
34. **Decrypt with retry** — Transient Turso reads may fail → retry decrypt 2-3 times
35. **Fallback transporter** — If tenant SMTP fails, system may have a default transporter
36. **Test SMTP** — Use `scripts/test-smtp.ts` to verify credentials before deploying changes

### Rate Limiting
30. **Per-tenant outbound limit** — Prevent one tenant from sending 500 emails in 1 minute and damaging shared IP reputation
31. **Per-domain limit** — Spread sends across recipient domains to avoid being flagged as spam by any single provider

### Preview & Test Mode
32. **Safe recipients** — Test mode must use designated test addresses only. Never accidentally hit real users
33. **Visual marker** — Preview/test emails should be clearly marked as non-production

---

## Never
- Never send directly from application code without going through the outbox/persistence path
- Never retry to a recipient already marked bounced, complained, or unsubscribed
- Never enable tenant sending on an unverified or misaligned domain
- Never mutate template content between retries without updating versioning
- Never omit unsubscribe handling for mail categories that function like list/marketing mail
- Never log SMTP credentials, auth responses, or full recipient lists
- Never "just retry" a failed send without classifying the error
- Never let test mode send to production recipients accidentally
- Never assume a successful SMTP response means inbox delivery
- Never ignore a complaint signal because the SMTP send was accepted
- Never allow an outbound worker to produce new content during a retry if replay is intended
- Never read the entire 79KB email.ts — grep for specific function names

---

## Failure Smells

### Blockers
- SMTP send happens before durable persistence
- Retry logic regenerates content instead of replaying versioned payload
- Tenant domain auth state unknown or unchecked before sending
- Retry can send to a recipient who previously bounced or unsubscribed
- No suppression table or equivalent durable state exists

### Needs Review
- No bounce/complaint ingestion exists
- Templates have no versioning or preview-safe test mode
- Unsubscribe headers missing for bulk/notification emails
- Deliverability monitored only by application success logs
- No separation between transactional and list-style mail categories
- Domain alignment assumed but not verified
- Preview mode uses same recipient resolution as production
- A domain change can go live without re-checking authentication

---

## Common Failure Modes
- Messages land in spam because SPF, DKIM, DMARC not aligned
- Retries resend to bad recipients because bounce/complaint state not consulted
- Template change causes retry output to differ from originally approved email
- Tenant accidentally floods a recipient domain → reputation damage
- One tenant's invalid SMTP config generates huge retry backlog
- Complaint suppression exists in UI but not in actual send pipeline
- Test emails leak into real users' inboxes
- Different templates produce inconsistent from-name, footer, or unsubscribe behavior

---

## Debugging Email Issues

### "Email stuck in pending"
1. Check `emailLog` — is `attempts` < `maxAttempts`?
2. Check scheduler — is the retry worker running?
3. Check SMTP credentials — valid and decryptable?

### "Email sent but not received"
1. Check `smtpResponse` in emailLog — was it accepted by SMTP server?
2. Check spam folder
3. Verify `toEmail` is correct
4. Check SPF/DKIM/DMARC alignment for sender domain

### "PDF attachment missing"
1. Was PDF written to MinIO before email was queued?
2. Was `command()` used for presigned URL (not `query()`)?
3. Was `doc.end()` called on the PDFDocument?

### "Decrypt failed for SMTP password"
1. Transient Turso read → retry
2. Check encryption key (env `ENCRYPTION_KEY`)
3. Check if integration was deactivated by previous error

### "Gmail send fails with 535-5.7.8 BadCredentials"
1. This means SMTP OAuth2 is being used — WRONG. Must use Gmail API
2. Check `src/lib/server/gmail/transporter.ts` — should use `gmail.users.messages.send`, not `nodemailer.createTransport({ service: 'gmail' })`
3. Google Workspace blocks SMTP XOAUTH2 mechanism

### "Gmail send fails with 403 or Insufficient Permission"
1. Check `grantedScopes` in `gmail_integration` table — must include `gmail.send`
2. User needs to re-authorize: Settings → Email → "Actualizează Permisiuni" button
3. After re-auth, `handleCallback()` stores new scopes in `grantedScopes` column

---

## Standards & References
- **RFC 6376** — DKIM signing and verification
- **RFC 7489** — DMARC policy and identifier alignment
- **RFC 8058** — One-click unsubscribe (required by Gmail/Yahoo since Feb 2024)
- **Outbox pattern** — Durable payload replay with suppression-aware retry

---

## Review Checklist
- [ ] Is the email persisted before send?
- [ ] Is the payload replayable and versioned?
- [ ] Are SPF, DKIM, and DMARC validated for sender domain?
- [ ] Are bounced/complained/unsubscribed recipients suppressed?
- [ ] Are previews safe (test recipients only)?
- [ ] Are deliverability metrics tracked?
- [ ] Is template version stable across retries?
- [ ] Is sender identity verified for the tenant?
- [ ] Are headers intentional and category-appropriate?
- [ ] Is RFC 8058 unsubscribe implemented for bulk mail?
- [ ] Are rate limits per tenant and per domain?
