import PDFDocument from 'pdfkit';
import { resolve } from 'path';
import { existsSync } from 'fs';

function resolveAssetsDir(): string {
	const dir = import.meta.dirname ?? '.';
	const sameLevel = resolve(dir, 'assets');
	if (existsSync(sameLevel)) return sameLevel;
	return resolve(dir, '..', 'assets');
}

const ASSETS_DIR = resolveAssetsDir();
const FONT_REGULAR = resolve(ASSETS_DIR, 'DejaVuSans.ttf');
const FONT_BOLD = resolve(ASSETS_DIR, 'DejaVuSans-Bold.ttf');
const DEFAULT_LOGO = resolve(ASSETS_DIR, 'logo.png');

// A4
const PW = 595.28;
const PH = 841.89;
const ML = 45;
const MR = 45;
const MT = 40;
const CW = PW - ML - MR;

// Colors
const ACCENT = '#3B82F6';
const DARK = '#1E293B';
const TEXT = '#334155';
const MUTED = '#64748B';
const LIGHT = '#94A3B8';
const BORDER = '#CBD5E1';
const SOFT_BG = '#F1F5F9';
const WHITE = '#FFFFFF';

// Platform brand colors
const PLATFORM_COLORS: Record<string, string> = {
	'Meta Ads': '#1877F2',
	'Google Ads': '#3C8BD9',
	'TikTok Ads': '#000000'
};

export interface ReportPlatformData {
	name: string;
	spend: number;
	impressions: number;
	clicks: number;
	conversions: number;
	currency: string;
}

export interface ReportPdfData {
	tenantName: string;
	clientName: string;
	period: { since: string; until: string; label: string };
	platforms: ReportPlatformData[];
	generatedAt: Date;
	tenantLogo?: string | null; // base64 encoded logo or null for default
}

function fmtNum(n: number): string {
	return n.toLocaleString('ro-RO', { maximumFractionDigits: 0 });
}

function fmtAmount(n: number, currency: string): string {
	return n.toLocaleString('ro-RO', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' ' + currency;
}

function fmtPct(n: number): string {
	return n.toLocaleString('ro-RO', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + '%';
}

function roundedRect(doc: PDFKit.PDFDocument, x: number, y: number, w: number, h: number, r: number, color: string) {
	doc.save();
	doc.roundedRect(x, y, w, h, r).fill(color);
	doc.restore();
}

/** Draw the Meta (Facebook) logo at given position */
function drawMetaLogo(doc: PDFKit.PDFDocument, x: number, y: number, size: number) {
	const s = size / 80;
	doc.save();
	doc.translate(x, y);
	doc.scale(s);
	doc.path('M77,37.5c0-20.4-16.6-37-37-37S3,17.1,3,37.5C3,56,16.5,71.3,34.2,74.1V48.2h-9.4V37.5h9.4v-8.2c0-9.3,5.5-14.4,14-14.4c4,0,8.3,0.7,8.3,0.7v9.1h-4.7c-4.6,0-6,2.9-6,5.8v6.9H56l-1.6,10.7h-8.6v25.9C63.5,71.3,77,56,77,37.5z').fill('#1877F2');
	doc.path('M54.4,48.2L56,37.5H45.8v-6.9c0-2.9,1.4-5.8,6-5.8h4.7v-9.1c0,0-4.2-0.7-8.3-0.7c-8.5,0-14,5.1-14,14.4v8.2h-9.4v10.7h9.4v25.9c1.9,0.3,3.8,0.4,5.8,0.4s3.9-0.2,5.8-0.4V48.2H54.4z').fill('#FFFFFF');
	doc.restore();
}

/** Draw the Google Ads logo at given position */
function drawGoogleLogo(doc: PDFKit.PDFDocument, x: number, y: number, size: number) {
	const s = size / 80;
	doc.save();
	doc.translate(x, y);
	doc.scale(s);
	doc.path('M27.2,9.2c0.8-2,1.8-3.9,3.4-5.4c6.3-6.2,16.8-4.6,21,3.1c3.2,5.9,6.6,11.6,10,17.4c5.5,9.6,11.1,19.3,16.6,28.9c4.6,8.1-0.4,18.3-9.5,19.7c-5.6,0.8-10.9-1.7-13.8-6.8c-4.9-8.5-9.8-16.9-14.6-25.4c-0.1-0.2-0.2-0.4-0.4-0.5c-0.5-0.4-0.7-1-1.1-1.6c-2.2-3.8-4.4-7.6-6.5-11.3c-1.4-2.4-2.8-4.9-4.2-7.3c-1.3-2.2-1.8-4.6-1.8-7.1C26.5,11.7,26.6,10.4,27.2,9.2').fill('#3C8BD9');
	doc.path('M27.2,9.2c-0.3,1.2-0.5,2.3-0.6,3.5c-0.1,2.7,0.6,5.2,1.9,7.6c3.5,6.1,7.1,12.2,10.6,18.3c0.3,0.5,0.6,1.1,0.9,1.6c-1.9,3.4-3.9,6.7-5.8,10c-2.7,4.7-5.4,9.4-8.2,14c-0.1,0-0.2-0.1-0.2-0.2c0-0.3,0.1-0.5,0.1-0.7c1.3-4.8,0.2-9.1-3.1-12.8c-2-2.2-4.6-3.5-7.6-3.9c-3.9-0.5-7.3,0.5-10.3,2.9c-0.5,0.4-0.9,1-1.5,1.4c-0.1,0-0.2-0.1-0.2-0.2c1.5-2.7,3.1-5.3,4.6-8C14.2,31.7,20.6,20.6,27,9.6C27.1,9.4,27.2,9.3,27.2,9.2').fill('#FABC04');
	doc.path('M3.3,50.9c0.6-0.5,1.2-1.1,1.8-1.6c7.8-6.2,19.6-1.7,21.3,8.1c0.4,2.4,0.2,4.6-0.5,6.9c0,0.2-0.1,0.4-0.1,0.5c-0.3,0.5-0.5,1.1-0.9,1.6c-2.9,4.7-7.1,7.1-12.6,6.7C6,72.6,1,67.8,0.1,61.5c-0.4-3.1,0.2-5.9,1.8-8.6c0.3-0.6,0.7-1.1,1.1-1.7C3.1,51.2,3.1,50.9,3.3,50.9').fill('#34A852');
	doc.restore();
}

/** Draw the TikTok logo at given position */
function drawTikTokLogo(doc: PDFKit.PDFDocument, x: number, y: number, size: number) {
	const s = size / 512;
	doc.save();
	doc.translate(x, y);
	doc.scale(s);
	doc.path('M412.19,118.66a109.27,109.27,0,0,1-9.45-5.5,132.87,132.87,0,0,1-24.27-20.62c-18.1-20.71-24.86-41.72-27.35-56.43h.1C349.14,23.9,350,16,350.13,16H267.69V334.78c0,4.28,0,8.51-.18,12.69,0,.52-.05,1-.08,1.56,0,.23,0,.47-.05.71,0,.06,0,.12,0,.18a70,70,0,0,1-35.22,55.56,68.8,68.8,0,0,1-34.11,9c-38.41,0-69.54-31.32-69.54-70s31.13-70,69.54-70a68.9,68.9,0,0,1,21.41,3.39l.1-83.94a153.14,153.14,0,0,0-118,34.52,161.79,161.79,0,0,0-35.3,43.53c-3.48,6-16.61,30.11-18.2,69.24-1,22.21,5.67,45.22,8.85,54.73v.2c2,5.6,9.75,24.71,22.38,40.82A167.53,167.53,0,0,0,115,470.66v-.2l.2.2C155.11,497.78,199.36,496,199.36,496c7.66-.31,33.32,0,62.46-13.81,32.32-15.31,50.72-38.12,50.72-38.12a158.46,158.46,0,0,0,27.64-45.93c7.46-19.61,9.95-43.13,9.95-52.53V176.49c1,.6,14.32,9.41,14.32,9.41s19.19,12.3,49.13,20.31c21.48,5.7,50.42,6.9,50.42,6.9V131.27C453.86,132.37,433.27,129.17,412.19,118.66Z').fill('#000000');
	doc.restore();
}

/** Draw platform logo by name */
function drawPlatformLogo(doc: PDFKit.PDFDocument, name: string, x: number, y: number, size: number) {
	if (name === 'Meta Ads') drawMetaLogo(doc, x, y, size);
	else if (name === 'Google Ads') drawGoogleLogo(doc, x, y, size);
	else if (name === 'TikTok Ads') drawTikTokLogo(doc, x, y, size);
}

export async function generateReportPdf(data: ReportPdfData): Promise<Buffer> {
	return new Promise((resolve, reject) => {
		const doc = new PDFDocument({ size: 'A4', margin: ML, bufferPages: true });
		const chunks: Buffer[] = [];

		doc.on('data', (chunk: Buffer) => chunks.push(chunk));
		doc.on('end', () => resolve(Buffer.concat(chunks)));
		doc.on('error', reject);

		doc.registerFont('Regular', FONT_REGULAR);
		doc.registerFont('Bold', FONT_BOLD);

		let y = MT;

		// ============================================================
		// TOP ACCENT BAR
		// ============================================================
		doc.rect(0, 0, PW, 4).fill(ACCENT);
		y = MT + 8;

		// ============================================================
		// HEADER — logo left, title right (matching invoice pattern)
		// ============================================================
		const logoH = 32;
		try {
			if (data.tenantLogo) {
				const base64Data = data.tenantLogo.replace(/^data:image\/\w+;base64,/, '');
				const logoBuffer = Buffer.from(base64Data, 'base64');
				doc.image(logoBuffer, ML, y + 2, { height: logoH });
			} else if (existsSync(DEFAULT_LOGO)) {
				doc.image(DEFAULT_LOGO, ML, y + 2, { height: logoH });
			}
		} catch { /* skip logo on error */ }

		doc.font('Bold').fontSize(22).fillColor(ACCENT)
			.text('Raport Marketing', ML, y, { width: CW, align: 'right' });
		y += 50;

		// Accent line under header
		doc.moveTo(ML, y).lineTo(PW - MR, y).strokeColor(ACCENT).lineWidth(2).stroke();
		y += 15;

		// ============================================================
		// TWO COLUMNS: Client | Detalii Raport
		// ============================================================
		const col1X = ML;
		const col2X = ML + CW / 2 + 15;
		const colW = CW / 2 - 15;
		const sectionStart = y;

		// Left: CLIENT
		doc.font('Bold').fontSize(7).fillColor(ACCENT)
			.text('CLIENT', col1X, y);
		y += 12;

		doc.font('Bold').fontSize(9.5).fillColor(DARK)
			.text(data.clientName, col1X, y, { width: colW });
		y += 16;

		// Right: DETALII RAPORT
		let yr = sectionStart;
		doc.font('Bold').fontSize(7).fillColor(ACCENT)
			.text('DETALII RAPORT', col2X, yr);
		yr += 14;

		const meta: [string, string][] = [
			['Perioadă', data.period.label],
			['Generat', data.generatedAt.toLocaleDateString('ro-RO', { day: 'numeric', month: 'long', year: 'numeric' })],
			['Platforme', data.platforms.map((p) => p.name).join(', ') || '—']
		];

		for (const [label, val] of meta) {
			doc.font('Regular').fontSize(7.5).fillColor(MUTED)
				.text(label, col2X, yr, { width: 65, continued: false });
			doc.font('Bold').fontSize(7.5).fillColor(DARK)
				.text(val, col2X + 67, yr, { width: colW - 67, align: 'right' });
			yr += 13;
		}

		y = Math.max(y, yr) + 12;

		// Thin separator
		doc.moveTo(ML, y).lineTo(PW - MR, y).strokeColor(BORDER).lineWidth(0.5).stroke();
		y += 16;

		// ============================================================
		// SUMMARY KPI CARDS
		// ============================================================
		const totalSpend = data.platforms.reduce((s, p) => s + p.spend, 0);
		const totalImpressions = data.platforms.reduce((s, p) => s + p.impressions, 0);
		const totalClicks = data.platforms.reduce((s, p) => s + p.clicks, 0);
		const totalConversions = data.platforms.reduce((s, p) => s + p.conversions, 0);
		const mainCurrency = data.platforms[0]?.currency || 'RON';
		const ctr = totalImpressions > 0 ? (totalClicks / totalImpressions) * 100 : 0;
		const cpc = totalClicks > 0 ? totalSpend / totalClicks : 0;

		const kpis = [
			{ label: 'Cheltuieli totale', value: fmtAmount(totalSpend, mainCurrency), accent: true },
			{ label: 'Impresii', value: fmtNum(totalImpressions), accent: false },
			{ label: 'Click-uri', value: fmtNum(totalClicks), accent: false },
			{ label: 'CTR', value: totalImpressions > 0 ? fmtPct(ctr) : '—', accent: false },
			{ label: 'CPC mediu', value: totalClicks > 0 ? fmtAmount(cpc, mainCurrency) : '—', accent: false },
			{ label: 'Conversii', value: totalConversions > 0 ? fmtNum(totalConversions) : '—', accent: false }
		];

		// Draw KPI grid (2 rows x 3 columns)
		const kpiW = (CW - 16) / 3;
		const kpiH = 52;
		const kpiGap = 8;

		for (let i = 0; i < kpis.length; i++) {
			const col = i % 3;
			const row = Math.floor(i / 3);
			const kx = ML + col * (kpiW + kpiGap);
			const ky = y + row * (kpiH + kpiGap);

			// Card background
			if (kpis[i].accent) {
				roundedRect(doc, kx, ky, kpiW, kpiH, 4, ACCENT);
				doc.font('Regular').fontSize(7).fillColor('#FFFFFFCC')
					.text(kpis[i].label, kx + 10, ky + 10, { width: kpiW - 20 });
				doc.font('Bold').fontSize(13).fillColor(WHITE)
					.text(kpis[i].value, kx + 10, ky + 24, { width: kpiW - 20 });
			} else {
				roundedRect(doc, kx, ky, kpiW, kpiH, 4, SOFT_BG);
				doc.font('Regular').fontSize(7).fillColor(MUTED)
					.text(kpis[i].label, kx + 10, ky + 10, { width: kpiW - 20 });
				doc.font('Bold').fontSize(13).fillColor(DARK)
					.text(kpis[i].value, kx + 10, ky + 24, { width: kpiW - 20 });
			}
		}

		y += 2 * (kpiH + kpiGap) + 12;

		// ============================================================
		// PLATFORM DETAILS TABLE
		// ============================================================
		if (data.platforms.length > 0) {
			// Section title
			doc.font('Bold').fontSize(11).fillColor(DARK)
				.text('Detalii per Platformă', ML, y);
			y += 22;

			// Table columns
			const cols = [
				{ label: 'Platformă', w: 110, align: 'left' as const },
				{ label: 'Cheltuieli', w: 90, align: 'right' as const },
				{ label: 'Impresii', w: 70, align: 'right' as const },
				{ label: 'Click-uri', w: 60, align: 'right' as const },
				{ label: 'CPC', w: 70, align: 'right' as const },
				{ label: 'CTR', w: 55, align: 'right' as const },
				{ label: 'Conversii', w: 55, align: 'right' as const }
			];

			const rowH = 24;

			// Table header
			roundedRect(doc, ML, y, CW, rowH, 3, ACCENT);
			let cx = ML + 8;
			for (const col of cols) {
				doc.font('Bold').fontSize(7.5).fillColor(WHITE)
					.text(col.label, cx, y + 8, { width: col.w - 12, align: col.align });
				cx += col.w;
			}
			y += rowH + 1;

			// Data rows
			for (let i = 0; i < data.platforms.length; i++) {
				const platform = data.platforms[i];
				const pCpc = platform.clicks > 0 ? platform.spend / platform.clicks : 0;
				const pCtr = platform.impressions > 0 ? (platform.clicks / platform.impressions) * 100 : 0;

				// Alternating row background
				if (i % 2 === 0) {
					roundedRect(doc, ML, y, CW, rowH, 0, SOFT_BG);
				}

				cx = ML + 8;

				// Platform name with logo
				drawPlatformLogo(doc, platform.name, cx, y + 5, 14);
				doc.font('Bold').fontSize(8).fillColor(DARK)
					.text(platform.name, cx + 18, y + 8, { width: cols[0].w - 26, align: 'left' });
				cx += cols[0].w;

				const rowData = [
					fmtAmount(platform.spend, platform.currency),
					fmtNum(platform.impressions),
					fmtNum(platform.clicks),
					pCpc > 0 ? fmtAmount(pCpc, platform.currency) : '—',
					pCtr > 0 ? fmtPct(pCtr) : '—',
					platform.conversions > 0 ? fmtNum(platform.conversions) : '—'
				];

				for (let j = 0; j < rowData.length; j++) {
					doc.font('Regular').fontSize(8).fillColor(TEXT)
						.text(rowData[j], cx, y + 8, { width: cols[j + 1].w - 12, align: 'right' });
					cx += cols[j + 1].w;
				}

				y += rowH;
			}

			// Total row
			y += 2;
			roundedRect(doc, ML, y, CW, rowH + 2, 3, DARK);
			cx = ML + 8;

			doc.font('Bold').fontSize(8).fillColor(WHITE)
				.text('TOTAL', cx, y + 9, { width: cols[0].w - 12, align: 'left' });
			cx += cols[0].w;

			const totalRow = [
				fmtAmount(totalSpend, mainCurrency),
				fmtNum(totalImpressions),
				fmtNum(totalClicks),
				totalClicks > 0 ? fmtAmount(totalSpend / totalClicks, mainCurrency) : '—',
				totalImpressions > 0 ? fmtPct((totalClicks / totalImpressions) * 100) : '—',
				totalConversions > 0 ? fmtNum(totalConversions) : '—'
			];

			for (let j = 0; j < totalRow.length; j++) {
				doc.font('Bold').fontSize(8).fillColor(WHITE)
					.text(totalRow[j], cx, y + 9, { width: cols[j + 1].w - 12, align: 'right' });
				cx += cols[j + 1].w;
			}

			y += rowH + 20;
		}

		// ============================================================
		// PER-PLATFORM BREAKDOWN CARDS (if multiple platforms)
		// ============================================================
		if (data.platforms.length > 1) {
			for (const platform of data.platforms) {
				// Check if we need a new page
				if (y + 80 > PH - 60) {
					doc.addPage();
					doc.rect(0, 0, PW, 4).fill(ACCENT);
					y = MT + 10;
				}

				const pCpc = platform.clicks > 0 ? platform.spend / platform.clicks : 0;
				const pCtr = platform.impressions > 0 ? (platform.clicks / platform.impressions) * 100 : 0;
				const dotColor = PLATFORM_COLORS[platform.name] || ACCENT;
				const cardH = 58;

				// Card outline
				doc.save();
				doc.roundedRect(ML, y, CW, cardH, 4)
					.lineWidth(0.5).strokeColor(BORDER).stroke();
				doc.restore();

				// Left accent stripe
				doc.save();
				doc.rect(ML, y + 4, 3, cardH - 8).fill(dotColor);
				doc.restore();

				// Platform logo + name
				drawPlatformLogo(doc, platform.name, ML + 14, y + 7, 16);
				doc.font('Bold').fontSize(9).fillColor(DARK)
					.text(platform.name, ML + 34, y + 10);

				// Mini KPIs inside card
				const miniKpis = [
					{ label: 'Cheltuieli', value: fmtAmount(platform.spend, platform.currency) },
					{ label: 'Impresii', value: fmtNum(platform.impressions) },
					{ label: 'Click-uri', value: fmtNum(platform.clicks) },
					{ label: 'CPC', value: pCpc > 0 ? fmtAmount(pCpc, platform.currency) : '—' },
					{ label: 'CTR', value: pCtr > 0 ? fmtPct(pCtr) : '—' }
				];

				if (platform.conversions > 0) {
					miniKpis.push({ label: 'Conversii', value: fmtNum(platform.conversions) });
				}

				const miniW = (CW - 28) / miniKpis.length;
				for (let k = 0; k < miniKpis.length; k++) {
					const mx = ML + 14 + k * miniW;
					doc.font('Regular').fontSize(6.5).fillColor(MUTED)
						.text(miniKpis[k].label, mx, y + 28, { width: miniW - 4 });
					doc.font('Bold').fontSize(9).fillColor(DARK)
						.text(miniKpis[k].value, mx, y + 38, { width: miniW - 4 });
				}

				y += cardH + 8;
			}
		}

		// ============================================================
		// "NO DATA" STATE
		// ============================================================
		if (data.platforms.length === 0) {
			y += 20;
			roundedRect(doc, ML, y, CW, 60, 4, SOFT_BG);
			doc.font('Regular').fontSize(10).fillColor(MUTED)
				.text('Nu există date de cheltuieli pentru perioada selectată.', ML + 20, y + 22, {
					width: CW - 40,
					align: 'center'
				});
			y += 80;
		}

		// ============================================================
		// FOOTER
		// ============================================================
		// Bottom accent line
		doc.moveTo(ML, PH - 45).lineTo(PW - MR, PH - 45).strokeColor(BORDER).lineWidth(0.5).stroke();

		doc.font('Regular').fontSize(7).fillColor(LIGHT)
			.text(data.tenantName, ML, PH - 36);

		doc.font('Regular').fontSize(7).fillColor(LIGHT)
			.text('Raport generat automat', PW - MR - 120, PH - 36, { width: 120, align: 'right' });

		doc.end();
	});
}
