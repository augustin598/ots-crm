import { customType, sqliteTable, integer as serial, integer, text } from 'drizzle-orm/sqlite-core';
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
		.references(() => task.id),
	userId: text('user_id')
		.notNull()
		.references(() => user.id),
	content: text('content').notNull(),
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

export const invoice = sqliteTable('invoice', {
	id: text('id').primaryKey(),
	tenantId: text('tenant_id')
		.notNull()
		.references(() => tenant.id),
	clientId: text('client_id')
		.notNull()
		.references(() => client.id),
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
		.references(() => contract.id),
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
	clientUsers: many(clientUser)
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
	supplierInvoices: many(supplierInvoice)
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
	contracts: many(contract)
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
	watchers: many(taskWatcher)
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
	lineItems: many(contractLineItem)
}));

export const contractLineItemRelations = relations(contractLineItem, ({ one }) => ({
	contract: one(contract, {
		fields: [contractLineItem.contractId],
		references: [contract.id]
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
