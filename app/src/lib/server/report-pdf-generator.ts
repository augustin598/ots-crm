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
		// HEADER
		// ============================================================
		doc.font('Bold').fontSize(22).fillColor(ACCENT)
			.text('Raport Marketing', ML, y);
		y += 30;

		doc.font('Bold').fontSize(11).fillColor(DARK)
			.text(data.clientName, ML, y);
		y += 16;

		doc.font('Regular').fontSize(9).fillColor(MUTED)
			.text(`Perioadă: ${data.period.label}`, ML, y);
		y += 13;

		doc.font('Regular').fontSize(8).fillColor(LIGHT)
			.text(`Generat: ${data.generatedAt.toLocaleDateString('ro-RO', { day: 'numeric', month: 'long', year: 'numeric' })}`, ML, y);
		y += 8;

		// Accent line under header
		doc.moveTo(ML, y + 6).lineTo(ML + 60, y + 6).strokeColor(ACCENT).lineWidth(2).stroke();
		y += 20;

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

				// Platform name with color dot
				const dotColor = PLATFORM_COLORS[platform.name] || ACCENT;
				doc.circle(cx + 3, y + rowH / 2, 3).fill(dotColor);
				doc.font('Bold').fontSize(8).fillColor(DARK)
					.text(platform.name, cx + 12, y + 8, { width: cols[0].w - 20, align: 'left' });
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

				// Platform name
				doc.font('Bold').fontSize(9).fillColor(DARK)
					.text(platform.name, ML + 14, y + 10);

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
