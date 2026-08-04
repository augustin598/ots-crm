import type { GmailMessage } from '../client';
import { cpanelParser } from './cpanel';
import { hetznerParser } from './hetzner';
import { googleParser } from './google';
import { ovhParser } from './ovh';
import { digitaloceanParser } from './digitalocean';
import { awsParser } from './aws';
import { linkedinParser } from './linkedin';
import { openaiParser } from './openai';
import { cloudflareParser } from './cloudflare';
import { directadminParser } from './directadmin';
import { cursorParser } from './cursor';
import { inwxParser } from './inwx';
import { whmcsParser } from './whmcs';
import { litespeedParser } from './litespeed';
import { tiktokParser } from './tiktok';
import { anthropicParser } from './anthropic';
import { metaParser } from './meta';
import { roSuppliersParser } from './ro-suppliers';
import { genericParser } from './generic';

export interface ParsedInvoice {
	invoiceNumber?: string;
	amount?: number; // in cents
	currency?: string;
	issueDate?: Date;
	dueDate?: Date;
	status?: 'paid' | 'unpaid' | 'pending';
	supplierType: string;
	supplierName: string;
}

export interface SupplierParser {
	id: string;
	name: string;
	matchEmail(from: string, subject: string): boolean;
	parseInvoice(email: GmailMessage): ParsedInvoice;
	getSearchQuery(): string;
}

/**
 * Registry of supplier parsers. First match wins, so ORDER encodes an
 * invariant, not just "specificity":
 *
 * 1. DOMAIN-PRECISE matchers first — matchEmail relies ONLY on the sender's
 *    from-domain (or a from-domain check ANDed with a subject keyword, e.g.
 *    googleParser). These can never be hijacked by an unrelated supplier's
 *    subject line, because they don't look at the subject at all (or only
 *    look at it after the domain already matched).
 * 2. SUBJECT-HEURISTIC matchers second — matchEmail returns true from a
 *    subject keyword ALONE (from-domain OR subject-keyword), with no
 *    from-domain requirement. Placed BEFORE a domain-precise parser, one of
 *    these would silently hijack it: e.g. anthropicParser matches any subject
 *    containing "claude", so "Your receipt from Cursor — Claude Sonnet usage"
 *    from billing@cursor.com would mislabel the invoice as Anthropic's
 *    instead of Cursor's if anthropicParser ran first. Keep these AFTER every
 *    domain-precise parser.
 * 3. CATCH-ALLS last — roSuppliersParser (matches on "factura" in the subject
 *    with no domain requirement) and genericParser (any invoice-ish subject).
 *
 * See parsers.test.ts "nu se lasă umbrite de matcher-e pe subiect" for the
 * regression this ordering guards against.
 */
export const parserRegistry: SupplierParser[] = [
	// --- domain-precise (from-domain only, or from-domain AND subject) ---
	cpanelParser,
	hetznerParser,
	googleParser,
	ovhParser,
	digitaloceanParser,
	awsParser,
	linkedinParser,
	openaiParser,
	cloudflareParser,
	directadminParser,
	cursorParser,
	inwxParser,
	// --- subject-heuristic (from-domain OR subject keyword alone) ---
	whmcsParser,
	litespeedParser,
	tiktokParser,
	anthropicParser,
	metaParser,
	// --- catch-alls ---
	roSuppliersParser,
	genericParser
];

/**
 * Find the matching parser for an email
 */
export function findParser(from: string, subject: string): SupplierParser | null {
	return parserRegistry.find((p) => p.matchEmail(from, subject)) || null;
}

/**
 * Build a combined Gmail search query for all or selected parsers
 */
export function buildSearchQuery(
	parserIds?: string[],
	dateFrom?: Date,
	dateTo?: Date,
	customEmails?: string[]
): string {
	const parsers = parserIds
		? parserRegistry.filter((p) => parserIds.includes(p.id))
		: parserRegistry;

	// Combine individual parser queries with OR
	const supplierQueries = parsers
		.filter((p) => p.id !== 'generic')
		.map((p) => `(${p.getSearchQuery()})`)
		.join(' OR ');

	// Build custom email/domain queries
	const customQuery =
		customEmails && customEmails.length > 0
			? customEmails.map((e) => `from:${e}`).join(' OR ')
			: '';

	// If generic is included, we search broader
	const includesGeneric = parsers.some((p) => p.id === 'generic');

	// Combine all source queries
	const sourceQueries = [supplierQueries, customQuery].filter(Boolean);
	let query = sourceQueries.join(' OR ');

	if (includesGeneric && !query) {
		query = genericParser.getSearchQuery();
	} else if (includesGeneric) {
		query = `(${query}) OR (${genericParser.getSearchQuery()})`;
	} else if (sourceQueries.length > 1) {
		query = `(${supplierQueries}) OR (${customQuery})`;
	}

	// Add date filters
	if (dateFrom) {
		const from = formatGmailDate(dateFrom);
		query += ` after:${from}`;
	}
	if (dateTo) {
		const to = formatGmailDate(dateTo);
		query += ` before:${to}`;
	}

	return query;
}

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
	/**
	 * Tipare de expeditori de exclus permanent (chitanțe de publicitate etc.).
	 * ATENȚIE: filtrarea din query e doar o optimizare — Gmail interpretează unele
	 * tipare mai larg sau mai îngust decât ne așteptăm. Excluderea trebuie aplicată
	 * ȘI pe rezultate, cu `shouldExcludeEmail`.
	 */
	excludeEmails?: string[];
}

/**
 * Normalizează un tipar de excludere la operatorul negativ pe care îl înțelege Gmail.
 *
 * - `@domeniu.com` și `domeniu.com` → `-from:domeniu.com` (Gmail nu vrea „@" în față)
 * - `user@domeniu.com`             → `-from:user@domeniu.com`
 *
 * Întoarce `null` pentru tiparele goale sau evident invalide (fără punct, cu spații),
 * ca să nu injectăm în query un operator care ar exclude mai mult decât s-a cerut.
 */
export function toGmailExcludeOperator(pattern: string): string | null {
	const trimmed = pattern.trim().toLowerCase();
	if (!trimmed) return null;
	const normalized = trimmed.startsWith('@') ? trimmed.slice(1) : trimmed;
	if (!normalized || !normalized.includes('.')) return null;
	// Un spațiu ar rupe query-ul: Gmail ar trata restul ca termen de căutare separat
	if (/\s/.test(normalized)) return null;
	return `-from:${normalized}`;
}

/**
 * Sugestii de excludere oferite în UI cu un clic. NU se aplică automat —
 * utilizatorul alege ce adaugă.
 *
 * Regula listei: doar platforme de publicitate/social, de unde vin chitanțe de
 * reclame pe care contabilitatea nu le vrea în fluxul de facturi de furnizor.
 * Furnizorii de infrastructură reali (Hetzner, OVH, Google Workspace, DirectAdmin…)
 * NU au ce căuta aici — facturile lor trebuie să ajungă în Keez.
 */
export const SUGGESTED_EXCLUDE_PATTERNS: string[] = [
	// Numit explicit de utilizator: chitanțele TikTok Ads. Potrivirea pe domeniu
	// prinde și subdomeniile (ads.tiktok.com, business.tiktok.com).
	'tiktok.com',
	// Numit explicit de utilizator: Facebook/Meta Ads.
	'facebook.com',
	// Domeniul real de trimitere al notificărilor și chitanțelor Facebook.
	'facebookmail.com',
	// Meta Platforms — facturile de reclame migrate pe brandul nou.
	'meta.com',
	// Meta, partea de Instagram Ads.
	'instagram.com',
	// LinkedIn Ads / Campaign Manager.
	'linkedin.com'
	// Intenționat ABSENTE:
	// - google.com → Google Ads trimite de pe payments-noreply@google.com, exact ca
	//                Google Workspace. Excluderea ar arunca și facturi reale.
	// - x.com      → potrivirea pe subșir de domeniu ar prinde fedex.com, linux.com etc.
];

/**
 * Interogare Gmail pentru tabul de descărcare. Intenționat mai largă decât
 * `buildSearchQuery` (folosită de fluxul de import): o plată către un furnizor
 * fără parser nu și-ar găsi niciodată factura dacă am filtra pe expeditori.
 */
export function buildInvoiceSearchQuery(options: InvoiceSearchOptions): string {
	let query: string;
	if (options.scope === 'all') {
		query = 'has:attachment filename:pdf';
	} else {
		query = buildSearchQuery(options.parserIds, undefined, undefined, options.customEmails);
	}
	if (options.dateFrom) query += ` after:${formatGmailDate(options.dateFrom)}`;
	if (options.dateTo) query += ` before:${formatGmailDate(options.dateTo)}`;

	// Excluderi persistente de expeditori — optimizare, nu garanție (vezi
	// InvoiceSearchOptions.excludeEmails); rezultatele se refiltrează oricum.
	const excludeOperators = (options.excludeEmails ?? [])
		.map(toGmailExcludeOperator)
		.filter((op): op is string => op !== null);
	if (excludeOperators.length > 0) query += ` ${excludeOperators.join(' ')}`;

	return query;
}

function formatGmailDate(date: Date): string {
	return `${date.getFullYear()}/${date.getMonth() + 1}/${date.getDate()}`;
}

// Re-exported from the leaf helpers module (no parser imports) so existing importers
// keep working. Parser files must import these from './helpers' directly, not from
// here — importing them from here would recreate the index.ts <-> parser file cycle
// that used to break depending on test import order (see parsers/helpers.ts).
export { parseAmount, detectStatus, isValidInvoiceNumber, extractInvoiceNumber } from './helpers';

/**
 * Extract email address from "Name <email>" format and match against a pattern.
 * Patterns: "@domain.com" (domain), "user@domain.com" (exact), "domain.com" (partial domain)
 */
function matchesEmailPattern(from: string, pattern: string): boolean {
	const fromLower = from.toLowerCase();
	const emailMatch = fromLower.match(/<(.+?)>/);
	const emailAddress = emailMatch ? emailMatch[1] : fromLower.trim();
	const patternLower = pattern.toLowerCase().trim();
	if (!patternLower) return false;

	if (patternLower.startsWith('@')) {
		return emailAddress.endsWith(patternLower);
	} else if (patternLower.includes('@')) {
		return emailAddress === patternLower;
	} else {
		const domain = emailAddress.split('@')[1] || '';
		return domain.includes(patternLower);
	}
}

/**
 * Check if an email sender matches any exclusion pattern.
 */
export function shouldExcludeEmail(from: string, excludePatterns: string[]): boolean {
	if (!excludePatterns || excludePatterns.length === 0) return false;
	return excludePatterns.some((pattern) => matchesEmailPattern(from, pattern));
}

/**
 * Check if an email sender matches any of the custom monitored emails/domains.
 */
export function isFromCustomSource(from: string, customEmails: string[]): boolean {
	if (!customEmails || customEmails.length === 0) return false;
	return customEmails.some((pattern) => matchesEmailPattern(from, pattern));
}

/**
 * Find parser for an email. If the email is from a custom-monitored source
 * and no specific parser matches, fall back to generic parser.
 */
export function findParserWithFallback(
	from: string,
	subject: string,
	isCustomMonitored: boolean
): SupplierParser | null {
	const parser = parserRegistry.find((p) => p.matchEmail(from, subject));
	if (parser) return parser;
	if (isCustomMonitored) return genericParser;
	return null;
}
