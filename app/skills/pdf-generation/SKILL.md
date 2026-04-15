---
name: pdf-generation
description: Use when creating, modifying, or debugging PDF generation for invoices, contracts, reports, or any document. Also use when the user mentions "PDF," "pdfkit," "generate invoice PDF," "contract PDF," "report PDF," "presigned URL," "MinIO," "S3," "PDF attachment," "PDF styling," "diacritics," "font," "PDF/A," "watermark," or "digital signature." Triggers on work in *-pdf-generator.ts files or when attaching PDFs to emails.
---

# PDF & Document Generation — OTS CRM

## Context
- Library: pdfkit (PDFDocument)
- Generators:
  - `src/lib/server/invoice-pdf-generator.ts` — Invoice PDFs
  - `src/lib/server/contract-pdf-generator.ts` — Contract PDFs
  - `src/lib/server/report-pdf-generator.ts` — Marketing report PDFs
  - `src/lib/server/pdf-generator.ts` — Generic/shared utilities
- Storage: MinIO (S3-compatible), path: `uploads/{tenantId}/{module}/{fileId}.pdf`
- Fonts: DejaVuSans.ttf, DejaVuSans-Bold.ttf (Romanian diacritics support)
- Page: A4 (595.28pt width), margins 45px left/right, 40px top

## Core Design Principles
- Treat PDFs as production artifacts, not UI screenshots
- Make output deterministic — same input must produce same output
- Separate document generation, storage, and distribution concerns
- Design for legal, localization, and archival needs up front
- Prefer stable reusable styles over per-document ad hoc formatting

---

## Must

### Before Modifying a Generator
1. **Read the existing generator** — understand current layout, sections, data flow
2. **Check the data interface** — ensure all required fields are populated by the caller
3. **Verify font availability** — DejaVuSans for Romanian diacritics (ă, î, ș, ț, â)

### Layout & Styling
4. **Use shared constants** — Colors: Dark (#1E293B), Text (#334155), Muted (#64748B), Border (#CBD5E1), Soft BG (#F1F5F9), Accent (#3B82F6)
5. **Number formatting** — Use `fmtNum()` with `ro-RO` locale for amounts (1.234,56 format)
6. **Currency** — Support both RON and EUR, display correct symbol
7. **Explicit page breaks** — Check remaining page space before rendering sections to avoid cut-off content
8. **Legal sections** — For contracts, page breaks must NEVER split signature space or legal blocks
9. **Assets** — Resolve via `import.meta.dirname` for correct path in Bun runtime

### Deterministic Output
10. **Same input → same output** — PDF generation must be deterministic across retries and worker restarts
11. **Store before retry** — Generated PDFs are persisted to MinIO. Retries reuse stored artifact, not regenerate
12. **Cache by content hash** — When same semantic input should produce same file, cache deterministic PDFs
13. **Preview vs Final** — Separate artifact paths for draft/preview and final documents. Never overwrite final with preview

### Storage & URLs
14. **CRITICAL: Presigned URLs** — Use `command()` NOT `query()` for MinIO presigned URLs. `query()` caches per arguments → expired URLs → S3 AccessDenied
15. **Storage path** — Follow pattern: `uploads/{tenantId}/{module}/{fileId}.pdf`
16. **Write before send** — PDF MUST be fully written to MinIO AND stream closed BEFORE queuing email with attachment
17. **Validate after generation** — Check: file exists, size > 0, can be opened

### Fonts & Localization
18. **Embed all fonts** — Never assume local font availability in production workers
19. **Test diacritics** — Every generator must be tested with ă, î, ș, ț, â characters
20. **Line wrapping** — Test with long Romanian text — diacritics can affect character width and wrapping
21. **Font subsetting** — Consider for future optimization but not critical at current scale

### Metadata
22. **Set PDF metadata** — Title, subject, author, creation date for each document type
23. **PDF/A awareness** — For invoices/contracts (legal documents under RO law), document whether PDF/A is required. Add to roadmap for Q2

---

## Never
- Never email a PDF attachment that was not first persisted to storage
- Never assume local font availability in production workers
- Never regenerate a legal/financial PDF during retry — reuse stored artifact
- Never mix storage upload, email send, and PDF generation in one unrecoverable step
- Never let font fallback silently change document meaning (diacritics → boxes)
- Never skip validation just because the PDF "looks okay" in one viewer
- Never ship large PDFs without memory and latency testing
- Never make preview and final output share the same artifact path
- Never let a PDF generator depend on mutable external state during retry
- Never hardcode dates, amounts, or company names — use dynamic helpers

---

## Failure Smells

### Blockers
- PDF is generated and emailed inline without durable storage first
- Fonts are referenced but not embedded or not tested with Romanian text
- Invoice/contract output changes across retries with the same business input
- Page breaks split essential legal or signature sections unpredictably
- `query()` used instead of `command()` for presigned URLs

### Needs Review
- No strategy for large PDFs or high-memory documents
- Layout constants duplicated across generators
- Preview and final artifacts not clearly separated
- Document metadata not validated
- Rendering not tested with long text, multiple pages, or wide tables
- No explicit handling for draft vs final status
- Table overflow or multi-page table behavior untested

---

## Common Failure Modes
- Production workers substitute fonts → layout breaks or diacritics appear as boxes
- Retries send different document output for the same event (non-deterministic generation)
- Large reports exhaust memory because generation is fully buffered
- Long strings overflow boxes and distort layout
- Page break splits a legal block or signature section
- Preview builds accidentally overwrite final documents
- PDF looks correct in one reader but fails in another due to font/metadata issues
- Email sent before PDF written to MinIO → attachment missing (race condition)

---

## Testing

### Golden-File Tests (priority)
- Compare generated PDF against known-good reference for each generator type
- Text extraction checks for semantic correctness (amounts, names, dates)

### Required Fixtures
- Short invoice (1-3 items)
- Long invoice (20+ items, multi-page)
- Contract with signature block
- Multi-page marketing report
- Document with all Romanian diacritics
- Edge case: very long company name, very long address

---

## Shared Data Interfaces

```typescript
// All generators use consistent interfaces:
TenantData  — company name, CUI, VAT, IBAN, bank, address, email, phone, theme color
ClientData  — name, business name, company type, addresses
InvoiceData — invoiceNumber, status, issueDate, dueDate, lineItems, currency
ContractData — contractNumber, contractDate, contractTitle, serviceDescription
ReportPlatformData — name, spend, impressions, clicks, conversions, currency
```

---

## Review Checklist
- [ ] Is output deterministic?
- [ ] Are fonts embedded?
- [ ] Is the artifact stored before email delivery?
- [ ] Are large documents streamed (not fully buffered)?
- [ ] Are page breaks safe for legal sections?
- [ ] Are preview and final artifacts separated?
- [ ] Is metadata set intentionally?
- [ ] Are Romanian diacritics tested?
- [ ] Is `command()` used for presigned URLs (not `query()`)?
- [ ] Are test fixtures realistic?
