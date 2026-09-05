// PDF-ul raportului săptămânal PageSpeed (atașat opțional la email).
// Un tabel compact pe A4, cu aceleași date și praguri de culoare ca emailul.
import PDFDocument from 'pdfkit';
import { resolve } from 'path';
import { existsSync } from 'fs';
import { psiFmt, psiScoreLevel } from '$lib/logic/pagespeed';
import type { PagespeedReportData } from './report';

/**
 * Fonturile DejaVu (diacritice) vin din src/lib/server/assets. Căutăm după FIȘIER,
 * nu după director: pe producție `build/assets` există (assets SvelteKit) dar nu are
 * fonturile — Dockerfile-ul le copiază lângă chunk-uri, în build/server/chunks/assets.
 */
function resolveAssetsDir(): string {
	const dir = import.meta.dirname ?? '.';
	const candidates = [
		resolve(dir, 'assets'), // prod: chunk-uri aplatizate, assets/ alături
		resolve(dir, '..', 'assets'), // dev: src/lib/server/pagespeed → src/lib/server/assets
		resolve(dir, '..', '..', 'assets')
	];
	return candidates.find((c) => existsSync(resolve(c, 'DejaVuSans.ttf'))) ?? candidates[0];
}

const ASSETS_DIR = resolveAssetsDir();
const FONT_REGULAR = resolve(ASSETS_DIR, 'DejaVuSans.ttf');
const FONT_BOLD = resolve(ASSETS_DIR, 'DejaVuSans-Bold.ttf');

const LEVEL_COLORS: Record<string, string> = {
	good: '#047857',
	ni: '#b45309',
	poor: '#b91c1c',
	none: '#9ca3af'
};

const ML = 40;
const PW = 595.28;

export async function generatePagespeedReportPdf(data: PagespeedReportData): Promise<Buffer> {
	return new Promise((resolvePromise, reject) => {
		const doc = new PDFDocument({ size: 'A4', margin: ML });
		const chunks: Buffer[] = [];
		doc.on('data', (chunk: Buffer) => chunks.push(chunk));
		doc.on('end', () => resolvePromise(Buffer.concat(chunks)));
		doc.on('error', reject);

		try {
			doc.registerFont('Regular', FONT_REGULAR);
			doc.registerFont('Bold', FONT_BOLD);

			doc.font('Bold').fontSize(18).fillColor('#0f172a')
				.text(`Raport PageSpeed Insights — ${data.interval}`, ML, ML);
			doc.font('Regular').fontSize(10).fillColor('#64748b')
				.text(`Săptămâna ${data.interval} · ${data.siteCount} site-uri scanate`, ML, doc.y + 4);

			// KPI-uri
			let y = doc.y + 18;
			const kpis: [string, string, string][] = [
				['Scor mediu mobil', String(data.avgMobile ?? '—'), LEVEL_COLORS[psiScoreLevel(data.avgMobile)]],
				['Scor mediu desktop', String(data.avgDesktop ?? '—'), LEVEL_COLORS[psiScoreLevel(data.avgDesktop)]],
				['Δ vs săpt. trecută', data.deltaMobile == null ? '—' : `${data.deltaMobile > 0 ? '+' : ''}${data.deltaMobile}`, '#0f172a'],
				['Trec Core Web Vitals', `${data.cwvPassCount}/${data.cwvKnownCount || data.siteCount}`, '#0f172a']
			];
			const kpiW = (PW - 2 * ML) / kpis.length;
			kpis.forEach(([label, value, color], i) => {
				const x = ML + i * kpiW;
				doc.font('Regular').fontSize(7).fillColor('#64748b').text(label.toUpperCase(), x, y);
				doc.font('Bold').fontSize(16).fillColor(color).text(value, x, y + 11);
			});
			y += 44;

			// tabel
			const cols = [
				{ label: 'Site', w: 165, align: 'left' as const },
				{ label: 'Mobil', w: 55, align: 'right' as const },
				{ label: 'Δ', w: 45, align: 'right' as const },
				{ label: 'Desktop', w: 60, align: 'right' as const },
				{ label: 'LCP', w: 60, align: 'right' as const },
				{ label: 'CLS', w: 55, align: 'right' as const },
				{ label: 'CWV', w: 75, align: 'right' as const }
			];
			let x = ML;
			doc.font('Bold').fontSize(7.5).fillColor('#64748b');
			for (const col of cols) {
				doc.text(col.label.toUpperCase(), x, y, { width: col.w, align: col.align });
				x += col.w;
			}
			y += 14;
			doc.moveTo(ML, y - 3).lineTo(PW - ML, y - 3).strokeColor('#e2e8f0').lineWidth(0.5).stroke();

			for (const row of data.rows) {
				if (y > 780) {
					doc.addPage();
					y = ML;
				}
				x = ML;
				const cells: [string, string][] = [
					[`${row.domain}${row.failed ? ' (eșuat)' : ''}`, '#0f172a'],
					[String(row.mobile ?? '—'), LEVEL_COLORS[psiScoreLevel(row.mobile)]],
					[
						row.deltaMobile == null ? '—' : `${row.deltaMobile > 0 ? '+' : ''}${row.deltaMobile}`,
						row.deltaMobile == null ? '#9ca3af' : row.deltaMobile < 0 ? '#b91c1c' : '#047857'
					],
					[String(row.desktop ?? '—'), LEVEL_COLORS[psiScoreLevel(row.desktop)]],
					[row.lcpMs != null ? psiFmt('lcp', row.lcpMs) : '—', '#334155'],
					[row.cls != null ? psiFmt('cls', row.cls) : '—', '#334155'],
					[row.cwv == null ? '—' : row.cwv ? 'trece' : 'nu trece', row.cwv == null ? '#9ca3af' : row.cwv ? '#047857' : '#b91c1c']
				];
				cells.forEach(([text, color], i) => {
					doc
						.font(i === 0 || i === 1 ? 'Bold' : 'Regular')
						.fontSize(8.5)
						.fillColor(color)
						.text(text, x, y, { width: cols[i].w, align: cols[i].align });
					x += cols[i].w;
				});
				if (row.clientName) {
					doc.font('Regular').fontSize(7).fillColor('#94a3b8')
						.text(row.clientName, ML, y + 10, { width: cols[0].w });
				}
				y += row.clientName ? 22 : 15;
				doc.moveTo(ML, y - 3).lineTo(PW - ML, y - 3).strokeColor('#f1f5f9').lineWidth(0.5).stroke();
			}

			doc.font('Regular').fontSize(7).fillColor('#94a3b8')
				.text(
					'Trimis automat de OTS CRM · sursa datelor: Google PageSpeed Insights API v5 (Lighthouse + CrUX)',
					ML,
					y + 10
				);
			doc.end();
		} catch (err) {
			reject(err);
		}
	});
}
