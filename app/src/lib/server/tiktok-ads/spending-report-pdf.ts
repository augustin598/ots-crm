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

// A4 dimensions
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
const ACCENT = '#EE1D52'; // TikTok red

export interface SpendingPeriod {
	periodStart: string;
	periodEnd: string;
	spend: string;
	impressions: number;
	clicks: number;
	conversions: number;
}

export interface SpendingReportData {
	tenantName: string;
	clientName: string;
	adAccountId: string;
	adAccountName: string;
	currencyCode: string;
	periods: SpendingPeriod[];
	generatedAt: Date;
}

function formatPeriod(start: string, end: string): string {
	try {
		const d = new Date(start + 'T00:00:00');
		return d.toLocaleDateString('ro-RO', { month: 'long', year: 'numeric' });
	} catch {
		return `${start} - ${end}`;
	}
}

function formatAmount(amount: string, currency: string): string {
	const num = parseFloat(amount);
	if (isNaN(num)) return `0.00 ${currency}`;
	return `${num.toLocaleString('ro-RO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency}`;
}

function formatNumber(n: number): string {
	return n.toLocaleString('ro-RO');
}

export async function generateSpendingReportPdf(data: SpendingReportData): Promise<Buffer> {
	return new Promise((resolve, reject) => {
		const doc = new PDFDocument({ size: 'A4', margin: ML });
		const chunks: Buffer[] = [];

		doc.on('data', (chunk: Buffer) => chunks.push(chunk));
		doc.on('end', () => resolve(Buffer.concat(chunks)));
		doc.on('error', reject);

		doc.registerFont('Regular', FONT_REGULAR);
		doc.registerFont('Bold', FONT_BOLD);

		let y = MT;

		// Header
		doc.font('Bold').fontSize(18).fillColor(ACCENT);
		doc.text('Raport Cheltuieli TikTok Ads', ML, y, { width: CW, align: 'center' });
		y += 30;

		// Subtitle line
		doc.font('Regular').fontSize(9).fillColor(MUTED);
		doc.text(`Generat: ${data.generatedAt.toLocaleDateString('ro-RO', { day: '2-digit', month: '2-digit', year: 'numeric' })}`, ML, y, { width: CW, align: 'center' });
		y += 25;

		// Divider
		doc.strokeColor(BORDER).lineWidth(1).moveTo(ML, y).lineTo(PW - MR, y).stroke();
		y += 15;

		// Info section
		const infoItems = [
			['Companie', data.tenantName],
			['Client', data.clientName],
			['Cont publicitar', `${data.adAccountName} (${data.adAccountId})`],
			['Monedă', data.currencyCode]
		];

		for (const [label, value] of infoItems) {
			doc.font('Bold').fontSize(9).fillColor(TEXT);
			doc.text(`${label}:`, ML, y, { continued: true });
			doc.font('Regular').text(`  ${value}`);
			y += 16;
		}

		y += 10;

		// Table header — 5 columns (period, spend, impressions, clicks, conversions)
		const colX = {
			period: ML,
			spend: ML + 140,
			impressions: ML + 250,
			clicks: ML + 340,
			conversions: ML + 420
		};
		const colW = {
			period: 130,
			spend: 100,
			impressions: 80,
			clicks: 70,
			conversions: CW - 420 + ML
		};

		// Header row background
		doc.rect(ML, y, CW, 22).fill(ACCENT);
		y += 6;

		doc.font('Bold').fontSize(8).fillColor('#FFFFFF');
		doc.text('Perioadă', colX.period + 6, y, { width: colW.period });
		doc.text('Cheltuieli', colX.spend + 6, y, { width: colW.spend, align: 'right' });
		doc.text('Afișări', colX.impressions + 6, y, { width: colW.impressions, align: 'right' });
		doc.text('Click-uri', colX.clicks + 6, y, { width: colW.clicks, align: 'right' });
		doc.text('Conversii', colX.conversions + 6, y, { width: colW.conversions, align: 'right' });
		y += 22;

		// Data rows
		let totalSpend = 0;
		let totalImpressions = 0;
		let totalClicks = 0;
		let totalConversions = 0;

		for (let i = 0; i < data.periods.length; i++) {
			const p = data.periods[i];
			const rowBg = i % 2 === 0 ? SOFT_BG : '#FFFFFF';

			doc.rect(ML, y - 4, CW, 22).fill(rowBg);

			doc.font('Regular').fontSize(8).fillColor(TEXT);
			doc.text(formatPeriod(p.periodStart, p.periodEnd), colX.period + 6, y, { width: colW.period });
			doc.text(formatAmount(p.spend, data.currencyCode), colX.spend + 6, y, { width: colW.spend, align: 'right' });
			doc.text(formatNumber(p.impressions), colX.impressions + 6, y, { width: colW.impressions, align: 'right' });
			doc.text(formatNumber(p.clicks), colX.clicks + 6, y, { width: colW.clicks, align: 'right' });
			doc.text(formatNumber(p.conversions), colX.conversions + 6, y, { width: colW.conversions, align: 'right' });

			totalSpend += parseFloat(p.spend) || 0;
			totalImpressions += p.impressions;
			totalClicks += p.clicks;
			totalConversions += p.conversions;
			y += 22;
		}

		// Total row
		doc.rect(ML, y - 4, CW, 24).fill(DARK);
		y += 2;

		doc.font('Bold').fontSize(9).fillColor('#FFFFFF');
		doc.text('TOTAL', colX.period + 6, y, { width: colW.period });
		doc.text(formatAmount(totalSpend.toFixed(2), data.currencyCode), colX.spend + 6, y, { width: colW.spend, align: 'right' });
		doc.text(formatNumber(totalImpressions), colX.impressions + 6, y, { width: colW.impressions, align: 'right' });
		doc.text(formatNumber(totalClicks), colX.clicks + 6, y, { width: colW.clicks, align: 'right' });
		doc.text(formatNumber(totalConversions), colX.conversions + 6, y, { width: colW.conversions, align: 'right' });
		y += 30;

		// CTR summary
		if (totalImpressions > 0) {
			const ctr = ((totalClicks / totalImpressions) * 100).toFixed(2);
			doc.font('Regular').fontSize(9).fillColor(MUTED);
			doc.text(`CTR mediu: ${ctr}%`, ML, y, { width: CW });
			y += 16;
		}

		// Cost per click
		if (totalClicks > 0) {
			const cpc = (totalSpend / totalClicks).toFixed(2);
			doc.font('Regular').fontSize(9).fillColor(MUTED);
			doc.text(`Cost mediu per click: ${cpc} ${data.currencyCode}`, ML, y, { width: CW });
			y += 16;
		}

		// Cost per conversion
		if (totalConversions > 0) {
			const cpconv = (totalSpend / totalConversions).toFixed(2);
			doc.font('Regular').fontSize(9).fillColor(MUTED);
			doc.text(`Cost mediu per conversie: ${cpconv} ${data.currencyCode}`, ML, y, { width: CW });
			y += 25;
		}

		// Footer
		doc.font('Regular').fontSize(8).fillColor(MUTED);
		doc.text('Generat automat din CRM. Datele provin din TikTok Ads API (Reporting).', ML, y, { width: CW, align: 'center' });

		doc.end();
	});
}
