/** Textul Telegram al zilei — pur, testabil. Mesajele se trimit fără parse mode (text simplu). */
import type { Finding } from './types';
import { LEVEL_EMOJI } from '$lib/logic/wordpress-sentinel-labels';

export const TELEGRAM_MAX = 4096;

export interface DigestSite {
	name: string;
	findings: Finding[];
}

export interface DigestInput {
	date: Date;
	sites: DigestSite[];
	quietSites: number;
	url: string;
}

const dayFmt = new Intl.DateTimeFormat('ro-RO', { day: 'numeric', month: 'short', timeZone: 'Europe/Bucharest' });

/** „29 sept.” — ziua în ora României. */
export function dayLabel(date: Date): string {
	return dayFmt.format(date);
}

/** Blocul fiecărui site: 🔴 întâi, apoi 🟠; site-urile cu critice urcă primele. */
function siteBlocks(sites: DigestSite[]): string[][] {
	const hasCritical = (s: DigestSite) => s.findings.some((f) => f.level === 'critical');
	return sites
		.filter((s) => s.findings.length > 0)
		.sort((a, b) => Number(hasCritical(b)) - Number(hasCritical(a)) || a.name.localeCompare(b.name))
		.map((s) =>
			[...s.findings]
				.sort((a, b) => (a.level === b.level ? 0 : a.level === 'critical' ? -1 : 1))
				.map((f) => `${LEVEL_EMOJI[f.level]} ${s.name}: ${f.text}`)
		);
}

export function buildDigest({ date, sites, quietSites, url }: DigestInput): string[] {
	const header = `🛡 Sentinel · ${dayLabel(date)}`;
	const blocks = siteBlocks(sites);
	if (blocks.length === 0) return [`${header} — ✅ ${quietSites} site-uri liniștite`];

	const footer = [`✅ ${quietSites} site-uri liniștite`, `→ ${url}`];
	const single = [header, ...blocks.flat(), ...footer].join('\n');
	if (single.length <= TELEGRAM_MAX) return [single];

	// Împărțire: blocuri întregi pe pagină; un bloc prea mare pentru o pagină se taie pe linii.
	const budget = TELEGRAM_MAX - (header.length + ' (999/999)'.length + 1);
	const len = (lines: string[]) => (lines.length ? lines.join('\n').length : 0);
	const pages: string[][] = [[]];
	const push = (line: string) => {
		const cur = pages[pages.length - 1];
		if (cur.length > 0 && len([...cur, line]) > budget) pages.push([line]);
		else cur.push(line);
	};
	for (const block of blocks) {
		const cur = pages[pages.length - 1];
		if (len(block) <= budget && cur.length > 0 && len([...cur, ...block]) > budget) pages.push([]);
		for (const line of block) push(line);
	}
	if (len([...pages[pages.length - 1], ...footer]) > budget) pages.push([]);
	pages[pages.length - 1].push(...footer);
	return pages.map((lines, i) => [`${header} (${i + 1}/${pages.length})`, ...lines].join('\n'));
}
