import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { eq, and, ne, sql } from 'drizzle-orm';
import { encodeBase32LowerCase } from '@oslojs/encoding';

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

function generateClientUserId() {
	const bytes = crypto.getRandomValues(new Uint8Array(15));
	return encodeBase32LowerCase(bytes);
}

/**
 * Nullify/remove FK references and delete a clientUser record.
 * Covers every table referencing clientUser.id: marketingMaterial,
 * clientAccessData, servicePackageRequest (nullable FKs → set null) and
 * clientUserPreferences (notNull FK → row deleted; SQLite FK cascade is not
 * guaranteed to be enforced on Turso, so we delete explicitly).
 */
export async function deleteClientUserWithFKs(tx: Tx, clientUserId: string) {
	await tx
		.update(table.marketingMaterial)
		.set({ uploadedByClientUserId: null })
		.where(eq(table.marketingMaterial.uploadedByClientUserId, clientUserId));
	await tx
		.update(table.clientAccessData)
		.set({ createdByClientUserId: null })
		.where(eq(table.clientAccessData.createdByClientUserId, clientUserId));
	await tx
		.update(table.servicePackageRequest)
		.set({ clientUserId: null })
		.where(eq(table.servicePackageRequest.clientUserId, clientUserId));
	await tx
		.delete(table.clientUserPreferences)
		.where(eq(table.clientUserPreferences.clientUserId, clientUserId));
	await tx.delete(table.clientUser).where(eq(table.clientUser.id, clientUserId));
}

/**
 * Keep the primary client_user link in sync with client.email. Runs inside the
 * caller's transaction, after client.email has been updated.
 *
 * Handles every combination:
 *  - migrate:  old primary link exists, new email has an account → re-link the
 *              old row (keeps its id, so FK references stay attached)
 *  - promote:  new email's user already has a (secondary) link → isPrimary=true
 *  - create:   new email's user has no link yet → insert one (isPrimary=true)
 *  - drop:     email cleared / new email has no account → old primary link is
 *              removed (portal login recreates it at the contact's first login)
 *  - demote:   any other row still flagged primary loses the flag — a client
 *              has at most ONE primary: the current client.email holder.
 *
 * Without the create/promote paths the primary contact silently disappears
 * from every client_user-driven surface (task assignee picker, client team
 * lists) until their next full portal login — the Lucky Group bug.
 */
export async function syncPrimaryClientUserLink(
	tx: Tx,
	opts: { clientId: string; tenantId: string; oldEmail: string; newEmail: string }
) {
	const { clientId, tenantId } = opts;
	const oldEmail = opts.oldEmail.trim().toLowerCase();
	const newEmail = opts.newEmail.trim().toLowerCase();

	let newUser: { id: string } | undefined;
	if (newEmail) {
		[newUser] = await tx
			.select({ id: table.user.id })
			.from(table.user)
			.where(eq(sql`lower(${table.user.email})`, newEmail))
			.limit(1);
	}

	// Migrate or drop the OLD primary link (when the old email had one).
	let linkEnsured = false;
	if (oldEmail) {
		const [oldUser] = await tx
			.select({ id: table.user.id })
			.from(table.user)
			.where(eq(sql`lower(${table.user.email})`, oldEmail))
			.limit(1);

		if (oldUser) {
			const [oldClientUser] = await tx
				.select()
				.from(table.clientUser)
				.where(
					and(
						eq(table.clientUser.userId, oldUser.id),
						eq(table.clientUser.clientId, clientId),
						eq(table.clientUser.tenantId, tenantId),
						eq(table.clientUser.isPrimary, true)
					)
				)
				.limit(1);

			if (oldClientUser) {
				if (newUser) {
					const [existingNewCU] = await tx
						.select()
						.from(table.clientUser)
						.where(
							and(
								eq(table.clientUser.userId, newUser.id),
								eq(table.clientUser.clientId, clientId),
								eq(table.clientUser.tenantId, tenantId)
							)
						)
						.limit(1);

					if (existingNewCU) {
						// Promote existing to primary, delete old
						await tx
							.update(table.clientUser)
							.set({ isPrimary: true, updatedAt: new Date() })
							.where(eq(table.clientUser.id, existingNewCU.id));
						await deleteClientUserWithFKs(tx, oldClientUser.id);
					} else {
						// Re-link old clientUser to new user (keeps the clientUser id,
						// so FK references like marketingMaterial stay attached)
						await tx
							.update(table.clientUser)
							.set({ userId: newUser.id, updatedAt: new Date() })
							.where(eq(table.clientUser.id, oldClientUser.id));
					}
					linkEnsured = true;
				} else {
					// No user for new email yet — remove old clientUser; the portal
					// login flow creates the new link at first login.
					await deleteClientUserWithFKs(tx, oldClientUser.id);
				}
			}
		}
	}

	// Ensure the NEW primary link exists even when there was nothing to migrate
	// (old link already lost, or the client had no email before).
	if (newUser && !linkEnsured) {
		const [existingCU] = await tx
			.select()
			.from(table.clientUser)
			.where(
				and(
					eq(table.clientUser.userId, newUser.id),
					eq(table.clientUser.clientId, clientId),
					eq(table.clientUser.tenantId, tenantId)
				)
			)
			.limit(1);
		if (existingCU) {
			if (!existingCU.isPrimary) {
				await tx
					.update(table.clientUser)
					.set({ isPrimary: true, updatedAt: new Date() })
					.where(eq(table.clientUser.id, existingCU.id));
			}
		} else {
			await tx.insert(table.clientUser).values({
				id: generateClientUserId(),
				userId: newUser.id,
				clientId,
				tenantId,
				isPrimary: true
			});
		}
	}

	// Demote any OTHER row still flagged primary. Stale flags survive email
	// changes made while the old contact stayed logged in, and a stale primary
	// keeps full portal access (resolveAccessFlags treats isPrimary as
	// ALL_ACCESS_TRUE).
	const demoteConditions = [
		eq(table.clientUser.clientId, clientId),
		eq(table.clientUser.tenantId, tenantId),
		eq(table.clientUser.isPrimary, true)
	];
	if (newUser) demoteConditions.push(ne(table.clientUser.userId, newUser.id));
	await tx
		.update(table.clientUser)
		.set({ isPrimary: false, updatedAt: new Date() })
		.where(and(...demoteConditions));
}

/**
 * Emails (lowercased) of everyone actually ON a task: every task_assignee row,
 * every task_watcher row and the single assignedTo user. Client-company
 * notifications must stay scoped to these — notify_tasks is a company-level
 * flag, not task participation, and without this filter every flagged contact
 * receives every task of the company, including ones they're not part of.
 */
export async function getTaskParticipantEmails(
	taskId: string,
	tenantId: string,
	assignedToUserId: string | null
): Promise<Set<string>> {
	const assigneeRows = await db
		.select({ email: table.user.email })
		.from(table.taskAssignee)
		.innerJoin(table.user, eq(table.taskAssignee.userId, table.user.id))
		.where(and(eq(table.taskAssignee.taskId, taskId), eq(table.taskAssignee.tenantId, tenantId)));

	const watcherRows = await db
		.select({ email: table.user.email })
		.from(table.taskWatcher)
		.innerJoin(table.user, eq(table.taskWatcher.userId, table.user.id))
		.where(and(eq(table.taskWatcher.taskId, taskId), eq(table.taskWatcher.tenantId, tenantId)));

	const participants = new Set<string>();
	for (const r of [...assigneeRows, ...watcherRows]) {
		if (r.email) participants.add(r.email.toLowerCase().trim());
	}

	if (assignedToUserId) {
		const [assigned] = await db
			.select({ email: table.user.email })
			.from(table.user)
			.where(eq(table.user.id, assignedToUserId))
			.limit(1);
		if (assigned?.email) participants.add(assigned.email.toLowerCase().trim());
	}

	return participants;
}

/**
 * Task-eligible client users for a client: the primary contact (is_primary
 * flag OR user email matching client.email) plus secondary contacts whose
 * clientSecondaryEmail row grants accessFlags.tasks (legacy notifyTasks
 * fallback). Mirrors the visibility rule of getAssignableClientUsers in
 * users.remote.ts — server-side validations (createTask, addAssignee,
 * updateTask) MUST use this same rule, otherwise assignment becomes an
 * implicit access escalation for contacts the admin explicitly denied.
 */
export async function getEligibleClientAssigneeIds(
	tenantId: string,
	clientId: string
): Promise<Set<string>> {
	const rows = await db
		.select({
			userId: table.user.id,
			email: table.user.email,
			isPrimary: table.clientUser.isPrimary
		})
		.from(table.clientUser)
		.innerJoin(table.user, eq(table.clientUser.userId, table.user.id))
		.where(and(eq(table.clientUser.clientId, clientId), eq(table.clientUser.tenantId, tenantId)));

	if (rows.length === 0) return new Set();

	const cseRows = await db
		.select({
			email: table.clientSecondaryEmail.email,
			accessFlags: table.clientSecondaryEmail.accessFlags,
			notifyTasks: table.clientSecondaryEmail.notifyTasks
		})
		.from(table.clientSecondaryEmail)
		.where(
			and(
				eq(table.clientSecondaryEmail.clientId, clientId),
				eq(table.clientSecondaryEmail.tenantId, tenantId)
			)
		);

	const tasksAccessByEmail = new Map<string, boolean>();
	for (const r of cseRows) {
		let hasTasksAccess = false;
		if (r.accessFlags) {
			try {
				hasTasksAccess = !!JSON.parse(r.accessFlags).tasks;
			} catch {
				// fallthrough to legacy notify column
			}
		}
		if (!hasTasksAccess && r.notifyTasks) hasTasksAccess = true;
		tasksAccessByEmail.set(r.email.toLowerCase(), hasTasksAccess);
	}

	const [cli] = await db
		.select({ email: table.client.email })
		.from(table.client)
		.where(and(eq(table.client.id, clientId), eq(table.client.tenantId, tenantId)))
		.limit(1);
	const primaryEmail = cli?.email?.trim().toLowerCase() || null;

	return new Set(
		rows
			.filter((r) => {
				if (r.isPrimary) return true;
				if (primaryEmail && r.email?.toLowerCase() === primaryEmail) return true;
				return r.email ? tasksAccessByEmail.get(r.email.toLowerCase()) === true : false;
			})
			.map((r) => r.userId)
	);
}
