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
const ML = 45;
const MR = 45;
const MT = 40;
const CW = PW - ML - MR;

// Colors
const DARK = '#1E293B';
const TEXT = '#334155';
const MUTED = '#64748B';
const BORDER = '#CBD5E1';
const SOFT_BG = '#F1F5F9';
const ACCENT = '#3B82F6';

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

export async function generateReportPdf(data: ReportPdfData): Promise<Buffer> {
	return new Promise((resolve, reject) => {
		const doc = new PDFDocument({ size: 'A4', margin: ML, bufferPages: true });
		const chunks: Buffer[] = [];

		doc.on('data', (chunk: Buffer) => chunks.push(chunk));
		doc.on('end', () => resolve(Buffer.concat(chunks)));
		doc.on('error', reject);

		// Register fonts
		doc.registerFont('Regular', FONT_REGULAR);
		doc.registerFont('Bold', FONT_BOLD);

		let y = MT;

		// ---- Header ----
		doc.font('Bold').fontSize(20).fillColor(DARK)
			.text('Raport Marketing', ML, y);
		y += 28;

		doc.font('Regular').fontSize(12).fillColor(MUTED)
			.text(data.clientName, ML, y);
		y += 18;

		doc.font('Regular').fontSize(10).fillColor(MUTED)
			.text(`Perioadă: ${data.period.label}`, ML, y);
		y += 14;

		doc.font('Regular').fontSize(9).fillColor(MUTED)
			.text(`Generat: ${data.generatedAt.toLocaleDateString('ro-RO', { day: 'numeric', month: 'long', year: 'numeric' })}`, ML, y);
		y += 30;

		// ---- Separator ----
		doc.moveTo(ML, y).lineTo(PW - MR, y).strokeColor(BORDER).lineWidth(1).stroke();
		y += 20;

		// ---- KPI Summary ----
		const totalSpend = data.platforms.reduce((s, p) => s + p.spend, 0);
		const totalImpressions = data.platforms.reduce((s, p) => s + p.impressions, 0);
		const totalClicks = data.platforms.reduce((s, p) => s + p.clicks, 0);
		const totalConversions = data.platforms.reduce((s, p) => s + p.conversions, 0);
		const mainCurrency = data.platforms[0]?.currency || 'RON';

		doc.font('Bold').fontSize(11).fillColor(DARK)
			.text('Sumar General', ML, y);
		y += 18;

		const kpis = [
			{ label: 'Cheltuieli totale', value: fmtAmount(totalSpend, mainCurrency) },
			{ label: 'Impresii', value: fmtNum(totalImpressions) },
			{ label: 'Click-uri', value: fmtNum(totalClicks) },
			{ label: 'CTR', value: totalImpressions > 0 ? fmtPct((totalClicks / totalImpressions) * 100) : '-' },
			{ label: 'CPC mediu', value: totalClicks > 0 ? fmtAmount(totalSpend / totalClicks, mainCurrency) : '-' }
		];

		if (totalConversions > 0) {
			kpis.push({ label: 'Conversii', value: fmtNum(totalConversions) });
		}

		const kpiColW = CW / Math.min(kpis.length, 3);
		for (let i = 0; i < kpis.length; i++) {
			const col = i % 3;
			if (i > 0 && col === 0) y += 36;
			const x = ML + col * kpiColW;

			doc.font('Regular').fontSize(8).fillColor(MUTED)
				.text(kpis[i].label, x, y, { width: kpiColW - 10 });
			doc.font('Bold').fontSize(13).fillColor(DARK)
				.text(kpis[i].value, x, y + 11, { width: kpiColW - 10 });
		}
		y += 50;

		// ---- Platform Table ----
		doc.moveTo(ML, y).lineTo(PW - MR, y).strokeColor(BORDER).lineWidth(0.5).stroke();
		y += 15;

		doc.font('Bold').fontSize(11).fillColor(DARK)
			.text('Detalii per Platformă', ML, y);
		y += 22;

		// Table header
		const cols = [
			{ label: 'Platformă', w: 100, align: 'left' as const },
			{ label: 'Cheltuieli', w: 85, align: 'right' as const },
			{ label: 'Impresii', w: 75, align: 'right' as const },
			{ label: 'Click-uri', w: 65, align: 'right' as const },
			{ label: 'CPC', w: 70, align: 'right' as const },
			{ label: 'CTR', w: 60, align: 'right' as const },
			{ label: 'Conversii', w: 55, align: 'right' as const }
		];

		// Header row
		doc.rect(ML, y, CW, 20).fill(SOFT_BG);
		let cx = ML + 5;
		for (const col of cols) {
			doc.font('Bold').fontSize(8).fillColor(MUTED)
				.text(col.label, cx, y + 5, { width: col.w - 10, align: col.align });
			cx += col.w;
		}
		y += 22;

		// Data rows
		for (const platform of data.platforms) {
			const cpc = platform.clicks > 0 ? platform.spend / platform.clicks : 0;
			const ctr = platform.impressions > 0 ? (platform.clicks / platform.impressions) * 100 : 0;

			cx = ML + 5;
			const rowData = [
				{ text: platform.name, align: 'left' as const },
				{ text: fmtAmount(platform.spend, platform.currency), align: 'right' as const },
				{ text: fmtNum(platform.impressions), align: 'right' as const },
				{ text: fmtNum(platform.clicks), align: 'right' as const },
				{ text: cpc > 0 ? fmtAmount(cpc, platform.currency) : '-', align: 'right' as const },
				{ text: ctr > 0 ? fmtPct(ctr) : '-', align: 'right' as const },
				{ text: platform.conversions > 0 ? fmtNum(platform.conversions) : '-', align: 'right' as const }
			];

			for (let i = 0; i < rowData.length; i++) {
				doc.font('Regular').fontSize(9).fillColor(TEXT)
					.text(rowData[i].text, cx, y, { width: cols[i].w - 10, align: rowData[i].align });
				cx += cols[i].w;
			}
			y += 18;

			// Row separator
			doc.moveTo(ML, y - 2).lineTo(PW - MR, y - 2).strokeColor('#E2E8F0').lineWidth(0.3).stroke();
		}

		// Total row
		y += 4;
		doc.rect(ML, y - 2, CW, 20).fill(SOFT_BG);
		cx = ML + 5;
		const totalRow = [
			{ text: 'TOTAL', align: 'left' as const },
			{ text: fmtAmount(totalSpend, mainCurrency), align: 'right' as const },
			{ text: fmtNum(totalImpressions), align: 'right' as const },
			{ text: fmtNum(totalClicks), align: 'right' as const },
			{ text: totalClicks > 0 ? fmtAmount(totalSpend / totalClicks, mainCurrency) : '-', align: 'right' as const },
			{ text: totalImpressions > 0 ? fmtPct((totalClicks / totalImpressions) * 100) : '-', align: 'right' as const },
			{ text: totalConversions > 0 ? fmtNum(totalConversions) : '-', align: 'right' as const }
		];

		for (let i = 0; i < totalRow.length; i++) {
			doc.font('Bold').fontSize(9).fillColor(DARK)
				.text(totalRow[i].text, cx, y + 3, { width: cols[i].w - 10, align: totalRow[i].align });
			cx += cols[i].w;
		}
		y += 30;

		// ---- Footer ----
		const pageH = 841.89; // A4 height
		doc.font('Regular').fontSize(8).fillColor(MUTED)
			.text(`Generat automat de ${data.tenantName}`, ML, pageH - 40, { align: 'center', width: CW });

		doc.end();
	});
}
