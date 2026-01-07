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
	age: integer('age'),
	username: text('username').notNull().unique(),
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
	companyType: text('company_type'),
	cui: text('cui').unique(),
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

export const client = sqliteTable('client', {
	id: text('id').primaryKey(),
	tenantId: text('tenant_id')
		.notNull()
		.references(() => tenant.id),
	name: text('name').notNull(),
	email: text('email'),
	phone: text('phone'),
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
	notes: text('notes'),
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
	clientId: text('client_id')
		.notNull()
		.references(() => client.id),
	name: text('name').notNull(),
	description: text('description'),
	status: text('status').notNull().default('planning'), // 'planning', 'active', 'on-hold', 'completed', 'cancelled'
	startDate: timestamp('start_date', { withTimezone: true, mode: 'date' }),
	endDate: timestamp('end_date', { withTimezone: true, mode: 'date' }),
	budget: integer('budget'), // in cents
	createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
		.notNull()
		.default(sql`current_date`),
	updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' })
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
	status: text('status').notNull().default('todo'), // 'todo', 'in-progress', 'review', 'done', 'cancelled'
	priority: text('priority').default('medium'), // 'low', 'medium', 'high', 'urgent'
	dueDate: timestamp('due_date', { withTimezone: true, mode: 'date' }),
	assignedToUserId: text('assigned_to_user_id').references(() => user.id),
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
	contractTemplateId: text('contract_template_id').references(() => contractTemplate.id),
	name: text('name').notNull(),
	type: text('type').notNull().default('other'), // 'contract', 'proposal', 'invoice', 'other'
	filePath: text('file_path').notNull(),
	fileSize: integer('file_size'),
	mimeType: text('mime_type'),
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
	notes: text('notes'),
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
	description: text('description').notNull(),
	quantity: integer('quantity').notNull().default(1),
	rate: integer('rate').notNull(), // in cents
	amount: integer('amount').notNull(), // in cents (quantity * rate)
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
	contractTemplates: many(contractTemplate),
	taskComments: many(taskComment)
}));

export const sessionRelations = relations(session, ({ one }) => ({
	user: one(user, {
		fields: [session.userId],
		references: [user.id]
	})
}));

export const tenantRelations = relations(tenant, ({ many }) => ({
	tenantUsers: many(tenantUser),
	clients: many(client),
	projects: many(project),
	tasks: many(task),
	milestones: many(milestone),
	contractTemplates: many(contractTemplate),
	documents: many(document),
	services: many(service),
	invoices: many(invoice)
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
	projects: many(project),
	tasks: many(task),
	documents: many(document),
	services: many(service),
	invoices: many(invoice)
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
	tasks: many(task),
	milestones: many(milestone),
	documents: many(document),
	services: many(service),
	invoices: many(invoice)
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
	comments: many(taskComment)
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

export const contractTemplateRelations = relations(contractTemplate, ({ one, many }) => ({
	tenant: one(tenant, {
		fields: [contractTemplate.tenantId],
		references: [tenant.id]
	}),
	createdBy: one(user, {
		fields: [contractTemplate.createdByUserId],
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
	contractTemplate: one(contractTemplate, {
		fields: [document.contractTemplateId],
		references: [contractTemplate.id]
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
	lineItems: many(invoiceLineItem)
}));

export const invoiceLineItemRelations = relations(invoiceLineItem, ({ one }) => ({
	invoice: one(invoice, {
		fields: [invoiceLineItem.invoiceId],
		references: [invoice.id]
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
export type ContractTemplate = typeof contractTemplate.$inferSelect;
export type NewContractTemplate = typeof contractTemplate.$inferInsert;
export type Document = typeof document.$inferSelect;
export type NewDocument = typeof document.$inferInsert;
export type Service = typeof service.$inferSelect;
export type NewService = typeof service.$inferInsert;
export type Invoice = typeof invoice.$inferSelect;
export type NewInvoice = typeof invoice.$inferInsert;
export type InvoiceLineItem = typeof invoiceLineItem.$inferSelect;
export type NewInvoiceLineItem = typeof invoiceLineItem.$inferInsert;
