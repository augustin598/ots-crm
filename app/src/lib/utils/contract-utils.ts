export const CONTRACT_STATUSES = ['draft', 'sent', 'signed', 'active', 'expired', 'cancelled'] as const;
export type ContractStatus = (typeof CONTRACT_STATUSES)[number];

const STATUS_LABELS: Record<string, string> = {
	draft: 'Ciornă',
	sent: 'Trimis',
	signed: 'Semnat',
	active: 'Activ',
	expired: 'Expirat',
	cancelled: 'Anulat'
};

export function getContractStatusLabel(status: string): string {
	return STATUS_LABELS[status] || status;
}

export type BadgeVariant = 'default' | 'secondary' | 'destructive' | 'outline' | 'success' | 'warning';

export function getContractStatusVariant(status: string): BadgeVariant {
	switch (status) {
		case 'draft':
			return 'outline';
		case 'sent':
			return 'secondary';
		case 'signed':
			return 'default';
		case 'active':
			return 'default';
		case 'expired':
			return 'destructive';
		case 'cancelled':
			return 'destructive';
		default:
			return 'secondary';
	}
}

export function getContractStatusClass(status: string): string {
	if (status === 'active') {
		return 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400 border-green-200 dark:border-green-800';
	}
	return '';
}

export function formatContractDate(date: Date | string | null | undefined): string {
	if (!date) return '-';
	try {
		const d = date instanceof Date ? date : new Date(date);
		if (!isNaN(d.getTime()) && d.getFullYear() > 1970) {
			return d.toLocaleDateString('ro-RO', {
				year: 'numeric',
				month: 'short',
				day: 'numeric'
			});
		}
	} catch {
		// ignore
	}
	return '-';
}

export function formatContractPrice(cents: number): string {
	return (cents / 100).toFixed(2);
}

export function getBillingFrequencyLabel(freq: string | null | undefined): string {
	switch (freq) {
		case 'monthly':
			return 'Lunar';
		case 'one-time':
			return 'O singură dată';
		case 'quarterly':
			return 'Trimestrial';
		case 'yearly':
			return 'Anual';
		default:
			return freq || '-';
	}
}

/** Safe cents conversion avoiding floating-point errors */
export function toCents(value: number): number {
	return Math.round(value * 100);
}

/** Whether contract status allows editing */
export function isContractEditable(status: string): boolean {
	return status === 'draft' || status === 'sent';
}
