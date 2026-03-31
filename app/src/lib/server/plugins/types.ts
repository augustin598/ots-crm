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

export type HookEvent =
	| InvoiceCreatedEvent
	| InvoiceUpdatedEvent
	| InvoiceDeletedEvent
	| InvoiceStatusChangedEvent
	| InvoicePaidEvent
	| TaskAssignedEvent
	| ContractSignedEvent
	| SyncErrorEvent;

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
