/**
 * Currency utilities for formatting and displaying currency values
 */

export type Currency = 'RON' | 'EUR' | 'USD';

export const CURRENCIES: Currency[] = ['RON', 'EUR', 'USD'];

export const CURRENCY_SYMBOLS: Record<Currency, string> = {
	RON: 'lei',
	EUR: '€',
	USD: '$'
};

/** User-friendly labels for currency dropdowns */
export const CURRENCY_LABELS: Record<Currency, string> = {
	RON: 'Lei (RON)',
	EUR: 'Euro (EUR)',
	USD: 'USD'
};

export const CURRENCY_FORMATS: Record<Currency, Intl.NumberFormatOptions> = {
	RON: {
		style: 'currency',
		currency: 'RON',
		minimumFractionDigits: 2,
		maximumFractionDigits: 2
	},
	EUR: {
		style: 'currency',
		currency: 'EUR',
		minimumFractionDigits: 2,
		maximumFractionDigits: 2
	},
	USD: {
		style: 'currency',
		currency: 'USD',
		minimumFractionDigits: 2,
		maximumFractionDigits: 2
	}
};

/**
 * Format an amount in cents to a currency string
 */
export function formatCurrency(amountInCents: number | null | undefined, currency: Currency = 'RON'): string {
	if (amountInCents === null || amountInCents === undefined) {
		return `${CURRENCY_SYMBOLS[currency]} 0.00`;
	}

	const amount = amountInCents / 100;
	const formatter = new Intl.NumberFormat('ro-RO', CURRENCY_FORMATS[currency]);
	return formatter.format(amount);
}

/**
 * Get currency symbol
 */
export function getCurrencySymbol(currency: Currency = 'RON'): string {
	return CURRENCY_SYMBOLS[currency];
}

/**
 * Format amount with currency symbol (simple format)
 */
export function formatAmount(amountInCents: number | null | undefined, currency: Currency = 'RON'): string {
	if (amountInCents === null || amountInCents === undefined) {
		return `0.00 ${CURRENCY_SYMBOLS[currency]}`;
	}

	const amount = (amountInCents / 100).toFixed(2);
	return `${amount} ${CURRENCY_SYMBOLS[currency]}`;
}
