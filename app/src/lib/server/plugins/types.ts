import type { Invoice } from '$lib/server/db/schema';

/**
 * Plugin configuration type
 */
export type PluginConfig = Record<string, unknown>;

/**
 * Hook event types
 */
export type InvoiceCreatedEvent = {
	type: 'invoice.created';
	invoice: Invoice;
	tenantId: string;
	userId: string;
};

export type InvoiceUpdatedEvent = {
	type: 'invoice.updated';
	invoice: Invoice;
	previousInvoice: Invoice;
	tenantId: string;
	userId: string;
};

export type InvoiceDeletedEvent = {
	type: 'invoice.deleted';
	invoice: Invoice;
	tenantId: string;
	userId: string;
};

export type InvoiceStatusChangedEvent = {
	type: 'invoice.status.changed';
	invoice: Invoice;
	previousStatus: string;
	newStatus: string;
	tenantId: string;
	userId: string;
};

export type InvoicePaidEvent = {
	type: 'invoice.paid';
	invoice: Invoice;
	tenantId: string;
	userId: string;
};

export type HookEvent =
	| InvoiceCreatedEvent
	| InvoiceUpdatedEvent
	| InvoiceDeletedEvent
	| InvoiceStatusChangedEvent
	| InvoicePaidEvent;

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
	on<T extends HookEvent>(eventType: T['type'], handler: HookHandler<T>): void;
	emit<T extends HookEvent>(event: T): Promise<void>;
	off<T extends HookEvent>(eventType: T['type'], handler: HookHandler<T>): void;
}
