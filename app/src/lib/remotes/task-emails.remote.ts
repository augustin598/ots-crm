import { query, command, getRequestEvent } from '$app/server';
import { requireStaff } from '$lib/server/get-actor';
import * as v from 'valibot';
import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { eq, and, desc } from 'drizzle-orm';
import { encodeBase32LowerCase } from '@oslojs/encoding';
import { searchEmails, getEmail } from '$lib/server/gmail/client';

function generateId() {
	const bytes = crypto.getRandomValues(new Uint8Array(15));
	return encodeBase32LowerCase(bytes);
}

/**
 * Gate strict pentru orice funcție care atinge Gmail LIVE (căutare, corp,
 * asociere, dezasociere). Inboxul Gmail e emailul personal al adminului —
 * doar owner/admin au voie să-l atingă (decizie 2026-07-30). Staff-ul vede
 * doar metadatele deja salvate în DB, prin getTaskEmails.
 */
async function requireOwnerAdmin(event: NonNullable<ReturnType<typeof getRequestEvent>>) {
	await requireStaff(event);
	const role = event.locals.tenantUser?.role;
	if (role !== 'owner' && role !== 'admin') {
		throw new Error('Doar administratorii pot accesa emailurile asociate.');
	}
}

const SNIPPET_LEN = 200;
function toSnippet(body: string): string {
	return body.replace(/\s+/g, ' ').trim().slice(0, SNIPPET_LEN);
}

// ---- Queries ----

/**
 * Emailurile asociate unui task.
 *  - staff: metadatele complete salvate la asociere (subiect, expeditor,
 *    dată, snippet) — fără apel Gmail
 *  - client portal: DOAR {id, subject, emailDate} (pur informativ), exclusiv
 *    pe task-urile clientului lui — scoping forțat pe locals.client.id (F8)
 */
export const getTaskEmails = query(v.pipe(v.string(), v.minLength(1)), async (taskId) => {
	const event = getRequestEvent();
	if (!event?.locals.user || !event?.locals.tenant) {
		throw new Error('Unauthorized');
	}

	const [task] = await db
		.select({ id: table.task.id, clientId: table.task.clientId })
		.from(table.task)
		.where(and(eq(table.task.id, taskId), eq(table.task.tenantId, event.locals.tenant.id)))
		.limit(1);
	if (!task) throw new Error('Task not found');

	if (event.locals.isClientUser) {
		// Izolare portal: clientul vede doar task-urile lui.
		if (!event.locals.client?.id || task.clientId !== event.locals.client.id) {
			throw new Error('Task not found');
		}
	} else {
		await requireStaff(event);
	}

	const rows = await db
		.select()
		.from(table.taskEmail)
		.where(
			and(eq(table.taskEmail.tenantId, event.locals.tenant.id), eq(table.taskEmail.taskId, taskId))
		)
		.orderBy(desc(table.taskEmail.emailDate));

	if (event.locals.isClientUser) {
		// Pur informativ în portal: fără snippet/expeditor/ID-uri Gmail.
		return rows.map((r) => ({ id: r.id, subject: r.subject, emailDate: r.emailDate }));
	}
	return rows;
});

// ---- Commands (Gmail live → owner/admin) ----

/**
 * Căutare în inbox pentru dialogul de asociere (sintaxă Gmail: from:, subject:
 * etc.). Command, nu query — rezultatele nu trebuie cache-uite per-arg.
 */
export const searchTaskEmails = command(
	v.object({ search: v.pipe(v.string(), v.minLength(2)) }),
	async ({ search }) => {
		const event = getRequestEvent();
		if (!event?.locals.user || !event?.locals.tenant) {
			throw new Error('Unauthorized');
		}
		await requireOwnerAdmin(event);
		const tenantId = event.locals.tenant.id;

		const refs = await searchEmails(tenantId, search, 10);
		const results = await Promise.all(
			refs.map(async (ref) => {
				try {
					const email = await getEmail(tenantId, ref.id);
					return {
						gmailMessageId: email.id,
						gmailThreadId: email.threadId,
						subject: email.subject,
						from: email.from,
						date: email.date,
						snippet: toSnippet(email.body)
					};
				} catch {
					// Mesaj dispărut/inaccesibil între list și get — îl omitem.
					return null;
				}
			})
		);
		return results.filter((r): r is NonNullable<typeof r> => r !== null);
	}
);

export const linkTaskEmail = command(
	v.object({
		taskId: v.pipe(v.string(), v.minLength(1)),
		gmailMessageId: v.pipe(v.string(), v.minLength(1))
	}),
	async ({ taskId, gmailMessageId }) => {
		const event = getRequestEvent();
		if (!event?.locals.user || !event?.locals.tenant) {
			throw new Error('Unauthorized');
		}
		await requireOwnerAdmin(event);

		const [task] = await db
			.select({ id: table.task.id })
			.from(table.task)
			.where(and(eq(table.task.id, taskId), eq(table.task.tenantId, event.locals.tenant.id)))
			.limit(1);
		if (!task) throw new Error('Task not found');

		// Idempotent: emailul e deja asociat → no-op (altfel indexul unic ar
		// produce un 500 generic în prod, unde mesajele Error nu ajung la client).
		const [existing] = await db
			.select({ id: table.taskEmail.id })
			.from(table.taskEmail)
			.where(
				and(
					eq(table.taskEmail.taskId, taskId),
					eq(table.taskEmail.gmailMessageId, gmailMessageId),
					eq(table.taskEmail.tenantId, event.locals.tenant.id)
				)
			)
			.limit(1);
		if (existing) return;

		// Metadatele se copiază ACUM ca staff/portal să nu aibă nevoie de Gmail.
		const email = await getEmail(event.locals.tenant.id, gmailMessageId);
		await db.insert(table.taskEmail).values({
			id: generateId(),
			tenantId: event.locals.tenant.id,
			taskId,
			gmailMessageId: email.id,
			gmailThreadId: email.threadId,
			subject: email.subject,
			fromEmail: email.from,
			snippet: toSnippet(email.body),
			emailDate: email.date,
			linkedByUserId: event.locals.user.id,
			createdAt: new Date()
		});
	}
);

export const unlinkTaskEmail = command(
	v.object({ taskEmailId: v.pipe(v.string(), v.minLength(1)) }),
	async ({ taskEmailId }) => {
		const event = getRequestEvent();
		if (!event?.locals.user || !event?.locals.tenant) {
			throw new Error('Unauthorized');
		}
		await requireOwnerAdmin(event);
		await db
			.delete(table.taskEmail)
			.where(
				and(
					eq(table.taskEmail.id, taskEmailId),
					eq(table.taskEmail.tenantId, event.locals.tenant.id)
				)
			);
	}
);

/** Corpul complet + lista de atașamente — Gmail live, doar owner/admin. */
export const getTaskEmailBody = command(
	v.object({ taskEmailId: v.pipe(v.string(), v.minLength(1)) }),
	async ({ taskEmailId }) => {
		const event = getRequestEvent();
		if (!event?.locals.user || !event?.locals.tenant) {
			throw new Error('Unauthorized');
		}
		await requireOwnerAdmin(event);

		const [row] = await db
			.select()
			.from(table.taskEmail)
			.where(
				and(
					eq(table.taskEmail.id, taskEmailId),
					eq(table.taskEmail.tenantId, event.locals.tenant.id)
				)
			)
			.limit(1);
		if (!row) throw new Error('Email negăsit');

		const email = await getEmail(event.locals.tenant.id, row.gmailMessageId);
		return {
			subject: email.subject,
			from: email.from,
			date: email.date,
			body: email.body,
			gmailMessageId: row.gmailMessageId,
			attachments: email.attachments
		};
	}
);
