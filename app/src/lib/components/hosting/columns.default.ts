import type { ColumnDef } from './column-manager';

/**
 * Column definitions for the hosting accounts table — 1:1 with the HOST design pack
 * (`columns.config.json`). Order here is the default order; user can drag-reorder
 * (except required columns).
 */
export const HOSTING_ACCOUNT_COLUMNS: ColumnDef[] = [
	{ key: 'user', label: 'DA User', field: 'da_username', required: true },
	{ key: 'domain', label: 'Domeniu', field: 'domain', required: true },
	{ key: 'addons', label: '+ Domenii adiționale', field: 'additional_domains', isNew: true },
	{ key: 'pachet', label: 'Pachet + PHP', field: 'da_package_name' },
	{ key: 'server', label: 'Server', field: 'server' },
	{ key: 'ciclu', label: 'Ciclu + Auto-renew', field: 'billing_cycle', isNew: true },
	{ key: 'start', label: 'Data start', field: 'start_date' },
	{ key: 'scadenta', label: 'Scadență + countdown', field: 'next_due_date' },
	{ key: 'plata', label: 'Ultima plată', field: 'last_invoice', isNew: true },
	{ key: 'status', label: 'Status cont', field: 'status' },
	{ key: 'suma', label: 'Sumă + perioadă', field: 'recurring_amount', required: true }
];

export const COLUMNS_STORAGE_KEY = 'hosting.accounts.columns.v1';
