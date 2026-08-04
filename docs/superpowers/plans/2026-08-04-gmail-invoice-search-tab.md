# Tab „Căutare Gmail" + match plăți + fixuri parsare — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tab nou pe `/ots/banking/supplier-invoices` care caută facturi furnizori direct în Gmail (upload „Documente Lipsa" din Keez sau căutare liberă), le potrivește cu plățile printr-un algoritm de scoring și permite descărcarea individuală/ZIP, plus fixarea bugurilor de parsare (sumă, valută, status, nr. factură).

**Spec:** `docs/superpowers/specs/2026-08-04-gmail-invoice-search-tab-design.md`

**Architecture:** Logica de match e un modul pur testabil (`payment-match.ts`); căutarea Gmail refolosește `buildSearchQuery`/`searchEmails` existente; descărcarea ia atașamentele live din Gmail (attachmentId-urile sunt efemere); evidența descărcărilor e un tabel nou `gmail_invoice_download`.

**Tech Stack:** SvelteKit 5 (remote functions), Bun (`bun:test`), Drizzle/Turso (migrări hand-authored, un statement per fișier), JSZip, xlsx, shadcn-svelte Tabs.

**Reguli proiect obligatorii:**
- Toate remote-urile noi: `requireStaff(event)` după guard-ul user/tenant (F8).
- Migrări: un singur statement SQL per fișier; `_journal.json` sincron cu fișierele; după `db:migrate` verifică pe Turso cu `PRAGMA table_info`. Tabelul se adaugă în `schema.ts` DOAR după ce migrarea a rulat.
- Nu persista/refolosi `attachmentId` Gmail — refetch prin `getEmail` la fiecare descărcare.
- După orice componentă Svelte nouă/modificată: rulează `svelte-autofixer` (MCP).
- `svelte-check` are nevoie de `NODE_OPTIONS=--max-old-space-size=8192`.
- Toate comenzile se rulează din `/Users/augustin598/Projects/CRM/app`.

---

## Task 1: Fix pdf-parser — total brut prioritar, valută din context, fără sumă fără valută, nr. factură cu cifre

**Files:**
- Test: `src/lib/server/gmail/__tests__/pdf-parser.test.ts` (nou)
- Modify: `src/lib/server/gmail/pdf-parser.ts`

Bugurile reproduse: ROTLD → prinde „Total 62,91" (net) în loc de „Total de plata (TVA inclus) 76,12" și nu detectează RON; INWX → prinde „1.00" (cantitatea) în loc de „Total with VAT: 9,50 €" și acceptă „available" ca nr. de factură.

`parseInvoiceText` nu e exportat; testăm prin `extractInvoiceDataFromPdf`? Nu — ar cere PDF-uri reale. **Exportă `parseInvoiceText`** pentru testare directă pe text.

- [ ] **Step 1: Scrie testele care pică**

```ts
// src/lib/server/gmail/__tests__/pdf-parser.test.ts
import { describe, it, expect } from 'bun:test';
import { parseInvoiceText } from '../pdf-parser';

// Text aproximat din PDF-ul real ROTLD (factura 453940)
const ROTLD_TEXT = `Institutul National de Cercetare-Dezvoltare in Informatica - ICI Bucuresti
Cod fiscal: RO2785503
FACTURA
Serie ICI 8
Nr. 453940
Data 21-07-2026
Nr. crt. Denumirea serviciilor Cantitate Pret unitar fara TVA - RON - Valoare fara TVA - RON - TVA (21%)
1 Reinnoire oannaseb.ro 1 62,91 62,91 13,21
Total 62,91 13,21
Total de plata (TVA inclus) 76,12
Achitat cu (RRN):620284779550 / 2026-07-21`;

// Text aproximat din PDF-ul real INWX (document 2026068392)
const INWX_TEXT = `INWX GmbH
Invoice
Customer number: 253104
Document number: 2026068392
Date: 2026-06-30
Pos. Description Amount Price Total
1 REG: proteamwash.be 1.00 9,50 € 9,50 €
Total with VAT: 9,50 €
Total without VAT: 7,85 €
VAT 21.00%: 1,65 €
Amount received by prepayment.`;

describe('parseInvoiceText — sume și valute', () => {
	it('ROTLD: ia totalul de plată cu TVA, în RON', () => {
		const r = parseInvoiceText(ROTLD_TEXT);
		expect(r.amount).toBe(7612);
		expect(r.currency).toBe('RON');
	});

	it('INWX: ia Total with VAT în EUR, nu cantitatea 1.00', () => {
		const r = parseInvoiceText(INWX_TEXT);
		expect(r.amount).toBe(950);
		expect(r.currency).toBe('EUR');
	});

	it('nu întoarce niciodată sumă fără valută', () => {
		const r = parseInvoiceText('Ceva text\nTotal 123.45\nAlt text fara valuta');
		expect(r.amount).toBeUndefined();
	});
});

describe('parseInvoiceText — nr. factură', () => {
	it('ROTLD: extrage 453940 din "Nr. 453940"', () => {
		const r = parseInvoiceText(ROTLD_TEXT);
		expect(r.invoiceNumber).toBe('453940');
	});

	it('INWX: extrage 2026068392 din "Document number"', () => {
		const r = parseInvoiceText(INWX_TEXT);
		expect(r.invoiceNumber).toBe('2026068392');
	});

	it('respinge candidați fără cifre (ex. "available")', () => {
		const r = parseInvoiceText('Your new invoice available now\nTotal in EUR 5,00');
		expect(r.invoiceNumber).toBeUndefined();
	});
});
```

- [ ] **Step 2: Rulează testele — trebuie să pice**

Run: `cd /Users/augustin598/Projects/CRM/app && bun test src/lib/server/gmail/__tests__/pdf-parser.test.ts`
Expected: FAIL — `parseInvoiceText` nu e exportat; după export, aserțiile pe sume pică.

- [ ] **Step 3: Implementează fixul în `pdf-parser.ts`**

Schimbări:

a) Exportă funcția: `function parseInvoiceText(` → `export function parseInvoiceText(`.

b) În secțiunea `--- Invoice Number ---`, adaugă la ÎNCEPUTUL listei `invoicePatterns` două pattern-uri noi și cere cifre în sanity check:

```ts
	const invoicePatterns = [
		/document\s+number\s*[:\-–]?\s*([\w\-/.]+)/i,
		/\bnr\.?\s+(\d{3,})\b/i,
		/(?:invoice|factur[aă]|rechnung)\s*(?:number|num[aă]rul|nr\.?|no\.?|#|num[aă]r)\s*[:\-–]?\s*([\w\-/.]+)/i,
		// ... restul pattern-urilor existente neschimbate
	];

	for (const pattern of invoicePatterns) {
		const match = text.match(pattern);
		if (match) {
			const num = match[1] || match[0];
			// Sanity check: 3-30 chars și conține cel puțin o cifră (respinge "available" etc.)
			if (num.length >= 3 && num.length <= 30 && /\d/.test(num)) {
				result.invoiceNumber = num.replace(/^[:\-–\s]+/, '').trim();
				break;
			}
		}
	}
```

c) În secțiunea `--- Amount ---`, ÎNAINTE de pattern-ul 1 existent, adaugă pattern-ul 0 (totaluri brute, prioritate maximă):

```ts
	// 0. Gross totals — highest priority: "Total de plata (TVA inclus) 76,12",
	// "Total with VAT: 9,50 €", "Grand total", "Gesamtbetrag"
	const grossPatterns: Array<{ re: RegExp; amountIdx: number; currencyIdx?: number }> = [
		{ re: /total\s+de\s+plat[aă][^\d\n]*?([\d.,]+)/i, amountIdx: 1 },
		{ re: /total\s+with\s+vat\s*[:\-–]?\s*([\d.,]+)\s*(€|\$|£|RON|EUR|USD|GBP|LEI)?/i, amountIdx: 1, currencyIdx: 2 },
		{ re: /(?:grand\s+total|gesamtbetrag)\s*[:\-–]?\s*([\d.,]+)\s*(€|\$|£|RON|EUR|USD|GBP|LEI)?/i, amountIdx: 1, currencyIdx: 2 }
	];
	for (const { re, amountIdx, currencyIdx } of grossPatterns) {
		const m = text.match(re);
		if (!m) continue;
		const parsed = parseBareAmount(m[amountIdx]);
		if (!parsed) continue;
		result.amount = parsed;
		if (currencyIdx && m[currencyIdx]) result.currency = normalizeSymbolCurrency(m[currencyIdx]);
		break;
	}
```

cu helperul (lângă `normalizeCurrency`):

```ts
function normalizeSymbolCurrency(c: string): string {
	const map: Record<string, string> = { '€': 'EUR', $: 'USD', '£': 'GBP' };
	return map[c] || normalizeCurrency(c);
}
```

d) După TOATE pattern-urile de sumă (după fallback-ul 5), adaugă rezolvarea valutei din context + regula „fără sumă fără valută":

```ts
	// Currency from document context when amount was found without one:
	// column headers like "- RON -", or RON invoices with Romanian VAT wording
	if (result.amount && !result.currency) {
		const columnHint = text.match(/-\s*(RON|EUR|USD|GBP|LEI)\s*-/i);
		if (columnHint) {
			result.currency = normalizeCurrency(columnHint[1]);
		} else if (/\bTVA\b/i.test(text) && /\b(RON|LEI)\b/i.test(text)) {
			result.currency = 'RON';
		}
	}

	// Never return an amount without a currency — a wrong guess (old USD default)
	// is worse than an empty field.
	if (result.amount && !result.currency) {
		delete result.amount;
	}
```

- [ ] **Step 4: Rulează testele — trebuie să treacă**

Run: `bun test src/lib/server/gmail/__tests__/pdf-parser.test.ts`
Expected: PASS (6 tests)

- [ ] **Step 5: Rulează toată suita gmail ca regresie**

Run: `bun test src/lib/server/gmail/`
Expected: PASS (inclusiv auth-callback.test.ts)

- [ ] **Step 6: Commit**

```bash
git add src/lib/server/gmail/pdf-parser.ts src/lib/server/gmail/__tests__/pdf-parser.test.ts
git commit -m "fix(gmail): pdf-parser ia totalul cu TVA, valuta din context, respinge nr. factură fără cifre"
```

---

## Task 2: Status „paid" din PDF + cuvinte-cheie noi în detectStatus

**Files:**
- Test: `src/lib/server/gmail/__tests__/pdf-parser.test.ts` (extindere), `src/lib/server/gmail/__tests__/parsers.test.ts` (nou)
- Modify: `src/lib/server/gmail/pdf-parser.ts`, `src/lib/server/gmail/parsers/index.ts`, `src/lib/remotes/supplier-invoices.remote.ts`

- [ ] **Step 1: Scrie testele care pică**

Adaugă în `pdf-parser.test.ts`:

```ts
describe('parseInvoiceText — status', () => {
	it('ROTLD: "Achitat cu (RRN)" => paid', () => {
		expect(parseInvoiceText(ROTLD_TEXT).status).toBe('paid');
	});
	it('INWX: "Amount received by prepayment" => paid', () => {
		expect(parseInvoiceText(INWX_TEXT).status).toBe('paid');
	});
	it('fără indicii => status undefined', () => {
		expect(parseInvoiceText('Total in EUR 5,00').status).toBeUndefined();
	});
});
```

Creează `src/lib/server/gmail/__tests__/parsers.test.ts`:

```ts
import { describe, it, expect } from 'bun:test';
import { detectStatus } from '../parsers/index';

describe('detectStatus — cuvinte-cheie noi', () => {
	it('achitat => paid', () => {
		expect(detectStatus('Factura a fost achitata cu cardul')).toBe('paid');
	});
	it('amount received by prepayment => paid', () => {
		expect(detectStatus('Amount received by prepayment.')).toBe('paid');
	});
});
```

- [ ] **Step 2: Rulează — trebuie să pice**

Run: `bun test src/lib/server/gmail/__tests__/pdf-parser.test.ts src/lib/server/gmail/__tests__/parsers.test.ts`
Expected: FAIL (status undefined / pending)

- [ ] **Step 3: Implementează**

a) `parsers/index.ts` — în `detectStatus`, în blocul `paid`, adaugă:

```ts
			bodyLower.includes('achitat') ||
			bodyLower.includes('amount received') ||
			bodyLower.includes('prepayment') ||
```

b) `pdf-parser.ts` — extinde interfața și populează status:

```ts
export interface PdfExtractedInvoiceData {
	invoiceNumber?: string;
	amount?: number; // in cents
	currency?: string;
	issueDate?: Date;
	dueDate?: Date;
	status?: 'paid';
}
```

La finalul lui `parseInvoiceText`, înainte de `return result;`:

```ts
	// Paid detection from PDF text (only positive signal; absence means unknown)
	if (/achitat|amount received|prepayment|paid in full|payment received/i.test(text)) {
		result.status = 'paid';
	}
```

c) `supplier-invoices.remote.ts` — în AMBELE blocuri de enrichment PDF (în `previewGmailInvoices` și `importSelectedInvoices`), după linia cu `if (!parsed.issueDate && pdfData.issueDate) ...`, adaugă:

```ts
						if ((!parsed.status || parsed.status === 'pending') && pdfData.status) parsed.status = pdfData.status;
```

d) Tot în `importSelectedInvoices` — nu mai forța USD când parserul n-a găsit valuta; suma fără valută nu se salvează:

```ts
				// era: amount: parsed.amount || null,  currency: parsed.currency || 'USD',
				amount: parsed.currency ? parsed.amount || null : null,
				currency: parsed.currency || 'USD',
```

(schema are `currency NOT NULL DEFAULT 'USD'`, deci coloana primește o valoare, dar suma nu mai apare cu valută ghicită.)

- [ ] **Step 4: Rulează — trebuie să treacă**

Run: `bun test src/lib/server/gmail/`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/server/gmail/ src/lib/remotes/supplier-invoices.remote.ts
git commit -m "fix(gmail): status plătită detectat și din PDF; fără sumă cu valută ghicită la import"
```

---

## Task 3: Nr. factură fals în parserele de email (generic + ro-suppliers)

**Files:**
- Test: `src/lib/server/gmail/__tests__/parsers.test.ts` (extindere)
- Modify: `src/lib/server/gmail/parsers/generic.ts`, `src/lib/server/gmail/parsers/ro-suppliers.ts`

- [ ] **Step 1: Scrie testele care pică**

Adaugă în `parsers.test.ts`:

```ts
import { genericParser } from '../parsers/generic';
import { roSuppliersParser } from '../parsers/ro-suppliers';
import type { GmailMessage } from '../client';

function makeEmail(overrides: Partial<GmailMessage>): GmailMessage {
	return {
		id: 'm1',
		threadId: 't1',
		from: 'INWX GmbH <noreply@inwx.de>',
		subject: 'New Invoice available',
		date: new Date('2026-07-01'),
		body: 'A new invoice is available in your account.',
		attachments: [],
		...overrides
	};
}

describe('extragere nr. factură din email', () => {
	it('generic: nu ia "available" din "New Invoice available"', () => {
		const r = genericParser.parseInvoice(makeEmail({}));
		expect(r.invoiceNumber).toBeUndefined();
	});
	it('generic: acceptă numere reale ("Invoice #12345")', () => {
		const r = genericParser.parseInvoice(makeEmail({ subject: 'Invoice #12345' }));
		expect(r.invoiceNumber).toBe('12345');
	});
	it('ro-suppliers: extrage 453940 din subiect ROTLD', () => {
		const r = roSuppliersParser.parseInvoice(
			makeEmail({ from: 'facturi@rotld.ro', subject: 'ROTLD Factura #453940/2026-07-21', body: '' })
		);
		expect(r.invoiceNumber).toContain('453940');
	});
});
```

- [ ] **Step 2: Rulează — primul test pică**

Run: `bun test src/lib/server/gmail/__tests__/parsers.test.ts`
Expected: FAIL — generic întoarce `invoiceNumber: 'available'`

- [ ] **Step 3: Implementează**

a) `generic.ts` — înlocuiește blocul `invoiceMatch`:

```ts
		const invoiceMatch = email.subject.match(/(?:invoice|factura|factură)\s*#?\s*([\w-]+)/i) ||
			email.body.match(/(?:invoice|factura|factură)\s*(?:number|nr\.?|#|no\.?)\s*:?\s*([\w-]+)/i);
		// Invoice numbers always contain digits — rejects words like "available"/"ready"
		if (invoiceMatch && /\d/.test(invoiceMatch[1])) {
			result.invoiceNumber = invoiceMatch[1];
		}
```

b) `ro-suppliers.ts` — aceeași gardă pe blocul lui `invoiceMatch`:

```ts
		if (invoiceMatch) {
			const candidate = invoiceMatch[2] ? `${invoiceMatch[1]}-${invoiceMatch[2]}` : invoiceMatch[1];
			if (/\d/.test(candidate)) result.invoiceNumber = candidate;
		}
```

- [ ] **Step 4: Rulează — trebuie să treacă**

Run: `bun test src/lib/server/gmail/`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/server/gmail/parsers/generic.ts src/lib/server/gmail/parsers/ro-suppliers.ts src/lib/server/gmail/__tests__/parsers.test.ts
git commit -m "fix(gmail): nr. factură cere cifre — elimină 'available' și alte cuvinte capturate greșit"
```

---

## Task 4: Parsere noi — DirectAdmin, Cursor (Anysphere), INWX

**Files:**
- Create: `src/lib/server/gmail/parsers/directadmin.ts`, `src/lib/server/gmail/parsers/cursor.ts`, `src/lib/server/gmail/parsers/inwx.ts`
- Modify: `src/lib/server/gmail/parsers/index.ts`
- Test: `src/lib/server/gmail/__tests__/parsers.test.ts` (extindere)

- [ ] **Step 1: Scrie testele care pică**

```ts
import { findParser } from '../parsers/index';

describe('parsere noi', () => {
	it('directadmin match pe expeditor', () => {
		expect(findParser('DirectAdmin <billing@directadmin.com>', 'Invoice')?.id).toBe('directadmin');
	});
	it('cursor match pe anysphere/cursor.com', () => {
		expect(findParser('Anysphere <billing@cursor.com>', 'Your receipt')?.id).toBe('cursor');
	});
	it('inwx match pe inwx.de', () => {
		expect(findParser('INWX GmbH <buchhaltung@inwx.de>', 'New Invoice available')?.id).toBe('inwx');
	});
});
```

- [ ] **Step 2: Rulează — pică** (`findParser` întoarce generic sau null)

Run: `bun test src/lib/server/gmail/__tests__/parsers.test.ts`
Expected: FAIL

- [ ] **Step 3: Creează cele 3 parsere**

`directadmin.ts` (șablonul e identic cu litespeed.ts, fără fallback USD):

```ts
import type { GmailMessage } from '../client';
import type { SupplierParser, ParsedInvoice } from './index';
import { parseAmount, detectStatus } from './index';

export const directadminParser: SupplierParser = {
	id: 'directadmin',
	name: 'DirectAdmin',

	matchEmail(from: string): boolean {
		return from.toLowerCase().includes('directadmin.com');
	},

	parseInvoice(email: GmailMessage): ParsedInvoice {
		const result: ParsedInvoice = { supplierType: 'directadmin', supplierName: 'DirectAdmin' };
		const invoiceMatch = email.subject.match(/(?:invoice|receipt)\s*#?\s*([\w-]*\d[\w-]*)/i) ||
			email.body.match(/(?:invoice|receipt)\s*(?:number|#|no\.?)\s*:?\s*([\w-]*\d[\w-]*)/i);
		if (invoiceMatch) result.invoiceNumber = invoiceMatch[1];
		const amountResult = parseAmount(email.body) || parseAmount(email.subject);
		if (amountResult) {
			result.amount = amountResult.amount;
			result.currency = amountResult.currency;
		}
		result.status = detectStatus(email.body + ' ' + email.subject);
		result.issueDate = email.date;
		return result;
	},

	getSearchQuery(): string {
		return 'from:directadmin.com has:attachment filename:pdf';
	}
};
```

`cursor.ts` — identic structural, cu:
- `id: 'cursor'`, `name: 'Cursor (Anysphere)'`, `supplierType: 'cursor'`, `supplierName: 'Anysphere Inc (cursor.com)'`
- `matchEmail`: `from.toLowerCase().includes('cursor.com') || from.toLowerCase().includes('anysphere')`
- `getSearchQuery()`: `'from:cursor.com has:attachment filename:pdf'`

`inwx.ts` — identic structural, cu:
- `id: 'inwx'`, `name: 'INWX'`, `supplierType: 'inwx'`, `supplierName: 'INWX GmbH'`
- `matchEmail`: `from.toLowerCase().includes('inwx.de') || from.toLowerCase().includes('inwx.com')`
- `getSearchQuery()`: `'(from:inwx.de OR from:inwx.com) has:attachment filename:pdf'`

- [ ] **Step 4: Înregistrează-le în `parsers/index.ts`**

```ts
import { directadminParser } from './directadmin';
import { cursorParser } from './cursor';
import { inwxParser } from './inwx';
```

și în `parserRegistry`, după `cloudflareParser`:

```ts
	cloudflareParser,
	directadminParser,
	cursorParser,
	inwxParser,
	roSuppliersParser,
	genericParser
```

(înaintea lui `roSuppliersParser`/`genericParser` — first match wins, iar `ro-suppliers` face match pe orice subiect cu „factura".)

- [ ] **Step 5: Adaugă parserele noi în opțiunile paginii de import**

În `src/routes/[tenant]/banking/supplier-invoices/import/+page.svelte`, în `parserOptions` (după `litespeed`... lista existentă), adaugă:

```ts
	{ id: 'directadmin', label: 'DirectAdmin' },
	{ id: 'cursor', label: 'Cursor (Anysphere)' },
	{ id: 'inwx', label: 'INWX' },
```

și include-le și în lista implicită `selectedParsers`.

- [ ] **Step 6: Rulează — trebuie să treacă**

Run: `bun test src/lib/server/gmail/`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add src/lib/server/gmail/parsers/ "src/routes/[tenant]/banking/supplier-invoices/import/+page.svelte"
git commit -m "feat(gmail): parsere noi DirectAdmin, Cursor, INWX"
```

---

## Task 5: Modulul de match plată ↔ factură (`payment-match.ts`)

**Files:**
- Create: `src/lib/server/banking/payment-match.ts`
- Test: `src/lib/server/banking/__tests__/payment-match.test.ts` (nou; creează directorul)

- [ ] **Step 1: Scrie testele care pică** (fixture-uri = rândurile reale din MissingDocuments.xlsx)

```ts
// src/lib/server/banking/__tests__/payment-match.test.ts
import { describe, it, expect } from 'bun:test';
import {
	extractPaymentDetails,
	parseMissingDocumentsRows,
	matchPayments,
	type PaymentRow,
	type InvoiceCandidate
} from '../payment-match';

const HETZNER_COMMENT =
	'  Plata la POS non-BT cu card VISA;EPOS 14/07/2026 472721821 TID:02B00111 HETZNER ONLINE GMBH  HETZNER.COM/ DE 42444505 valoare tranzactie: 180.04 EUR RRN:619502159763 comision tranzactie 0.00 RON;REF: 000NVPO261975UOO; ';
const DA_COMMENT =
	'  Plata la POS non-BT cu card VISA;EPOS 07/07/2026 9RRDTDHDRM9WVW9 TID:H9JRYLIO DIRECTADMIN.COM  +15879214476 CA 42444505 valoare tranzactie: 29.00 USD RRN:618811530698 comision tranzactie 0.00 RON;REF: 000NVPO261904iEK; ';
const CLAUDE_COMMENT =
	'  Plata la POS non-BT cu card VISA;EPOS 24/07/2026 Q0RRUWQV26H30SO TID:G0A3LMSE * CLAUDE SUB  +14152360599 US 42444505 valoare tranzactie: 211.56 EUR RRN:620514488579 comision tranzactie 0.00 RON;REF: 000NVPO262084soF; ';
const FIDA_COMMENT =
	'  Plata la POS;EPOS 03/08/2026 MID 644214659202RON MPY*fidasolutions Maramures ROM valoare trz: 8.00 RON RRN:322793237391 comision trz 0.00 RON  OD Order 533710000-853464267;REF: 044POSP2621517B3; ';

describe('extractPaymentDetails', () => {
	it('extrage suma și valuta ORIGINALĂ (nu RON) din comentariu', () => {
		const d = extractPaymentDetails(HETZNER_COMMENT);
		expect(d.originalAmount).toBe(18004);
		expect(d.originalCurrency).toBe('EUR');
	});
	it('suportă varianta prescurtată "valoare trz:"', () => {
		const d = extractPaymentDetails(FIDA_COMMENT);
		expect(d.originalAmount).toBe(800);
		expect(d.originalCurrency).toBe('RON');
	});
	it('USD la DirectAdmin', () => {
		const d = extractPaymentDetails(DA_COMMENT);
		expect(d.originalAmount).toBe(2900);
		expect(d.originalCurrency).toBe('USD');
	});
});

describe('parseMissingDocumentsRows', () => {
	it('reține doar plățile, convertește data din serial Excel', () => {
		const rows = parseMissingDocumentsRows([
			['Tip', 'Referinta', 'Data', 'Partener', 'Valoare', 'Valuta', 'Comentariu', 'IBAN'],
			['Plati fara document', '12326', 46219, null, '968.77', 'RON', HETZNER_COMMENT, 'RO86...'],
			['Incasari fara document', '9794', 46071, null, '1,479.83', 'RON', 'Incasare OP...', 'RO86...']
		]);
		expect(rows.payments.length).toBe(1);
		expect(rows.ignoredIncomes).toBe(1);
		const p = rows.payments[0];
		expect(p.reference).toBe('12326');
		// serial 46219 = 2026-07-16 (sistemul 1900, offset 1899-12-30)
		expect(p.date.toISOString().slice(0, 10)).toBe('2026-07-16');
		expect(p.originalAmount).toBe(18004);
		expect(p.originalCurrency).toBe('EUR');
	});
});

function payment(over: Partial<PaymentRow>): PaymentRow {
	return {
		reference: '1', date: new Date('2026-07-16'), partner: null, amountRon: 96877,
		comment: HETZNER_COMMENT, originalAmount: 18004, originalCurrency: 'EUR', ...over
	};
}
function candidate(over: Partial<InvoiceCandidate>): InvoiceCandidate {
	return {
		gmailMessageId: 'g1', from: 'Hetzner Online GmbH <invoice@hetzner.com>',
		subject: 'Invoice R0012345678', date: new Date('2026-07-14'),
		amount: 18004, currency: 'EUR', supplierType: 'hetzner', ...over
	};
}

describe('matchPayments — scoring', () => {
	it('sumă+valută+comerciant+dată apropiată => match sigur (>=70)', () => {
		const res = matchPayments([payment({})], [candidate({})]);
		expect(res[0].match?.gmailMessageId).toBe('g1');
		expect(res[0].score).toBeGreaterThanOrEqual(70);
		expect(res[0].confidence).toBe('sure');
	});
	it('plata în RON nu face match pe suma RON cu factura în EUR', () => {
		const res = matchPayments(
			[payment({ originalAmount: 96877, originalCurrency: 'RON' })],
			[candidate({ amount: 96877, currency: 'EUR', supplierType: 'openai', from: 'x <a@b.c>', subject: 'x' })]
		);
		expect(res[0].confidence).not.toBe('sure');
	});
	it('doar comerciant, fără sumă => probabil, nu sigur', () => {
		const res = matchPayments([payment({})], [candidate({ amount: undefined, currency: undefined })]);
		expect(res[0].confidence).toBe('probable');
	});
	it('în afara ferestrei de date => fără match', () => {
		const res = matchPayments([payment({})], [candidate({ date: new Date('2026-09-20') })]);
		expect(res[0].match).toBeUndefined();
	});
	it('o factură se atașează unei singure plăți (greedy pe scor)', () => {
		const p1 = payment({ reference: 'a' });
		const p2 = payment({ reference: 'b', date: new Date('2026-07-20') });
		const res = matchPayments([p1, p2], [candidate({})]);
		const matched = res.filter((r) => r.match);
		expect(matched.length).toBe(1);
		expect(matched[0].reference).toBe('a'); // data mai apropiată de factură
	});
	it('furnizor FĂRĂ parser: match pe tokenul din descriere (KESSELRING)', () => {
		const KESSELRING_COMMENT =
			'  Plata la POS non-BT cu card VISA;EPOS 17/07/2026 4210252 TID:PAYW0006 MPY*KESSELRING SRL    ROZ  NOV RO 42444505 valoare tranzactie: 81.09 RON RRN:619811671945 comision tranzactie 0.00 RON;REF: 000NVPO262012NnP; ';
		const res = matchPayments(
			[payment({ comment: KESSELRING_COMMENT, originalAmount: 8109, originalCurrency: 'RON', date: new Date('2026-07-17') })],
			[candidate({
				from: 'Kesselring SRL <facturi@kesselring.ro>',
				subject: 'Factura 1234',
				date: new Date('2026-07-17'),
				amount: 8109,
				currency: 'RON',
				supplierType: undefined
			})]
		);
		expect(res[0].confidence).toBe('sure');
	});

	it('nu face match pe cuvinte generice din descriere', () => {
		const res = matchPayments(
			[payment({ originalAmount: null, originalCurrency: null })],
			[candidate({ from: 'Online Payment <noreply@random.com>', subject: 'Invoice', amount: undefined, currency: undefined, supplierType: undefined })]
		);
		expect(res[0].match).toBeUndefined();
	});

	it('CLAUDE SUB face match pe aliasul anthropic', () => {
		const res = matchPayments(
			[payment({ comment: CLAUDE_COMMENT, originalAmount: 21156, date: new Date('2026-07-24') })],
			[candidate({ from: 'Anthropic <receipts@anthropic.com>', subject: 'Your receipt', supplierType: 'anthropic', amount: 21156, date: new Date('2026-07-24') })]
		);
		expect(res[0].confidence).toBe('sure');
	});
});
```

- [ ] **Step 2: Rulează — pică** (modulul nu există)

Run: `bun test src/lib/server/banking/__tests__/payment-match.test.ts`
Expected: FAIL — cannot resolve `../payment-match`

- [ ] **Step 3: Implementează `payment-match.ts`**

```ts
// src/lib/server/banking/payment-match.ts
// Match algorithm between bank payments (Keez "Documente Lipsa" export) and
// supplier invoices found in Gmail. Pure module — no DB, no network — for testability.

export interface PaymentRow {
	reference: string; // Referinta Keez
	date: Date;
	partner: string | null;
	amountRon: number; // cents, coloana Valoare (mereu RON) — semnal secundar
	comment: string;
	originalAmount: number | null; // cents, din "valoare tranzactie: X CUR" — semnal PRINCIPAL
	originalCurrency: string | null;
}

export interface InvoiceCandidate {
	gmailMessageId: string;
	from: string;
	subject: string;
	date: Date;
	amount?: number; // cents
	currency?: string;
	supplierType?: string;
}

export interface PaymentMatchResult extends PaymentRow {
	match?: InvoiceCandidate;
	score: number;
	confidence: 'sure' | 'probable' | 'none';
}

// Merchant tokens as they appear in BT statement descriptions, keyed by supplierType
const MERCHANT_ALIASES: Record<string, string[]> = {
	hetzner: ['HETZNER'],
	google: ['GOOGLE CLOUD', 'GOOGLE WORKSPACE', 'GOOGLE*', 'GOOGLE '],
	directadmin: ['DIRECTADMIN'],
	litespeed: ['LITESPEED', 'LITE SPEED'],
	anthropic: ['CLAUDE SUB', 'ANTHROPIC', 'CLAUDE.AI'],
	cursor: ['CURSOR', 'ANYSPHERE'],
	inwx: ['INWX'],
	openai: ['OPENAI', 'CHATGPT'],
	'ro-supplier': ['ROTLD', 'ICI ', 'KESSELRING', 'FIDASOLUTIONS'],
	cloudflare: ['CLOUDFLARE'],
	digitalocean: ['DIGITALOCEAN'],
	ovh: ['OVH'],
	aws: ['AWS', 'AMAZON WEB'],
	tiktok: ['TIKTOK'],
	meta: ['FACEBOOK', 'META PLATFORMS', 'FACEBK']
};

const MATCH_WINDOW_DAYS = 10;
export const SURE_THRESHOLD = 70;
export const PROBABLE_THRESHOLD = 40;

export function extractPaymentDetails(comment: string): {
	originalAmount: number | null;
	originalCurrency: string | null;
} {
	const m = comment.match(/valoare\s+(?:tranzactie|trz):\s*([\d.,]+)\s*(RON|EUR|USD|GBP)/i);
	if (!m) return { originalAmount: null, originalCurrency: null };
	const normalized = m[1].includes(',') && !m[1].includes('.') ? m[1].replace(',', '.') : m[1].replace(/,/g, '');
	const amount = Math.round(parseFloat(normalized) * 100);
	if (isNaN(amount)) return { originalAmount: null, originalCurrency: null };
	return { originalAmount: amount, originalCurrency: m[2].toUpperCase() };
}

/** Excel 1900 date system: serial 1 = 1900-01-01, offset epoch 1899-12-30. */
function excelSerialToDate(serial: number): Date {
	return new Date(Date.UTC(1899, 11, 30) + serial * 86_400_000);
}

function parseRonValue(v: string | number): number {
	if (typeof v === 'number') return Math.round(v * 100);
	const s = v.replace(/,/g, '');
	return Math.round(parseFloat(s) * 100) || 0;
}

export function parseMissingDocumentsRows(rows: unknown[][]): {
	payments: PaymentRow[];
	ignoredIncomes: number;
} {
	const payments: PaymentRow[] = [];
	let ignoredIncomes = 0;
	for (const row of rows) {
		const [tip, referinta, dataSerial, partener, valoare, , comentariu] = row as [
			string, string | number, number | string, string | null, string | number, string, string
		];
		if (typeof tip !== 'string') continue; // header / rânduri goale
		if (tip.trim() === 'Incasari fara document') {
			ignoredIncomes++;
			continue;
		}
		if (tip.trim() !== 'Plati fara document') continue;
		const comment = String(comentariu ?? '');
		const { originalAmount, originalCurrency } = extractPaymentDetails(comment);
		payments.push({
			reference: String(referinta ?? ''),
			date: typeof dataSerial === 'number' ? excelSerialToDate(dataSerial) : new Date(String(dataSerial)),
			partner: partener ? String(partener) : null,
			amountRon: parseRonValue(valoare ?? 0),
			comment,
			originalAmount,
			originalCurrency
		});
	}
	return { payments, ignoredIncomes };
}

function daysBetween(a: Date, b: Date): number {
	return Math.abs(a.getTime() - b.getTime()) / 86_400_000;
}

/** Words in statement descriptions that are never a merchant name. */
const MERCHANT_STOPWORDS = new Set([
	'PLATA', 'CARD', 'VISA', 'EPOS', 'NON', 'TID', 'RRN', 'REF', 'MID', 'ORDER',
	'VALOARE', 'TRANZACTIE', 'COMISION', 'TRZ', 'POS', 'RON', 'EUR', 'USD', 'GBP',
	'INVOICE', 'FACTURA', 'PAYMENT', 'ONLINE', 'GMBH', 'SRL', 'INC', 'LTD', 'LIMITED',
	'TECHNOLOGIES', 'COM', 'WWW', 'NOREPLY', 'BILLING', 'MPY'
]);

/**
 * Merchant tokens extracted from the statement description, for suppliers that
 * have no parser (and therefore no alias entry): "MPY*KESSELRING SRL" -> KESSELRING.
 */
function merchantTokens(payment: PaymentRow): string[] {
	const source = (payment.comment + ' ' + (payment.partner || '')).toUpperCase();
	return [...new Set(source.split(/[^A-Z]+/))].filter(
		(w) => w.length >= 4 && !MERCHANT_STOPWORDS.has(w)
	);
}

function merchantMatches(payment: PaymentRow, candidate: InvoiceCandidate): boolean {
	const haystack = (payment.comment + ' ' + (payment.partner || '')).toUpperCase();
	const aliases = MERCHANT_ALIASES[candidate.supplierType || ''];
	if (aliases && aliases.some((a) => haystack.includes(a))) return true;

	// Fallback for senders without a parser: does a merchant token from the
	// statement appear in the sender address or subject?
	const emailHaystack = `${candidate.from} ${candidate.subject}`.toUpperCase();
	return merchantTokens(payment).some((token) => emailHaystack.includes(token));
}

export function scoreMatch(payment: PaymentRow, candidate: InvoiceCandidate): number {
	if (daysBetween(payment.date, candidate.date) > MATCH_WINDOW_DAYS) return 0;
	let score = 0;
	// Semnal principal: suma + valuta ORIGINALĂ a tranzacției (NU valoarea în RON —
	// contul e în lei, facturile sunt adesea în EUR/USD)
	if (
		payment.originalAmount != null &&
		payment.originalCurrency != null &&
		candidate.amount != null &&
		candidate.currency === payment.originalCurrency
	) {
		if (candidate.amount === payment.originalAmount) score += 60;
		else if (Math.abs(candidate.amount - payment.originalAmount) / payment.originalAmount <= 0.02) score += 40;
	}
	if (merchantMatches(payment, candidate)) score += 30;
	const days = daysBetween(payment.date, candidate.date);
	score += Math.max(0, Math.round(10 * (1 - days / MATCH_WINDOW_DAYS)));
	return score;
}

/** Greedy unique assignment: sort all pairs by score desc, tie-break on date proximity. */
export function matchPayments(
	payments: PaymentRow[],
	candidates: InvoiceCandidate[]
): PaymentMatchResult[] {
	const pairs: Array<{ pi: number; ci: number; score: number; days: number }> = [];
	payments.forEach((p, pi) => {
		candidates.forEach((c, ci) => {
			const score = scoreMatch(p, c);
			if (score >= PROBABLE_THRESHOLD) {
				pairs.push({ pi, ci, score, days: daysBetween(p.date, c.date) });
			}
		});
	});
	pairs.sort((a, b) => b.score - a.score || a.days - b.days);

	const usedPayments = new Set<number>();
	const usedCandidates = new Set<number>();
	const assignment = new Map<number, { ci: number; score: number }>();
	for (const { pi, ci, score } of pairs) {
		if (usedPayments.has(pi) || usedCandidates.has(ci)) continue;
		usedPayments.add(pi);
		usedCandidates.add(ci);
		assignment.set(pi, { ci, score });
	}

	return payments.map((p, pi) => {
		const a = assignment.get(pi);
		if (!a) return { ...p, score: 0, confidence: 'none' as const };
		return {
			...p,
			match: candidates[a.ci],
			score: a.score,
			confidence: a.score >= SURE_THRESHOLD ? ('sure' as const) : ('probable' as const)
		};
	});
}
```

- [ ] **Step 4: Rulează — trebuie să treacă**

Run: `bun test src/lib/server/banking/__tests__/payment-match.test.ts`
Expected: PASS. Dacă testul pe serialul Excel pică cu o zi diferență, verifică valoarea reală: rândul Hetzner din xlsx are Data=46219 și în Keez apare 16.07.2026 — ajustează fixture-ul, NU offsetul epoch (1899-12-30 e standardul).

- [ ] **Step 5: Commit**

```bash
git add src/lib/server/banking/
git commit -m "feat(banking): algoritm de match plăți Keez <-> facturi Gmail cu scoring pe valuta originală"
```

---

## Task 6: Migrarea `gmail_invoice_download` + schema

**Files:**
- Create: `drizzle/0443_gmail_invoice_download.sql`, `drizzle/0444_gmail_invoice_download_idx.sql`
- Modify: `drizzle/meta/_journal.json`, `src/lib/server/db/schema.ts`

Ordine STRICTĂ (memoria „schema select-all hazard"): întâi SQL + migrate + verificare pe Turso, ABIA APOI tabelul în `schema.ts`.

- [ ] **Step 1: Scrie `drizzle/0443_gmail_invoice_download.sql`** (un singur statement)

```sql
CREATE TABLE `gmail_invoice_download` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL REFERENCES `tenant`(`id`),
	`gmail_message_id` text NOT NULL,
	`attachment_filename` text,
	`bank_reference` text,
	`downloaded_at` integer NOT NULL DEFAULT (unixepoch()),
	`downloaded_by_user_id` text REFERENCES `user`(`id`)
);
```

**Verifică întâi convenția de timestamp:** `grep -A2 "downloaded_at\|current_timestamp" drizzle/0440_task_email.sql` — folosește EXACT același default ca migrările recente (dacă acolo e `DEFAULT (current_timestamp)`, folosește asta).

- [ ] **Step 2: Scrie `drizzle/0444_gmail_invoice_download_idx.sql`** (un singur statement)

```sql
CREATE UNIQUE INDEX `gmail_invoice_download_unique_idx` ON `gmail_invoice_download` (`tenant_id`,`gmail_message_id`,`attachment_filename`);
```

- [ ] **Step 3: Adaugă intrările în `drizzle/meta/_journal.json`** — copiază formatul intrării `0442_task_email_unique_idx` (aceleași câmpuri; `idx` 443 și 444, `tag`-urile `0443_gmail_invoice_download` și `0444_gmail_invoice_download_idx`, `when` = timestamp curent în ms).

- [ ] **Step 4: Rulează migrarea și verifică pe Turso**

Run: `bun run db:migrate`
Expected: succes, fără erori.

Apoi verifică remote (memoria „Migration flow — verify on Turso"): rulează scriptul/CLI-ul folosit de proiect pentru SQL direct (dacă nu există unul evident, folosește un one-off cu clientul libSQL din `$lib/server/db` printr-un script `bun` în scratchpad):

```
PRAGMA table_info(gmail_invoice_download);
```
Expected: 7 coloane listate.

- [ ] **Step 5: Adaugă tabelul în `schema.ts`** (după `supplierInvoice`, stilul tabelelor vecine):

```ts
export const gmailInvoiceDownload = sqliteTable('gmail_invoice_download', {
	id: text('id').primaryKey(),
	tenantId: text('tenant_id')
		.notNull()
		.references(() => tenant.id),
	gmailMessageId: text('gmail_message_id').notNull(),
	attachmentFilename: text('attachment_filename'),
	bankReference: text('bank_reference'),
	downloadedAt: timestamp('downloaded_at', { withTimezone: true, mode: 'date' })
		.notNull()
		.default(sql`current_timestamp`),
	downloadedByUserId: text('downloaded_by_user_id').references(() => user.id)
});
```

(aliniază `default` cu ce ai pus în SQL la Step 1.)

- [ ] **Step 6: Verifică typecheck-ul rapid pe schema**

Run: `bun test src/lib/server/gmail/ src/lib/server/banking/`
Expected: PASS (nimic stricat).

- [ ] **Step 7: Commit**

```bash
git add drizzle/ src/lib/server/db/schema.ts
git commit -m "feat(db): tabel gmail_invoice_download pentru evidența facturilor descărcate din Gmail"
```

---

## Task 7: Remote functions — căutare liberă, match pe XLSX, evidență

**Files:**
- Create: `src/lib/server/gmail/download-evidence.ts`
- Modify: `src/lib/remotes/supplier-invoices.remote.ts`

- [ ] **Step 1: Creează helperul de evidență `download-evidence.ts`**

```ts
// src/lib/server/gmail/download-evidence.ts
import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { and, eq, inArray } from 'drizzle-orm';
import { encodeBase32LowerCase } from '@oslojs/encoding';

function generateId() {
	const bytes = crypto.getRandomValues(new Uint8Array(15));
	return encodeBase32LowerCase(bytes);
}

export async function recordDownload(
	tenantId: string,
	userId: string,
	gmailMessageId: string,
	attachmentFilename: string,
	bankReference?: string | null
): Promise<void> {
	await db
		.insert(table.gmailInvoiceDownload)
		.values({
			id: generateId(),
			tenantId,
			gmailMessageId,
			attachmentFilename,
			bankReference: bankReference ?? null,
			downloadedAt: new Date(),
			downloadedByUserId: userId
		})
		.onConflictDoUpdate({
			target: [
				table.gmailInvoiceDownload.tenantId,
				table.gmailInvoiceDownload.gmailMessageId,
				table.gmailInvoiceDownload.attachmentFilename
			],
			set: { downloadedAt: new Date(), downloadedByUserId: userId, bankReference: bankReference ?? null }
		});
}

/** Map gmailMessageId -> downloadedAt pentru un set de mesaje. */
export async function getDownloadedMap(
	tenantId: string,
	gmailMessageIds: string[]
): Promise<Map<string, Date>> {
	if (gmailMessageIds.length === 0) return new Map();
	const rows = await db
		.select({
			gmailMessageId: table.gmailInvoiceDownload.gmailMessageId,
			downloadedAt: table.gmailInvoiceDownload.downloadedAt
		})
		.from(table.gmailInvoiceDownload)
		.where(
			and(
				eq(table.gmailInvoiceDownload.tenantId, tenantId),
				inArray(table.gmailInvoiceDownload.gmailMessageId, gmailMessageIds)
			)
		);
	return new Map(rows.map((r) => [r.gmailMessageId, r.downloadedAt]));
}
```

- [ ] **Step 1b: `buildInvoiceSearchQuery` — căutare la ORICE expeditor, nu doar la parserele cunoscute**

În `src/lib/server/gmail/parsers/index.ts`, lângă `buildSearchQuery` existent (care rămâne neschimbat — îl folosește fluxul de import), adaugă:

```ts
export interface InvoiceSearchOptions {
	/**
	 * 'all'       — orice email cu PDF atașat (implicit pentru tabul de descărcare):
	 *               prinde și furnizorii fără parser (Kesselring, fidasolutions etc.)
	 * 'suppliers' — doar expeditorii cu parser + adresele custom
	 */
	scope: 'all' | 'suppliers';
	parserIds?: string[];
	customEmails?: string[];
	dateFrom?: Date;
	dateTo?: Date;
}

/** Gmail query for the download tab. Broader than buildSearchQuery by design. */
export function buildInvoiceSearchQuery(options: InvoiceSearchOptions): string {
	let query: string;
	if (options.scope === 'all') {
		query = 'has:attachment filename:pdf';
	} else {
		query = buildSearchQuery(options.parserIds, undefined, undefined, options.customEmails);
	}
	if (options.dateFrom) query += ` after:${formatGmailDate(options.dateFrom)}`;
	if (options.dateTo) query += ` before:${formatGmailDate(options.dateTo)}`;
	return query;
}
```

Test (adaugă în `src/lib/server/gmail/__tests__/parsers.test.ts`):

```ts
import { buildInvoiceSearchQuery } from '../parsers/index';

describe('buildInvoiceSearchQuery', () => {
	it('scope all caută orice email cu PDF, fără filtru de expeditor', () => {
		const q = buildInvoiceSearchQuery({ scope: 'all' });
		expect(q).toBe('has:attachment filename:pdf');
		expect(q).not.toContain('from:');
	});
	it('adaugă intervalul de date', () => {
		const q = buildInvoiceSearchQuery({
			scope: 'all',
			dateFrom: new Date(2026, 6, 1),
			dateTo: new Date(2026, 6, 31)
		});
		expect(q).toContain('after:2026/7/1');
		expect(q).toContain('before:2026/7/31');
	});
	it('scope suppliers restrânge la expeditorii cunoscuți', () => {
		const q = buildInvoiceSearchQuery({ scope: 'suppliers', parserIds: ['hetzner'] });
		expect(q).toContain('hetzner');
	});
});
```

- [ ] **Step 2: Adaugă comanda `searchGmailForDownload` (Mod B) în `supplier-invoices.remote.ts`**

Importuri noi la începutul fișierului:

```ts
import { getDownloadedMap } from '$lib/server/gmail/download-evidence';
import {
	parseMissingDocumentsRows,
	matchPayments,
	type InvoiceCandidate
} from '$lib/server/banking/payment-match';
import * as XLSX from 'xlsx';
```

și adaugă `buildInvoiceSearchQuery` la importul existent din `$lib/server/gmail/parsers`.

Comanda (după `previewGmailInvoices`):

```ts
/**
 * Search Gmail for supplier invoice emails WITHOUT importing them (download tab).
 */
export const searchGmailForDownload = command(
	v.object({
		parserIds: v.optional(v.array(v.string())),
		dateFrom: v.optional(v.string()),
		dateTo: v.optional(v.string()),
		customEmails: v.optional(v.array(v.pipe(v.string(), v.minLength(1)))),
		/** 'all' (implicit) caută la ORICE expeditor cu PDF atașat, nu doar la furnizorii cunoscuți. */
		scope: v.optional(v.picklist(['all', 'suppliers'])),
		maxResults: v.optional(v.number())
	}),
	async (data) => {
		const event = getRequestEvent();
		if (!event?.locals.user || !event?.locals.tenant) {
			throw new Error('Unauthorized');
		}
		await requireStaff(event);
		const tenantId = event.locals.tenant.id;

		const searchQuery = buildInvoiceSearchQuery({
			scope: data.scope ?? 'all',
			parserIds: data.parserIds,
			customEmails: data.customEmails,
			dateFrom: data.dateFrom ? new Date(data.dateFrom) : undefined,
			dateTo: data.dateTo ? new Date(data.dateTo) : undefined
		});
		const messages = await searchEmails(tenantId, searchQuery, data.maxResults || 150);

		const existingInvoices = await db
			.select({ gmailMessageId: table.supplierInvoice.gmailMessageId })
			.from(table.supplierInvoice)
			.where(eq(table.supplierInvoice.tenantId, tenantId));
		const importedIds = new Set(existingInvoices.map((i) => i.gmailMessageId).filter(Boolean));
		const downloadedMap = await getDownloadedMap(tenantId, messages.map((m) => m.id));

		const results = [];
		for (const msg of messages) {
			try {
				const email = await getEmail(tenantId, msg.id);
				const pdfAttachments = email.attachments
					.map((a, index) => ({ index, filename: a.filename, size: a.size, mimeType: a.mimeType }))
					.filter((a) => a.mimeType === 'application/pdf' || a.filename.toLowerCase().endsWith('.pdf'));
				if (pdfAttachments.length === 0) continue;

				const parser = findParser(email.from, email.subject);
				const parsed = parser ? parser.parseInvoice(email) : null;

				results.push({
					gmailMessageId: msg.id,
					from: email.from,
					subject: email.subject,
					date: email.date,
					pdfAttachments,
					amount: parsed?.currency ? (parsed.amount ?? null) : null,
					currency: parsed?.currency ?? null,
					supplierType: parsed?.supplierType ?? null,
					alreadyImported: importedIds.has(msg.id),
					downloadedAt: downloadedMap.get(msg.id) ?? null
				});
			} catch (err) {
				console.error(`[Gmail Download Search] Error on message ${msg.id}:`, err);
			}
		}
		return { results, totalFound: messages.length };
	}
);
```

- [ ] **Step 3: Adaugă comanda `matchMissingDocuments` (Mod A)**

```ts
/**
 * Upload the Keez "Documente Lipsa" XLSX and match each payment
 * against invoice emails found in Gmail.
 */
export const matchMissingDocuments = command(
	v.object({ fileBase64: v.pipe(v.string(), v.minLength(8)) }),
	async (data) => {
		const event = getRequestEvent();
		if (!event?.locals.user || !event?.locals.tenant) {
			throw new Error('Unauthorized');
		}
		await requireStaff(event);
		const tenantId = event.locals.tenant.id;

		const workbook = XLSX.read(Buffer.from(data.fileBase64, 'base64'), { type: 'buffer' });
		const sheet = workbook.Sheets[workbook.SheetNames[0]];
		const rawRows = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true }) as unknown[][];
		const { payments, ignoredIncomes } = parseMissingDocumentsRows(rawRows);
		if (payments.length === 0) {
			return { payments: [], ignoredIncomes, candidatesFound: 0 };
		}

		// Fereastra de căutare: min/max data plăților, cu padding de 10 zile
		const times = payments.map((p) => p.date.getTime());
		const dateFrom = new Date(Math.min(...times) - 10 * 86_400_000);
		const dateTo = new Date(Math.max(...times) + 10 * 86_400_000);

		// Căutăm la ORICE expeditor cu PDF atașat, nu doar la furnizorii cu parser —
		// altfel plățile către furnizori necunoscuți (Kesselring, fidasolutions etc.)
		// n-ar găsi niciodată factura.
		const searchQuery = buildInvoiceSearchQuery({ scope: 'all', dateFrom, dateTo });
		const messages = await searchEmails(tenantId, searchQuery, 200);

		const downloadedMap = await getDownloadedMap(tenantId, messages.map((m) => m.id));
		const candidates: InvoiceCandidate[] = [];
		const candidateMeta = new Map<string, { pdfAttachments: Array<{ index: number; filename: string }>; downloadedAt: Date | null }>();

		for (const msg of messages) {
			try {
				const email = await getEmail(tenantId, msg.id);
				const pdfAttachments = email.attachments
					.map((a, index) => ({ index, filename: a.filename, mimeType: a.mimeType }))
					.filter((a) => a.mimeType === 'application/pdf' || a.filename.toLowerCase().endsWith('.pdf'))
					.map(({ index, filename }) => ({ index, filename }));
				if (pdfAttachments.length === 0) continue;

				const parser = findParser(email.from, email.subject);
				const parsed = parser ? parser.parseInvoice(email) : null;
				let amount = parsed?.currency ? parsed.amount : undefined;
				let currency = parsed?.currency;

				// PDF enrichment doar când emailul nu are suma — e un fetch în plus per email
				if (amount == null) {
					const pdfAtt = email.attachments.find(
						(a) => a.mimeType === 'application/pdf' || a.filename.toLowerCase().endsWith('.pdf')
					);
					if (pdfAtt) {
						try {
							const pdfBuffer = await getAttachment(tenantId, msg.id, pdfAtt.id);
							const pdfData = await extractInvoiceDataFromPdf(pdfBuffer);
							if (pdfData.amount && pdfData.currency) {
								amount = pdfData.amount;
								currency = pdfData.currency;
							}
						} catch {
							// PDF criptat/imagine — mergem fără sumă
						}
					}
				}

				candidates.push({
					gmailMessageId: msg.id,
					from: email.from,
					subject: email.subject,
					date: email.date,
					amount: amount ?? undefined,
					currency: currency ?? undefined,
					supplierType: parsed?.supplierType
				});
				candidateMeta.set(msg.id, {
					pdfAttachments,
					downloadedAt: downloadedMap.get(msg.id) ?? null
				});
			} catch (err) {
				console.error(`[Missing Docs Match] Error on message ${msg.id}:`, err);
			}
		}

		const matched = matchPayments(payments, candidates);
		return {
			payments: matched.map((m) => ({
				...m,
				matchMeta: m.match ? candidateMeta.get(m.match.gmailMessageId) ?? null : null
			})),
			ignoredIncomes,
			candidatesFound: candidates.length
		};
	}
);
```

- [ ] **Step 4: Verifică manual compilarea remote-urilor**

Run: `bun test src/lib/server/ && NODE_OPTIONS=--max-old-space-size=8192 bunx svelte-check --threshold error --output human 2>&1 | tail -20`
Expected: teste PASS; svelte-check fără erori NOI (notează numărul de erori preexistente dacă există).

- [ ] **Step 5: Commit**

```bash
git add src/lib/server/gmail/download-evidence.ts src/lib/remotes/supplier-invoices.remote.ts
git commit -m "feat(gmail): remote-uri căutare pentru descărcare + match Documente Lipsa din Keez"
```

---

## Task 8: Endpoint-uri de descărcare (individual + ZIP) cu atașamente live din Gmail

**Files:**
- Create: `src/routes/[tenant]/banking/supplier-invoices/gmail-attachment/+server.ts`
- Create: `src/routes/[tenant]/banking/supplier-invoices/download-gmail-zip/+server.ts`

REGULĂ: attachmentId-urile Gmail sunt EFEMERE — ambele endpoint-uri refac `getEmail` și folosesc id-ul proaspăt + indexul atașamentului. Filename-urile se sanitizează în `Content-Disposition`.

- [ ] **Step 1: Endpoint individual `gmail-attachment/+server.ts`**

```ts
import type { RequestHandler } from './$types';
import { error } from '@sveltejs/kit';
import { requireStaff } from '$lib/server/get-actor';
import { getEmail, getAttachment } from '$lib/server/gmail/client';
import { recordDownload } from '$lib/server/gmail/download-evidence';

function sanitizeFilename(name: string): string {
	return (name || 'factura.pdf').replace(/[^a-zA-Z0-9-_. ]/g, '_').slice(0, 120);
}

export const GET: RequestHandler = async (event) => {
	if (!event.locals.user || !event.locals.tenant) throw error(401, 'Unauthorized');
	await requireStaff(event);

	const messageId = event.url.searchParams.get('messageId');
	const indexParam = event.url.searchParams.get('index');
	const bankReference = event.url.searchParams.get('ref');
	if (!messageId || indexParam === null) throw error(400, 'messageId și index sunt obligatorii');
	const index = parseInt(indexParam, 10);
	if (isNaN(index) || index < 0) throw error(400, 'index invalid');

	const tenantId = event.locals.tenant.id;
	// Refetch: Gmail attachment IDs are ephemeral — always resolve fresh by index
	const email = await getEmail(tenantId, messageId);
	const attachment = email.attachments[index];
	if (!attachment) throw error(404, 'Atașamentul nu există');

	const buffer = await getAttachment(tenantId, messageId, attachment.id);
	await recordDownload(tenantId, event.locals.user.id, messageId, attachment.filename, bankReference);

	return new Response(buffer as unknown as BodyInit, {
		status: 200,
		headers: {
			'Content-Type': attachment.mimeType || 'application/pdf',
			'Content-Disposition': `attachment; filename="${sanitizeFilename(attachment.filename)}"`,
			'Content-Length': buffer.length.toString()
		}
	});
};
```

- [ ] **Step 2: Endpoint ZIP `download-gmail-zip/+server.ts`**

```ts
import type { RequestHandler } from './$types';
import { error } from '@sveltejs/kit';
import JSZip from 'jszip';
import { requireStaff } from '$lib/server/get-actor';
import { getEmail, getAttachment } from '$lib/server/gmail/client';
import { recordDownload } from '$lib/server/gmail/download-evidence';

interface ZipItem {
	messageId: string;
	/** Prefix pentru numele fișierului, ex. referința Keez + comerciant: "12326_HETZNER_180.04EUR" */
	label?: string;
	bankReference?: string;
}

function sanitize(name: string): string {
	return name.replace(/[^a-zA-Z0-9-_. ]/g, '_').slice(0, 120);
}

export const POST: RequestHandler = async (event) => {
	if (!event.locals.user || !event.locals.tenant) throw error(401, 'Unauthorized');
	await requireStaff(event);

	const body = await event.request.json();
	const items: ZipItem[] = body.items;
	if (!Array.isArray(items) || items.length === 0) throw error(400, 'Niciun email selectat');
	if (items.length > 100) throw error(400, 'Prea multe selectate (max 100)');

	const tenantId = event.locals.tenant.id;
	const zip = new JSZip();
	const skipped: string[] = [];
	let added = 0;

	for (const item of items) {
		try {
			// Refetch fresh — Gmail attachment IDs are ephemeral
			const email = await getEmail(tenantId, item.messageId);
			const pdfs = email.attachments.filter(
				(a) => a.mimeType === 'application/pdf' || a.filename.toLowerCase().endsWith('.pdf')
			);
			if (pdfs.length === 0) {
				skipped.push(item.messageId);
				continue;
			}
			for (const att of pdfs) {
				const buffer = await getAttachment(tenantId, item.messageId, att.id);
				const base = item.label ? `${sanitize(item.label)}_${sanitize(att.filename)}` : sanitize(att.filename);
				// JSZip suprascrie tacit numele duplicate — prefixează cu un contor
				zip.file(`${String(added + 1).padStart(2, '0')}_${base}`, buffer);
				await recordDownload(tenantId, event.locals.user!.id, item.messageId, att.filename, item.bankReference);
				added++;
			}
		} catch (err) {
			console.warn(`[Gmail ZIP] Skip message ${item.messageId}:`, err);
			skipped.push(item.messageId);
		}
	}

	if (added === 0) throw error(404, 'Niciun PDF descărcabil în selecție');

	const zipBuffer = await zip.generateAsync({ type: 'uint8array' });
	const date = new Date().toISOString().slice(0, 10);
	return new Response(zipBuffer as unknown as BodyInit, {
		status: 200,
		headers: {
			'Content-Type': 'application/zip',
			'Content-Disposition': `attachment; filename="facturi-gmail-${date}.zip"`,
			'Content-Length': zipBuffer.length.toString(),
			'X-Skipped-Count': skipped.length.toString()
		}
	});
};
```

- [ ] **Step 3: Verificare compilare**

Run: `NODE_OPTIONS=--max-old-space-size=8192 bunx svelte-check --threshold error --output human 2>&1 | tail -10`
Expected: fără erori noi.

- [ ] **Step 4: Commit**

```bash
git add "src/routes/[tenant]/banking/supplier-invoices/gmail-attachment" "src/routes/[tenant]/banking/supplier-invoices/download-gmail-zip"
git commit -m "feat(gmail): endpoint-uri descărcare atașamente live din Gmail (individual + ZIP) cu evidență"
```

---

## Task 9: UI — taburi pe pagină + componenta GmailSearchTab

**Files:**
- Modify: `src/routes/[tenant]/banking/supplier-invoices/+page.svelte`
- Create: `src/routes/[tenant]/banking/supplier-invoices/GmailSearchTab.svelte`

- [ ] **Step 1: Wrap pagina existentă în Tabs**

În `+page.svelte`:
- adaugă importurile: `import * as Tabs from '$lib/components/ui/tabs';` și `import GmailSearchTab from './GmailSearchTab.svelte';` (verifică întâi exportul real: `cat src/lib/components/ui/tabs/index.ts` — dacă exportă componente numite `Tabs, TabsList, TabsTrigger, TabsContent`, folosește forma aceea).
- imediat sub header (după `</div>` al blocului cu titlul + butonul „Import din Gmail"), deschide:

```svelte
<Tabs.Root value="imported">
	<Tabs.List class="mb-4">
		<Tabs.Trigger value="imported">Facturi importate</Tabs.Trigger>
		<Tabs.Trigger value="gmail">Căutare Gmail</Tabs.Trigger>
	</Tabs.List>
	<Tabs.Content value="imported">
		<!-- TOT conținutul existent al paginii de la bannerul de sync până la paginare, mutat aici NESCHIMBAT -->
	</Tabs.Content>
	<Tabs.Content value="gmail">
		<GmailSearchTab />
	</Tabs.Content>
</Tabs.Root>
```

Adaugă și în `supplierTypeLabel` cazurile noi: `'directadmin' → 'DirectAdmin'`, `'cursor' → 'Cursor'`, `'inwx' → 'INWX'`, `'litespeed' → 'LiteSpeed'`, `'anthropic' → 'Anthropic'`; și în `<Select>`-ul de tip furnizor: `<SelectItem value="directadmin">DirectAdmin</SelectItem>`, `<SelectItem value="litespeed">LiteSpeed</SelectItem>`, `<SelectItem value="cursor">Cursor</SelectItem>`, `<SelectItem value="inwx">INWX</SelectItem>`, `<SelectItem value="anthropic">Anthropic</SelectItem>`.

- [ ] **Step 1b: Filtru de dată pe lista de facturi importate (cerere utilizator)**

Lista existentă filtrează doar după text/status/tip. Adaugă filtrare după `issueDate`, cu **default luna calendaristică anterioară** (fluxul e lunar). În `<script>`-ul din `+page.svelte`:

```ts
	// Interval implicit: luna calendaristică anterioară. Derivat din data curentă,
	// niciodată hardcodat (regula proiectului „no hardcoded dynamic values").
	function previousMonthRange(): { from: string; to: string } {
		const now = new Date();
		const first = new Date(now.getFullYear(), now.getMonth() - 1, 1);
		const last = new Date(now.getFullYear(), now.getMonth(), 0);
		const iso = (d: Date) =>
			`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
		return { from: iso(first), to: iso(last) };
	}
	const defaultRange = previousMonthRange();
	let dateFromFilter = $state(defaultRange.from);
	let dateToFilter = $state(defaultRange.to);
```

În `filteredInvoices`, adaugă înaintea lui `return true;`:

```ts
			if (dateFromFilter || dateToFilter) {
				if (!inv.issueDate) return false;
				const issued = new Date(inv.issueDate);
				if (dateFromFilter && issued < new Date(`${dateFromFilter}T00:00:00`)) return false;
				if (dateToFilter && issued > new Date(`${dateToFilter}T23:59:59`)) return false;
			}
```

Adaugă `dateFromFilter; dateToFilter;` la dependențele din `$effect`-ul care resetează `currentPage = 1`.

În blocul de filtre din markup, după `Input`-ul de căutare:

```svelte
				<div>
					<Label class="text-xs">De la</Label>
					<Input type="date" bind:value={dateFromFilter} class="w-[150px]" />
				</div>
				<div>
					<Label class="text-xs">Până la</Label>
					<Input type="date" bind:value={dateToFilter} class="w-[150px]" />
				</div>
				<Button variant="outline" size="sm" onclick={() => { const r = previousMonthRange(); dateFromFilter = r.from; dateToFilter = r.to; }}>
					Luna anterioară
				</Button>
				<Button variant="ghost" size="sm" onclick={() => { dateFromFilter = ''; dateToFilter = ''; }}>
					Toate datele
				</Button>
```

(importă `Label` din `$lib/components/ui/label` dacă nu e deja importat). Mesajul de „nicio factură" trebuie să rămână corect când filtrul de dată e cel care golește lista — textul existent „Încearcă să modifici filtrele." acoperă cazul.

- [ ] **Step 2: Creează `GmailSearchTab.svelte`**

Structura completă (adaptează micile diferențe de API la componentele UI existente — uită-te la felul în care `+page.svelte` folosește `Select`, `Checkbox`, `Card`):

```svelte
<script lang="ts">
	import { searchGmailForDownload, matchMissingDocuments, getGmailConnectionStatus } from '$lib/remotes/supplier-invoices.remote';
	import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '$lib/components/ui/card';
	import { Button } from '$lib/components/ui/button';
	import { Badge } from '$lib/components/ui/badge';
	import { Input } from '$lib/components/ui/input';
	import { Checkbox } from '$lib/components/ui/checkbox';
	import { Label } from '$lib/components/ui/label';
	import { formatAmount, type Currency } from '$lib/utils/currency';
	import { Download, Search, Upload, FileSpreadsheet, AlertCircle } from '@lucide/svelte';
	import { page } from '$app/state';
	import { toast } from 'svelte-sonner';
	import { clientLogger } from '$lib/client-logger';

	const tenantSlug = $derived(page.params.tenant);

	const statusQuery = getGmailConnectionStatus();
	const gmailStatus = $derived(statusQuery.current);

	// ---- Mod: 'upload' (Documente Lipsa) | 'search' (căutare liberă) ----
	let mode = $state<'upload' | 'search'>('upload');

	// ---- Mod A: upload Documente Lipsa ----
	let uploading = $state(false);
	let matchResult = $state<Awaited<ReturnType<typeof matchMissingDocuments>> | null>(null);
	let selectedPayments = $state(new Set<string>()); // key = reference + gmailMessageId

	async function handleFileChange(e: Event) {
		const input = e.target as HTMLInputElement;
		const file = input.files?.[0];
		if (!file) return;
		uploading = true;
		try {
			const buf = await file.arrayBuffer();
			const base64 = btoa(String.fromCharCode(...new Uint8Array(buf)));
			matchResult = await matchMissingDocuments({ fileBase64: base64 });
			// pre-bifează match-urile sigure
			selectedPayments = new Set(
				matchResult.payments.filter((p) => p.confidence === 'sure' && p.match).map((p) => p.reference + p.match!.gmailMessageId)
			);
		} catch (err) {
			clientLogger.apiError('gmail_match_missing_documents', err);
		} finally {
			uploading = false;
			input.value = '';
		}
	}

	function paymentLabel(p: { reference: string; comment: string; originalAmount: number | null; originalCurrency: string | null }) {
		const amt = p.originalAmount != null && p.originalCurrency
			? formatAmount(p.originalAmount, p.originalCurrency as Currency)
			: '';
		return `${p.reference}_${merchantShort(p.comment)}${amt ? '_' + amt.replace(/\s/g, '') : ''}`;
	}

	function merchantShort(comment: string): string {
		const m = comment.match(/TID:\S+\s+\*?\s*(.+?)\s{2,}/);
		return (m?.[1] || 'FURNIZOR').replace(/[^a-zA-Z0-9]+/g, '').slice(0, 20).toUpperCase();
	}

	// ---- Mod B: căutare liberă ----
	// Default: luna calendaristică ANTERIOARĂ (fluxul e lunar — facturile lunii trecute
	// se urcă în Keez la începutul lunii curente). NU hardcoda anul/luna (regula proiectului
	// „no hardcoded dynamic values") — derivă din data curentă.
	function previousMonthRange(): { from: string; to: string } {
		const now = new Date();
		const first = new Date(now.getFullYear(), now.getMonth() - 1, 1);
		const last = new Date(now.getFullYear(), now.getMonth(), 0);
		const iso = (d: Date) =>
			`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
		return { from: iso(first), to: iso(last) };
	}
	const defaultRange = previousMonthRange();

	let dateFrom = $state(defaultRange.from);
	let dateTo = $state(defaultRange.to);
	let searching = $state(false);
	let onlyNotDownloaded = $state(false);
	let searchResult = $state<Awaited<ReturnType<typeof searchGmailForDownload>> | null>(null);
	let selectedMessages = $state(new Set<string>());

	const visibleResults = $derived(
		(searchResult?.results ?? []).filter((r) => !onlyNotDownloaded || !r.downloadedAt)
	);

	async function handleSearch() {
		searching = true;
		try {
			searchResult = await searchGmailForDownload({
				dateFrom: dateFrom || undefined,
				dateTo: dateTo || undefined,
				maxResults: 100
			});
			selectedMessages = new Set();
		} catch (err) {
			clientLogger.apiError('gmail_search_for_download', err);
		} finally {
			searching = false;
		}
	}

	// ---- Descărcare comună ----
	let downloading = $state(false);

	async function downloadZip(items: Array<{ messageId: string; label?: string; bankReference?: string }>) {
		if (items.length === 0) return;
		downloading = true;
		try {
			const res = await fetch(`/${tenantSlug}/banking/supplier-invoices/download-gmail-zip`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ items })
			});
			if (!res.ok) throw new Error(await res.text());
			const skippedCount = parseInt(res.headers.get('X-Skipped-Count') || '0', 10);
			const blob = await res.blob();
			const url = URL.createObjectURL(blob);
			const a = document.createElement('a');
			a.href = url;
			a.download = res.headers.get('Content-Disposition')?.match(/filename="(.+)"/)?.[1] || 'facturi-gmail.zip';
			document.body.appendChild(a);
			a.click();
			a.remove();
			URL.revokeObjectURL(url);
			if (skippedCount > 0) toast.warning(`${skippedCount} emailuri sărite (fără PDF sau eroare)`);
			else toast.success('Arhiva descărcată');
			// reîmprospătează badge-urile "Descărcată"
			if (mode === 'search' && searchResult) await handleSearch();
		} catch (err) {
			clientLogger.apiError('gmail_download_zip', err);
		} finally {
			downloading = false;
		}
	}

	function singleDownloadUrl(messageId: string, index: number, ref?: string) {
		const params = new URLSearchParams({ messageId, index: String(index) });
		if (ref) params.set('ref', ref);
		return `/${tenantSlug}/banking/supplier-invoices/gmail-attachment?${params}`;
	}

	function formatDate(d: Date | string | null) {
		if (!d) return '-';
		return new Date(d).toLocaleDateString('ro-RO');
	}

	const confidenceBadge = (c: string) =>
		c === 'sure' ? ('success' as const) : c === 'probable' ? ('warning' as const) : ('secondary' as const);
	const confidenceLabel = (c: string) => (c === 'sure' ? 'Match sigur' : c === 'probable' ? 'Probabil' : 'Negăsită');
</script>

{#if gmailStatus && !gmailStatus.connected}
	<Card>
		<CardContent class="py-8 text-center">
			<AlertCircle class="h-8 w-8 mx-auto text-amber-500 mb-2" />
			<p>Gmail nu e conectat. Configurează conexiunea din pagina de import.</p>
		</CardContent>
	</Card>
{:else}
	<div class="flex gap-2 mb-4">
		<Button variant={mode === 'upload' ? 'default' : 'outline'} size="sm" onclick={() => (mode = 'upload')}>
			<FileSpreadsheet class="h-4 w-4 mr-2" /> Documente Lipsa (Keez)
		</Button>
		<Button variant={mode === 'search' ? 'default' : 'outline'} size="sm" onclick={() => (mode = 'search')}>
			<Search class="h-4 w-4 mr-2" /> Căutare liberă
		</Button>
	</div>

	{#if mode === 'upload'}
		<Card class="mb-4">
			<CardHeader>
				<CardTitle>Încarcă exportul „Documente Lipsa" din Keez</CardTitle>
				<CardDescription>
					XLSX-ul cu plățile fără document. Căutăm automat facturile în Gmail și le potrivim cu fiecare plată.
					Atenție: plățile apar în lei, dar match-ul se face pe suma originală (EUR/USD) din descrierea tranzacției.
				</CardDescription>
			</CardHeader>
			<CardContent>
				<label class="inline-flex items-center gap-2 cursor-pointer">
					<Upload class="h-4 w-4" />
					<span class="text-sm">{uploading ? 'Se procesează...' : 'Alege MissingDocuments.xlsx'}</span>
					<input type="file" accept=".xlsx" class="hidden" onchange={handleFileChange} disabled={uploading} />
				</label>
			</CardContent>
		</Card>

		{#if matchResult}
			{@const matchedSelected = matchResult.payments.filter((p) => p.match && selectedPayments.has(p.reference + p.match.gmailMessageId))}
			<div class="mb-3 flex items-center justify-between">
				<p class="text-sm text-muted-foreground">
					{matchResult.payments.length} plăți · {matchResult.candidatesFound} facturi găsite în Gmail
					{#if matchResult.ignoredIncomes > 0} · {matchResult.ignoredIncomes} încasări ignorate{/if}
				</p>
				<Button size="sm" disabled={downloading || matchedSelected.length === 0}
					onclick={() => downloadZip(matchedSelected.map((p) => ({ messageId: p.match!.gmailMessageId, label: paymentLabel(p), bankReference: p.reference })))}>
					<Download class="h-4 w-4 mr-2" />
					{downloading ? 'Se descarcă...' : `Descarcă selecția (${matchedSelected.length})`}
				</Button>
			</div>
			<Card>
				<CardContent class="p-0">
					<div class="overflow-x-auto">
						<table class="w-full text-sm">
							<thead>
								<tr class="border-b bg-muted/50">
									<th class="w-10 p-3"></th>
									<th class="text-left p-3 font-medium">Ref.</th>
									<th class="text-left p-3 font-medium">Data plății</th>
									<th class="text-right p-3 font-medium">Sumă originală</th>
									<th class="text-right p-3 font-medium">Sumă RON</th>
									<th class="text-left p-3 font-medium">Factura găsită</th>
									<th class="text-left p-3 font-medium">Match</th>
									<th class="text-right p-3 font-medium">Acțiuni</th>
								</tr>
							</thead>
							<tbody>
								{#each matchResult.payments as p (p.reference + (p.match?.gmailMessageId ?? ''))}
									{@const key = p.match ? p.reference + p.match.gmailMessageId : null}
									<tr class="border-b hover:bg-muted/25" class:bg-red-50={!p.match}>
										<td class="p-3">
											{#if key}
												<Checkbox
													checked={selectedPayments.has(key)}
													onCheckedChange={() => {
														const next = new Set(selectedPayments);
														if (next.has(key)) next.delete(key); else next.add(key);
														selectedPayments = next;
													}}
												/>
											{/if}
										</td>
										<td class="p-3 font-mono">{p.reference}</td>
										<td class="p-3">{formatDate(p.date)}</td>
										<td class="p-3 text-right font-mono">
											{p.originalAmount != null && p.originalCurrency
												? formatAmount(p.originalAmount, p.originalCurrency as Currency)
												: '-'}
										</td>
										<td class="p-3 text-right font-mono">{formatAmount(p.amountRon, 'RON')}</td>
										<td class="p-3 max-w-[280px]">
											{#if p.match}
												<div class="truncate font-medium">{p.match.subject}</div>
												<div class="text-xs text-muted-foreground truncate">{p.match.from} · {formatDate(p.match.date)}</div>
												{#if p.matchMeta?.downloadedAt}
													<Badge variant="secondary" class="mt-1">Descărcată {formatDate(p.matchMeta.downloadedAt)}</Badge>
												{/if}
											{:else}
												<span class="text-muted-foreground">—</span>
											{/if}
										</td>
										<td class="p-3">
											<Badge variant={confidenceBadge(p.confidence)}>{confidenceLabel(p.confidence)} {p.score ? `(${p.score})` : ''}</Badge>
										</td>
										<td class="p-3 text-right">
											{#if p.match && p.matchMeta?.pdfAttachments?.length}
												<Button variant="ghost" size="sm" title="Descarcă PDF"
													href={singleDownloadUrl(p.match.gmailMessageId, p.matchMeta.pdfAttachments[0].index, p.reference)}>
													<Download class="h-4 w-4" />
												</Button>
											{/if}
										</td>
									</tr>
								{/each}
							</tbody>
						</table>
					</div>
				</CardContent>
			</Card>
		{/if}
	{:else}
		<Card class="mb-4">
			<CardContent class="pt-4 flex flex-wrap items-end gap-4">
				<div>
					<Label class="text-xs">De la</Label>
					<Input type="date" bind:value={dateFrom} class="w-[160px]" />
				</div>
				<div>
					<Label class="text-xs">Până la</Label>
					<Input type="date" bind:value={dateTo} class="w-[160px]" />
				</div>
				<Button variant="outline" size="sm" onclick={() => { const r = previousMonthRange(); dateFrom = r.from; dateTo = r.to; }}>
					Luna anterioară
				</Button>
				<Button onclick={handleSearch} disabled={searching}>
					<Search class="h-4 w-4 mr-2" />
					{searching ? 'Se caută...' : 'Caută în Gmail'}
				</Button>
				<label class="flex items-center gap-2 text-sm">
					<Checkbox checked={onlyNotDownloaded} onCheckedChange={(v) => (onlyNotDownloaded = !!v)} />
					Doar nedescărcate
				</label>
			</CardContent>
		</Card>

		{#if searchResult}
			<div class="mb-3 flex items-center justify-between">
				<p class="text-sm text-muted-foreground">{visibleResults.length} emailuri cu facturi PDF</p>
				<div class="flex gap-2">
					<Button variant="outline" size="sm" onclick={() => (selectedMessages = new Set(visibleResults.map((r) => r.gmailMessageId)))}>
						Selectează tot
					</Button>
					<Button size="sm" disabled={downloading || selectedMessages.size === 0}
						onclick={() => downloadZip([...selectedMessages].map((messageId) => ({ messageId })))}>
						<Download class="h-4 w-4 mr-2" />
						{downloading ? 'Se descarcă...' : `Descarcă selecția (${selectedMessages.size})`}
					</Button>
				</div>
			</div>
			<Card>
				<CardContent class="p-0">
					<div class="overflow-x-auto">
						<table class="w-full text-sm">
							<thead>
								<tr class="border-b bg-muted/50">
									<th class="w-10 p-3"></th>
									<th class="text-left p-3 font-medium">Expeditor / Subiect</th>
									<th class="text-left p-3 font-medium">Data</th>
									<th class="text-right p-3 font-medium">Sumă</th>
									<th class="text-left p-3 font-medium">Status</th>
									<th class="text-right p-3 font-medium">Acțiuni</th>
								</tr>
							</thead>
							<tbody>
								{#each visibleResults as r (r.gmailMessageId)}
									<tr class="border-b hover:bg-muted/25">
										<td class="p-3">
											<Checkbox
												checked={selectedMessages.has(r.gmailMessageId)}
												onCheckedChange={() => {
													const next = new Set(selectedMessages);
													if (next.has(r.gmailMessageId)) next.delete(r.gmailMessageId); else next.add(r.gmailMessageId);
													selectedMessages = next;
												}}
											/>
										</td>
										<td class="p-3 max-w-[320px]">
											<div class="truncate font-medium">{r.subject}</div>
											<div class="text-xs text-muted-foreground truncate">{r.from}</div>
										</td>
										<td class="p-3">{formatDate(r.date)}</td>
										<td class="p-3 text-right font-mono">
											{r.amount != null && r.currency ? formatAmount(r.amount, r.currency as Currency) : '-'}
										</td>
										<td class="p-3">
											{#if r.alreadyImported}<Badge variant="outline">Importată</Badge>{/if}
											{#if r.downloadedAt}<Badge variant="secondary">Descărcată</Badge>{/if}
										</td>
										<td class="p-3 text-right">
											{#each r.pdfAttachments as att (att.index)}
												<Button variant="ghost" size="sm" title={att.filename}
													href={singleDownloadUrl(r.gmailMessageId, att.index)}>
													<Download class="h-4 w-4" />
												</Button>
											{/each}
										</td>
									</tr>
								{/each}
							</tbody>
						</table>
					</div>
				</CardContent>
			</Card>
		{/if}
	{/if}
{/if}
```

Note de implementare:
- **Scope-ul căutării (cerere utilizator):** Mod B caută implicit la **toți expeditorii** cu PDF atașat (`scope: 'all'`), nu doar la furnizorii cu parser. Adaugă un checkbox „Doar furnizori cunoscuți" legat la `let onlyKnownSuppliers = $state(false)` și trimite `scope: onlyKnownSuppliers ? 'suppliers' : 'all'`. Sub filtre, afișează un hint: „Căutarea acoperă orice expeditor cu factură PDF în intervalul ales."
- **Adrese custom (spec §2):** în Mod B, lângă filtrele de dată, adaugă un `Input` text „Adrese custom (virgulă)" legat la `let customEmailsText = $state('')`; la căutare trimite `customEmails: customEmailsText.split(',').map((s) => s.trim()).filter(Boolean)` către `searchGmailForDownload` (relevant doar când scope-ul e 'suppliers').
- **„Caută manual" (spec §3, plăți fără match):** pe rândurile cu `confidence === 'none'` din Mod A, adaugă un buton mic care face `mode = 'search'` și pre-populează `dateFrom`/`dateTo` cu `p.date ± 10 zile` (format `YYYY-MM-DD`), apoi apelează `handleSearch()`.
- `getGmailConnectionStatus` — verifică forma reală a răspunsului (`getGmailStatus`) înainte de a folosi `.connected`; adaptează.
- Descărcarea individuală prin `href` navighează direct la endpoint (GET) — browserul descarcă fișierul; badge-ul „Descărcată" se actualizează la următoarea căutare.
- `btoa(String.fromCharCode(...))` poate depăși stack-ul pe fișiere mari; XLSX-ul Keez are câteva KB, e ok — dar folosește chunking dacă apar probleme (buclă cu `String.fromCharCode.apply` pe felii de 8KB).

- [ ] **Step 3: Rulează svelte-autofixer (MCP) pe ambele fișiere**

Rulează tool-ul MCP `svelte-autofixer` pe `GmailSearchTab.svelte` și pe `+page.svelte` modificat; aplică fixurile raportate și re-rulează până nu mai sunt probleme.

- [ ] **Step 4: Build check**

Run: `NODE_OPTIONS=--max-old-space-size=8192 bunx svelte-check --threshold error --output human 2>&1 | tail -15`
Expected: fără erori noi.

- [ ] **Step 5: Commit**

```bash
git add "src/routes/[tenant]/banking/supplier-invoices/"
git commit -m "feat(banking): tab Căutare Gmail — upload Documente Lipsa cu match automat + căutare liberă + descărcare ZIP"
```

---

## Task 10: Verificare finală

- [ ] **Step 1: Toată suita de teste**

Run: `bun test src/lib/server/gmail/ src/lib/server/banking/`
Expected: PASS, 0 failures.

- [ ] **Step 2: svelte-check complet**

Run: `NODE_OPTIONS=--max-old-space-size=8192 bunx svelte-check --threshold warning 2>&1 | tail -5`
Expected: fără erori; warning-urile preexistente sunt acceptabile.

- [ ] **Step 3: Test manual pe dev** (ATENȚIE: DB dev = Turso PROD; nu importa/șterge nimic — doar căutare și descărcare, care sunt read-only pe Gmail + scriu doar în `gmail_invoice_download`)

1. `bun run dev` din `app/`, login `office@onetopsolution.ro` pe `/ots/banking/supplier-invoices`.
2. Tab „Căutare Gmail" → „Documente Lipsa" → încarcă `/Users/augustin598/Projects/CRM/MissingDocuments.xlsx`.
3. Verifică: plățile Hetzner/DirectAdmin/LiteSpeed/Google au match sigur; Kesselring/fidasolutions probabil fără match (n-au email); descarcă ZIP-ul și deschide un PDF.
4. Căutare liberă: verifică întâi că intervalul e pre-completat cu **luna anterioară** → bifează 2 → ZIP → badge „Descărcată" apare la re-căutare.
5. Tab „Facturi importate": intervalul de dată e pre-completat cu luna anterioară; butonul „Toate datele" golește filtrul și reafișează toate facturile.

- [ ] **Step 4: Commit final dacă au apărut ajustări, apoi raportează**

Nu face push/deploy fără confirmarea utilizatorului (regula proiectului: deploy doar la „go").
