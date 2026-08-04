import { describe, it, expect } from 'bun:test';
import type { GmailMessage } from '../client';
import { cursorParser } from '../parsers/cursor';
import { directadminParser } from '../parsers/directadmin';
import { genericParser } from '../parsers/generic';
import { googleParser } from '../parsers/google';
import {
	SUGGESTED_EXCLUDE_PATTERNS,
	buildInvoiceSearchQuery,
	detectStatus,
	findParser,
	parseAmount,
	toGmailExcludeOperator
} from '../parsers/index';
import { parseAmountNearKeyword } from '../parsers/helpers';
import { inwxParser } from '../parsers/inwx';
import { openaiParser } from '../parsers/openai';
import { roSuppliersParser } from '../parsers/ro-suppliers';
import { whmcsParser } from '../parsers/whmcs';

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

describe('detectStatus — cuvinte-cheie noi', () => {
	it('achitat => paid', () => {
		expect(detectStatus('Factura a fost achitata cu cardul')).toBe('paid');
	});
	it('amount received by prepayment => paid', () => {
		expect(detectStatus('Amount received by prepayment.')).toBe('paid');
	});
});

describe('detectStatus — fără fals pozitiv pe neachitat/de achitat/prepayment', () => {
	it('neachitată => unpaid (nu paid)', () => {
		expect(detectStatus('Factura dvs. este neachitată')).toBe('unpaid');
	});
	it('de achitat => unpaid', () => {
		expect(detectStatus('Aveți de achitat suma de 100 RON')).toBe('unpaid');
	});
	it('prepayment bar (cerere, nu confirmare) => nu paid', () => {
		expect(detectStatus('Prepayment invoice for your order')).not.toBe('paid');
	});
});

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
		expect(r.invoiceNumber).toBe('453940');
	});
	it('generic: nu confundă anul din subiect cu nr. de factură ("Invoice 2026 renewal reminder")', () => {
		const r = genericParser.parseInvoice(
			makeEmail({ subject: 'Invoice 2026 renewal reminder', body: 'Your invoice for this year is attached.' })
		);
		expect(r.invoiceNumber).toBeUndefined();
	});
	it('ro-suppliers: nu confundă anul din subiect cu nr. de factură ("Factura 2026 emisa")', () => {
		const r = roSuppliersParser.parseInvoice(
			makeEmail({ from: 'facturi@rotld.ro', subject: 'Factura 2026 emisa', body: '' })
		);
		expect(r.invoiceNumber).toBeUndefined();
	});
	it('generic: subiect respins ("available") nu blochează fallback-ul din body ("Invoice number: 12345")', () => {
		const r = genericParser.parseInvoice(
			makeEmail({ subject: 'New Invoice available', body: 'Invoice number: 12345' })
		);
		expect(r.invoiceNumber).toBe('12345');
	});
	it('generic: an cu marcaj explicit "#" e acceptat ("Invoice #2026")', () => {
		const r = genericParser.parseInvoice(makeEmail({ subject: 'Invoice #2026' }));
		expect(r.invoiceNumber).toBe('2026');
	});
	it('ro-suppliers: subiect respins ("2026" fără marcaj) nu blochează fallback-ul din body ("Factura #5566")', () => {
		const r = roSuppliersParser.parseInvoice(
			makeEmail({ from: 'facturi@rotld.ro', subject: 'Factura 2026 emisa', body: 'Factura #5566' })
		);
		expect(r.invoiceNumber).toBe('5566');
	});
	it('generic: candidat respins din subiect nu blochează un nr. real mai departe în ACELAȘI subiect ("New Invoice available - #INV-2026-0042")', () => {
		const r = genericParser.parseInvoice(
			makeEmail({ subject: 'New Invoice available - #INV-2026-0042' })
		);
		expect(r.invoiceNumber).toBe('INV-2026-0042');
	});
	it('generic: candidat respins din subiect nu blochează un nr. real mai departe în ACELAȘI subiect ("New Invoice available: 12345")', () => {
		const r = genericParser.parseInvoice(makeEmail({ subject: 'New Invoice available: 12345' }));
		expect(r.invoiceNumber).toBe('12345');
	});
	it('ro-suppliers: candidat respins din subiect nu blochează un nr. real mai departe în ACELAȘI subiect ("Factura disponibila - #5566")', () => {
		const r = roSuppliersParser.parseInvoice(
			makeEmail({ from: 'facturi@rotld.ro', subject: 'Factura disponibila - #5566', body: '' })
		);
		expect(r.invoiceNumber).toBe('5566');
	});
	it('generic: body cu marcaj explicit acceptă anul ("Invoice number: 2026")', () => {
		const r = genericParser.parseInvoice(
			makeEmail({ subject: 'New Invoice available', body: 'Invoice number: 2026' })
		);
		expect(r.invoiceNumber).toBe('2026');
	});
	it('ro-suppliers: formatul "Seria X nr Y" tot funcționează după refactor', () => {
		const r = roSuppliersParser.parseInvoice(
			makeEmail({ from: 'facturi@emag.ro', subject: 'Factura emisa', body: 'Seria ABC nr 12345' })
		);
		expect(r.invoiceNumber).toBe('ABC-12345');
	});
});

describe('extractInvoiceNumber — ancorat pe cuvântul-cheie (regresie: NU mai ia primul token cu cifră din tot textul)', () => {
	it('generic: nu ia "4471" (nr. de comandă) din "Renewal for order 4471 - invoice #INV-2026-0042"', () => {
		const r = genericParser.parseInvoice(
			makeEmail({ subject: 'Renewal for order 4471 - invoice #INV-2026-0042' })
		);
		expect(r.invoiceNumber).toBe('INV-2026-0042');
	});
	it('generic: nu ia "2" (nr. de produse) din "Your 2 items shipped, invoice #123"', () => {
		const r = genericParser.parseInvoice(makeEmail({ subject: 'Your 2 items shipped, invoice #123' }));
		expect(r.invoiceNumber).toBe('123');
	});
	it('generic: nu ia "15" (ziua din dată) din body "Hi John, on 15 July 2026 we issued invoice #5566."', () => {
		const r = genericParser.parseInvoice(
			makeEmail({
				subject: 'New Invoice available',
				body: 'Hi John, on 15 July 2026 we issued invoice #5566.'
			})
		);
		expect(r.invoiceNumber).toBe('5566');
	});
	it('generic: nu ia "998877" (nr. de cont) din body "Hello, account 998877 was billed. Invoice number: 12345"', () => {
		const r = genericParser.parseInvoice(
			makeEmail({
				subject: 'New Invoice available',
				body: 'Hello, account 998877 was billed. Invoice number: 12345'
			})
		);
		expect(r.invoiceNumber).toBe('12345');
	});
	it('generic: nu ia "49" (din suma 49.99) din body "Total: 49.99 USD. Invoice #A-771"', () => {
		const r = genericParser.parseInvoice(
			makeEmail({ subject: 'New Invoice available', body: 'Total: 49.99 USD. Invoice #A-771' })
		);
		expect(r.invoiceNumber).toBe('A-771');
	});
	it('whmcs: nu ia "9912" (nr. de tichet suport) din "Support ticket #9912 - invoice ready"', () => {
		const r = whmcsParser.parseInvoice(
			makeEmail({ from: 'billing@whmcs.com', subject: 'Support ticket #9912 - invoice ready', body: '' })
		);
		expect(r.invoiceNumber).toBeUndefined();
	});
	it('google: idiomul RO "Numărul facturii:" e verificat ÎNAINTE de scanarea generică, nu ia "777" din body "Comanda 777. Numarul facturii: 12345"', () => {
		const r = googleParser.parseInvoice(
			makeEmail({
				from: 'billing@google.com',
				subject: 'Google Cloud',
				body: 'Comanda 777. Numarul facturii: 12345'
			})
		);
		expect(r.invoiceNumber).toBe('12345');
	});
});

describe('extractInvoiceNumber — fereastră pe TOKENI (regresie: fereastra pe caractere trunchia candidații lungi)', () => {
	it('generic: nu trunchiază nr. lung după marcajul "no." ("...subscription no. 1234567890")', () => {
		const r = genericParser.parseInvoice(
			makeEmail({
				subject: 'New Invoice available',
				body: 'Invoice for your monthly subscription no. 1234567890'
			})
		);
		expect(r.invoiceNumber).toBe('1234567890');
	});
	it('generic: nu trunchiază nr. lung după "#" chiar cu mult text de umplutură înainte', () => {
		const r = genericParser.parseInvoice(
			makeEmail({
				subject: 'New Invoice available',
				body: 'Invoice regarding your subscription #987654321098'
			})
		);
		expect(r.invoiceNumber).toBe('987654321098');
	});
});

describe('extractInvoiceNumber — marcajele cer delimitare de cuvânt (regresie: "no." se potrivea în interiorul "not"/"now"/"notification")', () => {
	it('generic: "not" nu blochează marcajul real "no." mai departe ("Invoice not yet paid, no. 8899")', () => {
		const r = genericParser.parseInvoice(
			makeEmail({ subject: 'New Invoice available', body: 'Invoice not yet paid, no. 8899' })
		);
		expect(r.invoiceNumber).toBe('8899');
	});
	it('generic: "now" nu blochează marcajul real "#" mai departe ("Invoice is now ready, see #12345")', () => {
		const r = genericParser.parseInvoice(
			makeEmail({ subject: 'New Invoice available', body: 'Invoice is now ready, see #12345' })
		);
		expect(r.invoiceNumber).toBe('12345');
	});
	it('generic: "notification" nu blochează marcajul real "#" mai departe ("Invoice notification for you: #12345")', () => {
		const r = genericParser.parseInvoice(
			makeEmail({ subject: 'New Invoice available', body: 'Invoice notification for you: #12345' })
		);
		expect(r.invoiceNumber).toBe('12345');
	});
});

describe('extractInvoiceNumber — fereastra de tokeni FĂRĂ marcaj (BARE_WINDOW_TOKENS=3, redus de la 4)', () => {
	it('generic: al 3-lea token fără marcaj e găsit ("Your invoice is available INV-0042")', () => {
		const r = genericParser.parseInvoice(makeEmail({ subject: 'Your invoice is available INV-0042' }));
		expect(r.invoiceNumber).toBe('INV-0042');
	});
	it('generic: pragul de lungime (>=3) respinge un token scurt fără marcaj ("Invoice 42")', () => {
		const r = genericParser.parseInvoice(makeEmail({ subject: 'Invoice 42' }));
		expect(r.invoiceNumber).toBeUndefined();
	});
});

describe('extractInvoiceNumber — respinge sume, cantități și date ca nr. de factură (regresie: fereastra lărgită inventa nr. din sume/date/cantități)', () => {
	it('generic: nu ia "129.99" (sumă) din "Invoice ready - total 129.99 EUR due"', () => {
		const r = genericParser.parseInvoice(
			makeEmail({ subject: 'New Invoice available', body: 'Invoice ready - total 129.99 EUR due' })
		);
		expect(r.invoiceNumber).toBeUndefined();
	});
	it('generic: nu ia "129.99" (sumă) din "Invoice ready, total 129.99 EUR"', () => {
		const r = genericParser.parseInvoice(
			makeEmail({ subject: 'New Invoice available', body: 'Invoice ready, total 129.99 EUR' })
		);
		expect(r.invoiceNumber).toBeUndefined();
	});
	it('generic: nu ia "49.50" (sumă) din "Invoice available - 49.50 USD"', () => {
		const r = genericParser.parseInvoice(
			makeEmail({ subject: 'New Invoice available', body: 'Invoice available - 49.50 USD' })
		);
		expect(r.invoiceNumber).toBeUndefined();
	});
	it('generic: nu ia "2026-07-21" (dată ISO) din "Invoice is attached for 2026-07-21 period"', () => {
		const r = genericParser.parseInvoice(
			makeEmail({ subject: 'New Invoice available', body: 'Invoice is attached for 2026-07-21 period' })
		);
		expect(r.invoiceNumber).toBeUndefined();
	});
	it('generic: nu ia "2026-07-21" (dată ISO) via marcajul "no." din "Invoice no. 2026-07-21"', () => {
		const r = genericParser.parseInvoice(
			makeEmail({ subject: 'New Invoice available', body: 'Invoice no. 2026-07-21' })
		);
		expect(r.invoiceNumber).toBeUndefined();
	});
	it('generic: limită cunoscută — o cantitate simplă de 3 cifre fără marcaj NU poate fi diferențiată de un nr. de factură real (rămâne acceptat, per notă coordonator)', () => {
		// "150" nu are nicio formă distinctivă (nu e dată, nu e sumă, nu e an) — niciun shape-guard
		// nu îl poate respinge fără fals-negative pe facturi reale cu 3 cifre. Documentat ca limitare
		// acceptată; BARE_WINDOW_TOKENS=3 reduce doar EXPUNEREA (nu elimină acest caz specific).
		const r = genericParser.parseInvoice(
			makeEmail({ subject: 'New Invoice available', body: 'Invoice enclosed for 150 domains renewed' })
		);
		expect(r.invoiceNumber).toBe('150');
	});
});

describe('extractInvoiceNumber — bare path normalizat identic cu marker path (regresie: "/" supraviețuia doar pe bare path)', () => {
	it('bare: "Invoice 123/2026" se oprește la "123", la fel ca marker path', () => {
		const r = genericParser.parseInvoice(makeEmail({ subject: 'Invoice 123/2026' }));
		expect(r.invoiceNumber).toBe('123');
	});
	it('marker: "Invoice #123/2026" se oprește la "123"', () => {
		const r = genericParser.parseInvoice(makeEmail({ subject: 'Invoice #123/2026' }));
		expect(r.invoiceNumber).toBe('123');
	});
});

describe('extragere nr. factură — google/openai/whmcs nu mai capturează cuvinte gunoi', () => {
	it('google: nu ia "is" din "Your Google invoice is available - #INV-9911"', () => {
		const r = googleParser.parseInvoice(
			makeEmail({
				from: 'billing@google.com',
				subject: 'Your Google invoice is available - #INV-9911',
				body: ''
			})
		);
		expect(r.invoiceNumber).not.toBe('is');
		expect(r.invoiceNumber).toBe('INV-9911');
	});
	it('openai: nu ia "is" din "Your OpenAI invoice is ready - #INV-7788"', () => {
		const r = openaiParser.parseInvoice(
			makeEmail({
				from: 'billing@openai.com',
				subject: 'Your OpenAI invoice is ready - #INV-7788',
				body: ''
			})
		);
		expect(r.invoiceNumber).not.toBe('is');
		expect(r.invoiceNumber).toBe('INV-7788');
	});
	it('whmcs: nu ia "available" din "New Invoice available - #4455"', () => {
		const r = whmcsParser.parseInvoice(
			makeEmail({
				from: 'billing@whmcs.com',
				subject: 'New Invoice available - #4455',
				body: ''
			})
		);
		expect(r.invoiceNumber).not.toBe('available');
		expect(r.invoiceNumber).toBe('4455');
	});
});

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

	it('directadmin: extrage nr. facturii din subiect', () => {
		const r = directadminParser.parseInvoice(
			makeEmail({
				from: 'DirectAdmin <billing@directadmin.com>',
				subject: 'Invoice #DA-2026-0099',
				body: 'Your DirectAdmin license invoice is attached. Total: $24.00 USD'
			})
		);
		expect(r.supplierType).toBe('directadmin');
		expect(r.invoiceNumber).toBe('DA-2026-0099');
	});

	it('directadmin: cuvântul-cheie "receipt" e recunoscut ("Receipt #DA-2026-0099")', () => {
		const r = directadminParser.parseInvoice(
			makeEmail({
				from: 'DirectAdmin <billing@directadmin.com>',
				subject: 'Receipt #DA-2026-0099',
				body: ''
			})
		);
		expect(r.invoiceNumber).toBe('DA-2026-0099');
	});

	it('cursor: getSearchQuery acoperă și anysphere.com, nu doar cursor.com', () => {
		expect(cursorParser.getSearchQuery()).toBe(
			'(from:cursor.com OR from:anysphere.com) has:attachment filename:pdf'
		);
	});

	it('cursor: extrage nr. chitanței din corp', () => {
		const r = cursorParser.parseInvoice(
			makeEmail({
				from: 'Anysphere <billing@cursor.com>',
				subject: 'Your receipt from Cursor',
				body: 'Receipt number: 2345-6789. Amount paid: $20.00 USD'
			})
		);
		expect(r.supplierType).toBe('cursor');
		expect(r.invoiceNumber).toBe('2345-6789');
	});

	it('inwx: "New Invoice available" nu produce nr. gunoi', () => {
		const r = inwxParser.parseInvoice(
			makeEmail({
				from: 'INWX GmbH <buchhaltung@inwx.de>',
				subject: 'New Invoice available',
				body: 'A new invoice is available in your account.'
			})
		);
		expect(r.supplierType).toBe('inwx');
		expect(r.invoiceNumber).toBeUndefined();
	});

	// Notificarea INWX nu conține suma (ea stă în PDF). Un „$1" oarecare din corp devenea
	// factură de 1,00 USD, iar suma inventată închidea îmbogățirea din PDF — vezi
	// `shouldPreferPdfAmount` și poarta din supplier-invoices.remote.ts.
	it('inwx: nicio sumă inventată dintr-o notificare fără sumă', () => {
		const r = inwxParser.parseInvoice(
			makeEmail({
				from: 'INWX GmbH <buchhaltung@inwx.de>',
				subject: 'New Invoice available',
				body: 'A new invoice is available in your account. Log in with $1 click to download it.'
			})
		);
		expect(r.amount).toBeUndefined();
		expect(r.currency).toBeUndefined();
	});

	it('inwx: suma DECLARATĂ în corp e citită („Rechnungsbetrag: 9,89 EUR")', () => {
		const r = inwxParser.parseInvoice(
			makeEmail({
				from: 'INWX GmbH <buchhaltung@inwx.de>',
				subject: 'Neue Rechnung verfügbar',
				body: 'Ihre Rechnung liegt bereit. Rechnungsbetrag: 9,89 EUR. Vielen Dank.'
			})
		);
		expect(r.amount).toBe(989);
		expect(r.currency).toBe('EUR');
	});

	it('inwx: și forma engleză („Total amount: EUR 12.50")', () => {
		const r = inwxParser.parseInvoice(
			makeEmail({
				from: 'INWX GmbH <buchhaltung@inwx.de>',
				subject: 'New Invoice available',
				body: 'Total amount: EUR 12.50'
			})
		);
		expect(r.amount).toBe(1250);
		expect(r.currency).toBe('EUR');
	});
});

describe('parseAmountNearKeyword — suma declarată, nu suma găsită', () => {
	it('fără cuvânt-cheie nu întoarce nimic, oricâte numere ar fi în text', () => {
		expect(parseAmountNearKeyword('Click here: $1 or 25.00 EUR of savings', ['total'])).toBeNull();
	});

	it('ia suma de după cuvântul-cheie, nu prima din text', () => {
		expect(parseAmountNearKeyword('Subscription $1 trial. Total: 25,00 EUR', ['total'])).toEqual({
			amount: 2500,
			currency: 'EUR'
		});
	});

	it('o sumă prea departe de cuvântul-cheie nu i se atribuie', () => {
		const text = `Total for the period described in the following paragraph of this notice: 25,00 EUR`;
		expect(parseAmountNearKeyword(text, ['total'])).toBeNull();
	});

	it('încearcă fiecare apariție a cuvântului-cheie', () => {
		const text = 'Total items: three. Total price: 40,00 RON';
		expect(parseAmountNearKeyword(text, ['total'])).toEqual({ amount: 4000, currency: 'RON' });
	});
});

describe('parsere noi — nu se lasă umbrite de matcher-e pe subiect (ordine registru)', () => {
	it('cursor.com nu e umbrit de anthropicParser ("...Claude Sonnet usage" în subiect)', () => {
		expect(
			findParser(
				'Anysphere <billing@cursor.com>',
				'Your receipt from Cursor — Claude Sonnet usage'
			)?.id
		).toBe('cursor');
	});
	it('directadmin.com nu e umbrit de whmcsParser ("WHMCS" în subiect)', () => {
		expect(
			findParser('DirectAdmin <billing@directadmin.com>', 'WHMCS module license invoice')?.id
		).toBe('directadmin');
	});
});

describe('parseAmount — separator zecimal: ultimul separator din text câștigă (bug: format german tratat ca mii+zecimale inversat)', () => {
	it('format german cu miare de mii "1.234,56 EUR" => 123456 cenți (nu 23456)', () => {
		expect(parseAmount('1.234,56 EUR')).toEqual({ amount: 123456, currency: 'EUR' });
	});
	it('format american cu virgulă de mii "1,234.56 USD" => 123456 cenți', () => {
		expect(parseAmount('1,234.56 USD')).toEqual({ amount: 123456, currency: 'USD' });
	});
	it('format german "1.099,00 EUR" => 109900 cenți (nu 9900)', () => {
		expect(parseAmount('1.099,00 EUR')).toEqual({ amount: 109900, currency: 'EUR' });
	});
	it('un singur separator zecimal (virgulă) rămâne corect: "12,34 EUR" => 1234 cenți', () => {
		expect(parseAmount('12,34 EUR')).toEqual({ amount: 1234, currency: 'EUR' });
	});
	it('un singur separator zecimal (punct), simbol $: "$12.34" => 1234 cenți', () => {
		expect(parseAmount('$12.34')).toEqual({ amount: 1234, currency: 'USD' });
	});
});

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

describe('excluderi de expeditori la căutarea de facturi', () => {
	it('normalizează „@domeniu.com" la operatorul negativ pe domeniu', () => {
		expect(toGmailExcludeOperator('@tiktok.com')).toBe('-from:tiktok.com');
	});

	it('păstrează adresa completă când tiparul e o adresă exactă', () => {
		expect(toGmailExcludeOperator('facturi@x.ro')).toBe('-from:facturi@x.ro');
	});

	it('normalizează domeniul gol', () => {
		expect(toGmailExcludeOperator('x.ro')).toBe('-from:x.ro');
	});

	it('respinge tiparele goale sau fără punct', () => {
		expect(toGmailExcludeOperator('   ')).toBeNull();
		expect(toGmailExcludeOperator('tiktok')).toBeNull();
		expect(toGmailExcludeOperator('@')).toBeNull();
	});

	it('adaugă operatorii negativi în query și păstrează filtrul de PDF', () => {
		const q = buildInvoiceSearchQuery({
			scope: 'all',
			excludeEmails: ['tiktok.com', '@facebook.com']
		});
		expect(q).toContain('has:attachment filename:pdf');
		expect(q).toContain('-from:tiktok.com');
		expect(q).toContain('-from:facebook.com');
	});

	it('regresie: fără excluderi query-ul rămâne exact ca înainte', () => {
		expect(buildInvoiceSearchQuery({ scope: 'all' })).toBe('has:attachment filename:pdf');
		expect(buildInvoiceSearchQuery({ scope: 'all', excludeEmails: [] })).toBe(
			'has:attachment filename:pdf'
		);
	});

	it('excluderile nu se pierd când există și filtre de dată', () => {
		const q = buildInvoiceSearchQuery({
			scope: 'all',
			excludeEmails: ['tiktok.com'],
			dateFrom: new Date(2026, 6, 1)
		});
		expect(q).toContain('after:2026/7/1');
		expect(q).toContain('-from:tiktok.com');
	});

	it('sugestiile implicite acoperă platformele numite de utilizator', () => {
		expect(SUGGESTED_EXCLUDE_PATTERNS).toContain('tiktok.com');
		expect(SUGGESTED_EXCLUDE_PATTERNS).toContain('facebook.com');
	});

	it('sugestiile NU conțin furnizori de infrastructură (hetzner, google.com)', () => {
		for (const pattern of SUGGESTED_EXCLUDE_PATTERNS) {
			expect(pattern).not.toContain('hetzner');
			expect(pattern).not.toContain('google.com');
		}
	});

	it('sugestiile sunt tipare valide (toate produc un operator negativ)', () => {
		for (const pattern of SUGGESTED_EXCLUDE_PATTERNS) {
			expect(toGmailExcludeOperator(pattern)).not.toBeNull();
		}
	});
});
