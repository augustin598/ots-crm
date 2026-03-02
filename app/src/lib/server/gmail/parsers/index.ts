import type { GmailMessage } from '../client';
import { cpanelParser } from './cpanel';
import { whmcsParser } from './whmcs';
import { hetznerParser } from './hetzner';
import { googleParser } from './google';
import { ovhParser } from './ovh';
import { digitaloceanParser } from './digitalocean';
import { awsParser } from './aws';
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
 * Registry of supplier parsers, ordered by specificity.
 * First match wins. Generic parser is always last.
 */
export const parserRegistry: SupplierParser[] = [
	cpanelParser,
	whmcsParser,
	hetznerParser,
	googleParser,
	ovhParser,
	digitaloceanParser,
	awsParser,
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
	dateTo?: Date
): string {
	const parsers = parserIds
		? parserRegistry.filter((p) => parserIds.includes(p.id))
		: parserRegistry;

	// Combine individual parser queries with OR
	const supplierQueries = parsers
		.filter((p) => p.id !== 'generic')
		.map((p) => `(${p.getSearchQuery()})`)
		.join(' OR ');

	// If generic is included, we search broader
	const includesGeneric = parsers.some((p) => p.id === 'generic');

	let query = supplierQueries;
	if (includesGeneric && !supplierQueries) {
		query = genericParser.getSearchQuery();
	} else if (includesGeneric) {
		query = `(${supplierQueries}) OR (${genericParser.getSearchQuery()})`;
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

function formatGmailDate(date: Date): string {
	return `${date.getFullYear()}/${date.getMonth() + 1}/${date.getDate()}`;
}

/**
 * Helper: parse amount string like "$12.34" or "12,34 EUR" to cents
 */
export function parseAmount(text: string): { amount: number; currency: string } | null {
	// Match patterns like: $12.34, 12.34 USD, €12,34, 12,34 EUR
	const patterns = [
		/\$\s*([\d,]+\.?\d*)/,
		/€\s*([\d.,]+)/,
		/([\d,]+\.?\d*)\s*(USD|EUR|RON|GBP)/i,
		/(USD|EUR|RON|GBP)\s*([\d,]+\.?\d*)/i
	];

	for (const pattern of patterns) {
		const match = text.match(pattern);
		if (match) {
			let amountStr: string;
			let currency: string;

			if (pattern === patterns[0]) {
				amountStr = match[1];
				currency = 'USD';
			} else if (pattern === patterns[1]) {
				amountStr = match[1];
				currency = 'EUR';
			} else if (pattern === patterns[3]) {
				currency = match[1].toUpperCase();
				amountStr = match[2];
			} else {
				amountStr = match[1];
				currency = match[2].toUpperCase();
			}

			// Normalize number: "1,234.56" or "1.234,56"
			const hasCommaAsDecimal = amountStr.includes(',') && !amountStr.includes('.');
			if (hasCommaAsDecimal) {
				amountStr = amountStr.replace(',', '.');
			} else {
				amountStr = amountStr.replace(/,/g, '');
			}

			const amount = Math.round(parseFloat(amountStr) * 100);
			if (!isNaN(amount)) {
				return { amount, currency };
			}
		}
	}
	return null;
}
