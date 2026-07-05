/* Tipuri shared pentru pagina Provisioning DirectAdmin */

export type ProvisioningStatus = 'active' | 'pending' | 'failed' | 'suspended' | 'terminated';

/**
 * Setat de `reconcileHostingWithDA` — vezi schema `hostingAccount.daSyncStatus`.
 */
export type DaSyncStatus =
	| 'ok'
	| 'orphan'
	| 'suspended_on_da'
	| 'active_on_da'
	| 'package_mismatch'
	| 'zombie_on_da'
	| 'server_error'
	// Set by the DA→CRM discovery import (createHostingAccountFromDiscovery): the row
	// was imported from DirectAdmin and still needs a client (and possibly a price).
	| 'da_only';

export const DA_SYNC_LABELS: Record<DaSyncStatus, string> = {
	ok: 'Confirmat pe DA',
	orphan: 'Nu există pe DA',
	suspended_on_da: 'Suspendat pe DA',
	active_on_da: 'Activ pe DA',
	package_mismatch: 'Pachet diferit',
	zombie_on_da: 'Încă există pe DA',
	server_error: 'DA inaccesibil',
	da_only: 'Importat din DA'
};

export type ProvisioningTrigger =
	| 'stripe-webhook'
	| 'manual'
	| 'system'
	| 'retry'
	| 'cron'
	| 'hook:invoice.status.changed'
	| 'hook:invoice.paid';

export type ProvisioningAction =
	| 'create'
	| 'suspend'
	| 'unsuspend'
	| 'delete'
	| 'sync'
	| 'test'
	| 'package-change'
	| 'package-apply'
	| 'view-credentials'
	| 'password-reset'
	| 'welcome-resend'
	| 'retry-provision'
	| 'login-as'
	| 'ssl-issue'
	| 'alert-sent';

export interface ProvisioningRow {
	id: string;
	accountId: string;
	daUsername: string;
	domain: string;
	status: ProvisioningStatus;
	suspendReason: string | null;
	createdAt: string;
	daServerId: string;
	daServerName: string | null;
	daServerHostname: string | null;
	daPackageId: string | null;
	daPackageName: string | null;
	hostingProductId: string | null;
	productName: string | null;
	productColor: string | null;
	clientId: string;
	clientName: string | null;
	clientEmail: string | null;
	diskUsage: number | null;
	bandwidthUsage: number | null;
	emailCount: number | null;
	dbCount: number | null;
	lastSyncedAt: string | null;
	daSyncStatus: DaSyncStatus | null;
	daSyncIssue: string | null;
	trigger: ProvisioningTrigger | string;
	durationMs: number | null;
	invoiceId: string | null;
	invoiceNumber: string | null;
	actor: string;
	errorMessage: string | null;
	pendingSinceMin: number | null;
	hasCredentials: boolean;
}

export interface ProvisioningStats {
	successRate30d: number;
	successRate30dPrev: number;
	trend: number;
	successCount30d: number;
	failedCount30d: number;
	newAccounts24h: number;
	newAccounts24hPrev: number;
	pendingCount: number;
	failedCount: number;
	avgDurationMs: number;
	avgDurationMsPrev: number;
	serversOnline: number;
	serversTotal: number;
}

export interface AuditLogRow {
	id: string;
	action: ProvisioningAction | string;
	trigger: ProvisioningTrigger | string;
	success: boolean;
	errorMessage: string | null;
	durationMs: number | null;
	actorId: string | null;
	invoiceId: string | null;
	createdAt: string;
	actor: string;
}

export interface CriticalItem {
	id: string;
	daUsername: string;
	domain: string;
	status: ProvisioningStatus;
	createdAt: string;
	daServerName: string | null;
	daServerHostname: string | null;
	clientName: string | null;
	errorMessage: string | null;
	durationMs: number | null;
	pendingSinceMin: number | null;
}

export interface ServerOption {
	id: string;
	name: string;
	hostname: string;
	isActive: boolean;
}

export const STATUS_LABELS: Record<ProvisioningStatus, string> = {
	active: 'Activ',
	pending: 'Pending',
	failed: 'Eșuat',
	suspended: 'Suspendat',
	terminated: 'Terminat'
};

export const ACTION_LABELS: Record<string, string> = {
	create: 'Creare cont',
	suspend: 'Suspendare',
	unsuspend: 'Reactivare',
	delete: 'Ștergere',
	sync: 'Sincronizare',
	test: 'Test conexiune',
	'package-change': 'Schimbare pachet',
	'package-apply': 'Aplică pachet',
	'view-credentials': 'Vizualizare credențiale',
	'password-reset': 'Resetare parolă',
	'welcome-resend': 'Re-trimite welcome',
	'retry-provision': 'Retry provisioning',
	'login-as': 'Autologin DA',
	'ssl-issue': 'Emitere SSL',
	'alert-sent': 'Alertă trimisă'
};

export const TRIGGER_LABELS: Record<string, string> = {
	'stripe-webhook': 'Stripe',
	manual: 'Manual',
	system: 'Sistem',
	retry: 'Retry',
	cron: 'Cron',
	'hook:invoice.status.changed': 'Invoice → status',
	'hook:invoice.paid': 'Invoice → paid'
};
