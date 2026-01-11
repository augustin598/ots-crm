import type { Tenant, Client, Project } from '$lib/server/db/schema';

export interface VariableMap {
	[key: string]: string;
}

/**
 * Resolves standard variables from tenant, client, and project data
 * Returns a map of variable names to their values
 */
export function resolveStandardVariables(
	tenant: Tenant,
	client: Client,
	project?: Project | null,
	custom?: Record<string, string>
): VariableMap {
	const variables: VariableMap = {};

	// Tenant variables
	variables['tenant.name'] = tenant.name || '';
	variables['tenant.slug'] = tenant.slug || '';
	variables['tenant.companyType'] = tenant.companyType || '';
	variables['tenant.cui'] = tenant.cui || '';
	variables['tenant.registrationNumber'] = tenant.registrationNumber || '';
	variables['tenant.tradeRegister'] = tenant.tradeRegister || '';
	variables['tenant.vatNumber'] = tenant.vatNumber || '';
	variables['tenant.legalRepresentative'] = tenant.legalRepresentative || '';
	variables['tenant.iban'] = tenant.iban || '';
	variables['tenant.bankName'] = tenant.bankName || '';
	variables['tenant.address'] = tenant.address || '';
	variables['tenant.city'] = tenant.city || '';
	variables['tenant.county'] = tenant.county || '';
	variables['tenant.postalCode'] = tenant.postalCode || '';
	variables['tenant.country'] = tenant.country || 'România';

	// Client variables
	variables['client.name'] = client.name || '';
	variables['client.email'] = client.email || '';
	variables['client.phone'] = client.phone || '';
	variables['client.status'] = client.status || '';
	variables['client.companyType'] = client.companyType || '';
	variables['client.cui'] = client.cui || '';
	variables['client.registrationNumber'] = client.registrationNumber || '';
	variables['client.tradeRegister'] = client.tradeRegister || '';
	variables['client.vatNumber'] = client.vatNumber || '';
	variables['client.legalRepresentative'] = client.legalRepresentative || '';
	variables['client.iban'] = client.iban || '';
	variables['client.bankName'] = client.bankName || '';
	variables['client.address'] = client.address || '';
	variables['client.city'] = client.city || '';
	variables['client.county'] = client.county || '';
	variables['client.postalCode'] = client.postalCode || '';
	variables['client.country'] = client.country || 'România';
	variables['client.notes'] = client.notes || '';

	// Project variables
	if (project) {
		variables['project.name'] = project.name || '';
		variables['project.description'] = project.description || '';
		variables['project.status'] = project.status || '';
		variables['project.budget'] = project.budget ? formatCurrency(project.budget, project.currency || 'RON') : '';
		variables['project.currency'] = project.currency || 'RON';
		variables['project.startDate'] = project.startDate
			? new Date(project.startDate).toLocaleDateString('ro-RO')
			: '';
		variables['project.endDate'] = project.endDate
			? new Date(project.endDate).toLocaleDateString('ro-RO')
			: '';
	}

	// System/Date variables
	const now = new Date();
	variables['date'] = now.toLocaleDateString('ro-RO');
	variables['currentDate'] = now.toLocaleDateString('ro-RO');
	variables['year'] = now.getFullYear().toString();
	variables['month'] = (now.getMonth() + 1).toString().padStart(2, '0');
	variables['day'] = now.getDate().toString().padStart(2, '0');
	variables['time'] = now.toLocaleTimeString('ro-RO');

	// Custom variables
	if (custom) {
		for (const [key, value] of Object.entries(custom)) {
			variables[key] = value || '';
		}
	}

	return variables;
}

/**
 * Replaces variables in HTML content with their values
 * Supports {{variable}} syntax
 */
export function replaceVariables(content: string, variables: VariableMap): string {
	let result = content;

	// Replace all {{variable}} patterns
	for (const [key, value] of Object.entries(variables)) {
		// Replace {{key}} and {{key.property}} patterns
		const regex = new RegExp(`\\{\\{${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\}\\}`, 'g');
		result = result.replace(regex, value);
	}

	return result;
}

/**
 * Extracts all variable names from content
 * Returns an array of unique variable names found in {{variable}} format
 */
export function extractVariables(content: string): string[] {
	const regex = /\{\{([^}]+)\}\}/g;
	const matches = new Set<string>();
	let match;

	while ((match = regex.exec(content)) !== null) {
		matches.add(match[1].trim());
	}

	return Array.from(matches);
}

/**
 * Formats currency amount (stored in cents) to display format
 */
function formatCurrency(amount: number, currency: string): string {
	const formattedAmount = (amount / 100).toFixed(2);
	const currencySymbols: Record<string, string> = {
		RON: 'lei',
		EUR: '€',
		USD: '$',
		GBP: '£'
	};

	const symbol = currencySymbols[currency] || currency;
	return `${formattedAmount} ${symbol}`;
}

/**
 * Groups variables by category for display purposes
 */
export function groupVariablesByCategory(variables: VariableMap): {
	tenant: Array<{ key: string; value: string }>;
	client: Array<{ key: string; value: string }>;
	project: Array<{ key: string; value: string }>;
	system: Array<{ key: string; value: string }>;
	custom: Array<{ key: string; value: string }>;
} {
	const grouped = {
		tenant: [] as Array<{ key: string; value: string }>,
		client: [] as Array<{ key: string; value: string }>,
		project: [] as Array<{ key: string; value: string }>,
		system: [] as Array<{ key: string; value: string }>,
		custom: [] as Array<{ key: string; value: string }>
	};

	for (const [key, value] of Object.entries(variables)) {
		const entry = { key, value };
		if (key.startsWith('tenant.')) {
			grouped.tenant.push(entry);
		} else if (key.startsWith('client.')) {
			grouped.client.push(entry);
		} else if (key.startsWith('project.')) {
			grouped.project.push(entry);
		} else if (['date', 'currentDate', 'year', 'month', 'day', 'time'].includes(key)) {
			grouped.system.push(entry);
		} else {
			grouped.custom.push(entry);
		}
	}

	return grouped;
}
