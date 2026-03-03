import PDFDocument from 'pdfkit';
import { resolve } from 'path';

interface TenantData {
	name: string;
	companyType?: string | null;
	cui?: string | null;
	registrationNumber?: string | null;
	tradeRegister?: string | null;
	vatNumber?: string | null;
	legalRepresentative?: string | null;
	iban?: string | null;
	bankName?: string | null;
	address?: string | null;
	city?: string | null;
	county?: string | null;
	postalCode?: string | null;
	country?: string | null;
	email?: string | null;
	website?: string | null;
}

interface ClientData {
	name: string;
	businessName?: string | null;
	companyType?: string | null;
	cui?: string | null;
	registrationNumber?: string | null;
	tradeRegister?: string | null;
	vatNumber?: string | null;
	legalRepresentative?: string | null;
	iban?: string | null;
	bankName?: string | null;
	address?: string | null;
	city?: string | null;
	county?: string | null;
	postalCode?: string | null;
	country?: string | null;
	email?: string | null;
	phone?: string | null;
}

interface InvoiceData {
	invoiceNumber: string;
	invoiceSeries?: string | null;
	status: string;
	issueDate?: Date | null;
	dueDate?: Date | null;
	paidDate?: Date | null;
	currency: string;
	invoiceCurrency?: string | null;
	exchangeRate?: string | null;
	paymentTerms?: string | null;
	paymentMethod?: string | null;
	vatOnCollection?: boolean | null;
	isCreditNote?: boolean | null;
	keezStatus?: string | null;
	taxApplicationType?: string | null;
	discountType?: string | null;
	discountValue?: number | null;
	notes?: string | null;
}

interface LineItemData {
	description: string;
	quantity: number;
	rate: number;
	amount: number;
	taxRate?: number | null;
	discountType?: string | null;
	discount?: number | null;
	note?: string | null;
	currency?: string | null;
	unitOfMeasure?: string | null;
}

export interface InvoicePDFInput {
	invoice: InvoiceData;
	lineItems: LineItemData[];
	tenant: TenantData;
	client: ClientData;
	displayInvoiceNumber: string;
	invoiceLogo?: string | null;
}

const PW = 595.28;
const PH = 841.89;
const ML = 45;
const MR = 45;
const MT = 40;
const MB = 55;
const CW = PW - ML - MR;

// Color palette (ACCENT is set per-tenant inside generateInvoicePDF)
const DEFAULT_ACCENT = '#3BA4DC';
const DARK = '#1E293B';
const TEXT = '#334155';
const MUTED = '#64748B';
const LIGHT = '#94A3B8';
const BORDER = '#CBD5E1';
const SOFT_BG = '#F1F5F9';
const WHITE = '#FFFFFF';

const ASSETS_DIR = resolve(import.meta.dirname ?? '.', 'assets');
const LOGO_PATH = resolve(ASSETS_DIR, 'logo.png');
const FONT_REGULAR = resolve(ASSETS_DIR, 'DejaVuSans.ttf');
const FONT_BOLD = resolve(ASSETS_DIR, 'DejaVuSans-Bold.ttf');

function fDate(date: Date | string | null | undefined): string {
	if (!date) return '-';
	try {
		const d = date instanceof Date ? date : new Date(date);
		if (isNaN(d.getTime()) || d.getFullYear() <= 1970) return '-';
		return d.toLocaleDateString('ro-RO', { day: '2-digit', month: '2-digit', year: 'numeric' });
	} catch {
		return '-';
	}
}

function fNum(v: number): string {
	return v.toLocaleString('ro-RO', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function addr(d: { address?: string | null; city?: string | null; county?: string | null; postalCode?: string | null; country?: string | null }): string {
	return [d.country, d.city, d.county, d.address].filter(Boolean).join(', ');
}

export async function generateInvoicePDF(input: InvoicePDFInput): Promise<Buffer> {
	return new Promise<Buffer>((resolve, reject) => {
		try {
			const { invoice, lineItems, tenant, client, displayInvoiceNumber } = input;
			const ACCENT = tenant.themeColor || DEFAULT_ACCENT;
			const calcCurr = invoice.currency || 'RON';
			const invCurr = invoice.invoiceCurrency || calcCurr;
			const isMulti = calcCurr !== invCurr;
			const taxType = invoice.taxApplicationType || 'apply';

			// Determine if proforma based on keezStatus or invoice status
			const isProforma = invoice.keezStatus === 'Draft' || (!invoice.keezStatus && invoice.status === 'draft' && invoice.keezStatus !== 'Valid');
			const isCreditNote = invoice.isCreditNote;
			const pdfTitle = isCreditNote ? 'NOTA DE CREDIT' : isProforma ? 'FACTURA PROFORMA' : 'FACTURA';

			const doc = new PDFDocument({
				size: 'A4',
				margins: { top: MT, bottom: 0, left: ML, right: MR },
				autoFirstPage: true,
				info: { Title: `${pdfTitle} ${displayInvoiceNumber}`, Author: tenant.name }
			});

			// Register DejaVu Sans fonts for Romanian diacritics
			doc.registerFont('DejaVu', FONT_REGULAR);
			doc.registerFont('DejaVu-Bold', FONT_BOLD);

			const buffers: Buffer[] = [];
			doc.on('data', (c: Buffer) => buffers.push(c));
			doc.on('end', () => resolve(Buffer.concat(buffers)));
			doc.on('error', reject);

			let pg = 1;

			function footer() {
				const fy = PH - 40;
				doc.moveTo(ML, fy).lineTo(PW - MR, fy).strokeColor(BORDER).lineWidth(0.5).stroke();
				doc.fontSize(6.5).font('DejaVu').fillColor(LIGHT);
				doc.text('One Top Solution SRL', ML, fy + 6, { lineBreak: false });
				doc.text(`Pagina ${pg}`, ML, fy + 6, { width: CW, align: 'right', lineBreak: false });
			}

			let y = MT;

			// ===== TOP ACCENT BAR =====
			doc.rect(0, 0, PW, 4).fillColor(ACCENT).fill();

			// ===== HEADER =====
			// Logo left
			try {
				if (input.invoiceLogo) {
					const base64Data = input.invoiceLogo.replace(/^data:image\/\w+;base64,/, '');
					const logoBuffer = Buffer.from(base64Data, 'base64');
					doc.image(logoBuffer, ML, y + 2, { height: 32 });
				} else {
					doc.image(LOGO_PATH, ML, y + 2, { height: 32 });
				}
			} catch { /* skip */ }

			// Invoice title - right
			doc.fontSize(isProforma ? 18 : 24).font('DejaVu-Bold').fillColor(ACCENT);
			doc.text(pdfTitle, ML, y, { width: CW, align: 'right', lineBreak: false });
			doc.fontSize(10).font('DejaVu').fillColor(MUTED);
			doc.text(displayInvoiceNumber, ML, y + 28, { width: CW, align: 'right', lineBreak: false });

			y += 50;

			// Thin line under header
			doc.moveTo(ML, y).lineTo(PW - MR, y).strokeColor(ACCENT).lineWidth(2).stroke();
			y += 15;

			// ===== TWO COLUMNS: Furnizor | Detalii Factura =====
			const col1X = ML;
			const col2X = ML + CW / 2 + 15;
			const colW = CW / 2 - 15;
			const sectionStart = y;

			// --- Left: Furnizor ---
			doc.fontSize(7).font('DejaVu-Bold').fillColor(ACCENT);
			doc.text('FURNIZOR', col1X, y, { lineBreak: false });
			y += 12;

			doc.fontSize(9.5).font('DejaVu-Bold').fillColor(DARK);
			doc.text(tenant.name, col1X, y, { width: colW, lineBreak: false });
			y += 14;

			doc.fontSize(7.5).font('DejaVu').fillColor(TEXT);
			const ta = addr(tenant);
			if (ta) { doc.text(ta, col1X, y, { width: colW, lineBreak: false }); y += 10; }
			if (tenant.cui) { doc.text(`CIF: ${tenant.cui}`, col1X, y, { lineBreak: false }); y += 10; }
			if (tenant.tradeRegister) { doc.text(`Reg.Com: ${tenant.tradeRegister}`, col1X, y, { lineBreak: false }); y += 10; }
			if (tenant.bankName) { doc.text(`Banca: ${tenant.bankName}`, col1X, y, { lineBreak: false }); y += 10; }
			if (tenant.iban) { doc.text(`IBAN: ${tenant.iban}`, col1X, y, { width: colW, lineBreak: false }); y += 10; }

			// --- Right: Invoice details ---
			let yr = sectionStart;
			doc.fontSize(7).font('DejaVu-Bold').fillColor(ACCENT);
			doc.text('DETALII FACTURA', col2X, yr, { lineBreak: false });
			yr += 14;

			const meta: [string, string][] = [];
			meta.push(['Numar', displayInvoiceNumber]);
			meta.push(['Data emitere', fDate(invoice.issueDate)]);
			if (invoice.dueDate) meta.push(['Scadenta', fDate(invoice.dueDate)]);
			meta.push(['Moneda', invCurr]);
			if (isMulti) {
				meta.push(['Moneda calcul', calcCurr]);
				if (invoice.exchangeRate) meta.push(['Curs valutar', `${invoice.exchangeRate} ${calcCurr}`]);
			}
			if (invoice.paymentMethod) meta.push(['Plata', invoice.paymentMethod]);
			if (invoice.vatOnCollection) meta.push(['TVA la incasare', 'Da']);

			for (const [label, val] of meta) {
				doc.fontSize(7.5).font('DejaVu').fillColor(MUTED);
				doc.text(label, col2X, yr, { width: 80, lineBreak: false });
				doc.fontSize(7.5).font('DejaVu-Bold').fillColor(DARK);
				doc.text(val, col2X + 82, yr, { width: colW - 82, align: 'right', lineBreak: false });
				yr += 13;
			}

			y = Math.max(y, yr) + 12;

			// ===== CLIENT SECTION =====
			// Soft background box
			const clientBoxH = 55;
			doc.roundedRect(ML, y, CW, clientBoxH, 3).fillColor(SOFT_BG).fill();

			doc.fontSize(7).font('DejaVu-Bold').fillColor(ACCENT);
			doc.text('CLIENT', ML + 12, y + 8, { lineBreak: false });

			doc.fontSize(9.5).font('DejaVu-Bold').fillColor(DARK);
			doc.text(client.businessName || client.name, ML + 12, y + 19, { width: CW - 24, lineBreak: false });

			doc.fontSize(7.5).font('DejaVu').fillColor(TEXT);
			const clientParts: string[] = [];
			const ca = addr(client);
			if (ca) clientParts.push(ca);
			const clientDetails: string[] = [];
			if (client.cui) clientDetails.push(`CIF: ${client.cui}`);
			if (client.tradeRegister) clientDetails.push(`Reg.Com: ${client.tradeRegister}`);
			const clientLine = clientDetails.join('    ');

			const clientText = [...clientParts, clientLine].filter(Boolean).join('\n');
			doc.text(clientText, ML + 12, y + 32, { width: CW - 24, height: 20 });

			y += clientBoxH + 15;

			// ===== TABLE =====
			const cols = [
				{ l: '#', w: 22, a: 'center' as const },
				{ l: 'Articol', w: 155, a: 'left' as const },
				{ l: 'UM', w: 32, a: 'center' as const },
				{ l: 'Cant.', w: 38, a: 'right' as const },
				{ l: 'Pret unitar', w: 62, a: 'right' as const },
				{ l: 'Valoare', w: 58, a: 'right' as const },
				{ l: '%TVA', w: 32, a: 'right' as const },
				{ l: 'Val. TVA', w: 52, a: 'right' as const },
				{ l: 'Total', w: 54, a: 'right' as const }
			];
			const HH = 20;

			function tHead(sy: number): number {
				// Header bottom border only (clean style)
				doc.moveTo(ML, sy + HH - 1).lineTo(PW - MR, sy + HH - 1).strokeColor(DARK).lineWidth(1.2).stroke();

				let x = ML;
				doc.fontSize(7).font('DejaVu-Bold').fillColor(DARK);
				for (const c of cols) {
					doc.text(c.l, x + 3, sy + 6, { width: c.w - 6, align: c.a, lineBreak: false });
					x += c.w;
				}
				return sy + HH;
			}

			function pageBreak(cy: number, need: number): number {
				if (cy + need > PH - MB - 10) {
					footer();
					doc.addPage();
					pg++;
					doc.rect(0, 0, PW, 4).fillColor(ACCENT).fill();
					return tHead(MT + 5);
				}
				return cy;
			}

			y = tHead(y);

			for (let i = 0; i < lineItems.length; i++) {
				const item = lineItems[i];
				const sub = (item.quantity * item.rate) / 100;
				const tr = item.taxRate ? item.taxRate / 100 : 0;
				let disc = 0;
				if (item.discountType === 'percent' && item.discount) disc = (sub * item.discount) / 100;
				else if (item.discountType === 'fixed' && item.discount) disc = item.discount / 100;
				const net = sub - disc;
				const tax = taxType === 'apply' ? (net * tr) / 100 : 0;
				const total = net + tax;

				doc.fontSize(7.5);
				const dH = doc.heightOfString(item.description, { width: cols[1].w - 8 });
				const nH = item.note ? doc.heightOfString(item.note, { width: cols[1].w - 8 }) : 0;
				const rh = Math.max(18, dH + nH + 8);

				y = pageBreak(y, rh);

				// Row bottom border
				doc.moveTo(ML, y + rh).lineTo(PW - MR, y + rh).strokeColor(BORDER).lineWidth(0.3).stroke();

				let x = ML;
				const cy = y + 4;

				// #
				doc.fontSize(7).font('DejaVu').fillColor(LIGHT);
				doc.text(String(i + 1), x + 3, cy, { width: cols[0].w - 6, align: 'center', lineBreak: false });
				x += cols[0].w;

				// Articol (description may wrap, so use height constraint)
				doc.fontSize(7.5).font('DejaVu-Bold').fillColor(DARK);
				doc.text(item.description, x + 4, cy, { width: cols[1].w - 8, height: dH + 2, ellipsis: true });
				if (item.note) {
					const off = doc.heightOfString(item.description, { width: cols[1].w - 8 });
					doc.fontSize(6.5).font('DejaVu').fillColor(LIGHT);
					doc.text(item.note, x + 4, cy + off + 1, { width: cols[1].w - 8, height: nH + 2, ellipsis: true });
				}
				x += cols[1].w;

				doc.fontSize(7.5).font('DejaVu').fillColor(TEXT);

				// UM
				doc.text(item.unitOfMeasure || 'Buc', x + 2, cy, { width: cols[2].w - 4, align: 'center', lineBreak: false });
				x += cols[2].w;

				// Cant
				doc.text(fNum(item.quantity), x + 2, cy, { width: cols[3].w - 4, align: 'right', lineBreak: false });
				x += cols[3].w;

				// Pret
				doc.text(fNum(item.rate / 100), x + 2, cy, { width: cols[4].w - 4, align: 'right', lineBreak: false });
				x += cols[4].w;

				// Valoare
				doc.text(fNum(net), x + 2, cy, { width: cols[5].w - 4, align: 'right', lineBreak: false });
				x += cols[5].w;

				// %TVA
				if (taxType === 'apply' && tr > 0) {
					doc.text(`${Math.round(tr)}%`, x + 2, cy, { width: cols[6].w - 4, align: 'right', lineBreak: false });
				} else {
					doc.fillColor(LIGHT).text('-', x + 2, cy, { width: cols[6].w - 4, align: 'right', lineBreak: false });
				}
				x += cols[6].w;

				// Val TVA
				doc.fillColor(TEXT);
				doc.text(fNum(tax), x + 2, cy, { width: cols[7].w - 4, align: 'right', lineBreak: false });
				x += cols[7].w;

				// Total
				doc.font('DejaVu-Bold').fillColor(DARK);
				doc.text(fNum(total), x + 2, cy, { width: cols[8].w - 4, align: 'right', lineBreak: false });

				y += rh;
			}

			// Table bottom
			doc.moveTo(ML, y).lineTo(PW - MR, y).strokeColor(DARK).lineWidth(1.2).stroke();
			y += 18;

			// ===== TOTALS =====
			y = pageBreak(y, 70);

			let subtotal = 0;
			let taxTotal = 0;
			for (const item of lineItems) {
				const sub = (item.quantity * item.rate) / 100;
				const tr = item.taxRate ? item.taxRate / 100 : 0;
				let disc = 0;
				if (item.discountType === 'percent' && item.discount) disc = (sub * item.discount) / 100;
				else if (item.discountType === 'fixed' && item.discount) disc = item.discount / 100;
				const net = sub - disc;
				subtotal += net;
				taxTotal += taxType === 'apply' ? (net * tr) / 100 : 0;
			}

			let invDisc = 0;
			if (invoice.discountType && invoice.discountType !== 'none' && invoice.discountValue) {
				invDisc = invoice.discountType === 'percent'
					? (subtotal * invoice.discountValue) / 100
					: invoice.discountValue / 100;
			}

			const netTotal = subtotal - invDisc;
			const grand = netTotal + taxTotal;

			let xRate = 1;
			if (isMulti && invoice.exchangeRate) {
				const p = parseFloat(invoice.exchangeRate.replace(',', '.'));
				if (!isNaN(p) && p > 0) xRate = p;
			}

			const tLabelX = PW - MR - 260;
			const tValX = PW - MR - 110;
			const tValW = 110;

			function tRow(label: string, value: string, bold = false) {
				doc.fontSize(8).font(bold ? 'DejaVu-Bold' : 'DejaVu').fillColor(bold ? DARK : MUTED);
				doc.text(label, tLabelX, y, { width: 145, align: 'right', lineBreak: false });
				doc.fontSize(8.5).font(bold ? 'DejaVu-Bold' : 'DejaVu').fillColor(DARK);
				doc.text(value, tValX, y, { width: tValW, align: 'right', lineBreak: false });
				y += bold ? 16 : 13;
			}

			tRow('Total fara TVA:', `${fNum(netTotal)} ${calcCurr}`);
			if (isMulti) tRow('', `${fNum(netTotal * xRate)} ${invCurr}`, true);

			if (invDisc > 0) tRow('Discount:', `-${fNum(invDisc)} ${calcCurr}`);

			if (taxType === 'apply' && taxTotal > 0) {
				tRow('Total TVA:', `${fNum(taxTotal)} ${calcCurr}`);
				if (isMulti) tRow('', `${fNum(taxTotal * xRate)} ${invCurr}`, true);
			}

			// Grand total with accent background
			y += 2;
			const gtBoxW = 265;
			const gtBoxX = PW - MR - gtBoxW;
			doc.roundedRect(gtBoxX, y - 2, gtBoxW, 22, 3).fillColor(ACCENT).fill();
			doc.fontSize(9).font('DejaVu-Bold').fillColor(WHITE);
			doc.text('TOTAL:', gtBoxX + 5, y + 4, { width: gtBoxW / 2 - 10, lineBreak: false });
			doc.text(`${fNum(grand)} ${calcCurr}`, gtBoxX + gtBoxW / 2, y + 4, { width: gtBoxW / 2 - 5, align: 'right', lineBreak: false });
			y += 24;

			if (isMulti) {
				doc.fontSize(8.5).font('DejaVu-Bold').fillColor(DARK);
				doc.text(`${fNum(grand * xRate)} ${invCurr}`, tValX, y, { width: tValW, align: 'right', lineBreak: false });
				y += 16;
			}

			// ===== NOTES =====
			if (invoice.notes) {
				y = pageBreak(y, 40);
				y += 8;
				doc.fontSize(7.5).font('DejaVu').fillColor(MUTED);
				const notesH = doc.heightOfString(invoice.notes, { width: CW });
				doc.text(invoice.notes, ML, y, { width: CW, height: notesH + 2 });
				y += notesH + 10;
			}

			// ===== FOOTER =====
			footer();
			doc.end();
		} catch (error) {
			reject(error);
		}
	});
}
