import PDFDocument from 'pdfkit';
import { resolve } from 'path';
import { getDefaultContractClauses } from '$lib/contract-templates';
import {
	getZeroVatLegalNote,
	type ClientVatScenario
} from '$lib/server/vat/classify-client';

// ── Interfaces ──────────────────────────────────────────────────────────

interface ContractTenantData {
	name: string;
	companyType?: string | null;
	cui?: string | null;
	registrationNumber?: string | null;
	tradeRegister?: string | null;
	legalRepresentative?: string | null;
	iban?: string | null;
	ibanEuro?: string | null;
	bankName?: string | null;
	address?: string | null;
	city?: string | null;
	county?: string | null;
	postalCode?: string | null;
	country?: string | null;
	email?: string | null;
	phone?: string | null;
	themeColor?: string | null;
}

interface ContractClientData {
	name: string;
	businessName?: string | null;
	companyType?: string | null;
	cui?: string | null;
	registrationNumber?: string | null;
	tradeRegister?: string | null;
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

interface ContractData {
	contractNumber: string;
	contractDate: Date;
	contractTitle: string;
	serviceDescription?: string | null;
	offerLink?: string | null;
	currency: string;
	paymentTermsDays: number;
	penaltyRate: number; // basis points (50 = 0.5%)
	billingFrequency: string;
	contractDurationMonths: number;
	discountPercent?: number | null;
	prestatorEmail?: string | null;
	beneficiarEmail?: string | null;
	hourlyRate: number; // in cents (6000 = 60)
	hourlyRateCurrency: string;
	prestatorSignatureName?: string | null;
	beneficiarSignatureName?: string | null;
	prestatorSignatureImage?: string | null;
	beneficiarSignatureImage?: string | null;
	clausesJson?: string | null; // JSON string of ContractClause[]
}

interface ContractLineItemData {
	description: string;
	price: number; // in cents
	unitOfMeasure: string;
}

interface ContractClause {
	sectionNumber?: string;
	number?: string;
	title: string;
	paragraphs: string[];
}

export interface ContractPDFInput {
	contract: ContractData;
	lineItems: ContractLineItemData[];
	tenant: ContractTenantData;
	client: ContractClientData;
	taxRate?: number; // VAT percentage, e.g. 19 or 21
	vatScenario?: ClientVatScenario;
}

// ── Constants ───────────────────────────────────────────────────────────

const PW = 595.28;
const PH = 841.89;
const ML = 45;
const MR = 45;
const MT = 40;
const MB = 55;
const CW = PW - ML - MR;

const DEFAULT_ACCENT = '#3BA4DC';
const DARK = '#1E293B';
const TEXT = '#334155';
const MUTED = '#64748B';
const LIGHT = '#94A3B8';
const BORDER = '#CBD5E1';
const WHITE = '#FFFFFF';

const ASSETS_DIR = resolve(import.meta.dirname ?? '.', 'assets');
const LOGO_PATH = resolve(ASSETS_DIR, 'logo.png');
const FONT_REGULAR = resolve(ASSETS_DIR, 'DejaVuSans.ttf');
const FONT_BOLD = resolve(ASSETS_DIR, 'DejaVuSans-Bold.ttf');

// ── Helpers ─────────────────────────────────────────────────────────────

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

function translateBillingFrequency(freq: string): string {
	const map: Record<string, string> = {
		'monthly': 'lunară',
		'quarterly': 'trimestrială',
		'yearly': 'anuală',
		'one-time': 'o singură dată'
	};
	return map[freq] || freq;
}

function tenantAddr(t: ContractTenantData): string {
	return [t.address, t.city, t.county ? `Jud:${t.county}` : null, t.country]
		.filter(Boolean)
		.join(', ');
}

// ── Main generator ──────────────────────────────────────────────────────

export async function generateContractPDF(input: ContractPDFInput): Promise<Buffer> {
	return new Promise<Buffer>((resolve, reject) => {
		try {
			const { contract, lineItems, tenant, client, taxRate, vatScenario } = input;
			const ACCENT = tenant.themeColor || DEFAULT_ACCENT;

			const doc = new PDFDocument({
				size: 'A4',
				margins: { top: MT, bottom: 0, left: ML, right: MR },
				autoFirstPage: true,
				info: {
					Title: `Contract ${contract.contractNumber}`,
					Author: tenant.name
				}
			});

			// Register DejaVu Sans fonts for Romanian diacritics
			doc.registerFont('DejaVu', FONT_REGULAR);
			doc.registerFont('DejaVu-Bold', FONT_BOLD);

			const buffers: Buffer[] = [];
			doc.on('data', (c: Buffer) => buffers.push(c));
			doc.on('end', () => resolve(Buffer.concat(buffers)));
			doc.on('error', reject);

			let pg = 1;
			let y = MT;

			// ── Header (every page) ─────────────────────────────────────

			function drawHeader() {
				// Left side: company info
				let hy = MT + 2;

				doc.fontSize(8).font('DejaVu-Bold').fillColor(DARK);
				doc.text(tenant.name, ML, hy, { lineBreak: false });
				hy += 11;

				doc.fontSize(7).font('DejaVu').fillColor(MUTED);
				const cuiLine = [
					tenant.cui ? `CUI: ${tenant.cui}` : null,
					tenant.tradeRegister ? tenant.tradeRegister : null
				]
					.filter(Boolean)
					.join(' | ');
				if (cuiLine) {
					doc.text(cuiLine, ML, hy, { lineBreak: false });
					hy += 10;
				}

				if (tenant.iban && tenant.bankName) {
					doc.text(`${tenant.bankName} : LEI - ${tenant.iban}`, ML, hy, {
						lineBreak: false
					});
					hy += 10;
				}

				if (tenant.ibanEuro && tenant.bankName) {
					doc.text(`${tenant.bankName} : EURO - ${tenant.ibanEuro}`, ML, hy, {
						lineBreak: false
					});
					hy += 10;
				}

				if (tenant.address) {
					doc.text(tenant.address, ML, hy, { lineBreak: false });
					hy += 10;
				}

				const cityLine = [tenant.city, tenant.county ? `Jud:${tenant.county}` : null, tenant.country]
					.filter(Boolean)
					.join(', ');
				if (cityLine) {
					doc.text(cityLine, ML, hy, { lineBreak: false });
					hy += 10;
				}

				// Right side: Logo
				try {
					doc.image(LOGO_PATH, PW - MR - 80, MT + 2, { height: 32 });
				} catch {
					/* skip if logo missing */
				}

				// Bottom border line separating header from content
				const headerLineY = MT + 80;
				doc.moveTo(ML, headerLineY).lineTo(PW - MR, headerLineY).strokeColor(BORDER).lineWidth(0.5).stroke();
			}

			// ── Footer (every page) ─────────────────────────────────────

			function drawFooter() {
				const fy = PH - 40;
				doc.moveTo(ML, fy).lineTo(PW - MR, fy).strokeColor(BORDER).lineWidth(0.5).stroke();
				doc.fontSize(6.5).font('DejaVu').fillColor(LIGHT);
				doc.text(`Pagina ${pg}`, ML, fy + 6, { width: CW, align: 'right', lineBreak: false });
			}

			// ── Page management ─────────────────────────────────────────

			const CONTENT_BOTTOM = PH - MB - 10;

			function newPage(): number {
				drawFooter();
				doc.addPage();
				pg++;
				drawHeader();
				return MT + 85;
			}

			function ensureSpace(currentY: number, needed: number): number {
				if (currentY + needed > CONTENT_BOTTOM) {
					return newPage();
				}
				return currentY;
			}

			// ── Pre-compute totals (needed by interpolateVars below) ──
			let totalPrice = 0;
			for (const item of lineItems) totalPrice += item.price / 100;
			const discountPct = contract.discountPercent ?? 0;
			const discountedTotal = totalPrice * (1 - discountPct / 100);
			const effectiveTaxRate = taxRate ?? 0;
			const tvaAmount = effectiveTaxRate > 0 ? Math.round((discountedTotal * effectiveTaxRate) / 100 * 100) / 100 : 0;
			const totalWithTVA = Math.round((discountedTotal + tvaAmount) * 100) / 100;

			// ── Variable interpolation ──────────────────────────────────

			function interpolateVars(text: string): string {
				const penaltyPercent = (contract.penaltyRate / 100)
					.toLocaleString('ro-RO', { minimumFractionDigits: 1, maximumFractionDigits: 2 });
				const hourlyFormatted = fNum(contract.hourlyRate / 100);

				const vars: Record<string, string> = {
					// Contract
					contractDurationMonths: String(contract.contractDurationMonths),
					penaltyRate: penaltyPercent,
					prestatorEmail: contract.prestatorEmail || '',
					beneficiarEmail: contract.beneficiarEmail || '',
					hourlyRate: hourlyFormatted,
					hourlyRateCurrency: contract.hourlyRateCurrency || '',
					contractDate: fDate(contract.contractDate),
					paymentTermsDays: String(contract.paymentTermsDays),
					currency: contract.currency,
					billingFrequency: translateBillingFrequency(contract.billingFrequency),
					discountPercent: String(contract.discountPercent ?? 0),
					discountedTotal: fNum(discountedTotal),
					tvaRate: String(effectiveTaxRate),
					tvaAmount: fNum(tvaAmount),
					totalWithTVA: fNum(totalWithTVA),
					serviceDescription: contract.serviceDescription || '',
					offerLink: contract.offerLink || '',
					// Tenant (Prestator)
					tenantName: tenant.name,
					tenantCui: tenant.cui || '',
					tenantTradeRegister: tenant.tradeRegister || '',
					tenantIban: tenant.iban || '',
					tenantIbanEuro: tenant.ibanEuro || '',
					tenantBankName: tenant.bankName || '',
					tenantAddress: tenant.address || '',
					tenantCity: tenant.city || '',
					tenantCounty: tenant.county || '',
					tenantPostalCode: tenant.postalCode || '',
					tenantCountry: tenant.country || '',
					tenantPhone: tenant.phone || '',
					tenantEmail: tenant.email || '',
					tenantLegalRepresentative: tenant.legalRepresentative || '',
					// Client (Beneficiar)
					clientName: client.businessName || client.name,
					clientCui: client.cui || '',
					clientTradeRegister: client.tradeRegister || '',
					clientIban: client.iban || '',
					clientBankName: client.bankName || '',
					clientAddress: client.address || '',
					clientCity: client.city || '',
					clientCounty: client.county || '',
					clientPostalCode: client.postalCode || '',
					clientCountry: client.country || '',
					clientPhone: client.phone || '',
					clientEmail: client.email || '',
					clientLegalRepresentative: client.legalRepresentative || ''
				};

				let result = text;
				for (const [key, value] of Object.entries(vars)) {
					result = result.replace(new RegExp(`\\{${key}\\}`, 'g'), value);
				}
				// Backward compat: replace old "+ TVA" pattern with total including TVA
				if (effectiveTaxRate > 0) {
					result = result.replace(
						new RegExp(`${fNum(discountedTotal).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s+${contract.currency}\\s*\\+\\s*TVA`),
						`${fNum(totalWithTVA)} ${contract.currency} (inclusiv TVA ${effectiveTaxRate}%)`
					);
				}
				return result;
			}

			// ── Helper: render paragraph text with word wrap ────────────

			function renderParagraph(text: string, x: number, currentY: number, opts?: { width?: number; fontSize?: number; font?: string; color?: string; lineGap?: number; indent?: number }): number {
				const w = opts?.width ?? CW;
				const fs = opts?.fontSize ?? 8.5;
				const f = opts?.font ?? 'DejaVu';
				const c = opts?.color ?? TEXT;
				const lg = opts?.lineGap ?? 3;
				const indent = opts?.indent ?? 0;

				const interpolated = interpolateVars(text);

				doc.fontSize(fs).font(f).fillColor(c);
				const h = doc.heightOfString(interpolated, { width: w - indent, lineGap: lg });

				currentY = ensureSpace(currentY, h + 4);

				doc.fontSize(fs).font(f).fillColor(c);
				doc.text(interpolated, x + indent, currentY, { width: w - indent, lineGap: lg });

				return currentY + h + 4;
			}

			// ── Helper: render rich paragraph with **bold** segments ────
			function renderRichParagraph(text: string, x: number, currentY: number, opts?: { width?: number; fontSize?: number; color?: string; lineGap?: number; align?: string }): number {
				const w = opts?.width ?? CW;
				const fs = opts?.fontSize ?? 8.5;
				const c = opts?.color ?? TEXT;
				const lg = opts?.lineGap ?? 3;

				const interpolated = interpolateVars(text);

				// Estimate height using regular font (strip ** markers)
				doc.fontSize(fs).font('DejaVu').fillColor(c);
				const plainText = interpolated.replace(/\*\*/g, '');
				const h = doc.heightOfString(plainText, { width: w, lineGap: lg });
				currentY = ensureSpace(currentY, h + 4);

				// Split text by **bold** markers into typed segments
				const parts = interpolated.split(/(\*\*[^*]*\*\*)/g); // [^*]* catches empty bold segments
				const segments: Array<{ text: string; bold: boolean }> = [];
				for (const part of parts) {
					if (!part) continue;
					if (part.startsWith('**') && part.endsWith('**')) {
						const inner = part.slice(2, -2);
						if (!inner.trim()) continue; // skip empty bold segments (empty field values)
						segments.push({ text: inner, bold: true });
					} else {
						segments.push({ text: part, bold: false });
					}
				}

				// Render each segment with continued:true except the last one
				for (let i = 0; i < segments.length; i++) {
					const seg = segments[i];
					const isFirst = i === 0;
					const isLast = i === segments.length - 1;

					doc.fontSize(fs).font(seg.bold ? 'DejaVu-Bold' : 'DejaVu').fillColor(c);
					if (isFirst) {
						doc.text(seg.text, x, currentY, {
							width: w,
							lineGap: lg,
							continued: !isLast
						});
					} else {
						doc.text(seg.text, {
							lineGap: lg,
							continued: !isLast
						});
					}
				}

				// Safety: if no segments, just write empty text
				if (segments.length === 0) {
					doc.fontSize(fs).font('DejaVu').fillColor(c);
					doc.text('', x, currentY, { width: w });
				}

				return currentY + h + 4;
			}

			// ── Helper: render section heading ──────────────────────────

			function renderSectionHeading(text: string, currentY: number, opts?: { fontSize?: number }): number {
				const fs = opts?.fontSize ?? 10;
				doc.fontSize(fs).font('DejaVu-Bold').fillColor(DARK);
				const h = doc.heightOfString(text, { width: CW });
				currentY = ensureSpace(currentY, h + 8);
				doc.fontSize(fs).font('DejaVu-Bold').fillColor(DARK);
				doc.text(text, ML, currentY, { width: CW });
				return currentY + h + 8;
			}

			// ════════════════════════════════════════════════════════════
			// PAGE 1
			// ════════════════════════════════════════════════════════════

			drawHeader();
			y = MT + 85;

			// Contract number + date (centered)
			doc.fontSize(12).font('DejaVu-Bold').fillColor(DARK);
			doc.text(`NR ${contract.contractNumber} din ${fDate(contract.contractDate)}`, ML, y, {
				width: CW,
				align: 'center'
			});
			y += 20;

			// Contract title (centered, dark bold)
			doc.fontSize(14).font('DejaVu-Bold').fillColor(DARK);
			doc.text(`CONTRACT DE ${contract.contractTitle},`, ML, y, {
				width: CW,
				align: 'center'
			});
			y += 28;

			// ════════════════════════════════════════════════════════════
			// CLAUSES — all content is data-driven from clausesJson
			// Section 3 is special: pricing table is injected after heading
			// ════════════════════════════════════════════════════════════

			let clauses: ContractClause[] = [];
			if (contract.clausesJson) {
				try {
					clauses = JSON.parse(contract.clausesJson);
				} catch {
					/* ignore parse errors */
				}
			}

			// Backward compatibility: contracte vechi au clausesJson doar cu secțiunile 4-23.
			// Dacă lipsesc secțiunile 1, 2 sau 3, le adăugăm automat din template-ul implicit.
			const defaultSections = getDefaultContractClauses();
			for (const sectionNum of ['1', '2', '3']) {
				const exists = clauses.some((c) => (c.sectionNumber || c.number) === sectionNum);
				if (!exists) {
					const defaultSection = defaultSections.find((c) => c.number === sectionNum);
					if (defaultSection) {
						const insertAt = clauses.findIndex(
							(c) => Number(c.sectionNumber || c.number) > Number(sectionNum)
						);
						if (insertAt === -1) {
							clauses.push(defaultSection);
						} else {
							clauses.splice(insertAt, 0, defaultSection);
						}
					}
				}
			}

			// Backward compat: inject offerLink paragraph into section 2 if missing
			if (contract.offerLink) {
				const section2 = clauses.find((c) => (c.sectionNumber || c.number) === '2');
				if (section2) {
					const hasOfferLink = section2.paragraphs.some((p: string) => p.includes('{offerLink}'));
					if (!hasOfferLink) {
						// Insert before the last paragraph (the disclaimer)
						const insertIdx = Math.max(0, section2.paragraphs.length - 1);
						section2.paragraphs.splice(insertIdx, 0, '• Oferta comercială detaliată poate fi consultată la adresa: **{offerLink}**');
					}
				}
			}

			for (const clause of clauses) {
				y += 6;

				// Render section heading from clausesJson
				const sNum = clause.sectionNumber || clause.number || '';
				const heading = `${sNum}. ${clause.title}`;
				const headingFontSize = ['1', '2', '3'].includes(sNum) ? 11 : 10;
				y = ensureSpace(y, 40);
				y = renderSectionHeading(heading, y, { fontSize: headingFontSize });

				// Section 3: inject pricing table between heading and paragraphs
				if (sNum === '3') {
					const colServiceW = CW * 0.50;
					const colPriceW = CW * 0.25;
					const colUnitW = CW * 0.25;
					const tableHH = 22;

					y = ensureSpace(y, tableHH + 30);

					// Header row
					doc.rect(ML, y, CW, tableHH).fillColor(ACCENT).fill();
					doc.fontSize(8).font('DejaVu-Bold').fillColor(WHITE);
					doc.text('Servicii', ML + 6, y + 6, { width: colServiceW - 12, lineBreak: false });
					doc.text('Preț', ML + colServiceW + 6, y + 6, { width: colPriceW - 12, align: 'center', lineBreak: false });
					doc.text('Unitate de masura', ML + colServiceW + colPriceW + 6, y + 6, { width: colUnitW - 12, align: 'center', lineBreak: false });
					y += tableHH;

					// Data rows
					for (const item of lineItems) {
						const priceValue = item.price / 100;
						doc.fontSize(8).font('DejaVu').fillColor(DARK);
						const descH = doc.heightOfString(item.description, { width: colServiceW - 12 });
						const rowH = Math.max(20, descH + 8);
						y = ensureSpace(y, rowH);
						doc.moveTo(ML, y + rowH).lineTo(PW - MR, y + rowH).strokeColor(BORDER).lineWidth(0.3).stroke();
						doc.fontSize(8).font('DejaVu').fillColor(DARK);
						doc.text(item.description, ML + 6, y + 4, { width: colServiceW - 12 });
						doc.text(`${fNum(priceValue)} ${contract.currency}`, ML + colServiceW + 6, y + 4, { width: colPriceW - 12, align: 'center', lineBreak: false });
						doc.text(item.unitOfMeasure, ML + colServiceW + colPriceW + 6, y + 4, { width: colUnitW - 12, align: 'center', lineBreak: false });
						y += rowH;
					}

					// Total (fara TVA) row
					y = ensureSpace(y, effectiveTaxRate > 0 ? (24 + 2) * 3 + 16 : 24 + 16);
					y += 2;
					const totalRowH = 24;
					doc.rect(ML, y, CW, totalRowH).fillColor(ACCENT).fill();
					doc.fontSize(9).font('DejaVu-Bold').fillColor(WHITE);
					const totalLabel = discountPct > 0 ? `Total cu DISCOUNT ${discountPct}%` : 'Total';
					doc.text(totalLabel, ML + 6, y + 6, { width: colServiceW - 12, lineBreak: false });
					doc.text(`${fNum(discountedTotal)} ${contract.currency}`, ML + colServiceW + 6, y + 6, { width: colPriceW - 12, align: 'center', lineBreak: false });
					y += totalRowH;

					// TVA row
					if (effectiveTaxRate > 0) {
						y += 2;
						doc.rect(ML, y, CW, totalRowH).fillColor('#E8F4FD').fill();
						doc.fontSize(9).font('DejaVu-Bold').fillColor(DARK);
						doc.text(`TVA (${effectiveTaxRate}%)`, ML + 6, y + 6, { width: colServiceW - 12, lineBreak: false });
						doc.text(`${fNum(tvaAmount)} ${contract.currency}`, ML + colServiceW + 6, y + 6, { width: colPriceW - 12, align: 'center', lineBreak: false });
						y += totalRowH;

						// Total cu TVA row
						y += 2;
						doc.rect(ML, y, CW, totalRowH).fillColor(ACCENT).fill();
						doc.fontSize(9).font('DejaVu-Bold').fillColor(WHITE);
						doc.text('Total cu TVA', ML + 6, y + 6, { width: colServiceW - 12, lineBreak: false });
						doc.text(`${fNum(totalWithTVA)} ${contract.currency}`, ML + colServiceW + 6, y + 6, { width: colPriceW - 12, align: 'center', lineBreak: false });
						y += totalRowH;
					}

					// Zero-VAT legal note (intracom / export) — only when no VAT was applied
					if (effectiveTaxRate === 0 && vatScenario) {
						const legalNote = getZeroVatLegalNote(vatScenario);
						if (legalNote) {
							y += 8;
							doc.fontSize(7.5).font('DejaVu').fillColor(MUTED);
							const noteHeight = doc.heightOfString(`Notă: ${legalNote}`, { width: CW });
							y = ensureSpace(y, noteHeight + 4);
							doc.text(`Notă: ${legalNote}`, ML, y, { width: CW });
							y += noteHeight;
						}
					}

					y += 16;
				}

				// Render paragraphs from clausesJson
				for (const para of clause.paragraphs) {
					// [center]text — render centered (used for "și" separator in section 1)
					if (para.startsWith('[center]')) {
						const centerText = interpolateVars(para.slice('[center]'.length));
						y = ensureSpace(y, 20);
						doc.fontSize(9).font('DejaVu-Bold').fillColor(DARK);
						doc.text(centerText, ML, y, { width: CW, align: 'center' });
						y += 16;
						continue;
					}

					// [if:varName] — conditional paragraph, skip if variable is empty
					if (para.startsWith('[if:')) {
						const endBracket = para.indexOf(']');
						const varName = para.slice(4, endBracket);
						const varValue = contract[varName as keyof typeof contract];
						if (!varValue) continue;
						const cleanPara = para.slice(endBracket + 1);
						const interpolated = interpolateVars(cleanPara);
						if (!interpolated.trim()) continue;
						y = ensureSpace(y, 16);
						y = renderParagraph(interpolated, ML, y);
						continue;
					}

					// Skip paragraphs that are empty after interpolation
					const interpolated = interpolateVars(para);
					if (!interpolated.trim()) continue;

					const isBullet = interpolated.trimStart().startsWith('\u2022') || interpolated.trimStart().startsWith('-');
					const indent = isBullet ? 15 : 0;
					const hasBold = para.includes('**');

					if (hasBold) {
						y = renderRichParagraph(para, ML, y, { fontSize: 8.5, color: TEXT });
					} else {
						y = renderParagraph(para, ML, y, { fontSize: 8.5, font: 'DejaVu', color: TEXT, indent });
					}
				}
			}

			// ════════════════════════════════════════════════════════════
			// SIGNATURE BLOCK
			// ════════════════════════════════════════════════════════════

			y += 20;
			y = ensureSpace(y, 110);

			const sigColW = CW / 2;
			const sigLeftX = ML;
			const sigRightX = ML + sigColW;
			const sigImgW = sigColW - 20;
			const sigImgH = 48;

			// Helper: convert base64 PNG data URL to Buffer
			function dataUrlToBuffer(dataUrl: string | null | undefined): Buffer | null {
				if (!dataUrl?.startsWith('data:image/png;base64,')) return null;
				try { return Buffer.from(dataUrl.split(',')[1], 'base64'); }
				catch { return null; }
			}

			// Column headers
			doc.fontSize(10).font('DejaVu-Bold').fillColor(DARK);
			doc.text('Companie', sigLeftX, y, { lineBreak: false });
			doc.text('Beneficiar', sigRightX, y, { lineBreak: false });

			y += 16;

			// Company names
			doc.fontSize(9).font('DejaVu-Bold').fillColor(DARK);
			doc.text(tenant.name, sigLeftX, y, { width: sigColW - 10 });
			doc.text(client.businessName || client.name, sigRightX, y, { width: sigColW - 10 });

			y += 16;

			// Signature images or blank lines
			const prestatorImgBuf = dataUrlToBuffer(contract.prestatorSignatureImage);
			const beneficiarImgBuf = dataUrlToBuffer(contract.beneficiarSignatureImage);

			if (prestatorImgBuf) {
				doc.image(prestatorImgBuf, sigLeftX, y, { width: sigImgW, height: sigImgH });
			} else {
				doc.moveTo(sigLeftX, y + sigImgH - 4).lineTo(sigLeftX + sigImgW, y + sigImgH - 4)
					.strokeColor('#cccccc').lineWidth(0.5).stroke().strokeColor(DARK).lineWidth(1);
			}

			if (beneficiarImgBuf) {
				doc.image(beneficiarImgBuf, sigRightX, y, { width: sigImgW, height: sigImgH });
			} else {
				doc.moveTo(sigRightX, y + sigImgH - 4).lineTo(sigRightX + sigImgW, y + sigImgH - 4)
					.strokeColor('#cccccc').lineWidth(0.5).stroke().strokeColor(DARK).lineWidth(1);
			}

			y += sigImgH + 6;

			// Administrator names below the signatures
			doc.fontSize(8.5).font('DejaVu').fillColor(TEXT);
			doc.text(
				`Administrator: ${contract.prestatorSignatureName || tenant.legalRepresentative || ''}`,
				sigLeftX, y, { width: sigColW - 10 }
			);
			doc.text(
				`Administrator: ${contract.beneficiarSignatureName || client.legalRepresentative || ''}`,
				sigRightX, y, { width: sigColW - 10 }
			);

			// ── Final footer and close ──────────────────────────────────

			drawFooter();
			doc.end();
		} catch (error) {
			reject(error);
		}
	});
}
