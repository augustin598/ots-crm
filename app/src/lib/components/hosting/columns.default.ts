import type { ColumnDef } from './column-manager';

/**
 * Column definitions for the hosting accounts table — matches the Hosting Accounts v2
 * design pack. Short single-word labels (PACHET / CICLU / STATUS / SUMĂ).
 *
 * `addons` column is OFF by default — the "+ N domenii adiționale" chip appears
 * inline under the domain cell. Toggle it on for a compact mode without details.
 */
export const HOSTING_ACCOUNT_COLUMNS: ColumnDef[] = [
	{ key: 'user', label: 'DA User', field: 'da_username', required: true },
	{ key: 'domain', label: 'Domeniu', field: 'domain', required: true },
	{ key: 'addons', label: 'Adiționale', field: 'additional_domains', isNew: true },
	{ key: 'pachet', label: 'Pachet', field: 'da_package_name' },
	{ key: 'server', label: 'Server', field: 'server' },
	{ key: 'ciclu', label: 'Ciclu', field: 'billing_cycle', isNew: true },
	{ key: 'start', label: 'Start', field: 'start_date' },
	{ key: 'scadenta', label: 'Scadență', field: 'next_due_date' },
	{ key: 'plata', label: 'Ultima plată', field: 'last_invoice', isNew: true },
	{ key: 'status', label: 'Status', field: 'status' },
	{ key: 'suma', label: 'Sumă', field: 'recurring_amount', required: true }
];

/**
 * Default visibility. Note: `addons` is OFF by default to match the v2 design
 * (the chip appears inline under the domain).
 */
export const HOSTING_ACCOUNT_DEFAULT_VISIBLE: Record<string, boolean> = {
	user: true,
	domain: true,
	addons: false,
	pachet: true,
	server: true,
	ciclu: true,
	start: true,
	scadenta: true,
	plata: true,
	status: true,
	suma: true
};

export const COLUMNS_STORAGE_KEY = 'hosting.accounts.columns.v2';
