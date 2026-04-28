import { customType, sqliteTable, integer as serial, integer, text, real, uniqueIndex, index } from 'drizzle-orm/sqlite-core';
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
	favicon: text('favicon'),
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
	monthlyBudget: integer('monthly_budget'), // Monthly ad budget in cents (e.g., 500000 = 5000 RON), nullable
	budgetWarningThreshold: integer('budget_warning_threshold').default(80),
	avatarPath: text('avatar_path'),
	avatarSource: text('avatar_source').notNull().default('whatsapp'),
	whmcsClientId: integer('whmcs_client_id'), // WHMCS user ID — stable match key after first sync
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
	isRecurring: boolean('is_recurring').notNull().default(false),
	recurringType: text('recurring_type'), // 'daily' | 'weekly' | 'monthly' | 'yearly'
	recurringInterval: integer('recurring_interval').default(1),
	recurringEndDate: timestamp('recurring_end_date', { withTimezone: true, mode: 'date' }),
	recurringParentId: text('recurring_parent_id'),
	recurringSpawnedAt: timestamp('recurring_spawned_at', { withTimezone: true, mode: 'date' }),
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

export const taskCommentAttachment = sqliteTable('task_comment_attachment', {
	id: text('id').primaryKey(),
	commentId: text('comment_id')
		.notNull()
		.references(() => taskComment.id, { onDelete: 'cascade' }),
	path: text('path').notNull(),
	mimeType: text('mime_type'),
	fileName: text('file_name'),
	fileSize: integer('file_size'),
	createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
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
	remainingAmount: integer('remaining_amount'), // in cents — suma rămasă de plată (from Keez sync)
	keezInvoiceId: text('keez_invoice_id'),
	keezExternalId: text('keez_external_id'),
	keezStatus: text('keez_status'), // 'Draft' (proforma), 'Valid' (fiscal), 'Cancelled'
	spvId: text('spv_id'), // ANAF SPV invoice ID
	externalSource: text('external_source'), // 'whmcs', 'manual', 'meta-ads' — discriminator for origin
	externalInvoiceId: integer('external_invoice_id'), // WHMCS invoice ID (or other source)
	externalTransactionId: text('external_transaction_id'), // Stripe txn_... or other payment provider ref
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
	// WHMCS-specific hosting series (separate from main keezSeries so hosting invoices can be tracked apart)
	keezSeriesHosting: text('keez_series_hosting'),
	keezStartNumberHosting: text('keez_start_number_hosting'),
	keezLastSyncedNumberHosting: text('keez_last_synced_number_hosting'),
	whmcsAutoPushToKeez: boolean('whmcs_auto_push_to_keez').notNull().default(false),
	// Zero-VAT note text appended to invoice.notes when WHMCS sends tax=0.
	// Nullable → in-code defaults from zero-vat-detection.ts kick in.
	whmcsZeroVatNoteIntracom: text('whmcs_zero_vat_note_intracom'),
	whmcsZeroVatNoteExport: text('whmcs_zero_vat_note_export'),
	// When false, zero-VAT detection is skipped entirely (operator opt-out).
	whmcsZeroVatAutoDetect: boolean('whmcs_zero_vat_auto_detect').notNull().default(true),
	// When true, EUR (or other non-RON) WHMCS push fails with a retryable
	// error if BNR rate is stale (>24h). Prevents silent exchangeRate=1 fallback.
	whmcsStrictBnrConversion: boolean('whmcs_strict_bnr_conversion').notNull().default(true),
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
	emailProvider: text('email_provider').default('smtp'), // 'gmail' | 'smtp'
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
	lastFailureAt: timestamp('last_failure_at', { withTimezone: true, mode: 'date' }),
	lastFailureReason: text('last_failure_reason'),
	consecutiveFailures: integer('consecutive_failures').notNull().default(0),
	isDegraded: boolean('is_degraded').notNull().default(false),
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
	// JSON-serialized AccessFlags. NULL = no portal access; falls back to notify*
	// columns for backward compat until backfill runs. See lib/server/portal-access.ts.
	accessFlags: text('access_flags'),
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
}, (t) => ({
	uniqueTenantNumber: uniqueIndex('contract_tenant_number_unique').on(t.tenantId, t.contractNumber)
}));

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
	lastSelectedAt: timestamp('last_selected_at', { withTimezone: true, mode: 'date' }),
	createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
		.notNull()
		.default(sql`current_date`),
	updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' })
		.notNull()
		.default(sql`current_date`)
});

export const servicePackageRequest = sqliteTable('service_package_request', {
	id: text('id').primaryKey(),
	tenantId: text('tenant_id')
		.notNull()
		.references(() => tenant.id),
	clientId: text('client_id').references(() => client.id),
	clientUserId: text('client_user_id').references(() => clientUser.id),
	categorySlug: text('category_slug').notNull(),
	bundleId: text('bundle_id'), // non-null when row represents a full bundle (from wizard)
	services: text('services'), // JSON array of slugs; non-null when row is a bundle
	tier: text('tier').notNull(), // 'bronze' | 'silver' | 'gold' | 'platinum'
	note: text('note'),
	status: text('status').notNull().default('pending'), // 'pending' | 'contacted' | 'accepted' | 'rejected'
	contactedAt: timestamp('contacted_at', { withTimezone: true, mode: 'date' }),
	createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
		.notNull()
		.default(sql`current_timestamp`),
	updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' })
		.notNull()
		.default(sql`current_timestamp`)
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
	// Onboarding
	onboardingTourCompleted: integer('onboarding_tour_completed', { mode: 'boolean' }).notNull().default(false),
	onboardingTourEnabled: integer('onboarding_tour_enabled', { mode: 'boolean' }).notNull().default(true),
	onboardingChecklist: text('onboarding_checklist'), // JSON: {"dashboard":true,"tasks":false,...}
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
	clientId: text('client_id').references(() => client.id), // Legacy single-client; kept for backward compat
	matchedClientIds: text('matched_client_ids'), // JSON array of client IDs snapshotted at request time (multi-company)
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
	lastRefreshAttemptAt: timestamp('last_refresh_attempt_at', { withTimezone: true, mode: 'date' }),
	lastRefreshError: text('last_refresh_error'),
	consecutiveRefreshFailures: integer('consecutive_refresh_failures').default(0),
	grantedScopes: text('granted_scopes'), // JSON: string[]
	accessTokenEncrypted: text('access_token_encrypted'),
	refreshTokenEncrypted: text('refresh_token_encrypted'),
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
	lastRefreshAttemptAt: timestamp('last_refresh_attempt_at', { withTimezone: true, mode: 'date' }),
	lastRefreshError: text('last_refresh_error'),
	consecutiveRefreshFailures: integer('consecutive_refresh_failures').default(0),
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
	integrationId: text('integration_id').references(() => googleAdsIntegration.id), // nullable (legacy); backfilled via migration 0167
	googleAdsCustomerId: text('google_ads_customer_id').notNull(), // Sub-account ID (no dashes)
	accountName: text('account_name').notNull(), // Descriptive name from Google Ads
	currencyCode: text('currency_code').notNull().default('USD'), // Account currency from Google Ads API
	clientId: text('client_id').references(() => client.id), // Mapped CRM client (nullable)
	isActive: boolean('is_active').notNull().default(true),
	status: text('status').notNull().default('ENABLED'), // ENABLED | SUSPENDED | CANCELLED | CLOSED
	billingSetupStatus: text('billing_setup_status'), // APPROVED | CANCELLED | PENDING
	paymentStatus: text('payment_status').notNull().default('ok'), // unified AdsPaymentStatus
	paymentStatusRaw: text('payment_status_raw'), // JSON snapshot of raw provider codes
	paymentStatusCheckedAt: timestamp('payment_status_checked_at', { withTimezone: true, mode: 'date' }),
	lastAlertEmailAt: timestamp('last_alert_email_at', { withTimezone: true, mode: 'date' }),
	alertMutedAtStatus: text('alert_muted_at_status'),
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
	lastRefreshAttemptAt: timestamp('last_refresh_attempt_at', { withTimezone: true, mode: 'date' }),
	lastRefreshError: text('last_refresh_error'),
	consecutiveRefreshFailures: integer('consecutive_refresh_failures').default(0),
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
	accountStatus: integer('account_status').notNull().default(1), // 1=ACTIVE, 3=UNSETTLED, 9=IN_GRACE_PERIOD
	disableReason: integer('disable_reason').notNull().default(0), // 0=none, 3=RISK_PAYMENT
	paymentStatus: text('payment_status').notNull().default('ok'), // unified AdsPaymentStatus
	paymentStatusRaw: text('payment_status_raw'), // JSON snapshot of raw provider codes
	paymentStatusCheckedAt: timestamp('payment_status_checked_at', { withTimezone: true, mode: 'date' }),
	lastAlertEmailAt: timestamp('last_alert_email_at', { withTimezone: true, mode: 'date' }), // throttle re-alerts to 24h
	alertMutedAtStatus: text('alert_muted_at_status'), // admin-muted while current status == this; auto-unmutes on status change
	lastFetchedAt: timestamp('last_fetched_at', { withTimezone: true, mode: 'date' }),
	// When a client has multiple accounts, this flags the default one for campaign creation.
	isPrimary: boolean('is_primary').notNull().default(false),
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

// Meta Ads Pages — Facebook Pages connected for lead monitoring
export const metaAdsPage = sqliteTable('meta_ads_page', {
	id: text('id').primaryKey(),
	tenantId: text('tenant_id')
		.notNull()
		.references(() => tenant.id),
	integrationId: text('integration_id')
		.notNull()
		.references(() => metaAdsIntegration.id, { onDelete: 'cascade' }),
	metaPageId: text('meta_page_id').notNull(),
	pageName: text('page_name').notNull().default(''),
	pageAccessToken: text('page_access_token').notNull().default(''),
	clientId: text('client_id').references(() => client.id),
	isMonitored: boolean('is_monitored').notNull().default(true),
	lastLeadSyncAt: timestamp('last_lead_sync_at', { withTimezone: true, mode: 'date' }),
	createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
		.notNull()
		.default(sql`current_date`),
	updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' })
		.notNull()
		.default(sql`current_date`)
});

// Leads — cross-platform lead storage (Facebook, TikTok, Google)
export const lead = sqliteTable('lead', {
	id: text('id').primaryKey(),
	tenantId: text('tenant_id')
		.notNull()
		.references(() => tenant.id),
	platform: text('platform').notNull().default('facebook'), // 'facebook' | 'tiktok' | 'google'
	externalLeadId: text('external_lead_id').notNull(), // Dedup key (Meta lead ID, TikTok lead ID, etc.)
	externalFormId: text('external_form_id'),
	externalAdId: text('external_ad_id'),
	externalCampaignId: text('external_campaign_id'),
	adName: text('ad_name'),
	formName: text('form_name'),
	fullName: text('full_name'),
	email: text('email'),
	phoneNumber: text('phone_number'),
	fieldData: jsonb('field_data').$type<Array<{ name: string; values: string[] }>>(),
	status: text('status').notNull().default('new'), // 'new' | 'contacted' | 'qualified' | 'converted' | 'disqualified'
	clientId: text('client_id').references(() => client.id),
	notes: text('notes'),
	integrationId: text('integration_id'), // Polymorphic: meta/tiktok/google integration ID
	pageId: text('page_id').references(() => metaAdsPage.id), // FK for Facebook leads
	externalCreatedAt: timestamp('external_created_at', { withTimezone: true, mode: 'date' }),
	importedAt: timestamp('imported_at', { withTimezone: true, mode: 'date' })
		.notNull()
		.default(sql`current_date`),
	createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
		.notNull()
		.default(sql`current_date`),
	updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' })
		.notNull()
		.default(sql`current_date`)
}, (table) => [
	uniqueIndex('lead_tenant_external_platform_idx').on(table.tenantId, table.externalLeadId, table.platform)
]);

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
	lastRefreshAttemptAt: timestamp('last_refresh_attempt_at', { withTimezone: true, mode: 'date' }),
	lastRefreshError: text('last_refresh_error'),
	consecutiveRefreshFailures: integer('consecutive_refresh_failures').default(0),
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
	status: text('status').notNull().default('STATUS_ENABLE'), // TikTok advertiser status code
	paymentStatus: text('payment_status').notNull().default('ok'), // unified AdsPaymentStatus
	paymentStatusRaw: text('payment_status_raw'), // JSON snapshot of raw provider codes
	paymentStatusCheckedAt: timestamp('payment_status_checked_at', { withTimezone: true, mode: 'date' }),
	lastAlertEmailAt: timestamp('last_alert_email_at', { withTimezone: true, mode: 'date' }),
	alertMutedAtStatus: text('alert_muted_at_status'),
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

export const adsAccountBudget = sqliteTable('ads_account_budget', {
	id: text('id').primaryKey(),
	tenantId: text('tenant_id')
		.notNull()
		.references(() => tenant.id),
	clientId: text('client_id')
		.notNull()
		.references(() => client.id),
	platform: text('platform').notNull(), // 'google', 'meta', 'tiktok'
	adsAccountId: text('ads_account_id').notNull(), // Platform-specific account ID
	monthlyBudget: integer('monthly_budget'), // in cents of the account's currency
	currencyCode: text('currency_code').notNull().default('RON'), // RON, USD, EUR
	isActive: boolean('is_active').notNull().default(true),
	createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
		.notNull()
		.default(sql`current_date`),
	updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' })
		.notNull()
		.default(sql`current_date`)
}, (table) => [
	uniqueIndex('ads_account_budget_acc_idx').on(table.adsAccountId)
]);

export const adsAccountBudgetRelations = relations(adsAccountBudget, ({ one }) => ({
	tenant: one(tenant, {
		fields: [adsAccountBudget.tenantId],
		references: [tenant.id]
	}),
	client: one(client, {
		fields: [adsAccountBudget.clientId],
		references: [client.id]
	})
}));

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
	clientId: text('client_id').references(() => client.id),
	// notification type — see NotificationType in notifications.ts
	type: text('type').notNull(),
	title: text('title').notNull(),
	message: text('message').notNull(),
	link: text('link'),
	isRead: boolean('is_read').notNull().default(false),
	metadata: jsonb('metadata').$type<Record<string, unknown>>(),
	createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
		.notNull()
		.default(sql`current_timestamp`),
	priority: text('priority').notNull().default('medium'),
	fingerprint: text('fingerprint').unique(),
	count: integer('count').notNull().default(1),
	updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' })
		.notNull()
		.default(sql`current_timestamp`),
	lastEmailAt: timestamp('last_email_at', { withTimezone: true, mode: 'date' })
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

// ---- Report Schedule ----

export const reportSchedule = sqliteTable('report_schedule', {
	id: text('id').primaryKey(),
	tenantId: text('tenant_id')
		.notNull()
		.references(() => tenant.id),
	clientId: text('client_id')
		.notNull()
		.references(() => client.id),
	frequency: text('frequency').notNull().default('disabled'), // 'weekly' | 'monthly' | 'disabled'
	dayOfWeek: integer('day_of_week').default(1), // 1=Monday (for weekly)
	dayOfMonth: integer('day_of_month').default(1), // 1-28 (for monthly)
	platforms: text('platforms').notNull().default('["meta","google","tiktok"]'), // JSON array
	recipientEmails: text('recipient_emails'), // JSON array, null = use client.email
	isEnabled: integer('is_enabled', { mode: 'boolean' }).notNull().default(true),
	/** Additional monthly all-platforms summary sent on day 1 of each month,
	 * covering the previous full month with Meta + Google + TikTok combined.
	 * Independent of the primary frequency (may coexist with weekly). */
	monthlyReportEnabled: integer('monthly_report_enabled', { mode: 'boolean' }).notNull().default(false),
	lastSentAt: timestamp('last_sent_at', { withTimezone: true, mode: 'date' }),
	createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
		.notNull()
		.default(sql`current_date`),
	updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' })
		.notNull()
		.default(sql`current_date`)
});

// ---- Saved Report Views ----

export const savedReportView = sqliteTable('saved_report_view', {
	id: text('id').primaryKey(),
	tenantId: text('tenant_id')
		.notNull()
		.references(() => tenant.id),
	userId: text('user_id')
		.notNull()
		.references(() => user.id),
	name: text('name').notNull(),
	platform: text('platform').notNull(), // 'meta' | 'google' | 'tiktok'
	filters: text('filters').notNull(), // JSON string: SavedViewFilters
	isDefault: integer('is_default', { mode: 'boolean' }).notNull().default(false),
	createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
		.notNull()
		.default(sql`current_date`),
	updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' })
		.notNull()
		.default(sql`current_date`)
});

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
	tiktokInvoiceDownloads: many(tiktokInvoiceDownload),
	adsAccountBudgets: many(adsAccountBudget)
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

export const taskCommentRelations = relations(taskComment, ({ one, many }) => ({
	task: one(task, {
		fields: [taskComment.taskId],
		references: [task.id]
	}),
	user: one(user, {
		fields: [taskComment.userId],
		references: [user.id]
	}),
	attachments: many(taskCommentAttachment)
}));

export const taskCommentAttachmentRelations = relations(taskCommentAttachment, ({ one }) => ({
	comment: one(taskComment, {
		fields: [taskCommentAttachment.commentId],
		references: [taskComment.id]
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
	payload: text('payload'), // JSON: { sendFn: string; args: unknown[] } — used to replay the original send call on retry
	createdAt: timestamp('created_at').notNull().default(sql`current_timestamp`),
	updatedAt: timestamp('updated_at').notNull().default(sql`current_timestamp`)
});

// Email Suppression - tracks bounced/complained addresses to prevent re-sending
export const emailSuppression = sqliteTable('email_suppression', {
	id: text('id').primaryKey(),
	tenantId: text('tenant_id').references(() => tenant.id),
	email: text('email').notNull(),
	reason: text('reason').notNull(), // 'hard_bounce' | 'complaint' | 'manual'
	smtpCode: text('smtp_code'), // e.g. '550', '551'
	smtpMessage: text('smtp_message'), // full SMTP error message
	sourceEmailLogId: text('source_email_log_id'), // which email triggered the suppression
	createdAt: timestamp('created_at').notNull().default(sql`current_timestamp`)
}, (t) => ({
	uniqueEmail: uniqueIndex('email_suppression_unique_idx').on(t.tenantId, t.email)
}));

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
	createdAt: timestamp('created_at').notNull().default(sql`current_timestamp`),
	// Error handling extensions
	action: text('action'),
	errorCode: text('error_code'),
	ipAddress: text('ip_address'),
	userAgent: text('user_agent'),
	requestId: text('request_id'),
	duration: integer('duration'), // milliseconds
	resolved: boolean('resolved').default(false),
	resolvedAt: timestamp('resolved_at'),
	resolutionNote: text('resolution_note')
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

// ==================== MARKETING COLLECTIONS ====================

export const marketingCollection = sqliteTable('marketing_collection', {
	id: text('id').primaryKey(),
	tenantId: text('tenant_id')
		.notNull()
		.references(() => tenant.id),
	clientId: text('client_id')
		.notNull()
		.references(() => client.id),
	name: text('name').notNull(),
	description: text('description'),
	color: text('color'), // hex color for visual grouping
	createdAt: timestamp('created_at').notNull().default(sql`current_timestamp`),
	updatedAt: timestamp('updated_at').notNull().default(sql`current_timestamp`)
});

export const marketingCollectionMaterial = sqliteTable('marketing_collection_material', {
	id: text('id').primaryKey(),
	collectionId: text('collection_id')
		.notNull()
		.references(() => marketingCollection.id, { onDelete: 'cascade' }),
	materialId: text('material_id')
		.notNull()
		.references(() => marketingMaterial.id, { onDelete: 'cascade' }),
	addedAt: timestamp('added_at').notNull().default(sql`current_timestamp`)
});

export const marketingCollectionRelations = relations(marketingCollection, ({ one, many }) => ({
	tenant: one(tenant, {
		fields: [marketingCollection.tenantId],
		references: [tenant.id]
	}),
	client: one(client, {
		fields: [marketingCollection.clientId],
		references: [client.id]
	}),
	materials: many(marketingCollectionMaterial)
}));

export const marketingCollectionMaterialRelations = relations(marketingCollectionMaterial, ({ one }) => ({
	collection: one(marketingCollection, {
		fields: [marketingCollectionMaterial.collectionId],
		references: [marketingCollection.id]
	}),
	material: one(marketingMaterial, {
		fields: [marketingCollectionMaterial.materialId],
		references: [marketingMaterial.id]
	})
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
export type TaskCommentAttachment = typeof taskCommentAttachment.$inferSelect;
export type NewTaskCommentAttachment = typeof taskCommentAttachment.$inferInsert;
export type TaskWatcher = typeof taskWatcher.$inferSelect;
export type NewTaskWatcher = typeof taskWatcher.$inferInsert;
export type DocumentTemplate = typeof documentTemplate.$inferSelect;
export type NewDocumentTemplate = typeof documentTemplate.$inferInsert;
export type Document = typeof document.$inferSelect;
export type NewDocument = typeof document.$inferInsert;
export type Service = typeof service.$inferSelect;
export type NewService = typeof service.$inferInsert;
export type ServicePackageRequest = typeof servicePackageRequest.$inferSelect;
export type NewServicePackageRequest = typeof servicePackageRequest.$inferInsert;
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
export type SeoLinkDiscoveryJob = typeof seoLinkDiscoveryJob.$inferSelect;
export type NewSeoLinkDiscoveryJob = typeof seoLinkDiscoveryJob.$inferInsert;
export type SeoLinkDiscoveryResult = typeof seoLinkDiscoveryResult.$inferSelect;
export type NewSeoLinkDiscoveryResult = typeof seoLinkDiscoveryResult.$inferInsert;
export type SitemapCache = typeof sitemapCache.$inferSelect;
export type NewSitemapCache = typeof sitemapCache.$inferInsert;
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
export type MetaAdsPage = typeof metaAdsPage.$inferSelect;
export type NewMetaAdsPage = typeof metaAdsPage.$inferInsert;
export type Lead = typeof lead.$inferSelect;
export type NewLead = typeof lead.$inferInsert;
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

// ==================== SEO LINK DISCOVERY ====================
// Jobs that crawl a source site's sitemap to find articles linking to client domains.

export const seoLinkDiscoveryJob = sqliteTable('seo_link_discovery_job', {
	id: text('id').primaryKey(),
	tenantId: text('tenant_id')
		.notNull()
		.references(() => tenant.id),
	userId: text('user_id').notNull(),
	sourceDomain: text('source_domain').notNull(),
	// JSON: { mode, clientIds, extraTargetDomains, selectedGroupKeys, limits, dateRange, forceRescanExisting }
	config: text('config').notNull(),
	// 'pending' | 'preview_ready' | 'running' | 'completed' | 'failed' | 'interrupted' | 'cancelled'
	status: text('status').notNull().default('pending'),
	// 'preview' | 'scanning' | 'done'
	phase: text('phase').notNull().default('preview'),
	totalSitemaps: integer('total_sitemaps').notNull().default(0),
	processedSitemaps: integer('processed_sitemaps').notNull().default(0),
	totalArticles: integer('total_articles').notNull().default(0),
	processedArticles: integer('processed_articles').notNull().default(0),
	errorCount: integer('error_count').notNull().default(0),
	matchCount: integer('match_count').notNull().default(0),
	currentSitemapUrl: text('current_sitemap_url'),
	currentSitemapIndex: integer('current_sitemap_index').notNull().default(0),
	error: text('error'),
	startedAt: timestamp('started_at', { withTimezone: true, mode: 'date' }),
	finishedAt: timestamp('finished_at', { withTimezone: true, mode: 'date' }),
	createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
		.notNull()
		.default(sql`current_date`),
	updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' })
		.notNull()
		.default(sql`current_date`)
});

export const seoLinkDiscoveryResult = sqliteTable('seo_link_discovery_result', {
	// Autoincrement for cursor-based polling
	id: integer('id').primaryKey({ autoIncrement: true }),
	jobId: text('job_id')
		.notNull()
		.references(() => seoLinkDiscoveryJob.id, { onDelete: 'cascade' }),
	tenantId: text('tenant_id').notNull(),
	articleUrl: text('article_url').notNull(),
	canonicalUrl: text('canonical_url'),
	articleTitle: text('article_title'),
	articlePublishedAt: text('article_published_at'),
	pressTrust: text('press_trust'),
	targetDomain: text('target_domain').notNull(),
	targetUrl: text('target_url').notNull(),
	anchorText: text('anchor_text'),
	linkAttribute: text('link_attribute'), // 'dofollow' | 'nofollow' | 'sponsored' | 'ugc'
	matchedClientId: text('matched_client_id'),
	matchedWebsiteId: text('matched_website_id'),
	alreadyTracked: boolean('already_tracked').notNull().default(false),
	savedAsSeoLinkId: text('saved_as_seo_link_id'),
	foundAt: timestamp('found_at', { withTimezone: true, mode: 'date' })
		.notNull()
		.default(sql`current_date`)
});

export const sitemapCache = sqliteTable('sitemap_cache', {
	url: text('url').primaryKey(),
	content: text('content').notNull(), // Base64-encoded gzipped XML
	contentLastmod: text('content_lastmod'), // lastmod seen in parent sitemap-index, for invalidation
	byteSize: integer('byte_size').notNull().default(0),
	fetchedAt: timestamp('fetched_at', { withTimezone: true, mode: 'date' })
		.notNull()
		.default(sql`current_date`),
	expiresAt: timestamp('expires_at', { withTimezone: true, mode: 'date' }).notNull()
});

export const seoLinkDiscoveryJobRelations = relations(seoLinkDiscoveryJob, ({ one, many }) => ({
	tenant: one(tenant, {
		fields: [seoLinkDiscoveryJob.tenantId],
		references: [tenant.id]
	}),
	results: many(seoLinkDiscoveryResult)
}));

export const seoLinkDiscoveryResultRelations = relations(seoLinkDiscoveryResult, ({ one }) => ({
	job: one(seoLinkDiscoveryJob, {
		fields: [seoLinkDiscoveryResult.jobId],
		references: [seoLinkDiscoveryJob.id]
	})
}));

export const whatsappSession = sqliteTable('whatsapp_session', {
	id: text('id').primaryKey(),
	tenantId: text('tenant_id')
		.notNull()
		.references(() => tenant.id),
	status: text('status').notNull(), // 'qr_pending' | 'connecting' | 'connected' | 'disconnected' | 'needs_reauth'
	phoneE164: text('phone_e164'),
	displayName: text('display_name'),
	storagePath: text('storage_path').notNull(), // MinIO path prefix
	lastConnectedAt: timestamp('last_connected_at', { withTimezone: true, mode: 'date' }),
	lastDisconnectedAt: timestamp('last_disconnected_at', { withTimezone: true, mode: 'date' }),
	lastError: text('last_error'),
	createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
		.notNull()
		.default(sql`current_timestamp`),
	updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' })
		.notNull()
		.default(sql`current_timestamp`)
});

export const whatsappMessage = sqliteTable('whatsapp_message', {
	id: text('id').primaryKey(),
	tenantId: text('tenant_id')
		.notNull()
		.references(() => tenant.id),
	sessionId: text('session_id')
		.notNull()
		.references(() => whatsappSession.id),
	clientId: text('client_id').references(() => client.id),
	direction: text('direction').notNull(), // 'inbound' | 'outbound'
	remoteJid: text('remote_jid').notNull(), // '40722123456@s.whatsapp.net'
	remotePhoneE164: text('remote_phone_e164').notNull(), // '+40722123456'
	wamId: text('wam_id').notNull(), // Baileys key.id
	messageType: text('message_type').notNull().default('text'),
	body: text('body'),
	mediaPath: text('media_path'),
	mediaMimeType: text('media_mime_type'),
	mediaFileName: text('media_file_name'),
	mediaSizeBytes: integer('media_size_bytes'),
	status: text('status').notNull(), // 'pending'|'sent'|'delivered'|'read'|'failed'
	errorMessage: text('error_message'),
	sentAt: timestamp('sent_at', { withTimezone: true, mode: 'date' }),
	deliveredAt: timestamp('delivered_at', { withTimezone: true, mode: 'date' }),
	readAt: timestamp('read_at', { withTimezone: true, mode: 'date' }),
	receivedAt: timestamp('received_at', { withTimezone: true, mode: 'date' }),
	createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
		.notNull()
		.default(sql`current_timestamp`),
	updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' })
		.notNull()
		.default(sql`current_timestamp`)
});

export const whatsappContact = sqliteTable('whatsapp_contact', {
	id: text('id').primaryKey(),
	tenantId: text('tenant_id')
		.notNull()
		.references(() => tenant.id),
	phoneE164: text('phone_e164').notNull(),
	displayName: text('display_name'), // user-edited label
	pushName: text('push_name'), // auto-captured from WhatsApp profile/contacts
	notes: text('notes'),
	avatarPath: text('avatar_path'),
	avatarMimeType: text('avatar_mime_type'),
	avatarFetchedAt: timestamp('avatar_fetched_at', { withTimezone: true, mode: 'date' }),
	avatarHidden: boolean('avatar_hidden').notNull().default(false),
	createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
		.notNull()
		.default(sql`current_timestamp`),
	updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' })
		.notNull()
		.default(sql`current_timestamp`)
});

export const whatsappContactRelations = relations(whatsappContact, ({ one }) => ({
	tenant: one(tenant, {
		fields: [whatsappContact.tenantId],
		references: [tenant.id]
	})
}));

export const whatsappSessionRelations = relations(whatsappSession, ({ one, many }) => ({
	tenant: one(tenant, {
		fields: [whatsappSession.tenantId],
		references: [tenant.id]
	}),
	messages: many(whatsappMessage)
}));

export const whatsappMessageRelations = relations(whatsappMessage, ({ one }) => ({
	tenant: one(tenant, {
		fields: [whatsappMessage.tenantId],
		references: [tenant.id]
	}),
	session: one(whatsappSession, {
		fields: [whatsappMessage.sessionId],
		references: [whatsappSession.id]
	}),
	client: one(client, {
		fields: [whatsappMessage.clientId],
		references: [client.id]
	})
}));

// ─── WordPress Sites ──────────────────────────────────────────────────────
// Centralized management of client WordPress sites: health monitoring,
// plugin/theme/core updates, blog post publishing. Each site is linked
// to an optional client (agency-internal sites have clientId = null) and
// authenticates to its WordPress via an HMAC-SHA256 secret stored encrypted.
export const wordpressSite = sqliteTable('wordpress_site', {
	id: text('id').primaryKey(),
	tenantId: text('tenant_id')
		.notNull()
		.references(() => tenant.id),
	clientId: text('client_id').references(() => client.id),
	name: text('name').notNull(), // Display label (e.g., "Acme — Blog")
	siteUrl: text('site_url').notNull(), // Normalized: https://, no trailing slash
	secretKey: text('secret_key').notNull(), // Encrypted via encrypt(tenantId, raw)
	connectorVersion: text('connector_version'), // Set at first successful /health
	wpVersion: text('wp_version'),
	phpVersion: text('php_version'),
	sslExpiresAt: timestamp('ssl_expires_at', { withTimezone: true, mode: 'date' }),
	lastHealthCheckAt: timestamp('last_health_check_at', { withTimezone: true, mode: 'date' }),
	lastUptimePingAt: timestamp('last_uptime_ping_at', { withTimezone: true, mode: 'date' }),
	uptimeStatus: text('uptime_status').notNull().default('unknown'), // 'up', 'down', 'unknown'
	lastUpdatesCheckAt: timestamp('last_updates_check_at', { withTimezone: true, mode: 'date' }),
	status: text('status').notNull().default('pending'), // 'connected', 'disconnected', 'error', 'pending'
	lastError: text('last_error'),
	consecutiveFailures: integer('consecutive_failures').notNull().default(0),
	paused: integer('paused').notNull().default(0), // 1 = scheduler skips this site
	createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
		.notNull()
		.default(sql`current_date`),
	updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' })
		.notNull()
		.default(sql`current_date`)
});

export const wordpressSiteRelations = relations(wordpressSite, ({ one, many }) => ({
	tenant: one(tenant, {
		fields: [wordpressSite.tenantId],
		references: [tenant.id]
	}),
	client: one(client, {
		fields: [wordpressSite.clientId],
		references: [client.id]
	}),
	pendingUpdates: many(wordpressPendingUpdate),
	updateJobs: many(wordpressUpdateJob),
	backups: many(wordpressBackup)
}));

// Cache of available core/plugin/theme updates per site. Populated by the
// daily `wordpress_updates_check` scheduler task or by the user hitting
// "Refresh updates" in the UI. Wiped and re-inserted on every refresh to
// avoid stale rows for updates that were applied elsewhere.
export const wordpressPendingUpdate = sqliteTable('wordpress_pending_update', {
	id: text('id').primaryKey(),
	tenantId: text('tenant_id')
		.notNull()
		.references(() => tenant.id),
	siteId: text('site_id')
		.notNull()
		.references(() => wordpressSite.id, { onDelete: 'cascade' }),
	type: text('type').notNull(), // 'core', 'plugin', 'theme'
	slug: text('slug').notNull(), // e.g. 'woocommerce' (plugin), 'twentytwentyfour' (theme), 'core' (core)
	name: text('name').notNull().default(''), // Human-readable label
	currentVersion: text('current_version').notNull().default(''),
	newVersion: text('new_version').notNull().default(''),
	securityUpdate: integer('security_update').notNull().default(0), // 1 = security
	autoUpdate: integer('auto_update').notNull().default(0), // 1 = WP auto-update is enabled (informational)
	detectedAt: timestamp('detected_at', { withTimezone: true, mode: 'date' })
		.notNull()
		.default(sql`current_date`)
});

export const wordpressPendingUpdateRelations = relations(wordpressPendingUpdate, ({ one }) => ({
	tenant: one(tenant, {
		fields: [wordpressPendingUpdate.tenantId],
		references: [tenant.id]
	}),
	site: one(wordpressSite, {
		fields: [wordpressPendingUpdate.siteId],
		references: [wordpressSite.id]
	})
}));

// Audit trail for each apply-updates action. One row per user-initiated
// batch. `items` holds the requested update list as JSON; `result` stores
// the plugin's per-item response so we can surface failures granularly.
export const wordpressUpdateJob = sqliteTable('wordpress_update_job', {
	id: text('id').primaryKey(),
	tenantId: text('tenant_id')
		.notNull()
		.references(() => tenant.id),
	siteId: text('site_id')
		.notNull()
		.references(() => wordpressSite.id, { onDelete: 'cascade' }),
	userId: text('user_id').references(() => user.id), // nullable: scheduled bulk jobs can be null
	items: text('items').notNull().default('[]'), // JSON array of {type, slug, fromVersion, toVersion}
	status: text('status').notNull().default('queued'), // 'queued', 'running', 'success', 'partial', 'failed'
	result: text('result'), // JSON: plugin's response
	error: text('error'),
	startedAt: timestamp('started_at', { withTimezone: true, mode: 'date' }),
	finishedAt: timestamp('finished_at', { withTimezone: true, mode: 'date' }),
	createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
		.notNull()
		.default(sql`current_date`)
});

export const wordpressUpdateJobRelations = relations(wordpressUpdateJob, ({ one }) => ({
	tenant: one(tenant, {
		fields: [wordpressUpdateJob.tenantId],
		references: [tenant.id]
	}),
	site: one(wordpressSite, {
		fields: [wordpressUpdateJob.siteId],
		references: [wordpressSite.id]
	}),
	user: one(user, {
		fields: [wordpressUpdateJob.userId],
		references: [user.id]
	})
}));

// Backup records. `trigger` distinguishes manual user-initiated backups
// from automatic pre-update snapshots. `archiveUrl` is populated by the
// plugin after uploading the zip — may be null while pending.
export const wordpressBackup = sqliteTable('wordpress_backup', {
	id: text('id').primaryKey(),
	tenantId: text('tenant_id')
		.notNull()
		.references(() => tenant.id),
	siteId: text('site_id')
		.notNull()
		.references(() => wordpressSite.id, { onDelete: 'cascade' }),
	userId: text('user_id').references(() => user.id),
	trigger: text('trigger').notNull().default('manual'), // 'manual', 'pre_update'
	status: text('status').notNull().default('queued'), // 'queued', 'running', 'success', 'failed'
	archiveUrl: text('archive_url'), // HTTP(S) URL to the zip if the plugin exposes it
	archivePath: text('archive_path'), // filesystem path on the WP server (wp-content/uploads/ots-backups/...)
	sizeBytes: integer('size_bytes'),
	error: text('error'),
	startedAt: timestamp('started_at', { withTimezone: true, mode: 'date' }),
	finishedAt: timestamp('finished_at', { withTimezone: true, mode: 'date' }),
	createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
		.notNull()
		.default(sql`current_date`)
});

export const wordpressBackupRelations = relations(wordpressBackup, ({ one }) => ({
	tenant: one(tenant, {
		fields: [wordpressBackup.tenantId],
		references: [tenant.id]
	}),
	site: one(wordpressSite, {
		fields: [wordpressBackup.siteId],
		references: [wordpressSite.id]
	}),
	user: one(user, {
		fields: [wordpressBackup.userId],
		references: [user.id]
	})
}));

// Cache of WP posts synced into the CRM. Not the source of truth — WP is.
// We refresh this on demand (list page) and on each create/update we push.
// Images referenced as `data:` inline base64 get extracted + uploaded to WP
// media before publish; final HTML is what WP stores.
export const wordpressPost = sqliteTable('wordpress_post', {
	id: text('id').primaryKey(),
	tenantId: text('tenant_id')
		.notNull()
		.references(() => tenant.id),
	siteId: text('site_id')
		.notNull()
		.references(() => wordpressSite.id, { onDelete: 'cascade' }),
	wpPostId: integer('wp_post_id').notNull(), // ID on the WP side
	title: text('title').notNull().default(''),
	slug: text('slug').notNull().default(''),
	status: text('status').notNull().default('draft'), // 'draft', 'publish', 'future', 'private', 'pending', 'trash'
	contentHtml: text('content_html').notNull().default(''),
	excerpt: text('excerpt'),
	featuredMediaId: integer('featured_media_id'), // WP attachment ID
	featuredMediaUrl: text('featured_media_url'),
	authorWpId: integer('author_wp_id'),
	link: text('link'), // Public permalink
	publishedAt: timestamp('published_at', { withTimezone: true, mode: 'date' }),
	lastSyncedAt: timestamp('last_synced_at', { withTimezone: true, mode: 'date' })
		.notNull()
		.default(sql`current_date`),
	createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
		.notNull()
		.default(sql`current_date`),
	updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' })
		.notNull()
		.default(sql`current_date`)
});

export const wordpressPostRelations = relations(wordpressPost, ({ one }) => ({
	tenant: one(tenant, {
		fields: [wordpressPost.tenantId],
		references: [tenant.id]
	}),
	site: one(wordpressSite, {
		fields: [wordpressPost.siteId],
		references: [wordpressSite.id]
	})
}));

// ============================================================================
// WHMCS Integration (receiver-side connector; replaces legacy keez_integration PHP module)
// Plan: docs/whmcs-integration.md
// ============================================================================

/**
 * Per-tenant credentials + state for the WHMCS connector.
 * sharedSecret is encrypted via lib/server/crypto (same pattern as other integrations).
 * enableKeezPush starts as false to enforce a dry-run phase before fiscal sync activates.
 */
export const whmcsIntegration = sqliteTable('whmcs_integration', {
	id: text('id').primaryKey(),
	tenantId: text('tenant_id')
		.notNull()
		.references(() => tenant.id)
		.unique(),
	whmcsUrl: text('whmcs_url').notNull(),
	sharedSecret: text('shared_secret').notNull(), // encrypted
	isActive: boolean('is_active').notNull().default(false),
	enableKeezPush: boolean('enable_keez_push').notNull().default(false), // dry-run gate
	circuitBreakerUntil: timestamp('circuit_breaker_until', { withTimezone: true, mode: 'date' }),
	consecutiveFailures: integer('consecutive_failures').notNull().default(0),
	lastSuccessfulSyncAt: timestamp('last_successful_sync_at', { withTimezone: true, mode: 'date' }),
	lastFailureReason: text('last_failure_reason'),
	createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
		.notNull()
		.default(sql`current_date`),
	updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' })
		.notNull()
		.default(sql`current_date`)
});

/**
 * Invoice sync tracking + state machine for WHMCS webhooks.
 * State: PENDING → CLIENT_MATCHED → INVOICE_CREATED → KEEZ_PUSHED (terminal).
 * Retry happens only on the failed step; earlier steps are skipped on resume.
 * originalTotalHash snapshots line items at first sync to detect post-payment mutations.
 */
export const whmcsInvoiceSync = sqliteTable(
	'whmcs_invoice_sync',
	{
		id: text('id').primaryKey(),
		tenantId: text('tenant_id')
			.notNull()
			.references(() => tenant.id),
		whmcsInvoiceId: integer('whmcs_invoice_id').notNull(),
		invoiceId: text('invoice_id').references(() => invoice.id),
		state: text('state').notNull(), // 'PENDING'|'CLIENT_MATCHED'|'INVOICE_CREATED'|'KEEZ_PUSHED'|'FAILED'|'DEAD_LETTER'
		lastEvent: text('last_event'), // 'created'|'paid'|'cancelled'|'refunded'
		matchType: text('match_type'), // 'WHMCS_ID'|'CUI'|'EMAIL'|'NEW'
		lastPayloadHash: text('last_payload_hash'),
		originalAmount: real('original_amount'),
		originalCurrency: text('original_currency'),
		originalTotalHash: text('original_total_hash'),
		retryCount: integer('retry_count').notNull().default(0),
		lastErrorClass: text('last_error_class'), // 'TRANSIENT'|'PERMANENT'
		lastErrorMessage: text('last_error_message'),
		rawPayload: text('raw_payload'), // redacted JSON
		receivedAt: timestamp('received_at', { withTimezone: true, mode: 'date' })
			.notNull()
			.default(sql`current_date`),
		processedAt: timestamp('processed_at', { withTimezone: true, mode: 'date' }),
		// Keez auto-push state-machine, separate from `state` so the upstream
		// Keez/CRM lifecycle and the downstream Keez push lifecycle don't conflict.
		// null='idle'|'in_flight'|'retrying'|'failed'|'success'
		keezPushStatus: text('keez_push_status'),
		nextRetryAt: timestamp('next_retry_at', { withTimezone: true, mode: 'date' }),
		lastPushAttemptAt: timestamp('last_push_attempt_at', { withTimezone: true, mode: 'date' })
	},
	(t) => ({
		uniqPair: uniqueIndex('uniq_whmcs_tenant_invoice').on(t.tenantId, t.whmcsInvoiceId),
		byTenantState: index('idx_whmcs_invoice_sync_tenant_state').on(t.tenantId, t.state),
		// Powers the reconcile cron + debug-health queries which scan by
		// keez_push_status. Without this, the `groupBy(keez_push_status)`
		// histogram in /api/_debug-whmcs-health is a full table scan.
		byTenantPushStatus: index('idx_whmcs_invoice_sync_keez_push_status').on(
			t.tenantId,
			t.keezPushStatus
		)
	})
);

/**
 * Client sync tracking. One row per (tenant, whmcsClientId) pair.
 * matchType records how the CRM client was located: existing whmcsClientId, CUI, email, or new create.
 */
export const whmcsClientSync = sqliteTable(
	'whmcs_client_sync',
	{
		id: text('id').primaryKey(),
		tenantId: text('tenant_id')
			.notNull()
			.references(() => tenant.id),
		whmcsClientId: integer('whmcs_client_id').notNull(),
		clientId: text('client_id').references(() => client.id),
		state: text('state').notNull(), // 'PENDING'|'MATCHED'|'CREATED'|'FAILED'
		matchType: text('match_type'), // 'WHMCS_ID'|'CUI'|'EMAIL'|'NEW'
		lastEvent: text('last_event'), // 'added'|'updated'
		lastPayloadHash: text('last_payload_hash'),
		lastErrorMessage: text('last_error_message'),
		rawPayload: text('raw_payload'),
		receivedAt: timestamp('received_at', { withTimezone: true, mode: 'date' })
			.notNull()
			.default(sql`current_date`),
		processedAt: timestamp('processed_at', { withTimezone: true, mode: 'date' })
	},
	(t) => ({
		uniqPair: uniqueIndex('uniq_whmcs_tenant_client').on(t.tenantId, t.whmcsClientId)
	})
);

/**
 * Product sync tracking. v1 logs-only (no service creation in v1 to keep scope tight).
 * Schema provisioned now to avoid future DDL deploys.
 */
export const whmcsProductSync = sqliteTable(
	'whmcs_product_sync',
	{
		id: text('id').primaryKey(),
		tenantId: text('tenant_id')
			.notNull()
			.references(() => tenant.id),
		whmcsProductId: integer('whmcs_product_id').notNull(),
		serviceId: text('service_id').references(() => service.id),
		state: text('state').notNull().default('LOGGED'), // v1: just log
		lastPayloadHash: text('last_payload_hash'),
		rawPayload: text('raw_payload'),
		receivedAt: timestamp('received_at', { withTimezone: true, mode: 'date' })
			.notNull()
			.default(sql`current_date`)
	},
	(t) => ({
		uniqPair: uniqueIndex('uniq_whmcs_tenant_product').on(t.tenantId, t.whmcsProductId)
	})
);

/**
 * Transaction sync tracking. v1 logs-only; v2 will link to bank transactions.
 */
export const whmcsTransactionSync = sqliteTable(
	'whmcs_transaction_sync',
	{
		id: text('id').primaryKey(),
		tenantId: text('tenant_id')
			.notNull()
			.references(() => tenant.id),
		whmcsTransactionId: text('whmcs_transaction_id').notNull(), // WHMCS uses string IDs for some gateways
		bankTransactionId: text('bank_transaction_id'), // future link to bankTransaction table
		state: text('state').notNull().default('LOGGED'),
		lastPayloadHash: text('last_payload_hash'),
		rawPayload: text('raw_payload'),
		receivedAt: timestamp('received_at', { withTimezone: true, mode: 'date' })
			.notNull()
			.default(sql`current_date`)
	},
	(t) => ({
		uniqPair: uniqueIndex('uniq_whmcs_tenant_transaction').on(t.tenantId, t.whmcsTransactionId)
	})
);

// --- WHMCS relations ---

export const whmcsIntegrationRelations = relations(whmcsIntegration, ({ one }) => ({
	tenant: one(tenant, {
		fields: [whmcsIntegration.tenantId],
		references: [tenant.id]
	})
}));

export const whmcsInvoiceSyncRelations = relations(whmcsInvoiceSync, ({ one }) => ({
	tenant: one(tenant, {
		fields: [whmcsInvoiceSync.tenantId],
		references: [tenant.id]
	}),
	invoice: one(invoice, {
		fields: [whmcsInvoiceSync.invoiceId],
		references: [invoice.id]
	})
}));

export const whmcsClientSyncRelations = relations(whmcsClientSync, ({ one }) => ({
	tenant: one(tenant, {
		fields: [whmcsClientSync.tenantId],
		references: [tenant.id]
	}),
	client: one(client, {
		fields: [whmcsClientSync.clientId],
		references: [client.id]
	})
}));

export const whmcsProductSyncRelations = relations(whmcsProductSync, ({ one }) => ({
	tenant: one(tenant, {
		fields: [whmcsProductSync.tenantId],
		references: [tenant.id]
	}),
	service: one(service, {
		fields: [whmcsProductSync.serviceId],
		references: [service.id]
	})
}));

export const whmcsTransactionSyncRelations = relations(whmcsTransactionSync, ({ one }) => ({
	tenant: one(tenant, {
		fields: [whmcsTransactionSync.tenantId],
		references: [tenant.id]
	})
}));

// =============================================================================
// External API key auth — for autonomous workers (PersonalOPS) calling CRM
// =============================================================================

export const apiKey = sqliteTable(
	'api_key',
	{
		id: text('id').primaryKey(),
		tenantId: text('tenant_id')
			.notNull()
			.references(() => tenant.id),
		name: text('name').notNull(),
		keyPrefix: text('key_prefix').notNull(), // first 12 chars of plaintext, display only
		keyHash: text('key_hash').notNull(), // SHA-256 hex of full plaintext
		scopes: text('scopes').notNull().default('[]'), // JSON array, e.g. ["campaigns:write","campaigns:read"]
		createdByUserId: text('created_by_user_id')
			.notNull()
			.references(() => user.id),
		lastUsedAt: timestamp('last_used_at', { withTimezone: true, mode: 'date' }),
		revokedAt: timestamp('revoked_at', { withTimezone: true, mode: 'date' }),
		expiresAt: timestamp('expires_at', { withTimezone: true, mode: 'date' }),
		createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
			.notNull()
			.default(sql`current_timestamp`)
	},
	(t) => ({
		hashIdx: uniqueIndex('api_key_hash_uidx').on(t.keyHash),
		tenantIdx: index('api_key_tenant_idx').on(t.tenantId)
	})
);

// =============================================================================
// Campaigns — created by workers as drafts (PAUSED), approved by humans
// =============================================================================

// Resumable state machine for the 4-step Meta create flow
//   none → campaign → adset → creative → ad → done
// On any partial failure, the worker retries with the same Idempotency-Key,
// and the CRM resumes from the last completed step. On permanent failure,
// the CRM compensates by deleting any orphan Meta entities (in reverse order).
export const campaign = sqliteTable(
	'campaign',
	{
		id: text('id').primaryKey(),
		tenantId: text('tenant_id')
			.notNull()
			.references(() => tenant.id),
		clientId: text('client_id')
			.notNull()
			.references(() => client.id),
		platform: text('platform').notNull(), // 'meta' | 'tiktok' | 'google'
		status: text('status').notNull().default('draft'),
		// status: 'draft' | 'building' | 'pending_approval' | 'active' | 'paused' | 'archived' | 'failed'
		buildStep: text('build_step').notNull().default('none'),
		// buildStep: 'none' | 'campaign' | 'adset' | 'creative' | 'ad' | 'done'
		buildAttempts: integer('build_attempts').notNull().default(0),
		externalCampaignId: text('external_campaign_id'),
		externalAdsetId: text('external_adset_id'),
		externalCreativeId: text('external_creative_id'),
		externalAdId: text('external_ad_id'),
		externalAdAccountId: text('external_ad_account_id'),
		name: text('name').notNull(),
		objective: text('objective').notNull(),
		budgetType: text('budget_type').notNull(), // 'daily' | 'lifetime'
		budgetCents: integer('budget_cents').notNull(),
		currencyCode: text('currency_code').notNull().default('RON'),
		audienceJson: text('audience_json').notNull().default('{}'),
		creativeJson: text('creative_json').notNull().default('{}'),
		briefJson: text('brief_json').notNull().default('{}'), // PII-redacted
		createdByWorkerId: text('created_by_worker_id'),
		createdByApiKeyId: text('created_by_api_key_id').references(() => apiKey.id),
		approvedByUserId: text('approved_by_user_id').references(() => user.id),
		approvedAt: timestamp('approved_at', { withTimezone: true, mode: 'date' }),
		pausedByUserId: text('paused_by_user_id').references(() => user.id),
		pausedAt: timestamp('paused_at', { withTimezone: true, mode: 'date' }),
		lastError: text('last_error'),
		createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
			.notNull()
			.default(sql`current_timestamp`),
		updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' })
			.notNull()
			.default(sql`current_timestamp`)
	},
	(t) => ({
		tenantStatusIdx: index('campaign_tenant_status_idx').on(t.tenantId, t.status),
		clientIdx: index('campaign_client_idx').on(t.clientId),
		externalIdx: uniqueIndex('campaign_external_uidx').on(t.platform, t.externalCampaignId)
	})
);

// Audit trail for state transitions only (not reads).
// Actions: 'draft.created' | 'build.step' | 'build.failed' | 'build.rolled_back'
//        | 'approved' | 'paused' | 'archived' | 'platform.error'
export const campaignAudit = sqliteTable(
	'campaign_audit',
	{
		id: text('id').primaryKey(),
		tenantId: text('tenant_id')
			.notNull()
			.references(() => tenant.id),
		campaignId: text('campaign_id')
			.notNull()
			.references(() => campaign.id, { onDelete: 'cascade' }),
		action: text('action').notNull(),
		actorType: text('actor_type').notNull(), // 'api_key' | 'user' | 'system'
		actorId: text('actor_id').notNull(),
		payloadJson: text('payload_json').notNull().default('{}'),
		errorMessage: text('error_message'),
		at: timestamp('at', { withTimezone: true, mode: 'date' })
			.notNull()
			.default(sql`current_timestamp`)
	},
	(t) => ({
		campaignIdx: index('campaign_audit_campaign_idx').on(t.campaignId, t.at)
	})
);

// Idempotency replay store — caches the response for an Idempotency-Key for 7 days.
// responseStatus = 0 means "in-flight" — concurrent retries block on the lock.
export const campaignIdempotency = sqliteTable(
	'campaign_idempotency',
	{
		id: text('id').primaryKey(),
		tenantId: text('tenant_id')
			.notNull()
			.references(() => tenant.id),
		idempotencyKey: text('idempotency_key').notNull(),
		apiKeyId: text('api_key_id')
			.notNull()
			.references(() => apiKey.id),
		responseStatus: integer('response_status').notNull().default(0),
		responseJson: text('response_json').notNull().default('{}'),
		createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
			.notNull()
			.default(sql`current_timestamp`),
		expiresAt: timestamp('expires_at', { withTimezone: true, mode: 'date' }).notNull()
	},
	(t) => ({
		tenantKeyIdx: uniqueIndex('campaign_idem_tenant_key_uidx').on(t.tenantId, t.idempotencyKey)
	})
);

// Cached Meta targetingsearch results — anti-hallucination for workers.
// Workers MUST pick interest/location/behavior IDs from this list, never invent them.
export const metaTargetingCache = sqliteTable(
	'meta_targeting_cache',
	{
		id: text('id').primaryKey(),
		type: text('type').notNull(), // 'interests' | 'locations' | 'behaviors' | 'demographics'
		query: text('query').notNull(),
		payloadJson: text('payload_json').notNull(),
		fetchedAt: timestamp('fetched_at', { withTimezone: true, mode: 'date' })
			.notNull()
			.default(sql`current_timestamp`),
		expiresAt: timestamp('expires_at', { withTimezone: true, mode: 'date' }).notNull()
	},
	(t) => ({
		typeQueryIdx: uniqueIndex('meta_targeting_cache_type_query_uidx').on(t.type, t.query)
	})
);

// Relations
export const apiKeyRelations = relations(apiKey, ({ one, many }) => ({
	tenant: one(tenant, {
		fields: [apiKey.tenantId],
		references: [tenant.id]
	}),
	createdBy: one(user, {
		fields: [apiKey.createdByUserId],
		references: [user.id]
	}),
	campaigns: many(campaign),
	idempotencyEntries: many(campaignIdempotency)
}));

export const campaignRelations = relations(campaign, ({ one, many }) => ({
	tenant: one(tenant, {
		fields: [campaign.tenantId],
		references: [tenant.id]
	}),
	client: one(client, {
		fields: [campaign.clientId],
		references: [client.id]
	}),
	createdByApiKey: one(apiKey, {
		fields: [campaign.createdByApiKeyId],
		references: [apiKey.id]
	}),
	approvedBy: one(user, {
		fields: [campaign.approvedByUserId],
		references: [user.id],
		relationName: 'campaignApprovedBy'
	}),
	pausedBy: one(user, {
		fields: [campaign.pausedByUserId],
		references: [user.id],
		relationName: 'campaignPausedBy'
	}),
	auditLog: many(campaignAudit)
}));

export const campaignAuditRelations = relations(campaignAudit, ({ one }) => ({
	tenant: one(tenant, {
		fields: [campaignAudit.tenantId],
		references: [tenant.id]
	}),
	campaign: one(campaign, {
		fields: [campaignAudit.campaignId],
		references: [campaign.id]
	})
}));

export const campaignIdempotencyRelations = relations(campaignIdempotency, ({ one }) => ({
	tenant: one(tenant, {
		fields: [campaignIdempotency.tenantId],
		references: [tenant.id]
	}),
	apiKey: one(apiKey, {
		fields: [campaignIdempotency.apiKeyId],
		references: [apiKey.id]
	})
}));

// Types
export type ApiKey = typeof apiKey.$inferSelect;
export type NewApiKey = typeof apiKey.$inferInsert;
export type Campaign = typeof campaign.$inferSelect;
export type NewCampaign = typeof campaign.$inferInsert;
export type CampaignAudit = typeof campaignAudit.$inferSelect;
export type NewCampaignAudit = typeof campaignAudit.$inferInsert;
export type CampaignIdempotency = typeof campaignIdempotency.$inferSelect;
export type NewCampaignIdempotency = typeof campaignIdempotency.$inferInsert;
export type MetaTargetingCache = typeof metaTargetingCache.$inferSelect;
export type NewMetaTargetingCache = typeof metaTargetingCache.$inferInsert;

export const CAMPAIGN_STATUSES = [
	'draft',
	'building',
	'pending_approval',
	'active',
	'paused',
	'archived',
	'failed'
] as const;
export type CampaignStatus = (typeof CAMPAIGN_STATUSES)[number];

export const CAMPAIGN_BUILD_STEPS = ['none', 'campaign', 'adset', 'creative', 'ad', 'done'] as const;
export type CampaignBuildStep = (typeof CAMPAIGN_BUILD_STEPS)[number];

export const API_KEY_SCOPES = [
	'campaigns:read',
	'campaigns:write',
	'clients:read',
	'integrations:read'
] as const;
export type ApiKeyScope = (typeof API_KEY_SCOPES)[number];
