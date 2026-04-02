import type { Invoice, InvoiceLineItem } from '$lib/server/db/schema';

/**
 * Plugin configuration type
 */
export type PluginConfig = Record<string, unknown>;

/**
 * Hook event types
 */
export type InvoiceCreatedEvent = {
	type: 'invoice.created';
	invoice: Invoice & { lineItems?: InvoiceLineItem[] };
	tenantId: string;
	userId: string;
	isRecurring?: boolean;
};

export type InvoiceUpdatedEvent = {
	type: 'invoice.updated';
	invoice: Invoice & { lineItems?: InvoiceLineItem[] };
	previousInvoice: Invoice;
	tenantId: string;
	userId: string;
};

export type InvoiceDeletedEvent = {
	type: 'invoice.deleted';
	invoice: Invoice & { lineItems?: InvoiceLineItem[] };
	tenantId: string;
	userId: string;
};

export type InvoiceStatusChangedEvent = {
	type: 'invoice.status.changed';
	invoice: Invoice & { lineItems?: InvoiceLineItem[] };
	previousStatus: string;
	newStatus: string;
	tenantId: string;
	userId: string;
};

export type InvoicePaidEvent = {
	type: 'invoice.paid';
	invoice: Invoice & { lineItems?: InvoiceLineItem[] };
	tenantId: string;
	userId: string;
};

export type TaskAssignedEvent = {
	type: 'task.assigned';
	taskId: string;
	taskTitle: string;
	assignedToUserId: string;
	assignedByUserId: string;
	clientId?: string | null;
	tenantId: string;
	tenantSlug: string;
};

export type ContractSignedEvent = {
	type: 'contract.signed';
	contractId: string;
	contractTitle: string;
	signerEmail: string;
	tenantId: string;
	tenantSlug: string;
};

export type SyncErrorEvent = {
	type: 'sync.error';
	source: string; // 'meta-ads' | 'tiktok-ads' | 'google-ads' | 'keez' | 'gmail' | etc.
	message: string;
	tenantId: string;
};

export type LeadsImportedEvent = {
	type: 'leads.imported';
	tenantId: string;
	imported: number;
	skipped: number;
	errors: number;
	source: 'manual' | 'scheduled';
	/** Client IDs affected by the import (for per-client activity feed) */
	clientIds?: string[];
};

export type ContractActivatedEvent = {
	type: 'contract.activated';
	contractId: string;
	contractTitle: string;
	clientId: string;
	tenantId: string;
	tenantSlug: string;
};

export type ContractExpiredEvent = {
	type: 'contract.expired';
	contractId: string;
	contractTitle: string;
	clientId: string;
	tenantId: string;
	tenantSlug: string;
};

export type TaskCompletedEvent = {
	type: 'task.completed';
	taskId: string;
	taskTitle: string;
	completedByUserId: string;
	clientId?: string;
	tenantId: string;
	tenantSlug: string;
};

export type HookEvent =
	| InvoiceCreatedEvent
	| InvoiceUpdatedEvent
	| InvoiceDeletedEvent
	| InvoiceStatusChangedEvent
	| InvoicePaidEvent
	| TaskAssignedEvent
	| TaskCompletedEvent
	| ContractSignedEvent
	| ContractActivatedEvent
	| ContractExpiredEvent
	| SyncErrorEvent
	| LeadsImportedEvent;

/**
 * Hook handler function type
 */
export type HookHandler<T extends HookEvent = HookEvent> = (event: T) => Promise<void> | void;

/**
 * Plugin interface
 */
export interface Plugin {
	id: string;
	name: string;
	version: string;
	displayName: string;
	description: string;
	initialize(config: PluginConfig): Promise<void>;
	registerHooks(hooks: HooksManager): void;
	onEnable(tenantId: string): Promise<void>;
	onDisable(tenantId: string): Promise<void>;
}

/**
 * Hooks manager interface
 */
export interface HooksManager {
	on<T extends HookEvent>(eventType: T['type'], handler: HookHandler<T>, pluginId?: string): void;
	emit<T extends HookEvent>(event: T): Promise<void>;
	off<T extends HookEvent>(eventType: T['type'], handler: HookHandler<T>): void;
	clearPluginHandlers(pluginId: string): void;
}
