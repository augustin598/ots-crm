import { customType, sqliteTable, integer as serial, integer, text, real, uniqueIndex } from 'drizzle-orm/sqlite-core';
import { relations, sql } from 'drizzle-orm';

const timestamp = customType<{ data: Date }>({
	dataType: () => 'timestamp',
	fromDriver: (value: unknown) => new Date(value as string | number),
	toDriver: (value: unknown) => (value as Date).toISOString()
});

const boolean = customType<{ data: boolean }>({
	dataType: () => 'number',
	fromDriver: (value: unknown) => ((value as number) > 0 ? true : false),
	toDriver: (value: unknown) => ((value as boolean) ? 1 : 0)
});

const jsonb = customType({
	dataType: () => 'text',
	fromDriver: (value: unknown) => JSON.parse(value as string),
	toDriver: (value: unknown) => JSON.stringify(value)
});

export const user = sqliteTable('user', {
	id: text('id').primaryKey(),
	email: text('email').notNull().unique(),
	firstName: text('first_name').notNull(),
	lastName: text('last_name').notNull(),
	username: text('username'), // Deprecated, kept for migration purposes
	passwordHash: text('password_hash').notNull()
});

export const session = sqliteTable('session', {
	id: text('id').primaryKey(),
	userId: text('user_id')
		.notNull()
		.references(() => user.id),
	expiresAt: timestamp('expires_at', { withTimezone: true, mode: 'date' }).notNull()
});

export const tenant = sqliteTable('tenant', {
	id: text('id').primaryKey(),
	name: text('name').notNull(),
	slug: text('slug').notNull().unique(),
	website: text('website'),
	companyType: text('company_type'),
	cui: text('cui').unique(),
	registrationNumber: text('registration_number'),
	tradeRegister: text('trade_register'),
	vatNumber: text('vat_number'),
	legalRepresentative: text('legal_representative'),
	iban: text('iban'),
	ibanEuro: text('iban_euro'),
	bankName: text('bank_name'),
	address: text('address'),
	city: text('city'),
	county: text('county'),
	postalCode: text('postal_code'),
	country: text('country').default('România'),
	phone: text('phone'),
	email: text('email'),
	contractPrefix: text('contract_prefix').default('CTR'),
	themeColor: text('theme_color'),
	createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
		.notNull()
		.default(sql`current_date`),
	updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' })
		.notNull()
		.default(sql`current_date`)
});

export const tenantUser = sqliteTable('tenant_user', {
	id: text('id').primaryKey(),
	tenantId: text('tenant_id')
		.notNull()
		.references(() => tenant.id),
	userId: text('user_id')
		.notNull()
		.references(() => user.id),
	role: text('role').notNull().default('member'), // 'owner', 'admin', 'member'
	createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
		.notNull()
		.default(sql`current_date`)
});

export const invitation = sqliteTable('invitation', {
	id: text('id').primaryKey(),
	tenantId: text('tenant_id')
		.notNull()
		.references(() => tenant.id),
	email: text('email').notNull(),
	role: text('role').notNull().default('member'), // 'owner', 'admin', 'member'
	token: text('token').notNull().unique(),
	invitedByUserId: text('invited_by_user_id')
		.notNull()
		.references(() => user.id),
	status: text('status').notNull().default('pending'), // 'pending', 'accepted', 'expired', 'cancelled'
	expiresAt: timestamp('expires_at', { withTimezone: true, mode: 'date' }).notNull(),
	acceptedAt: timestamp('accepted_at', { withTimezone: true, mode: 'date' }),
	createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
		.notNull()
		.default(sql`current_date`)
});

export const client = sqliteTable('client', {
	id: text('id').primaryKey(),
	tenantId: text('tenant_id')
		.notNull()
		.references(() => tenant.id),
	name: text('name').notNull(), // Alias / display name (editable by user)
	businessName: text('business_name'), // Official name from Keez/ANAF
	email: text('email'),
	phone: text('phone'),
	website: text('website'),
	status: text('status').default('prospect'), // 'prospect', 'active', 'inactive'
	companyType: text('company_type'),
	cui: text('cui'),
	registrationNumber: text('registration_number'),
	tradeRegister: text('trade_register'),
	vatNumber: text('vat_number'),
	legalRepresentative: text('legal_representative'),
	iban: text('iban'),
	bankName: text('bank_name'),
	address: text('address'),
	city: text('city'),
	county: text('county'),
	postalCode: text('postal_code'),
	country: text('country').default('România'),
	keezPartnerId: text('keez_partner_id'),
	notes: text('notes'),
	googleAdsCustomerId: text('google_ads_customer_id'), // Google Ads customer ID (e.g., "1234567890")
	restrictedAccess: text('restricted_access'), // null=auto (based on invoices), 'forced'=admin ban, 'unrestricted'=admin unban
	createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
		.notNull()
		.default(sql`current_date`),
	updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' })
		.notNull()
		.default(sql`current_date`)
});

export const partner = sqliteTable('partner', {
	id: text('id').primaryKey(),
	tenantId: text('tenant_id')
		.notNull()
		.references(() => tenant.id),
	clientId: text('client_id')
		.notNull()
		.references(() => client.id),
	partnerTenantId: text('partner_tenant_id')
		.notNull()
		.references(() => tenant.id),
	createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
		.notNull()
		.default(sql`current_date`),
	updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' })
		.notNull()
		.default(sql`current_date`)
});

export const project = sqliteTable('project', {
	id: text('id').primaryKey(),
	tenantId: text('tenant_id')
		.notNull()
		.references(() => tenant.id),
	clientId: text('client_id').references(() => client.id),
	name: text('name').notNull(),
	description: text('description'),
	status: text('status').notNull().default('planning'), // 'planning', 'active', 'on-hold', 'completed', 'cancelled'
	startDate: timestamp('start_date', { withTimezone: true, mode: 'date' }),
	endDate: timestamp('end_date', { withTimezone: true, mode: 'date' }),
	budget: integer('budget'), // in cents
	currency: text('currency').notNull().default('RON'), // 'RON', 'EUR', 'USD', etc.
	createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
		.notNull()
		.default(sql`current_date`),
	updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' })
		.notNull()
		.default(sql`current_date`)
});

export const projectPartner = sqliteTable('project_partner', {
	id: text('id').primaryKey(),
	tenantId: text('tenant_id')
		.notNull()
		.references(() => tenant.id),
	projectId: text('project_id')
		.notNull()
		.references(() => project.id),
	partnerId: text('partner_id')
		.notNull()
		.references(() => partner.id),
	createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
		.notNull()
		.default(sql`current_date`)
});

export const projectUser = sqliteTable('project_user', {
	id: text('id').primaryKey(),
	tenantId: text('tenant_id')
		.notNull()
		.references(() => tenant.id),
	projectId: text('project_id')
		.notNull()
		.references(() => project.id),
	userId: text('user_id')
		.notNull()
		.references(() => user.id),
	createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
		.notNull()
		.default(sql`current_date`)
});

export const milestone = sqliteTable('milestone', {
	id: text('id').primaryKey(),
	tenantId: text('tenant_id')
		.notNull()
		.references(() => tenant.id),
	projectId: text('project_id')
		.notNull()
		.references(() => project.id),
	name: text('name').notNull(),
	description: text('description'),
	status: text('status').notNull().default('pending'), // 'pending', 'in-progress', 'completed'
	dueDate: timestamp('due_date', { withTimezone: true, mode: 'date' }),
	completedDate: timestamp('completed_date', { withTimezone: true, mode: 'date' }),
	createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
		.notNull()
		.default(sql`current_date`),
	updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' })
		.notNull()
		.default(sql`current_date`)
});

export const task = sqliteTable('task', {
	id: text('id').primaryKey(),
	tenantId: text('tenant_id')
		.notNull()
		.references(() => tenant.id),
	projectId: text('project_id').references(() => project.id),
	clientId: text('client_id').references(() => client.id),
	milestoneId: text('milestone_id').references(() => milestone.id),
	title: text('title').notNull(),
	description: text('description'),
	status: text('status').notNull().default('todo'), // 'todo', 'in-progress', 'review', 'done', 'cancelled', 'pending-approval'
	priority: text('priority').default('medium'), // 'low', 'medium', 'high', 'urgent'
	position: integer('position'), // Position within status column for custom ordering
	dueDate: timestamp('due_date', { withTimezone: true, mode: 'date' }),
	assignedToUserId: text('assigned_to_user_id').references(() => user.id),
	createdByUserId: text('created_by_user_id').references(() => user.id),
	lastReminderSentAt: timestamp('last_reminder_sent_at', { withTimezone: true, mode: 'date' }),
	createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
		.notNull()
		.default(sql`current_date`),
	updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' })
		.notNull()
		.default(sql`current_date`)
});

export const contractTemplate = sqliteTable('contract_template', {
	id: text('id').primaryKey(),
	tenantId: text('tenant_id')
		.notNull()
		.references(() => tenant.id),
	name: text('name').notNull(),
	description: text('description'),
	content: text('content').notNull(),
	variables: jsonb('variables').$type<string[]>(),
	clausesJson: text('clauses_json'), // JSON array of {number, title, paragraphs[]} for PDF contract generation
	isActive: boolean('is_active').notNull().default(true),
	createdByUserId: text('created_by_user_id')
		.notNull()
		.references(() => user.id),
	createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
		.notNull()
		.default(sql`current_date`),
	updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' })
		.notNull()
		.default(sql`current_date`)
});

export const documentTemplate = sqliteTable('document_template', {
	id: text('id').primaryKey(),
	tenantId: text('tenant_id')
		.notNull()
		.references(() => tenant.id),
	name: text('name').notNull(),
	description: text('description'),
	type: text('type').notNull(), // 'offer', 'contract', 'generic'
	content: text('content').notNull(), // HTML content
	variables:
		jsonb('variables').$type<Array<{ key: string; label: string; defaultValue?: string }>>(),
	styling: jsonb('styling').$type<{
		primaryColor?: string;
		secondaryColor?: string;
		fontFamily?: string;
		fontSize?: string;
		header?: { content: string; height?: number };
		footer?: { content: string; height?: number };
	}>(),
	isActive: boolean('is_active').notNull().default(true),
	createdByUserId: text('created_by_user_id')
		.notNull()
		.references(() => user.id),
	createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
		.notNull()
		.default(sql`current_date`),
	updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' })
		.notNull()
		.default(sql`current_date`)
});

export const document = sqliteTable('document', {
	id: text('id').primaryKey(),
	tenantId: text('tenant_id')
		.notNull()
		.references(() => tenant.id),
	clientId: text('client_id')
		.notNull()
		.references(() => client.id),
	projectId: text('project_id').references(() => project.id),
	documentTemplateId: text('document_template_id').references(() => documentTemplate.id),
	name: text('name').notNull(),
	type: text('type').notNull().default('other'), // 'contract', 'proposal', 'invoice', 'offer', 'other'
	filePath: text('file_path').notNull(),
	fileSize: integer('file_size'),
	mimeType: text('mime_type'),
	renderedContent: text('rendered_content'), // Store rendered HTML for PDF generation
	pdfGenerated: boolean('pdf_generated').notNull().default(false),
	uploadedByUserId: text('uploaded_by_user_id')
		.notNull()
		.references(() => user.id),
	createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
		.notNull()
		.default(sql`current_date`)
});

export const service = sqliteTable('service', {
	id: text('id').primaryKey(),
	tenantId: text('tenant_id')
		.notNull()
		.references(() => tenant.id),
	clientId: text('client_id')
		.notNull()
		.references(() => client.id),
	projectId: text('project_id').references(() => project.id),
	name: text('name').notNull(),
	description: text('description'),
	category: text('category'), // 'Development', 'Design', 'Marketing', 'Consulting', etc.
	price: integer('price'), // in cents
	currency: text('currency').notNull().default('RON'), // 'RON', 'EUR', 'USD', etc.
	recurringType: text('recurring_type').notNull().default('none'), // 'none', 'daily', 'weekly', 'monthly', 'yearly'
	recurringInterval: integer('recurring_interval').notNull().default(1),
	isActive: boolean('is_active').notNull().default(true),
	createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
		.notNull()
		.default(sql`current_date`),
	updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' })
		.notNull()
		.default(sql`current_date`)
});

export const taskComment = sqliteTable('task_comment', {
	id: text('id').primaryKey(),
	taskId: text('task_id')
		.notNull()
		.references(() => task.id, { onDelete: 'cascade' }),
	userId: text('user_id')
		.notNull()
		.references(() => user.id),
	parentCommentId: text('parent_comment_id'),
	content: text('content').notNull(),
	attachmentPath: text('attachment_path'),
	attachmentMimeType: text('attachment_mime_type'),
	attachmentFileName: text('attachment_file_name'),
	attachmentFileSize: integer('attachment_file_size'),
	createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
		.notNull()
		.default(sql`current_date`),
	updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' })
		.notNull()
		.default(sql`current_date`)
});

export const taskWatcher = sqliteTable('task_watcher', {
	id: text('id').primaryKey(),
	taskId: text('task_id')
		.notNull()
		.references(() => task.id, { onDelete: 'cascade' }),
	userId: text('user_id')
		.notNull()
		.references(() => user.id),
	tenantId: text('tenant_id')
		.notNull()
		.references(() => tenant.id),
	createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
		.notNull()
		.default(sql`current_date`)
});

export const taskActivity = sqliteTable('task_activity', {
	id: text('id').primaryKey(),
	taskId: text('task_id')
		.notNull()
		.references(() => task.id, { onDelete: 'cascade' }),
	userId: text('user_id')
		.notNull()
		.references(() => user.id),
	tenantId: text('tenant_id')
		.notNull()
		.references(() => tenant.id),
	action: text('action').notNull(),
	field: text('field'),
	oldValue: text('old_value'),
	newValue: text('new_value'),
	createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
		.notNull()
		.default(sql`current_timestamp`)
});

export const taskMarketingMaterial = sqliteTable('task_marketing_material', {
	id: text('id').primaryKey(),
	tenantId: text('tenant_id')
		.notNull()
		.references(() => tenant.id),
	taskId: text('task_id')
		.notNull()
		.references(() => task.id, { onDelete: 'cascade' }),
	marketingMaterialId: text('marketing_material_id')
		.notNull()
		.references(() => marketingMaterial.id, { onDelete: 'cascade' }),
	addedByUserId: text('added_by_user_id')
		.notNull()
		.references(() => user.id),
	createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
		.notNull()
		.default(sql`current_timestamp`)
});

export const invoice = sqliteTable('invoice', {
	id: text('id').primaryKey(),
	tenantId: text('tenant_id')
		.notNull()
		.references(() => tenant.id),
	clientId: text('client_id')
		.notNull()
		.references(() => client.id),
	contractId: text('contract_id').references(() => contract.id),
	projectId: text('project_id').references(() => project.id),
	serviceId: text('service_id').references(() => service.id),
	invoiceNumber: text('invoice_number').notNull(),
	status: text('status').notNull().default('draft'), // 'draft', 'sent', 'paid', 'overdue', 'cancelled'
	amount: integer('amount'), // in cents
	taxRate: integer('tax_rate'), // in cents, e.g., 2000 = 20%
	taxAmount: integer('tax_amount'), // in cents
	totalAmount: integer('total_amount'), // in cents
	issueDate: timestamp('issue_date', { withTimezone: true, mode: 'date' }),
	dueDate: timestamp('due_date', { withTimezone: true, mode: 'date' }),
	paidDate: timestamp('paid_date', { withTimezone: true, mode: 'date' }),
	lastEmailSentAt: timestamp('last_email_sent_at', { withTimezone: true, mode: 'date' }),
	lastEmailStatus: text('last_email_status'), // 'sent', 'failed', 'pending'
	overdueReminderCount: integer('overdue_reminder_count').notNull().default(0),
	lastOverdueReminderAt: timestamp('last_overdue_reminder_at', { withTimezone: true, mode: 'date' }),
	currency: text('currency').notNull().default('RON'), // 'RON', 'EUR', 'USD', etc.
	notes: text('notes'),
	invoiceSeries: text('invoice_series'), // User-entered invoice series
	invoiceCurrency: text('invoice_currency'), // Invoice display currency (separate from calculation currency)
	paymentTerms: text('payment_terms'), // Payment terms (e.g., "Net 15", "Net 30")
	paymentMethod: text('payment_method'), // Payment method (e.g., "Bank Transfer", "Card", "Cash")
	exchangeRate: text('exchange_rate'), // Exchange rate as string (e.g., "1,0000")
	vatOnCollection: boolean('vat_on_collection').default(false), // VAT on collection flag
	isCreditNote: boolean('is_credit_note').default(false), // Credit note flag
	taxApplicationType: text('tax_application_type'), // 'apply', 'none', 'reverse' - for SmartBill tax name mapping
	discountType: text('discount_type'), // 'none', 'percent', 'value'
	discountValue: integer('discount_value'), // Discount amount in cents
	smartbillSeries: text('smartbill_series'),
	smartbillNumber: text('smartbill_number'),
	keezInvoiceId: text('keez_invoice_id'),
	keezExternalId: text('keez_external_id'),
	keezStatus: text('keez_status'), // 'Draft' (proforma), 'Valid' (fiscal), 'Cancelled'
	spvId: text('spv_id'), // ANAF SPV invoice ID
	createdByUserId: text('created_by_user_id')
		.notNull()
		.references(() => user.id),
	createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
		.notNull()
		.default(sql`current_date`),
	updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' })
		.notNull()
		.default(sql`current_date`)
});

export const invoiceLineItem = sqliteTable('invoice_line_item', {
	id: text('id').primaryKey(),
	invoiceId: text('invoice_id')
		.notNull()
		.references(() => invoice.id, { onDelete: 'cascade' }),
	serviceId: text('service_id').references(() => service.id), // Service ID if item came from a service
	description: text('description').notNull(),
	quantity: integer('quantity').notNull().default(1),
	rate: integer('rate').notNull(), // in cents
	amount: integer('amount').notNull(), // in cents (quantity * rate)
	taxRate: integer('tax_rate'), // Tax rate in cents per item (e.g., 1900 = 19%)
	discountType: text('discount_type'), // 'percent', 'fixed', or null
	discount: integer('discount'), // Discount amount in cents
	note: text('note'), // Item-specific note
	currency: text('currency'), // Item currency (for multi-currency invoices)
	unitOfMeasure: text('unit_of_measure'), // Unit of measure (e.g., "Pcs", "Hours", "Days")
	keezItemExternalId: text('keez_item_external_id'), // Keez item external ID reference
	createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
		.notNull()
		.default(sql`current_date`)
});

export const recurringInvoice = sqliteTable('recurring_invoice', {
	id: text('id').primaryKey(),
	tenantId: text('tenant_id')
		.notNull()
		.references(() => tenant.id),
	clientId: text('client_id')
		.notNull()
		.references(() => client.id),
	contractId: text('contract_id').references(() => contract.id),
	projectId: text('project_id').references(() => project.id),
	serviceId: text('service_id').references(() => service.id),
	name: text('name').notNull(),
	amount: integer('amount').notNull(), // in cents
	taxRate: integer('tax_rate').notNull().default(1900), // in cents, e.g., 1900 = 19%
	currency: text('currency').notNull().default('RON'), // 'RON', 'EUR', 'USD', etc.
	recurringType: text('recurring_type').notNull(), // 'daily', 'weekly', 'monthly', 'yearly'
	recurringInterval: integer('recurring_interval').notNull().default(1), // e.g., 2 for every 2 months
	startDate: timestamp('start_date', { withTimezone: true, mode: 'date' }).notNull(),
	endDate: timestamp('end_date', { withTimezone: true, mode: 'date' }),
	nextRunDate: timestamp('next_run_date', { withTimezone: true, mode: 'date' }).notNull(),
	lastRunDate: timestamp('last_run_date', { withTimezone: true, mode: 'date' }),
	issueDateOffset: integer('issue_date_offset').notNull().default(0), // days offset for issue date
	dueDateOffset: integer('due_date_offset').notNull().default(30), // days offset for due date
	notes: text('notes'),
	lineItemsJson: text('line_items_json'), // JSON string of line items
	isActive: boolean('is_active').notNull().default(true),
	createdByUserId: text('created_by_user_id')
		.notNull()
		.references(() => user.id),
	createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
		.notNull()
		.default(sql`current_date`),
	updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' })
		.notNull()
		.default(sql`current_date`)
});

export const plugin = sqliteTable('plugin', {
	id: text('id').primaryKey(),
	name: text('name').notNull().unique(),
	displayName: text('display_name').notNull(),
	description: text('description'),
	version: text('version').notNull(),
	isActive: boolean('is_active').notNull().default(true),
	config: jsonb('config').$type<Record<string, unknown>>(),
	createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
		.notNull()
		.default(sql`current_date`),
	updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' })
		.notNull()
		.default(sql`current_date`)
});

export const tenantPlugin = sqliteTable('tenant_plugin', {
	id: text('id').primaryKey(),
	tenantId: text('tenant_id')
		.notNull()
		.references(() => tenant.id),
	pluginId: text('plugin_id')
		.notNull()
		.references(() => plugin.id),
	isActive: boolean('is_active').notNull().default(true),
	config: jsonb('config').$type<Record<string, unknown>>(),
	createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
		.notNull()
		.default(sql`current_date`),
	updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' })
		.notNull()
		.default(sql`current_date`)
});

export const invoiceSettings = sqliteTable('invoice_settings', {
	id: text('id').primaryKey(),
	tenantId: text('tenant_id')
		.notNull()
		.references(() => tenant.id)
		.unique(),
	smartbillSeries: text('smartbill_series'),
	smartbillStartNumber: text('smartbill_start_number'),
	smartbillLastSyncedNumber: text('smartbill_last_synced_number'),
	smartbillAutoSync: boolean('smartbill_auto_sync').notNull().default(false),
	smartbillTaxNameApply: text('smartbill_tax_name_apply'), // Tax name for 'apply' type (default: 'Normala')
	smartbillTaxNameNone: text('smartbill_tax_name_none'), // Tax name for 'none' type (default: 'Neimpozabil')
	smartbillTaxNameReverse: text('smartbill_tax_name_reverse'), // Tax name for 'reverse' type (default: 'Taxare inversa')
	keezSeries: text('keez_series'),
	keezStartNumber: text('keez_start_number'),
	keezLastSyncedNumber: text('keez_last_synced_number'),
	keezAutoSync: boolean('keez_auto_sync').notNull().default(false),
	keezDefaultPaymentTypeId: integer('keez_default_payment_type_id').default(3), // 1=BFCash, 2=BFCard, 3=Bank, 4=ChitCash, etc.
	defaultCurrency: text('default_currency').notNull().default('RON'), // 'RON', 'EUR', 'USD'
	defaultTaxRate: integer('default_tax_rate').notNull().default(19), // VAT percentage, e.g., 19 for 19%
	invoiceEmailsEnabled: boolean('invoice_emails_enabled').notNull().default(true),
	sendInvoiceEmailEnabled: boolean('send_invoice_email_enabled').notNull().default(true),
	paidConfirmationEmailEnabled: boolean('paid_confirmation_email_enabled').notNull().default(true),
	overdueReminderEnabled: boolean('overdue_reminder_enabled').notNull().default(false),
	overdueReminderDaysAfterDue: integer('overdue_reminder_days_after_due').notNull().default(3),
	overdueReminderRepeatDays: integer('overdue_reminder_repeat_days').notNull().default(7),
	overdueReminderMaxCount: integer('overdue_reminder_max_count').notNull().default(3),
	autoSendRecurringInvoices: boolean('auto_send_recurring_invoices').notNull().default(false),
	invoiceLogo: text('invoice_logo'), // base64-encoded logo image for invoice PDFs
	createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
		.notNull()
		.default(sql`current_date`),
	updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' })
		.notNull()
		.default(sql`current_date`)
});

export const taskSettings = sqliteTable('task_settings', {
	id: text('id').primaryKey(),
	tenantId: text('tenant_id')
		.notNull()
		.references(() => tenant.id)
		.unique(),
	taskRemindersEnabled: boolean('task_reminders_enabled').notNull().default(true),
	// Client email notification toggles
	clientEmailsEnabled: boolean('client_emails_enabled').notNull().default(false),
	clientEmailOnTaskCreated: boolean('client_email_on_task_created').notNull().default(true),
	clientEmailOnStatusChange: boolean('client_email_on_status_change').notNull().default(true),
	clientEmailOnComment: boolean('client_email_on_comment').notNull().default(true),
	clientEmailOnTaskModified: boolean('client_email_on_task_modified').notNull().default(true),
	// Internal notification toggles
	internalEmailOnComment: boolean('internal_email_on_comment').notNull().default(true),
	createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
		.notNull()
		.default(sql`current_date`),
	updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' })
		.notNull()
		.default(sql`current_date`)
});

export const userWorkHours = sqliteTable('user_work_hours', {
	id: text('id').primaryKey(),
	userId: text('user_id')
		.notNull()
		.references(() => user.id),
	tenantId: text('tenant_id')
		.notNull()
		.references(() => tenant.id),
	workStartTime: text('work_start_time'), // Format "HH:MM", e.g., "09:00"
	workEndTime: text('work_end_time'), // Format "HH:MM", e.g., "17:00"
	workDays: jsonb('work_days').$type<string[]>(), // Array of day names: ["monday", "tuesday", ...]
	remindersEnabled: boolean('reminders_enabled').notNull().default(true),
	createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
		.notNull()
		.default(sql`current_date`),
	updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' })
		.notNull()
		.default(sql`current_date`)
});

export const emailSettings = sqliteTable('email_settings', {
	id: text('id').primaryKey(),
	tenantId: text('tenant_id')
		.notNull()
		.references(() => tenant.id)
		.unique(),
	smtpHost: text('smtp_host'),
	smtpPort: integer('smtp_port').default(587),
	smtpSecure: boolean('smtp_secure').default(false), // true for 465, false for other ports
	smtpUser: text('smtp_user'),
	smtpPassword: text('smtp_password'), // encrypted
	smtpFrom: text('smtp_from'), // From email address (optional, defaults to smtp_user)
	isEnabled: boolean('is_enabled').notNull().default(true),
	createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
		.notNull()
		.default(sql`current_date`),
	updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' })
		.notNull()
		.default(sql`current_date`)
});

export const smartbillIntegration = sqliteTable('smartbill_integration', {
	id: text('id').primaryKey(),
	tenantId: text('tenant_id')
		.notNull()
		.references(() => tenant.id)
		.unique(),
	email: text('email').notNull(),
	token: text('token').notNull(), // encrypted
	isActive: boolean('is_active').notNull().default(true),
	lastSyncAt: timestamp('last_sync_at', { withTimezone: true, mode: 'date' }),
	createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
		.notNull()
		.default(sql`current_date`),
	updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' })
		.notNull()
		.default(sql`current_date`)
});

export const smartbillInvoiceSync = sqliteTable('smartbill_invoice_sync', {
	id: text('id').primaryKey(),
	invoiceId: text('invoice_id')
		.notNull()
		.references(() => invoice.id, { onDelete: 'cascade' }),
	tenantId: text('tenant_id')
		.notNull()
		.references(() => tenant.id),
	smartbillSeries: text('smartbill_series').notNull(),
	smartbillNumber: text('smartbill_number').notNull(),
	smartbillCif: text('smartbill_cif').notNull(),
	syncDirection: text('sync_direction').notNull(), // 'push', 'pull', 'both'
	lastSyncedAt: timestamp('last_synced_at', { withTimezone: true, mode: 'date' }),
	syncStatus: text('sync_status').notNull().default('pending'), // 'pending', 'synced', 'error'
	errorMessage: text('error_message'),
	createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
		.notNull()
		.default(sql`current_date`),
	updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' })
		.notNull()
		.default(sql`current_date`)
});

export const keezIntegration = sqliteTable('keez_integration', {
	id: text('id').primaryKey(),
	tenantId: text('tenant_id')
		.notNull()
		.references(() => tenant.id)
		.unique(),
	clientEid: text('client_eid').notNull(),
	applicationId: text('application_id').notNull(),
	secret: text('secret').notNull(), // encrypted
	accessToken: text('access_token'), // encrypted, cached token
	tokenExpiresAt: timestamp('token_expires_at', { withTimezone: true, mode: 'date' }),
	isActive: boolean('is_active').notNull().default(true),
	lastSyncAt: timestamp('last_sync_at', { withTimezone: true, mode: 'date' }),
	createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
		.notNull()
		.default(sql`current_date`),
	updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' })
		.notNull()
		.default(sql`current_date`)
});

export const keezInvoiceSync = sqliteTable('keez_invoice_sync', {
	id: text('id').primaryKey(),
	invoiceId: text('invoice_id')
		.notNull()
		.references(() => invoice.id, { onDelete: 'cascade' }),
	tenantId: text('tenant_id')
		.notNull()
		.references(() => tenant.id),
	keezInvoiceId: text('keez_invoice_id').notNull(),
	keezExternalId: text('keez_external_id'),
	syncDirection: text('sync_direction').notNull(), // 'push', 'pull', 'both'
	lastSyncedAt: timestamp('last_synced_at', { withTimezone: true, mode: 'date' }),
	syncStatus: text('sync_status').notNull().default('pending'), // 'pending', 'synced', 'error'
	errorMessage: text('error_message'),
	createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
		.notNull()
		.default(sql`current_date`),
	updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' })
		.notNull()
		.default(sql`current_date`)
});

export const anafSpvIntegration = sqliteTable('anaf_spv_integration', {
	id: text('id').primaryKey(),
	tenantId: text('tenant_id')
		.notNull()
		.references(() => tenant.id)
		.unique(),
	clientId: text('client_id'), // encrypted
	clientSecret: text('client_secret'), // encrypted
	accessToken: text('access_token'), // encrypted, nullable for OAuth flow
	refreshToken: text('refresh_token'), // encrypted, nullable for OAuth flow
	expiresAt: timestamp('expires_at', { withTimezone: true, mode: 'date' }),
	isActive: boolean('is_active').notNull().default(true),
	lastSyncAt: timestamp('last_sync_at', { withTimezone: true, mode: 'date' }),
	createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
		.notNull()
		.default(sql`current_date`),
	updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' })
		.notNull()
		.default(sql`current_date`)
});

export const anafSpvInvoiceSync = sqliteTable('anaf_spv_invoice_sync', {
	id: text('id').primaryKey(),
	invoiceId: text('invoice_id').references(() => invoice.id, { onDelete: 'cascade' }), // For push operations (our invoices to SPV)
	expenseId: text('expense_id').references(() => expense.id, { onDelete: 'cascade' }), // For pull operations (expenses from SPV)
	tenantId: text('tenant_id')
		.notNull()
		.references(() => tenant.id),
	spvId: text('spv_id').notNull(), // ANAF SPV invoice ID
	syncDirection: text('sync_direction').notNull(), // 'pull', 'push'
	lastSyncedAt: timestamp('last_synced_at', { withTimezone: true, mode: 'date' }),
	syncStatus: text('sync_status').notNull().default('pending'), // 'pending', 'synced', 'error'
	errorMessage: text('error_message'),
	createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
		.notNull()
		.default(sql`current_date`),
	updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' })
		.notNull()
		.default(sql`current_date`)
});

export const keezClientSync = sqliteTable('keez_client_sync', {
	id: text('id').primaryKey(),
	clientId: text('client_id')
		.notNull()
		.references(() => client.id, { onDelete: 'cascade' }),
	tenantId: text('tenant_id')
		.notNull()
		.references(() => tenant.id),
	keezPartnerId: text('keez_partner_id').notNull(),
	keezExternalId: text('keez_external_id'),
	lastSyncedAt: timestamp('last_synced_at', { withTimezone: true, mode: 'date' }),
	syncStatus: text('sync_status').notNull().default('synced'), // 'synced', 'error'
	errorMessage: text('error_message'),
	createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
		.notNull()
		.default(sql`current_date`),
	updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' })
		.notNull()
		.default(sql`current_date`)
});

export const revolutIntegration = sqliteTable('revolut_integration', {
	id: text('id').primaryKey(),
	tenantId: text('tenant_id')
		.notNull()
		.references(() => tenant.id)
		.unique(),
	clientId: text('client_id'), // From Revolut Business app after certificate upload
	privateKey: text('private_key').notNull(), // Encrypted private key (PEM format)
	publicCertificate: text('public_certificate').notNull(), // Public certificate (PEM format) - stored for display
	redirectUri: text('redirect_uri'), // Must match what's configured in Revolut
	isActive: boolean('is_active').notNull().default(true),
	createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
		.notNull()
		.default(sql`current_date`),
	updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' })
		.notNull()
		.default(sql`current_date`)
});

export const bankAccount = sqliteTable('bank_account', {
	id: text('id').primaryKey(),
	tenantId: text('tenant_id')
		.notNull()
		.references(() => tenant.id),
	bankName: text('bank_name').notNull(), // 'revolut', 'transilvania', 'bcr'
	accountId: text('account_id').notNull(), // Bank's account identifier
	iban: text('iban').notNull(),
	accountName: text('account_name'),
	currency: text('currency').notNull().default('RON'), // 'RON', 'EUR', 'USD', etc.
	accessToken: text('access_token').notNull(), // encrypted
	refreshToken: text('refresh_token').notNull(), // encrypted
	tokenExpiresAt: timestamp('token_expires_at', { withTimezone: true, mode: 'date' }),
	isActive: boolean('is_active').notNull().default(true),
	lastSyncedAt: timestamp('last_synced_at', { withTimezone: true, mode: 'date' }),
	createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
		.notNull()
		.default(sql`current_date`),
	updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' })
		.notNull()
		.default(sql`current_date`)
});

export const bankTransaction = sqliteTable('bank_transaction', {
	id: text('id').primaryKey(),
	tenantId: text('tenant_id')
		.notNull()
		.references(() => tenant.id),
	bankAccountId: text('bank_account_id')
		.notNull()
		.references(() => bankAccount.id, { onDelete: 'cascade' }),
	transactionId: text('transaction_id').notNull(), // Bank's transaction ID
	amount: integer('amount').notNull(), // in cents, negative for outgoing
	currency: text('currency').notNull().default('RON'),
	date: timestamp('date', { withTimezone: true, mode: 'date' }).notNull(),
	description: text('description'),
	reference: text('reference'), // Transaction reference/payment reference
	counterpartIban: text('counterpart_iban'),
	counterpartName: text('counterpart_name'),
	category: text('category'),
	isExpense: boolean('is_expense').notNull().default(false), // true for outgoing transactions
	expenseId: text('expense_id'), // References expense.id (defined after)
	matchedInvoiceId: text('matched_invoice_id').references(() => invoice.id),
	matchingMethod: text('matching_method'), // 'iban-amount', 'invoice-number', 'manual'
	createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
		.notNull()
		.default(sql`current_date`),
	updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' })
		.notNull()
		.default(sql`current_date`)
});

export const supplier = sqliteTable('supplier', {
	id: text('id').primaryKey(),
	tenantId: text('tenant_id')
		.notNull()
		.references(() => tenant.id),
	name: text('name').notNull(),
	email: text('email'),
	phone: text('phone'),
	companyType: text('company_type'),
	cui: text('cui'),
	registrationNumber: text('registration_number'),
	tradeRegister: text('trade_register'),
	vatNumber: text('vat_number'),
	legalRepresentative: text('legal_representative'),
	iban: text('iban'),
	bankName: text('bank_name'),
	address: text('address'),
	city: text('city'),
	county: text('county'),
	postalCode: text('postal_code'),
	country: text('country').default('România'),
	notes: text('notes'),
	createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
		.notNull()
		.default(sql`current_date`),
	updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' })
		.notNull()
		.default(sql`current_date`)
});

export const userBankAccount = sqliteTable('user_bank_account', {
	id: text('id').primaryKey(),
	tenantId: text('tenant_id')
		.notNull()
		.references(() => tenant.id),
	userId: text('user_id')
		.notNull()
		.references(() => user.id),
	iban: text('iban').notNull(),
	bankName: text('bank_name'),
	accountName: text('account_name'),
	currency: text('currency').notNull().default('RON'),
	isActive: boolean('is_active').notNull().default(true),
	createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
		.notNull()
		.default(sql`current_date`),
	updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' })
		.notNull()
		.default(sql`current_date`)
});

export const expense = sqliteTable('expense', {
	id: text('id').primaryKey(),
	tenantId: text('tenant_id')
		.notNull()
		.references(() => tenant.id),
	bankTransactionId: text('bank_transaction_id'), // References bankTransaction.id (defined before)
	supplierId: text('supplier_id').references(() => supplier.id),
	clientId: text('client_id').references(() => client.id),
	userId: text('user_id').references(() => user.id), // User who made this expense
	projectId: text('project_id').references(() => project.id),
	category: text('category'),
	description: text('description').notNull(),
	amount: integer('amount').notNull(), // in cents
	currency: text('currency').notNull().default('RON'),
	date: timestamp('date', { withTimezone: true, mode: 'date' }).notNull(),
	vatRate: integer('vat_rate'), // in cents, e.g., 1900 = 19%
	vatAmount: integer('vat_amount'), // in cents
	receiptPath: text('receipt_path'), // File path for receipt upload
	invoicePath: text('invoice_path'), // File path for invoice upload
	isPaid: boolean('is_paid').notNull().default(false), // Whether the expense has been paid (linked to a bank transaction)
	supplierInvoiceId: text('supplier_invoice_id').references(() => supplierInvoice.id),
	createdByUserId: text('created_by_user_id')
		.notNull()
		.references(() => user.id),
	createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
		.notNull()
		.default(sql`current_date`),
	updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' })
		.notNull()
		.default(sql`current_date`)
});

export const transactionInvoiceMatch = sqliteTable('transaction_invoice_match', {
	id: text('id').primaryKey(),
	tenantId: text('tenant_id')
		.notNull()
		.references(() => tenant.id),
	transactionId: text('transaction_id')
		.notNull()
		.references(() => bankTransaction.id, { onDelete: 'cascade' }),
	invoiceId: text('invoice_id')
		.notNull()
		.references(() => invoice.id, { onDelete: 'cascade' }),
	matchingMethod: text('matching_method').notNull(), // 'iban-amount', 'invoice-number', 'manual'
	matchedAt: timestamp('matched_at', { withTimezone: true, mode: 'date' })
		.notNull()
		.default(sql`current_date`),
	matchedByUserId: text('matched_by_user_id').references(() => user.id)
});

export const transactionMatchRule = sqliteTable('transaction_match_rule', {
	id: text('id').primaryKey(),
	tenantId: text('tenant_id')
		.notNull()
		.references(() => tenant.id),
	// What this rule matches to
	matchType: text('match_type').notNull(), // 'supplier' | 'client' | 'user' | 'expense'
	supplierId: text('supplier_id').references(() => supplier.id),
	clientId: text('client_id').references(() => client.id),
	userId: text('user_id').references(() => user.id),
	expenseId: text('expense_id').references(() => expense.id), // For expense matching rules
	amount: integer('amount'), // Expense amount in cents (for expense matching rules)
	// Matching criteria (learned from transactions)
	counterpartIban: text('counterpart_iban'), // Normalized IBAN for bank transfers
	counterpartName: text('counterpart_name'), // Merchant/supplier name for card payments
	descriptionPattern: text('description_pattern'), // Pattern extracted from description
	referencePattern: text('reference_pattern'), // Pattern from transaction reference
	// Metadata
	matchCount: integer('match_count').notNull().default(0), // How many times this rule matched
	lastMatchedAt: timestamp('last_matched_at', { withTimezone: true, mode: 'date' }),
	createdByUserId: text('created_by_user_id').references(() => user.id), // Who created the rule
	createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
		.notNull()
		.default(sql`current_date`),
	updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' })
		.notNull()
		.default(sql`current_date`)
});

export const seoLink = sqliteTable('seo_link', {
	id: text('id').primaryKey(),
	tenantId: text('tenant_id')
		.notNull()
		.references(() => tenant.id),
	clientId: text('client_id')
		.notNull()
		.references(() => client.id),
	pressTrust: text('press_trust'), // Trust de presă - platforma (e.g. "Gândul", "Adevărul")
	month: text('month').notNull(), // Format YYYY-MM (luna plasării)
	keyword: text('keyword').notNull(),
	linkType: text('link_type'), // 'article', 'guest-post', 'press-release', 'directory', 'other'
	linkAttribute: text('link_attribute').notNull().default('dofollow'), // 'dofollow', 'nofollow'
	status: text('status').notNull().default('pending'), // 'pending', 'submitted', 'published', 'rejected'
	articleUrl: text('article_url').notNull(),
	articlePublishedAt: text('article_published_at'), // Data publicării articolului (ISO 8601), extrasă din articol
	targetUrl: text('target_url'), // URL-ul paginii clientului unde pointează linkul
	price: integer('price'), // in cents
	currency: text('currency').notNull().default('RON'),
	anchorText: text('anchor_text'), // Textul ancorat al linkului
	websiteId: text('website_id').references(() => clientWebsite.id),
	projectId: text('project_id').references(() => project.id),
	notes: text('notes'),
	// Link check status (last verification result)
	lastCheckedAt: timestamp('last_checked_at', { withTimezone: true, mode: 'date' }),
	lastCheckStatus: text('last_check_status'), // 'ok' | 'unreachable' | 'timeout' | 'redirect' | 'error'
	lastCheckHttpCode: integer('last_check_http_code'),
	lastCheckError: text('last_check_error'),
	lastCheckDofollow: text('last_check_dofollow'), // 'dofollow' | 'nofollow' - verified from page, null = neverificat
	extractedLinks: text('extracted_links'), // JSON: [{keyword, url}] - all links to client found in article
	articleType: text('article_type'), // 'gdrive' | 'press-article' | 'seo-article' | null
	gdriveUrl: text('gdrive_url'), // Google Drive link (used when articleType = 'gdrive')
	createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
		.notNull()
		.default(sql`current_date`),
	updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' })
		.notNull()
		.default(sql`current_date`)
});

export const clientWebsite = sqliteTable('client_website', {
	id: text('id').primaryKey(),
	tenantId: text('tenant_id')
		.notNull()
		.references(() => tenant.id),
	clientId: text('client_id')
		.notNull()
		.references(() => client.id),
	name: text('name'), // ex: "Site principal", "Shop", "Blog"
	url: text('url').notNull(), // ex: "https://brand-a.ro"
	isDefault: boolean('is_default').notNull().default(false),
	createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
		.notNull()
		.default(sql`current_date`),
	updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' })
		.notNull()
		.default(sql`current_date`)
});

export const clientSecondaryEmail = sqliteTable('client_secondary_email', {
	id: text('id').primaryKey(),
	tenantId: text('tenant_id')
		.notNull()
		.references(() => tenant.id),
	clientId: text('client_id')
		.notNull()
		.references(() => client.id),
	email: text('email').notNull(),
	label: text('label'),
	notifyInvoices: boolean('notify_invoices').notNull().default(false),
	notifyTasks: boolean('notify_tasks').notNull().default(false),
	notifyContracts: boolean('notify_contracts').notNull().default(false),
	createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
		.notNull()
		.default(sql`current_date`),
	updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' })
		.notNull()
		.default(sql`current_date`)
});

export const seoLinkCheck = sqliteTable('seo_link_check', {
	id: text('id').primaryKey(),
	seoLinkId: text('seo_link_id')
		.notNull()
		.references(() => seoLink.id, { onDelete: 'cascade' }),
	checkedAt: timestamp('checked_at', { withTimezone: true, mode: 'date' })
		.notNull()
		.default(sql`current_date`),
	status: text('status').notNull(), // 'ok' | 'unreachable' | 'timeout' | 'redirect' | 'error'
	httpCode: integer('http_code'),
	responseTimeMs: integer('response_time_ms'),
	errorMessage: text('error_message')
});

// ==================== CONTRACT TABLES ====================

export const contract = sqliteTable('contract', {
	id: text('id').primaryKey(),
	tenantId: text('tenant_id')
		.notNull()
		.references(() => tenant.id),
	clientId: text('client_id')
		.notNull()
		.references(() => client.id),
	templateId: text('template_id').references(() => contractTemplate.id),

	// Contract identification
	contractNumber: text('contract_number').notNull(),
	contractDate: timestamp('contract_date', { withTimezone: true, mode: 'date' }).notNull(),
	contractTitle: text('contract_title').notNull().default('PRESTARI SERVICII INFORMATICE'),
	status: text('status').notNull().default('draft'), // 'draft', 'sent', 'signed', 'active', 'expired', 'cancelled'

	// Section 2: Object/scope
	serviceDescription: text('service_description'),
	offerLink: text('offer_link'),

	// Section 3: Payment
	currency: text('currency').notNull().default('EUR'),
	paymentTermsDays: integer('payment_terms_days').notNull().default(5),
	penaltyRate: integer('penalty_rate').notNull().default(50), // basis points per day (50 = 0.5%)
	billingFrequency: text('billing_frequency').notNull().default('monthly'), // 'monthly', 'one-time', 'quarterly', 'yearly'

	// Section 4: Duration
	contractDurationMonths: integer('contract_duration_months').notNull().default(6),

	// Discount
	discountPercent: integer('discount_percent'),

	// Contact / notification
	prestatorEmail: text('prestator_email'),
	beneficiarEmail: text('beneficiar_email'),

	// Additional services rate
	hourlyRate: integer('hourly_rate').notNull().default(6000), // in cents (6000 = 60 EUR)
	hourlyRateCurrency: text('hourly_rate_currency').notNull().default('EUR'),

	// Signatures
	prestatorSignatureName: text('prestator_signature_name'),
	beneficiarSignatureName: text('beneficiar_signature_name'),
	prestatorSignatureImage: text('prestator_signature_image'),
	beneficiarSignatureImage: text('beneficiar_signature_image'),
	prestatorSignedAt: timestamp('prestator_signed_at', { withTimezone: true, mode: 'date' }),
	beneficiarSignedAt: timestamp('beneficiar_signed_at', { withTimezone: true, mode: 'date' }),

	// Legal clauses (copied from template, editable per contract)
	clausesJson: text('clauses_json'),

	notes: text('notes'),

	// Uploaded contract file (for contracts uploaded as PDF instead of generated)
	uploadedFilePath: text('uploaded_file_path'),
	uploadedFileSize: integer('uploaded_file_size'),
	uploadedFileMimeType: text('uploaded_file_mime_type'),

	// Optimistic locking
	version: integer('version').notNull().default(1),

	createdByUserId: text('created_by_user_id')
		.notNull()
		.references(() => user.id),
	createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
		.notNull()
		.default(sql`current_date`),
	updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' })
		.notNull()
		.default(sql`current_date`)
});

export const contractActivity = sqliteTable('contract_activity', {
	id: text('id').primaryKey(),
	contractId: text('contract_id')
		.notNull()
		.references(() => contract.id, { onDelete: 'cascade' }),
	userId: text('user_id'),
	tenantId: text('tenant_id')
		.notNull()
		.references(() => tenant.id),
	action: text('action').notNull(),
	field: text('field'),
	oldValue: text('old_value'),
	newValue: text('new_value'),
	createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
		.notNull()
		.default(sql`current_timestamp`)
});

export const contractLineItem = sqliteTable('contract_line_item', {
	id: text('id').primaryKey(),
	contractId: text('contract_id')
		.notNull()
		.references(() => contract.id, { onDelete: 'cascade' }),
	description: text('description').notNull(),
	price: integer('price').notNull(), // in cents
	unitOfMeasure: text('unit_of_measure').notNull().default('Luna'),
	sortOrder: integer('sort_order').notNull().default(0),
	createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
		.notNull()
		.default(sql`current_date`)
});

export const clientUser = sqliteTable('client_user', {
	id: text('id').primaryKey(),
	userId: text('user_id')
		.notNull()
		.references(() => user.id),
	clientId: text('client_id')
		.notNull()
		.references(() => client.id),
	tenantId: text('tenant_id')
		.notNull()
		.references(() => tenant.id),
	isPrimary: boolean('is_primary').notNull().default(true),
	createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
		.notNull()
		.default(sql`current_date`),
	updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' })
		.notNull()
		.default(sql`current_date`)
});

export const clientUserPreferences = sqliteTable('client_user_preferences', {
	id: text('id').primaryKey(),
	clientUserId: text('client_user_id')
		.notNull()
		.references(() => clientUser.id, { onDelete: 'cascade' })
		.unique(),
	tenantId: text('tenant_id')
		.notNull()
		.references(() => tenant.id),
	// Email notification preferences
	notifyTaskStatusChange: boolean('notify_task_status_change').notNull().default(true),
	notifyNewComment: boolean('notify_new_comment').notNull().default(true),
	notifyApproachingDeadline: boolean('notify_approaching_deadline').notNull().default(true),
	notifyTaskAssigned: boolean('notify_task_assigned').notNull().default(true),
	notifyTaskApprovedRejected: boolean('notify_task_approved_rejected').notNull().default(true),
	// Visual preferences
	defaultTaskView: text('default_task_view').default('card'), // 'list' | 'card'
	defaultTaskSort: text('default_task_sort').default('date'), // 'date' | 'priority' | 'status'
	itemsPerPage: integer('items_per_page').default(25), // 10 | 25 | 50
	// Task creation defaults
	defaultPriority: text('default_priority').default('medium'), // 'low' | 'medium' | 'high' | 'urgent'
	// Timestamps
	createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
		.notNull()
		.default(sql`current_date`),
	updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' })
		.notNull()
		.default(sql`current_date`)
});

export const magicLinkToken = sqliteTable('magic_link_token', {
	id: text('id').primaryKey(),
	token: text('token').notNull().unique(), // Hashed token
	email: text('email').notNull(),
	clientId: text('client_id').references(() => client.id), // Nullable for initial signup
	tenantId: text('tenant_id')
		.notNull()
		.references(() => tenant.id),
	expiresAt: timestamp('expires_at', { withTimezone: true, mode: 'date' }).notNull(),
	used: boolean('used').notNull().default(false),
	usedAt: timestamp('used_at', { withTimezone: true, mode: 'date' }),
	createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
		.notNull()
		.default(sql`current_date`)
});

export const adminMagicLinkToken = sqliteTable('admin_magic_link_token', {
	id: text('id').primaryKey(),
	token: text('token').notNull().unique(), // Hashed token
	email: text('email').notNull(),
	expiresAt: timestamp('expires_at', { withTimezone: true, mode: 'date' }).notNull(),
	used: boolean('used').notNull().default(false),
	usedAt: timestamp('used_at', { withTimezone: true, mode: 'date' }),
	createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
		.notNull()
		.default(sql`current_date`)
});

export const contractSignToken = sqliteTable('contract_sign_token', {
	id: text('id').primaryKey(),
	token: text('token').notNull().unique(), // Hashed token
	contractId: text('contract_id')
		.notNull()
		.references(() => contract.id, { onDelete: 'cascade' }),
	tenantId: text('tenant_id')
		.notNull()
		.references(() => tenant.id),
	email: text('email').notNull(),
	signingUrl: text('signing_url'),
	expiresAt: timestamp('expires_at', { withTimezone: true, mode: 'date' }).notNull(),
	used: boolean('used').notNull().default(false),
	usedAt: timestamp('used_at', { withTimezone: true, mode: 'date' }),
	createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
		.notNull()
		.default(sql`current_date`)
});

export const gmailIntegration = sqliteTable('gmail_integration', {
	id: text('id').primaryKey(),
	tenantId: text('tenant_id')
		.notNull()
		.references(() => tenant.id),
	email: text('email').notNull(),
	accessToken: text('access_token').notNull(),
	refreshToken: text('refresh_token').notNull(),
	tokenExpiresAt: timestamp('token_expires_at', { withTimezone: true, mode: 'date' }).notNull(),
	isActive: boolean('is_active').notNull().default(true),
	lastSyncAt: timestamp('last_sync_at', { withTimezone: true, mode: 'date' }),
	syncEnabled: boolean('sync_enabled').notNull().default(true),
	syncInterval: text('sync_interval').notNull().default('daily'), // 'daily' | 'twice_daily' | 'weekly'
	syncParserIds: text('sync_parser_ids'), // JSON array string or null (= all)
	syncDateRangeDays: integer('sync_date_range_days').notNull().default(7),
	lastSyncResults: text('last_sync_results'), // JSON string with {imported, errors, timestamp}
	customMonitoredEmails: text('custom_monitored_emails'), // JSON: [{label: string, value: string}]
	monitoredSupplierIds: text('monitored_supplier_ids'), // JSON: string[] (supplier IDs)
	excludeEmails: text('exclude_emails'), // JSON: string[] (email/domain patterns)
	createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
		.notNull()
		.default(sql`current_date`),
	updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' })
		.notNull()
		.default(sql`current_date`)
});

export const supplierInvoice = sqliteTable('supplier_invoice', {
	id: text('id').primaryKey(),
	tenantId: text('tenant_id')
		.notNull()
		.references(() => tenant.id),
	supplierId: text('supplier_id').references(() => supplier.id),
	invoiceNumber: text('invoice_number'),
	amount: integer('amount'), // in cents
	currency: text('currency').notNull().default('USD'),
	issueDate: timestamp('issue_date', { withTimezone: true, mode: 'date' }),
	dueDate: timestamp('due_date', { withTimezone: true, mode: 'date' }),
	status: text('status').notNull().default('pending'), // 'paid', 'unpaid', 'pending'
	pdfPath: text('pdf_path'),
	gmailMessageId: text('gmail_message_id'), // for deduplication
	emailSubject: text('email_subject'),
	emailFrom: text('email_from'),
	supplierType: text('supplier_type'), // 'cpanel', 'whmcs', 'hetzner', 'google', 'unknown'
	rawEmailData: text('raw_email_data'), // JSON with email metadata for debugging
	importedAt: timestamp('imported_at', { withTimezone: true, mode: 'date' }),
	createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
		.notNull()
		.default(sql`current_date`),
	updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' })
		.notNull()
		.default(sql`current_date`)
});

export const googleAdsIntegration = sqliteTable('google_ads_integration', {
	id: text('id').primaryKey(),
	tenantId: text('tenant_id')
		.notNull()
		.references(() => tenant.id),
	email: text('email').notNull(),
	accessToken: text('access_token').notNull(),
	refreshToken: text('refresh_token').notNull(),
	tokenExpiresAt: timestamp('token_expires_at', { withTimezone: true, mode: 'date' }).notNull(),
	isActive: boolean('is_active').notNull().default(true),
	mccAccountId: text('mcc_account_id').notNull(), // MCC (Manager) account ID, no dashes
	developerToken: text('developer_token').notNull(),
	lastSyncAt: timestamp('last_sync_at', { withTimezone: true, mode: 'date' }),
	syncEnabled: boolean('sync_enabled').notNull().default(true),
	lastSyncResults: text('last_sync_results'), // JSON: {imported, errors, timestamp}
	googleSessionCookies: text('google_session_cookies'), // AES-256-GCM encrypted Google session cookies
	googleSessionStatus: text('google_session_status').notNull().default('none'), // 'none' | 'active'
	createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
		.notNull()
		.default(sql`current_date`),
	updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' })
		.notNull()
		.default(sql`current_date`)
});

// Google Ads sub-accounts cached from MCC — each can be assigned to a CRM client
export const googleAdsAccount = sqliteTable('google_ads_account', {
	id: text('id').primaryKey(),
	tenantId: text('tenant_id')
		.notNull()
		.references(() => tenant.id),
	googleAdsCustomerId: text('google_ads_customer_id').notNull(), // Sub-account ID (no dashes)
	accountName: text('account_name').notNull(), // Descriptive name from Google Ads
	currencyCode: text('currency_code').notNull().default('USD'), // Account currency from Google Ads API
	clientId: text('client_id').references(() => client.id), // Mapped CRM client (nullable)
	isActive: boolean('is_active').notNull().default(true),
	lastFetchedAt: timestamp('last_fetched_at', { withTimezone: true, mode: 'date' }),
	createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
		.notNull()
		.default(sql`current_date`),
	updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' })
		.notNull()
		.default(sql`current_date`)
});

export const googleAdsInvoice = sqliteTable('google_ads_invoice', {
	id: text('id').primaryKey(),
	tenantId: text('tenant_id')
		.notNull()
		.references(() => tenant.id),
	clientId: text('client_id')
		.notNull()
		.references(() => client.id),
	googleAdsCustomerId: text('google_ads_customer_id').notNull(),
	googleInvoiceId: text('google_invoice_id').notNull(), // For deduplication
	invoiceNumber: text('invoice_number'),
	issueDate: timestamp('issue_date', { withTimezone: true, mode: 'date' }),
	dueDate: timestamp('due_date', { withTimezone: true, mode: 'date' }),
	subtotalAmountMicros: integer('subtotal_amount_micros'),
	totalAmountMicros: integer('total_amount_micros'),
	currencyCode: text('currency_code').notNull().default('EUR'),
	invoiceType: text('invoice_type'), // 'INVOICE', 'CREDIT_MEMO'
	pdfPath: text('pdf_path'),
	status: text('status').notNull().default('synced'), // 'synced', 'download_failed'
	syncedAt: timestamp('synced_at', { withTimezone: true, mode: 'date' }),
	createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
		.notNull()
		.default(sql`current_date`),
	updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' })
		.notNull()
		.default(sql`current_date`)
});

// Google Ads spending — periodic spend data per account/client (mirrors meta_ads_spending pattern)
export const googleAdsSpending = sqliteTable('google_ads_spending', {
	id: text('id').primaryKey(),
	tenantId: text('tenant_id')
		.notNull()
		.references(() => tenant.id),
	clientId: text('client_id')
		.notNull()
		.references(() => client.id),
	googleAdsCustomerId: text('google_ads_customer_id').notNull(),
	periodStart: text('period_start').notNull(), // "2026-02-01"
	periodEnd: text('period_end').notNull(), // "2026-02-28"
	spendAmount: text('spend_amount').notNull().default('0'), // raw from API e.g. "2207.59"
	spendCents: integer('spend_cents').notNull().default(0),
	currencyCode: text('currency_code').notNull().default('EUR'),
	impressions: integer('impressions').default(0),
	clicks: integer('clicks').default(0),
	conversions: integer('conversions').default(0),
	syncedAt: timestamp('synced_at', { withTimezone: true, mode: 'date' }),
	createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
		.notNull()
		.default(sql`current_date`),
	updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' })
		.notNull()
		.default(sql`current_date`)
});

// Meta Ads integration — multiple per tenant (one per Business Manager)
export const metaAdsIntegration = sqliteTable('meta_ads_integration', {
	id: text('id').primaryKey(),
	tenantId: text('tenant_id')
		.notNull()
		.references(() => tenant.id),
	businessId: text('business_id').notNull(), // Meta Business Manager ID
	businessName: text('business_name').notNull().default(''),
	email: text('email').notNull().default(''),
	accessToken: text('access_token').notNull().default(''),
	tokenExpiresAt: timestamp('token_expires_at', { withTimezone: true, mode: 'date' }),
	isActive: boolean('is_active').notNull().default(false),
	syncEnabled: boolean('sync_enabled').notNull().default(true),
	lastSyncAt: timestamp('last_sync_at', { withTimezone: true, mode: 'date' }),
	lastSyncResults: text('last_sync_results'), // JSON: {imported, errors, timestamp}
	fbSessionCookies: text('fb_session_cookies'), // AES-256-GCM encrypted Facebook session cookies
	fbSessionStatus: text('fb_session_status').notNull().default('none'), // 'none' | 'active'
	createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
		.notNull()
		.default(sql`current_date`),
	updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' })
		.notNull()
		.default(sql`current_date`)
});

// Meta Ads ad accounts cached from Business Manager — each can be assigned to a CRM client
export const metaAdsAccount = sqliteTable('meta_ads_account', {
	id: text('id').primaryKey(),
	tenantId: text('tenant_id')
		.notNull()
		.references(() => tenant.id),
	integrationId: text('integration_id')
		.notNull()
		.references(() => metaAdsIntegration.id, { onDelete: 'cascade' }),
	metaAdAccountId: text('meta_ad_account_id').notNull(), // e.g. act_XXXXXXXXX
	accountName: text('account_name').notNull().default(''),
	clientId: text('client_id').references(() => client.id), // Mapped CRM client (nullable)
	isActive: boolean('is_active').notNull().default(true),
	lastFetchedAt: timestamp('last_fetched_at', { withTimezone: true, mode: 'date' }),
	createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
		.notNull()
		.default(sql`current_date`),
	updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' })
		.notNull()
		.default(sql`current_date`)
});

export const metaAdsInvoice = sqliteTable('meta_ads_invoice', {
	id: text('id').primaryKey(),
	tenantId: text('tenant_id')
		.notNull()
		.references(() => tenant.id),
	integrationId: text('integration_id')
		.notNull()
		.references(() => metaAdsIntegration.id),
	clientId: text('client_id')
		.notNull()
		.references(() => client.id),
	metaAdAccountId: text('meta_ad_account_id').notNull(),
	metaInvoiceId: text('meta_invoice_id').notNull(), // For deduplication
	invoiceNumber: text('invoice_number'),
	issueDate: timestamp('issue_date', { withTimezone: true, mode: 'date' }),
	dueDate: timestamp('due_date', { withTimezone: true, mode: 'date' }),
	amountCents: integer('amount_cents'), // Meta uses cents, not micros
	currencyCode: text('currency_code').notNull().default('USD'),
	invoiceType: text('invoice_type').default('INVOICE'),
	paymentStatus: text('payment_status'),
	pdfPath: text('pdf_path'),
	status: text('status').notNull().default('synced'), // 'synced', 'download_failed'
	syncedAt: timestamp('synced_at', { withTimezone: true, mode: 'date' }),
	createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
		.notNull()
		.default(sql`current_date`),
	updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' })
		.notNull()
		.default(sql`current_date`)
});

// Meta Ads spending data synced from /insights endpoint per ad account
export const metaAdsSpending = sqliteTable('meta_ads_spending', {
	id: text('id').primaryKey(),
	tenantId: text('tenant_id')
		.notNull()
		.references(() => tenant.id),
	integrationId: text('integration_id')
		.notNull()
		.references(() => metaAdsIntegration.id),
	clientId: text('client_id')
		.notNull()
		.references(() => client.id),
	metaAdAccountId: text('meta_ad_account_id').notNull(),
	periodStart: text('period_start').notNull(), // "2026-02-01"
	periodEnd: text('period_end').notNull(), // "2026-02-28"
	spendAmount: text('spend_amount').notNull().default('0'), // raw from API e.g. "2207.59"
	spendCents: integer('spend_cents').notNull().default(0),
	currencyCode: text('currency_code').notNull().default('RON'),
	impressions: integer('impressions').default(0),
	clicks: integer('clicks').default(0),
	pdfPath: text('pdf_path'),
	syncedAt: timestamp('synced_at', { withTimezone: true, mode: 'date' }),
	createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
		.notNull()
		.default(sql`current_date`),
	updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' })
		.notNull()
		.default(sql`current_date`)
});

// Meta Ads invoice downloads — real Facebook billing PDF receipts downloaded via invoices_generator
export const metaInvoiceDownload = sqliteTable('meta_invoice_download', {
	id: text('id').primaryKey(),
	tenantId: text('tenant_id')
		.notNull()
		.references(() => tenant.id),
	integrationId: text('integration_id')
		.notNull()
		.references(() => metaAdsIntegration.id, { onDelete: 'cascade' }),
	clientId: text('client_id').references(() => client.id),
	metaAdAccountId: text('meta_ad_account_id').notNull(),
	adAccountName: text('ad_account_name'),
	bmName: text('bm_name'),
	periodStart: text('period_start').notNull(), // "2026-02-01"
	periodEnd: text('period_end').notNull(), // "2026-02-28"
	txid: text('txid'), // Facebook Transaction ID (e.g. "9360456000732052-9436742799770032")
	invoiceNumber: text('invoice_number'), // FBADS-108-104380003
	amountText: text('amount_text'), // "RON3,503.38" — raw amount from Facebook billing
	invoiceType: text('invoice_type').notNull().default('invoice'), // 'invoice' | 'credit'
	pdfPath: text('pdf_path'),
	status: text('status').notNull().default('pending'), // 'pending' | 'downloaded' | 'error'
	downloadedAt: timestamp('downloaded_at', { withTimezone: true, mode: 'date' }),
	errorMessage: text('error_message'),
	createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
		.notNull()
		.default(sql`current_date`),
	updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' })
		.notNull()
		.default(sql`current_date`)
});

// TikTok Ads integration — one per tenant connection (OAuth2 + session cookies)
export const tiktokAdsIntegration = sqliteTable('tiktok_ads_integration', {
	id: text('id').primaryKey(),
	tenantId: text('tenant_id')
		.notNull()
		.references(() => tenant.id),
	appId: text('app_id').notNull().default(''),
	orgId: text('org_id').notNull().default(''), // TikTok Business Center bc_id
	paymentAccountId: text('payment_account_id').notNull().default(''), // TikTok pa_id for billing API
	email: text('email').notNull().default(''),
	accessToken: text('access_token').notNull().default(''),
	refreshToken: text('refresh_token').notNull().default(''),
	tokenExpiresAt: timestamp('token_expires_at', { withTimezone: true, mode: 'date' }),
	refreshTokenExpiresAt: timestamp('refresh_token_expires_at', { withTimezone: true, mode: 'date' }),
	isActive: boolean('is_active').notNull().default(false),
	syncEnabled: boolean('sync_enabled').notNull().default(true),
	lastSyncAt: timestamp('last_sync_at', { withTimezone: true, mode: 'date' }),
	lastSyncResults: text('last_sync_results'), // JSON: {imported, errors, timestamp}
	ttSessionCookies: text('tt_session_cookies'), // AES-256-GCM encrypted TikTok session cookies
	ttSessionStatus: text('tt_session_status').notNull().default('none'), // 'none' | 'active'
	createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
		.notNull()
		.default(sql`current_date`),
	updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' })
		.notNull()
		.default(sql`current_date`)
});

// TikTok Ads advertiser accounts cached — each can be assigned to a CRM client
export const tiktokAdsAccount = sqliteTable('tiktok_ads_account', {
	id: text('id').primaryKey(),
	tenantId: text('tenant_id')
		.notNull()
		.references(() => tenant.id),
	integrationId: text('integration_id')
		.notNull()
		.references(() => tiktokAdsIntegration.id, { onDelete: 'cascade' }),
	tiktokAdvertiserId: text('tiktok_advertiser_id').notNull(),
	accountName: text('account_name').notNull().default(''),
	clientId: text('client_id').references(() => client.id), // Mapped CRM client (nullable)
	isActive: boolean('is_active').notNull().default(true),
	lastFetchedAt: timestamp('last_fetched_at', { withTimezone: true, mode: 'date' }),
	createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
		.notNull()
		.default(sql`current_date`),
	updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' })
		.notNull()
		.default(sql`current_date`)
});

// TikTok Ads spending data synced from Reporting API per advertiser
export const tiktokAdsSpending = sqliteTable('tiktok_ads_spending', {
	id: text('id').primaryKey(),
	tenantId: text('tenant_id')
		.notNull()
		.references(() => tenant.id),
	integrationId: text('integration_id')
		.notNull()
		.references(() => tiktokAdsIntegration.id),
	clientId: text('client_id')
		.notNull()
		.references(() => client.id),
	tiktokAdvertiserId: text('tiktok_advertiser_id').notNull(),
	periodStart: text('period_start').notNull(), // "2026-02-01"
	periodEnd: text('period_end').notNull(), // "2026-02-28"
	spendAmount: text('spend_amount').notNull().default('0'), // raw from API e.g. "2207.59"
	spendCents: integer('spend_cents').notNull().default(0),
	currencyCode: text('currency_code').notNull().default('RON'),
	impressions: integer('impressions').default(0),
	clicks: integer('clicks').default(0),
	conversions: integer('conversions').default(0),
	pdfPath: text('pdf_path'),
	syncedAt: timestamp('synced_at', { withTimezone: true, mode: 'date' }),
	createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
		.notNull()
		.default(sql`current_date`),
	updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' })
		.notNull()
		.default(sql`current_date`)
});

// TikTok invoice downloads — billing PDF receipts downloaded via cookie-based API
export const tiktokInvoiceDownload = sqliteTable('tiktok_invoice_download', {
	id: text('id').primaryKey(),
	tenantId: text('tenant_id')
		.notNull()
		.references(() => tenant.id),
	integrationId: text('integration_id')
		.notNull()
		.references(() => tiktokAdsIntegration.id, { onDelete: 'cascade' }),
	clientId: text('client_id').references(() => client.id),
	tiktokAdvertiserId: text('tiktok_advertiser_id').notNull(),
	adAccountName: text('ad_account_name'),
	tiktokInvoiceId: text('tiktok_invoice_id').notNull(), // TikTok internal invoice ID
	invoiceNumber: text('invoice_number'), // e.g. "BDUK20261596169"
	amountCents: integer('amount_cents'),
	currencyCode: text('currency_code').notNull().default('RON'),
	periodStart: text('period_start').notNull(),
	periodEnd: text('period_end').notNull(),
	pdfPath: text('pdf_path'),
	status: text('status').notNull().default('pending'), // 'pending' | 'downloaded' | 'error'
	downloadedAt: timestamp('downloaded_at', { withTimezone: true, mode: 'date' }),
	errorMessage: text('error_message'),
	createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
		.notNull()
		.default(sql`current_date`),
	updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' })
		.notNull()
		.default(sql`current_date`)
});

export const passwordResetToken = sqliteTable('password_reset_token', {
	id: text('id').primaryKey(),
	token: text('token').notNull().unique(), // Hashed token
	userId: text('user_id')
		.notNull()
		.references(() => user.id),
	expiresAt: timestamp('expires_at', { withTimezone: true, mode: 'date' }).notNull(),
	used: boolean('used').notNull().default(false),
	usedAt: timestamp('used_at', { withTimezone: true, mode: 'date' }),
	createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
		.notNull()
		.default(sql`current_date`)
});

// In-app notifications — delivered via SSE stream to connected users
export const notification = sqliteTable('notification', {
	id: text('id').primaryKey(),
	tenantId: text('tenant_id')
		.notNull()
		.references(() => tenant.id),
	userId: text('user_id')
		.notNull()
		.references(() => user.id),
	// 'task.assigned' | 'invoice.paid' | 'contract.signed' | 'sync.error' | 'system'
	type: text('type').notNull(),
	title: text('title').notNull(),
	message: text('message').notNull(),
	link: text('link'),
	isRead: boolean('is_read').notNull().default(false),
	metadata: jsonb('metadata').$type<Record<string, unknown>>(),
	createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
		.notNull()
		.default(sql`current_timestamp`)
});

export type Notification = typeof notification.$inferSelect;
export type NewNotification = typeof notification.$inferInsert;

// Relations
export const userRelations = relations(user, ({ many }) => ({
	sessions: many(session),
	tenantUsers: many(tenantUser),
	tasks: many(task),
	documents: many(document),
	invoices: many(invoice),
	taskComments: many(taskComment),
	sentInvitations: many(invitation),
	expenses: many(expense),
	transactionMatches: many(transactionInvoiceMatch),
	taskWatchers: many(taskWatcher),
	projectUsers: many(projectUser),
	createdTasks: many(task, {
		relationName: 'createdTasks'
	}),
	workHours: many(userWorkHours),
	bankAccounts: many(userBankAccount),
	clientUsers: many(clientUser),
	notifications: many(notification)
}));

export const sessionRelations = relations(session, ({ one }) => ({
	user: one(user, {
		fields: [session.userId],
		references: [user.id]
	})
}));

export const tenantRelations = relations(tenant, ({ many, one }) => ({
	tenantUsers: many(tenantUser),
	clients: many(client),
	projects: many(project),
	partners: many(partner),
	tasks: many(task),
	milestones: many(milestone),
	documents: many(document),
	services: many(service),
	invoices: many(invoice),
	recurringInvoices: many(recurringInvoice),
	invitations: many(invitation),
	tenantPlugins: many(tenantPlugin),
	invoiceSettings: one(invoiceSettings),
	taskSettings: one(taskSettings),
	smartbillIntegration: one(smartbillIntegration),
	keezIntegration: one(keezIntegration),
	revolutIntegration: one(revolutIntegration),
	bankAccounts: many(bankAccount),
	bankTransactions: many(bankTransaction),
	expenses: many(expense),
	transactionInvoiceMatches: many(transactionInvoiceMatch),
	userWorkHours: many(userWorkHours),
	suppliers: many(supplier),
	userBankAccounts: many(userBankAccount),
	clientUsers: many(clientUser),
	magicLinkTokens: many(magicLinkToken),
	seoLinks: many(seoLink),
	contracts: many(contract),
	contractTemplates: many(contractTemplate),
	gmailIntegration: one(gmailIntegration),
	googleAdsIntegration: one(googleAdsIntegration),
	supplierInvoices: many(supplierInvoice),
	googleAdsAccounts: many(googleAdsAccount),
	googleAdsInvoices: many(googleAdsInvoice),
	googleAdsSpending: many(googleAdsSpending),
	metaAdsIntegrations: many(metaAdsIntegration),
	metaAdsAccounts: many(metaAdsAccount),
	metaAdsInvoices: many(metaAdsInvoice),
	metaAdsSpending: many(metaAdsSpending),
	tiktokAdsIntegrations: many(tiktokAdsIntegration),
	tiktokAdsAccounts: many(tiktokAdsAccount),
	tiktokAdsSpending: many(tiktokAdsSpending),
	tiktokInvoiceDownloads: many(tiktokInvoiceDownload),
	emailLogs: many(emailLog),
	debugLogs: many(debugLog),
	notifications: many(notification)
}));

export const tenantUserRelations = relations(tenantUser, ({ one }) => ({
	tenant: one(tenant, {
		fields: [tenantUser.tenantId],
		references: [tenant.id]
	}),
	user: one(user, {
		fields: [tenantUser.userId],
		references: [user.id]
	})
}));

export const clientRelations = relations(client, ({ one, many }) => ({
	tenant: one(tenant, {
		fields: [client.tenantId],
		references: [tenant.id]
	}),
	partners: many(partner),
	projects: many(project),
	tasks: many(task),
	documents: many(document),
	services: many(service),
	invoices: many(invoice),
	expenses: many(expense),
	matchRules: many(transactionMatchRule),
	clientUsers: many(clientUser),
	magicLinkTokens: many(magicLinkToken),
	seoLinks: many(seoLink),
	websites: many(clientWebsite),
	contracts: many(contract),
	secondaryEmails: many(clientSecondaryEmail),
	accessData: many(clientAccessData),
	googleAdsAccounts: many(googleAdsAccount),
	googleAdsInvoices: many(googleAdsInvoice),
	googleAdsSpending: many(googleAdsSpending),
	metaAdsAccounts: many(metaAdsAccount),
	metaAdsInvoices: many(metaAdsInvoice),
	metaAdsSpending: many(metaAdsSpending),
	tiktokAdsAccounts: many(tiktokAdsAccount),
	tiktokAdsSpending: many(tiktokAdsSpending),
	tiktokInvoiceDownloads: many(tiktokInvoiceDownload)
}));

export const clientSecondaryEmailRelations = relations(clientSecondaryEmail, ({ one }) => ({
	tenant: one(tenant, {
		fields: [clientSecondaryEmail.tenantId],
		references: [tenant.id]
	}),
	client: one(client, {
		fields: [clientSecondaryEmail.clientId],
		references: [client.id]
	})
}));

export const projectRelations = relations(project, ({ one, many }) => ({
	tenant: one(tenant, {
		fields: [project.tenantId],
		references: [tenant.id]
	}),
	client: one(client, {
		fields: [project.clientId],
		references: [client.id]
	}),
	partners: many(projectPartner),
	tasks: many(task),
	milestones: many(milestone),
	documents: many(document),
	services: many(service),
	invoices: many(invoice),
	expenses: many(expense),
	projectUsers: many(projectUser),
	seoLinks: many(seoLink)
}));

export const seoLinkRelations = relations(seoLink, ({ one, many }) => ({
	tenant: one(tenant, {
		fields: [seoLink.tenantId],
		references: [tenant.id]
	}),
	client: one(client, {
		fields: [seoLink.clientId],
		references: [client.id]
	}),
	website: one(clientWebsite, {
		fields: [seoLink.websiteId],
		references: [clientWebsite.id]
	}),
	project: one(project, {
		fields: [seoLink.projectId],
		references: [project.id]
	}),
	checks: many(seoLinkCheck)
}));

export const seoLinkCheckRelations = relations(seoLinkCheck, ({ one }) => ({
	seoLink: one(seoLink, {
		fields: [seoLinkCheck.seoLinkId],
		references: [seoLink.id]
	})
}));

export const clientWebsiteRelations = relations(clientWebsite, ({ one, many }) => ({
	tenant: one(tenant, {
		fields: [clientWebsite.tenantId],
		references: [tenant.id]
	}),
	client: one(client, {
		fields: [clientWebsite.clientId],
		references: [client.id]
	}),
	seoLinks: many(seoLink)
}));

export const milestoneRelations = relations(milestone, ({ one, many }) => ({
	tenant: one(tenant, {
		fields: [milestone.tenantId],
		references: [tenant.id]
	}),
	project: one(project, {
		fields: [milestone.projectId],
		references: [project.id]
	}),
	tasks: many(task)
}));

export const taskRelations = relations(task, ({ one, many }) => ({
	tenant: one(tenant, {
		fields: [task.tenantId],
		references: [tenant.id]
	}),
	project: one(project, {
		fields: [task.projectId],
		references: [project.id]
	}),
	client: one(client, {
		fields: [task.clientId],
		references: [client.id]
	}),
	milestone: one(milestone, {
		fields: [task.milestoneId],
		references: [milestone.id]
	}),
	assignedTo: one(user, {
		fields: [task.assignedToUserId],
		references: [user.id]
	}),
	createdBy: one(user, {
		fields: [task.createdByUserId],
		references: [user.id],
		relationName: 'createdTasks'
	}),
	comments: many(taskComment),
	watchers: many(taskWatcher),
	activities: many(taskActivity),
	materials: many(taskMarketingMaterial)
}));

export const taskCommentRelations = relations(taskComment, ({ one }) => ({
	task: one(task, {
		fields: [taskComment.taskId],
		references: [task.id]
	}),
	user: one(user, {
		fields: [taskComment.userId],
		references: [user.id]
	})
}));

export const taskWatcherRelations = relations(taskWatcher, ({ one }) => ({
	task: one(task, {
		fields: [taskWatcher.taskId],
		references: [task.id]
	}),
	user: one(user, {
		fields: [taskWatcher.userId],
		references: [user.id]
	}),
	tenant: one(tenant, {
		fields: [taskWatcher.tenantId],
		references: [tenant.id]
	})
}));

export const taskActivityRelations = relations(taskActivity, ({ one }) => ({
	task: one(task, {
		fields: [taskActivity.taskId],
		references: [task.id]
	}),
	user: one(user, {
		fields: [taskActivity.userId],
		references: [user.id]
	}),
	tenant: one(tenant, {
		fields: [taskActivity.tenantId],
		references: [tenant.id]
	})
}));

export const projectUserRelations = relations(projectUser, ({ one }) => ({
	project: one(project, {
		fields: [projectUser.projectId],
		references: [project.id]
	}),
	user: one(user, {
		fields: [projectUser.userId],
		references: [user.id]
	}),
	tenant: one(tenant, {
		fields: [projectUser.tenantId],
		references: [tenant.id]
	})
}));

export const documentTemplateRelations = relations(documentTemplate, ({ one, many }) => ({
	tenant: one(tenant, {
		fields: [documentTemplate.tenantId],
		references: [tenant.id]
	}),
	createdBy: one(user, {
		fields: [documentTemplate.createdByUserId],
		references: [user.id]
	}),
	documents: many(document)
}));

export const documentRelations = relations(document, ({ one }) => ({
	tenant: one(tenant, {
		fields: [document.tenantId],
		references: [tenant.id]
	}),
	client: one(client, {
		fields: [document.clientId],
		references: [client.id]
	}),
	project: one(project, {
		fields: [document.projectId],
		references: [project.id]
	}),
	documentTemplate: one(documentTemplate, {
		fields: [document.documentTemplateId],
		references: [documentTemplate.id]
	}),
	uploadedBy: one(user, {
		fields: [document.uploadedByUserId],
		references: [user.id]
	})
}));

export const serviceRelations = relations(service, ({ one, many }) => ({
	tenant: one(tenant, {
		fields: [service.tenantId],
		references: [tenant.id]
	}),
	client: one(client, {
		fields: [service.clientId],
		references: [client.id]
	}),
	project: one(project, {
		fields: [service.projectId],
		references: [project.id]
	}),
	invoices: many(invoice)
}));

export const invoiceRelations = relations(invoice, ({ one, many }) => ({
	tenant: one(tenant, {
		fields: [invoice.tenantId],
		references: [tenant.id]
	}),
	client: one(client, {
		fields: [invoice.clientId],
		references: [client.id]
	}),
	contract: one(contract, {
		fields: [invoice.contractId],
		references: [contract.id]
	}),
	project: one(project, {
		fields: [invoice.projectId],
		references: [project.id]
	}),
	service: one(service, {
		fields: [invoice.serviceId],
		references: [service.id]
	}),
	createdBy: one(user, {
		fields: [invoice.createdByUserId],
		references: [user.id]
	}),
	lineItems: many(invoiceLineItem),
	smartbillSync: many(smartbillInvoiceSync),
	keezSync: many(keezInvoiceSync),
	anafSpvSync: many(anafSpvInvoiceSync),
	matchedTransactions: many(bankTransaction),
	transactionMatches: many(transactionInvoiceMatch)
}));

export const invoiceLineItemRelations = relations(invoiceLineItem, ({ one }) => ({
	invoice: one(invoice, {
		fields: [invoiceLineItem.invoiceId],
		references: [invoice.id]
	})
}));

export const recurringInvoiceRelations = relations(recurringInvoice, ({ one }) => ({
	tenant: one(tenant, {
		fields: [recurringInvoice.tenantId],
		references: [tenant.id]
	}),
	client: one(client, {
		fields: [recurringInvoice.clientId],
		references: [client.id]
	}),
	contract: one(contract, {
		fields: [recurringInvoice.contractId],
		references: [contract.id]
	}),
	project: one(project, {
		fields: [recurringInvoice.projectId],
		references: [project.id]
	}),
	service: one(service, {
		fields: [recurringInvoice.serviceId],
		references: [service.id]
	}),
	createdBy: one(user, {
		fields: [recurringInvoice.createdByUserId],
		references: [user.id]
	})
}));

export const invitationRelations = relations(invitation, ({ one }) => ({
	tenant: one(tenant, {
		fields: [invitation.tenantId],
		references: [tenant.id]
	}),
	invitedBy: one(user, {
		fields: [invitation.invitedByUserId],
		references: [user.id]
	})
}));

export const pluginRelations = relations(plugin, ({ many }) => ({
	tenantPlugins: many(tenantPlugin)
}));

export const tenantPluginRelations = relations(tenantPlugin, ({ one }) => ({
	tenant: one(tenant, {
		fields: [tenantPlugin.tenantId],
		references: [tenant.id]
	}),
	plugin: one(plugin, {
		fields: [tenantPlugin.pluginId],
		references: [plugin.id]
	})
}));

export const invoiceSettingsRelations = relations(invoiceSettings, ({ one }) => ({
	tenant: one(tenant, {
		fields: [invoiceSettings.tenantId],
		references: [tenant.id]
	})
}));

export const taskSettingsRelations = relations(taskSettings, ({ one }) => ({
	tenant: one(tenant, {
		fields: [taskSettings.tenantId],
		references: [tenant.id]
	})
}));

export const userWorkHoursRelations = relations(userWorkHours, ({ one }) => ({
	user: one(user, {
		fields: [userWorkHours.userId],
		references: [user.id]
	}),
	tenant: one(tenant, {
		fields: [userWorkHours.tenantId],
		references: [tenant.id]
	})
}));

export const emailSettingsRelations = relations(emailSettings, ({ one }) => ({
	tenant: one(tenant, {
		fields: [emailSettings.tenantId],
		references: [tenant.id]
	})
}));

export const smartbillIntegrationRelations = relations(smartbillIntegration, ({ one }) => ({
	tenant: one(tenant, {
		fields: [smartbillIntegration.tenantId],
		references: [tenant.id]
	})
}));

export const keezIntegrationRelations = relations(keezIntegration, ({ one }) => ({
	tenant: one(tenant, {
		fields: [keezIntegration.tenantId],
		references: [tenant.id]
	})
}));

export const revolutIntegrationRelations = relations(revolutIntegration, ({ one }) => ({
	tenant: one(tenant, {
		fields: [revolutIntegration.tenantId],
		references: [tenant.id]
	})
}));

export const smartbillInvoiceSyncRelations = relations(smartbillInvoiceSync, ({ one }) => ({
	invoice: one(invoice, {
		fields: [smartbillInvoiceSync.invoiceId],
		references: [invoice.id]
	}),
	tenant: one(tenant, {
		fields: [smartbillInvoiceSync.tenantId],
		references: [tenant.id]
	})
}));

export const keezInvoiceSyncRelations = relations(keezInvoiceSync, ({ one }) => ({
	invoice: one(invoice, {
		fields: [keezInvoiceSync.invoiceId],
		references: [invoice.id]
	}),
	tenant: one(tenant, {
		fields: [keezInvoiceSync.tenantId],
		references: [tenant.id]
	})
}));

export const anafSpvIntegrationRelations = relations(anafSpvIntegration, ({ one }) => ({
	tenant: one(tenant, {
		fields: [anafSpvIntegration.tenantId],
		references: [tenant.id]
	})
}));

export const anafSpvInvoiceSyncRelations = relations(anafSpvInvoiceSync, ({ one }) => ({
	invoice: one(invoice, {
		fields: [anafSpvInvoiceSync.invoiceId],
		references: [invoice.id]
	}),
	expense: one(expense, {
		fields: [anafSpvInvoiceSync.expenseId],
		references: [expense.id]
	}),
	tenant: one(tenant, {
		fields: [anafSpvInvoiceSync.tenantId],
		references: [tenant.id]
	})
}));

export const keezClientSyncRelations = relations(keezClientSync, ({ one }) => ({
	client: one(client, {
		fields: [keezClientSync.clientId],
		references: [client.id]
	}),
	tenant: one(tenant, {
		fields: [keezClientSync.tenantId],
		references: [tenant.id]
	})
}));

export const bankAccountRelations = relations(bankAccount, ({ one, many }) => ({
	tenant: one(tenant, {
		fields: [bankAccount.tenantId],
		references: [tenant.id]
	}),
	transactions: many(bankTransaction)
}));

export const bankTransactionRelations = relations(bankTransaction, ({ one, many }) => ({
	tenant: one(tenant, {
		fields: [bankTransaction.tenantId],
		references: [tenant.id]
	}),
	bankAccount: one(bankAccount, {
		fields: [bankTransaction.bankAccountId],
		references: [bankAccount.id]
	}),
	expense: one(expense, {
		fields: [bankTransaction.expenseId],
		references: [expense.id]
	}),
	matchedInvoice: one(invoice, {
		fields: [bankTransaction.matchedInvoiceId],
		references: [invoice.id]
	}),
	invoiceMatches: many(transactionInvoiceMatch)
}));

export const supplierRelations = relations(supplier, ({ one, many }) => ({
	tenant: one(tenant, {
		fields: [supplier.tenantId],
		references: [tenant.id]
	}),
	expenses: many(expense),
	matchRules: many(transactionMatchRule),
	supplierInvoices: many(supplierInvoice)
}));

export const gmailIntegrationRelations = relations(gmailIntegration, ({ one }) => ({
	tenant: one(tenant, {
		fields: [gmailIntegration.tenantId],
		references: [tenant.id]
	})
}));

export const supplierInvoiceRelations = relations(supplierInvoice, ({ one, many }) => ({
	tenant: one(tenant, {
		fields: [supplierInvoice.tenantId],
		references: [tenant.id]
	}),
	supplier: one(supplier, {
		fields: [supplierInvoice.supplierId],
		references: [supplier.id]
	}),
	expenses: many(expense)
}));

export const googleAdsIntegrationRelations = relations(googleAdsIntegration, ({ one }) => ({
	tenant: one(tenant, {
		fields: [googleAdsIntegration.tenantId],
		references: [tenant.id]
	})
}));

export const googleAdsAccountRelations = relations(googleAdsAccount, ({ one }) => ({
	tenant: one(tenant, {
		fields: [googleAdsAccount.tenantId],
		references: [tenant.id]
	}),
	client: one(client, {
		fields: [googleAdsAccount.clientId],
		references: [client.id]
	})
}));

export const googleAdsInvoiceRelations = relations(googleAdsInvoice, ({ one }) => ({
	tenant: one(tenant, {
		fields: [googleAdsInvoice.tenantId],
		references: [tenant.id]
	}),
	client: one(client, {
		fields: [googleAdsInvoice.clientId],
		references: [client.id]
	})
}));

export const googleAdsSpendingRelations = relations(googleAdsSpending, ({ one }) => ({
	tenant: one(tenant, {
		fields: [googleAdsSpending.tenantId],
		references: [tenant.id]
	}),
	client: one(client, {
		fields: [googleAdsSpending.clientId],
		references: [client.id]
	})
}));

export const metaAdsIntegrationRelations = relations(metaAdsIntegration, ({ one, many }) => ({
	tenant: one(tenant, {
		fields: [metaAdsIntegration.tenantId],
		references: [tenant.id]
	}),
	accounts: many(metaAdsAccount),
	invoices: many(metaAdsInvoice),
	spending: many(metaAdsSpending),
	invoiceDownloads: many(metaInvoiceDownload)
}));

export const metaAdsAccountRelations = relations(metaAdsAccount, ({ one }) => ({
	tenant: one(tenant, {
		fields: [metaAdsAccount.tenantId],
		references: [tenant.id]
	}),
	integration: one(metaAdsIntegration, {
		fields: [metaAdsAccount.integrationId],
		references: [metaAdsIntegration.id]
	}),
	client: one(client, {
		fields: [metaAdsAccount.clientId],
		references: [client.id]
	})
}));

export const metaAdsInvoiceRelations = relations(metaAdsInvoice, ({ one }) => ({
	tenant: one(tenant, {
		fields: [metaAdsInvoice.tenantId],
		references: [tenant.id]
	}),
	integration: one(metaAdsIntegration, {
		fields: [metaAdsInvoice.integrationId],
		references: [metaAdsIntegration.id]
	}),
	client: one(client, {
		fields: [metaAdsInvoice.clientId],
		references: [client.id]
	})
}));

export const metaAdsSpendingRelations = relations(metaAdsSpending, ({ one }) => ({
	tenant: one(tenant, {
		fields: [metaAdsSpending.tenantId],
		references: [tenant.id]
	}),
	integration: one(metaAdsIntegration, {
		fields: [metaAdsSpending.integrationId],
		references: [metaAdsIntegration.id]
	}),
	client: one(client, {
		fields: [metaAdsSpending.clientId],
		references: [client.id]
	})
}));

export const metaInvoiceDownloadRelations = relations(metaInvoiceDownload, ({ one }) => ({
	tenant: one(tenant, {
		fields: [metaInvoiceDownload.tenantId],
		references: [tenant.id]
	}),
	integration: one(metaAdsIntegration, {
		fields: [metaInvoiceDownload.integrationId],
		references: [metaAdsIntegration.id]
	}),
	client: one(client, {
		fields: [metaInvoiceDownload.clientId],
		references: [client.id]
	})
}));

export const tiktokAdsIntegrationRelations = relations(tiktokAdsIntegration, ({ one, many }) => ({
	tenant: one(tenant, {
		fields: [tiktokAdsIntegration.tenantId],
		references: [tenant.id]
	}),
	accounts: many(tiktokAdsAccount),
	spending: many(tiktokAdsSpending),
	invoiceDownloads: many(tiktokInvoiceDownload)
}));

export const tiktokAdsAccountRelations = relations(tiktokAdsAccount, ({ one }) => ({
	tenant: one(tenant, {
		fields: [tiktokAdsAccount.tenantId],
		references: [tenant.id]
	}),
	integration: one(tiktokAdsIntegration, {
		fields: [tiktokAdsAccount.integrationId],
		references: [tiktokAdsIntegration.id]
	}),
	client: one(client, {
		fields: [tiktokAdsAccount.clientId],
		references: [client.id]
	})
}));

export const tiktokAdsSpendingRelations = relations(tiktokAdsSpending, ({ one }) => ({
	tenant: one(tenant, {
		fields: [tiktokAdsSpending.tenantId],
		references: [tenant.id]
	}),
	integration: one(tiktokAdsIntegration, {
		fields: [tiktokAdsSpending.integrationId],
		references: [tiktokAdsIntegration.id]
	}),
	client: one(client, {
		fields: [tiktokAdsSpending.clientId],
		references: [client.id]
	})
}));

export const tiktokInvoiceDownloadRelations = relations(tiktokInvoiceDownload, ({ one }) => ({
	tenant: one(tenant, {
		fields: [tiktokInvoiceDownload.tenantId],
		references: [tenant.id]
	}),
	integration: one(tiktokAdsIntegration, {
		fields: [tiktokInvoiceDownload.integrationId],
		references: [tiktokAdsIntegration.id]
	}),
	client: one(client, {
		fields: [tiktokInvoiceDownload.clientId],
		references: [client.id]
	})
}));

export const userBankAccountRelations = relations(userBankAccount, ({ one }) => ({
	tenant: one(tenant, {
		fields: [userBankAccount.tenantId],
		references: [tenant.id]
	}),
	user: one(user, {
		fields: [userBankAccount.userId],
		references: [user.id]
	})
}));

export const expenseRelations = relations(expense, ({ one }) => ({
	tenant: one(tenant, {
		fields: [expense.tenantId],
		references: [tenant.id]
	}),
	bankTransaction: one(bankTransaction, {
		fields: [expense.bankTransactionId],
		references: [bankTransaction.id]
	}),
	supplier: one(supplier, {
		fields: [expense.supplierId],
		references: [supplier.id]
	}),
	client: one(client, {
		fields: [expense.clientId],
		references: [client.id]
	}),
	project: one(project, {
		fields: [expense.projectId],
		references: [project.id]
	}),
	createdBy: one(user, {
		fields: [expense.createdByUserId],
		references: [user.id]
	}),
	supplierInvoice: one(supplierInvoice, {
		fields: [expense.supplierInvoiceId],
		references: [supplierInvoice.id]
	})
}));

export const transactionInvoiceMatchRelations = relations(transactionInvoiceMatch, ({ one }) => ({
	tenant: one(tenant, {
		fields: [transactionInvoiceMatch.tenantId],
		references: [tenant.id]
	}),
	transaction: one(bankTransaction, {
		fields: [transactionInvoiceMatch.transactionId],
		references: [bankTransaction.id]
	}),
	invoice: one(invoice, {
		fields: [transactionInvoiceMatch.invoiceId],
		references: [invoice.id]
	}),
	matchedBy: one(user, {
		fields: [transactionInvoiceMatch.matchedByUserId],
		references: [user.id]
	})
}));

export const transactionMatchRuleRelations = relations(transactionMatchRule, ({ one }) => ({
	tenant: one(tenant, {
		fields: [transactionMatchRule.tenantId],
		references: [tenant.id]
	}),
	supplier: one(supplier, {
		fields: [transactionMatchRule.supplierId],
		references: [supplier.id]
	}),
	client: one(client, {
		fields: [transactionMatchRule.clientId],
		references: [client.id]
	}),
	user: one(user, {
		fields: [transactionMatchRule.userId],
		references: [user.id]
	}),
	expense: one(expense, {
		fields: [transactionMatchRule.expenseId],
		references: [expense.id]
	}),
	createdBy: one(user, {
		fields: [transactionMatchRule.createdByUserId],
		references: [user.id]
	})
}));

export const clientUserRelations = relations(clientUser, ({ one }) => ({
	user: one(user, {
		fields: [clientUser.userId],
		references: [user.id]
	}),
	client: one(client, {
		fields: [clientUser.clientId],
		references: [client.id]
	}),
	tenant: one(tenant, {
		fields: [clientUser.tenantId],
		references: [tenant.id]
	}),
	preferences: one(clientUserPreferences)
}));

export const clientUserPreferencesRelations = relations(clientUserPreferences, ({ one }) => ({
	clientUser: one(clientUser, {
		fields: [clientUserPreferences.clientUserId],
		references: [clientUser.id]
	}),
	tenant: one(tenant, {
		fields: [clientUserPreferences.tenantId],
		references: [tenant.id]
	})
}));

// Contract relations
export const contractTemplateRelations = relations(contractTemplate, ({ one, many }) => ({
	tenant: one(tenant, {
		fields: [contractTemplate.tenantId],
		references: [tenant.id]
	}),
	contracts: many(contract)
}));

export const contractRelations = relations(contract, ({ one, many }) => ({
	tenant: one(tenant, {
		fields: [contract.tenantId],
		references: [tenant.id]
	}),
	client: one(client, {
		fields: [contract.clientId],
		references: [client.id]
	}),
	template: one(contractTemplate, {
		fields: [contract.templateId],
		references: [contractTemplate.id]
	}),
	createdBy: one(user, {
		fields: [contract.createdByUserId],
		references: [user.id]
	}),
	lineItems: many(contractLineItem),
	activities: many(contractActivity),
	invoices: many(invoice),
	recurringInvoices: many(recurringInvoice)
}));

export const contractLineItemRelations = relations(contractLineItem, ({ one }) => ({
	contract: one(contract, {
		fields: [contractLineItem.contractId],
		references: [contract.id]
	})
}));

export const contractActivityRelations = relations(contractActivity, ({ one }) => ({
	contract: one(contract, {
		fields: [contractActivity.contractId],
		references: [contract.id]
	}),
	tenant: one(tenant, {
		fields: [contractActivity.tenantId],
		references: [tenant.id]
	})
}));

export const magicLinkTokenRelations = relations(magicLinkToken, ({ one }) => ({
	client: one(client, {
		fields: [magicLinkToken.clientId],
		references: [client.id]
	}),
	tenant: one(tenant, {
		fields: [magicLinkToken.tenantId],
		references: [tenant.id]
	})
}));

// BNR Exchange Rates (synced daily from https://www.bnr.ro/nbrfxrates.xml)
export const bnrExchangeRate = sqliteTable('bnr_exchange_rate', {
	id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
	currency: text('currency').notNull(),
	rate: real('rate').notNull(),
	multiplier: integer('multiplier').default(1),
	rateDate: text('rate_date').notNull(),
	fetchedAt: integer('fetched_at', { mode: 'timestamp' }).$defaultFn(() => new Date())
}, (table) => [
	uniqueIndex('bnr_rate_currency_date_idx').on(table.currency, table.rateDate)
]);

// Email Log - tracks every email send attempt
export const emailLog = sqliteTable('email_log', {
	id: text('id').primaryKey(),
	tenantId: text('tenant_id').references(() => tenant.id),
	toEmail: text('to_email').notNull(),
	subject: text('subject').notNull(),
	emailType: text('email_type').notNull(), // invitation, invoice, magic-link, admin-magic-link, password-reset, task-assignment, task-update, task-reminder, daily-reminder, contract-signing, invoice-paid
	status: text('status').notNull().default('pending'), // pending, active, completed, failed, delayed
	attempts: integer('attempts').notNull().default(0),
	maxAttempts: integer('max_attempts').notNull().default(3),
	errorMessage: text('error_message'),
	smtpMessageId: text('smtp_message_id'),
	smtpResponse: text('smtp_response'),
	processedAt: timestamp('processed_at'),
	completedAt: timestamp('completed_at'),
	metadata: text('metadata'), // JSON string
	htmlBody: text('html_body'),
	createdAt: timestamp('created_at').notNull().default(sql`current_timestamp`),
	updatedAt: timestamp('updated_at').notNull().default(sql`current_timestamp`)
});

// Debug Log - tracks application events, errors, warnings
export const debugLog = sqliteTable('debug_log', {
	id: text('id').primaryKey(),
	tenantId: text('tenant_id').references(() => tenant.id),
	level: text('level').notNull().default('info'), // info, warning, error
	source: text('source').notNull().default('server'), // server, client, scheduler, plugin, email, gmail, keez, smartbill, bnr
	message: text('message').notNull(),
	url: text('url'),
	stackTrace: text('stack_trace'),
	metadata: text('metadata'), // JSON string
	userId: text('user_id').references(() => user.id),
	createdAt: timestamp('created_at').notNull().default(sql`current_timestamp`)
});

export const emailLogRelations = relations(emailLog, ({ one }) => ({
	tenant: one(tenant, {
		fields: [emailLog.tenantId],
		references: [tenant.id]
	})
}));

export const debugLogRelations = relations(debugLog, ({ one }) => ({
	tenant: one(tenant, {
		fields: [debugLog.tenantId],
		references: [tenant.id]
	}),
	user: one(user, {
		fields: [debugLog.userId],
		references: [user.id]
	})
}));

// ==================== MARKETING MATERIALS ====================

export const marketingMaterial = sqliteTable('marketing_material', {
	id: text('id').primaryKey(),
	tenantId: text('tenant_id')
		.notNull()
		.references(() => tenant.id),
	clientId: text('client_id')
		.notNull()
		.references(() => client.id),
	category: text('category').notNull().default('google-ads'),
	// 'google-ads' | 'facebook-ads' | 'tiktok-ads' | 'press-article' | 'seo-article'
	type: text('type').notNull().default('image'),
	// 'image' | 'video' | 'document' | 'text' | 'url'
	title: text('title').notNull(),
	description: text('description'),
	filePath: text('file_path'),
	fileSize: integer('file_size'),
	mimeType: text('mime_type'),
	fileName: text('file_name'),
	textContent: text('text_content'),
	dimensions: text('dimensions'),
	externalUrl: text('external_url'),
	seoLinkId: text('seo_link_id').references(() => seoLink.id, { onDelete: 'set null' }),
	status: text('status').notNull().default('active'),
	// 'draft' | 'active' | 'archived'
	uploadedByUserId: text('uploaded_by_user_id').references(() => user.id),
	uploadedByClientUserId: text('uploaded_by_client_user_id').references(() => clientUser.id),
	campaignType: text('campaign_type'),
	// 'display' | 'pmax' | 'search' | 'demand-gen' — only set when category = 'google-ads'
	tags: text('tags'), // JSON string array
	attachedImages: text('attached_images'), // JSON: [{filePath, fileName, fileSize, mimeType, dimensions}]
	createdAt: timestamp('created_at').notNull().default(sql`current_timestamp`),
	updatedAt: timestamp('updated_at').notNull().default(sql`current_timestamp`)
});

export const taskMarketingMaterialRelations = relations(taskMarketingMaterial, ({ one }) => ({
	task: one(task, {
		fields: [taskMarketingMaterial.taskId],
		references: [task.id]
	}),
	marketingMaterial: one(marketingMaterial, {
		fields: [taskMarketingMaterial.marketingMaterialId],
		references: [marketingMaterial.id]
	}),
	addedByUser: one(user, {
		fields: [taskMarketingMaterial.addedByUserId],
		references: [user.id]
	}),
	tenant: one(tenant, {
		fields: [taskMarketingMaterial.tenantId],
		references: [tenant.id]
	})
}));

export const marketingMaterialRelations = relations(marketingMaterial, ({ one, many }) => ({
	tenant: one(tenant, {
		fields: [marketingMaterial.tenantId],
		references: [tenant.id]
	}),
	client: one(client, {
		fields: [marketingMaterial.clientId],
		references: [client.id]
	}),
	seoLink: one(seoLink, {
		fields: [marketingMaterial.seoLinkId],
		references: [seoLink.id]
	}),
	uploadedByUser: one(user, {
		fields: [marketingMaterial.uploadedByUserId],
		references: [user.id]
	}),
	uploadedByClientUser: one(clientUser, {
		fields: [marketingMaterial.uploadedByClientUserId],
		references: [clientUser.id]
	}),
	taskLinks: many(taskMarketingMaterial)
}));

// ==================== CLIENT ACCESS DATA ====================

export const clientAccessData = sqliteTable('client_access_data', {
	id: text('id').primaryKey(),
	tenantId: text('tenant_id')
		.notNull()
		.references(() => tenant.id),
	clientId: text('client_id')
		.notNull()
		.references(() => client.id),
	category: text('category').notNull().default('website'),
	// 'website' | 'email' | 'cpanel' | 'hosting' | 'tiktok' | 'facebook' | 'instagram' | 'google' | 'altele'
	label: text('label').notNull(),
	url: text('url'),
	username: text('username'),
	password: text('password'), // AES-256-GCM encrypted: iv:tag:ciphertext
	notes: text('notes'),
	customFields: text('custom_fields'), // JSON: [{key: string, value: string}]
	createdByUserId: text('created_by_user_id').references(() => user.id),
	createdByClientUserId: text('created_by_client_user_id').references(() => clientUser.id),
	createdAt: timestamp('created_at').notNull().default(sql`current_timestamp`),
	updatedAt: timestamp('updated_at').notNull().default(sql`current_timestamp`)
});

export const clientAccessDataRelations = relations(clientAccessData, ({ one }) => ({
	tenant: one(tenant, {
		fields: [clientAccessData.tenantId],
		references: [tenant.id]
	}),
	client: one(client, {
		fields: [clientAccessData.clientId],
		references: [client.id]
	}),
	createdByUser: one(user, {
		fields: [clientAccessData.createdByUserId],
		references: [user.id]
	}),
	createdByClientUser: one(clientUser, {
		fields: [clientAccessData.createdByClientUserId],
		references: [clientUser.id]
	})
}));

export const notificationRelations = relations(notification, ({ one }) => ({
	tenant: one(tenant, {
		fields: [notification.tenantId],
		references: [tenant.id]
	}),
	user: one(user, {
		fields: [notification.userId],
		references: [user.id]
	})
}));

// Types
export type Session = typeof session.$inferSelect;
export type User = typeof user.$inferSelect;
export type Tenant = typeof tenant.$inferSelect;
export type NewTenant = typeof tenant.$inferInsert;
export type TenantUser = typeof tenantUser.$inferSelect;
export type NewTenantUser = typeof tenantUser.$inferInsert;
export type Client = typeof client.$inferSelect;
export type NewClient = typeof client.$inferInsert;
export type Project = typeof project.$inferSelect;
export type NewProject = typeof project.$inferInsert;
export type Milestone = typeof milestone.$inferSelect;
export type NewMilestone = typeof milestone.$inferInsert;
export type Task = typeof task.$inferSelect;
export type NewTask = typeof task.$inferInsert;
export type TaskComment = typeof taskComment.$inferSelect;
export type NewTaskComment = typeof taskComment.$inferInsert;
export type TaskWatcher = typeof taskWatcher.$inferSelect;
export type NewTaskWatcher = typeof taskWatcher.$inferInsert;
export type DocumentTemplate = typeof documentTemplate.$inferSelect;
export type NewDocumentTemplate = typeof documentTemplate.$inferInsert;
export type Document = typeof document.$inferSelect;
export type NewDocument = typeof document.$inferInsert;
export type Service = typeof service.$inferSelect;
export type NewService = typeof service.$inferInsert;
export type Invoice = typeof invoice.$inferSelect;
export type NewInvoice = typeof invoice.$inferInsert;
export type InvoiceLineItem = typeof invoiceLineItem.$inferSelect;
export type NewInvoiceLineItem = typeof invoiceLineItem.$inferInsert;
export type RecurringInvoice = typeof recurringInvoice.$inferSelect;
export type NewRecurringInvoice = typeof recurringInvoice.$inferInsert;
export type Invitation = typeof invitation.$inferSelect;
export type NewInvitation = typeof invitation.$inferInsert;
export type Plugin = typeof plugin.$inferSelect;
export type NewPlugin = typeof plugin.$inferInsert;
export type TenantPlugin = typeof tenantPlugin.$inferSelect;
export type NewTenantPlugin = typeof tenantPlugin.$inferInsert;
export type InvoiceSettings = typeof invoiceSettings.$inferSelect;
export type NewInvoiceSettings = typeof invoiceSettings.$inferInsert;
export type TaskSettings = typeof taskSettings.$inferSelect;
export type NewTaskSettings = typeof taskSettings.$inferInsert;
export type UserWorkHours = typeof userWorkHours.$inferSelect;
export type NewUserWorkHours = typeof userWorkHours.$inferInsert;
export type EmailSettings = typeof emailSettings.$inferSelect;
export type NewEmailSettings = typeof emailSettings.$inferInsert;
export type SmartbillIntegration = typeof smartbillIntegration.$inferSelect;
export type NewSmartbillIntegration = typeof smartbillIntegration.$inferInsert;
export type SmartbillInvoiceSync = typeof smartbillInvoiceSync.$inferSelect;
export type NewSmartbillInvoiceSync = typeof smartbillInvoiceSync.$inferInsert;
export type KeezIntegration = typeof keezIntegration.$inferSelect;
export type NewKeezIntegration = typeof keezIntegration.$inferInsert;
export type KeezInvoiceSync = typeof keezInvoiceSync.$inferSelect;
export type NewKeezInvoiceSync = typeof keezInvoiceSync.$inferInsert;
export type KeezClientSync = typeof keezClientSync.$inferSelect;
export type NewKeezClientSync = typeof keezClientSync.$inferInsert;
export type AnafSpvIntegration = typeof anafSpvIntegration.$inferSelect;
export type NewAnafSpvIntegration = typeof anafSpvIntegration.$inferInsert;
export type AnafSpvInvoiceSync = typeof anafSpvInvoiceSync.$inferSelect;
export type NewAnafSpvInvoiceSync = typeof anafSpvInvoiceSync.$inferInsert;
export type RevolutIntegration = typeof revolutIntegration.$inferSelect;
export type NewRevolutIntegration = typeof revolutIntegration.$inferInsert;
export type BankAccount = typeof bankAccount.$inferSelect;
export type NewBankAccount = typeof bankAccount.$inferInsert;
export type BankTransaction = typeof bankTransaction.$inferSelect;
export type NewBankTransaction = typeof bankTransaction.$inferInsert;
export type Expense = typeof expense.$inferSelect;
export type NewExpense = typeof expense.$inferInsert;
export type Supplier = typeof supplier.$inferSelect;
export type NewSupplier = typeof supplier.$inferInsert;
export type UserBankAccount = typeof userBankAccount.$inferSelect;
export type NewUserBankAccount = typeof userBankAccount.$inferInsert;
export type TransactionInvoiceMatch = typeof transactionInvoiceMatch.$inferSelect;
export type NewTransactionInvoiceMatch = typeof transactionInvoiceMatch.$inferInsert;
export type ClientUser = typeof clientUser.$inferSelect;
export type NewClientUser = typeof clientUser.$inferInsert;
export type MagicLinkToken = typeof magicLinkToken.$inferSelect;
export type NewMagicLinkToken = typeof magicLinkToken.$inferInsert;
export type AdminMagicLinkToken = typeof adminMagicLinkToken.$inferSelect;
export type NewAdminMagicLinkToken = typeof adminMagicLinkToken.$inferInsert;
export type SeoLink = typeof seoLink.$inferSelect;
export type NewSeoLink = typeof seoLink.$inferInsert;
export type SeoLinkCheck = typeof seoLinkCheck.$inferSelect;
export type NewSeoLinkCheck = typeof seoLinkCheck.$inferInsert;
export type ContractTemplate = typeof contractTemplate.$inferSelect;
export type NewContractTemplate = typeof contractTemplate.$inferInsert;
export type Contract = typeof contract.$inferSelect;
export type NewContract = typeof contract.$inferInsert;
export type ContractLineItem = typeof contractLineItem.$inferSelect;
export type NewContractLineItem = typeof contractLineItem.$inferInsert;
export type GmailIntegration = typeof gmailIntegration.$inferSelect;
export type NewGmailIntegration = typeof gmailIntegration.$inferInsert;
export type SupplierInvoice = typeof supplierInvoice.$inferSelect;
export type NewSupplierInvoice = typeof supplierInvoice.$inferInsert;
export type BnrExchangeRate = typeof bnrExchangeRate.$inferSelect;
export type TaskActivity = typeof taskActivity.$inferSelect;
export type NewTaskActivity = typeof taskActivity.$inferInsert;
export type ClientUserPreferences = typeof clientUserPreferences.$inferSelect;
export type NewClientUserPreferences = typeof clientUserPreferences.$inferInsert;
export type EmailLog = typeof emailLog.$inferSelect;
export type NewEmailLog = typeof emailLog.$inferInsert;
export type DebugLog = typeof debugLog.$inferSelect;
export type NewDebugLog = typeof debugLog.$inferInsert;
export type MarketingMaterial = typeof marketingMaterial.$inferSelect;
export type NewMarketingMaterial = typeof marketingMaterial.$inferInsert;
export type ClientSecondaryEmail = typeof clientSecondaryEmail.$inferSelect;
export type NewClientSecondaryEmail = typeof clientSecondaryEmail.$inferInsert;
export type ClientAccessData = typeof clientAccessData.$inferSelect;
export type NewClientAccessData = typeof clientAccessData.$inferInsert;
export type GoogleAdsIntegration = typeof googleAdsIntegration.$inferSelect;
export type NewGoogleAdsIntegration = typeof googleAdsIntegration.$inferInsert;
export type GoogleAdsAccount = typeof googleAdsAccount.$inferSelect;
export type NewGoogleAdsAccount = typeof googleAdsAccount.$inferInsert;
export type GoogleAdsInvoice = typeof googleAdsInvoice.$inferSelect;
export type NewGoogleAdsInvoice = typeof googleAdsInvoice.$inferInsert;
export type GoogleAdsSpending = typeof googleAdsSpending.$inferSelect;
export type NewGoogleAdsSpending = typeof googleAdsSpending.$inferInsert;
export type MetaAdsIntegration = typeof metaAdsIntegration.$inferSelect;
export type NewMetaAdsIntegration = typeof metaAdsIntegration.$inferInsert;
export type MetaAdsAccount = typeof metaAdsAccount.$inferSelect;
export type NewMetaAdsAccount = typeof metaAdsAccount.$inferInsert;
export type MetaAdsInvoice = typeof metaAdsInvoice.$inferSelect;
export type NewMetaAdsInvoice = typeof metaAdsInvoice.$inferInsert;
export type MetaAdsSpending = typeof metaAdsSpending.$inferSelect;
export type NewMetaAdsSpending = typeof metaAdsSpending.$inferInsert;
export type MetaInvoiceDownload = typeof metaInvoiceDownload.$inferSelect;
export type NewMetaInvoiceDownload = typeof metaInvoiceDownload.$inferInsert;
export type TiktokAdsIntegration = typeof tiktokAdsIntegration.$inferSelect;
export type NewTiktokAdsIntegration = typeof tiktokAdsIntegration.$inferInsert;
export type TiktokAdsAccount = typeof tiktokAdsAccount.$inferSelect;
export type NewTiktokAdsAccount = typeof tiktokAdsAccount.$inferInsert;
export type TiktokAdsSpending = typeof tiktokAdsSpending.$inferSelect;
export type NewTiktokAdsSpending = typeof tiktokAdsSpending.$inferInsert;
export type TiktokInvoiceDownload = typeof tiktokInvoiceDownload.$inferSelect;
export type NewTiktokInvoiceDownload = typeof tiktokInvoiceDownload.$inferInsert;

// Invoice view tokens — public access to invoices via email links (no login required)
export const invoiceViewToken = sqliteTable('invoice_view_token', {
	id: text('id').primaryKey(),
	token: text('token').notNull().unique(), // SHA-256 hashed
	invoiceId: text('invoice_id')
		.notNull()
		.references(() => invoice.id, { onDelete: 'cascade' }),
	tenantId: text('tenant_id')
		.notNull()
		.references(() => tenant.id),
	createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
		.notNull()
		.default(sql`current_date`),
	expiresAt: timestamp('expires_at', { withTimezone: true, mode: 'date' }).notNull()
});
