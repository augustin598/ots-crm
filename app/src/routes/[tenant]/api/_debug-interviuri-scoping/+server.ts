import { json, error } from '@sveltejs/kit';
import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { eq, and, sql, isNull, count } from 'drizzle-orm';
import type { RequestHandler } from './$types';

/**
 * Diagnostic pentru delimitarea interviurilor între clienți.
 *
 *   GET                    — distribuția interviurilor pe clienți + userii de portal
 *   GET ?clientId=<id>     — simulează ce vede portalul acelui client (aceeași
 *                            condiție ca `getInterviews` pentru isClientUser)
 *
 * Read-only, admin-only, tenant-scoped. Nu scrie nimic.
 */

function requireAdmin(event: Parameters<RequestHandler>[0]) {
	if (!event.locals.user || !event.locals.tenant) throw error(401, 'Unauthorized');
	const role = event.locals.tenantUser?.role;
	if (role !== 'owner' && role !== 'admin') {
		throw error(403, 'Forbidden: Admin access required');
	}
}

export const GET: RequestHandler = async (event) => {
	requireAdmin(event);
	const tenantId = event.locals.tenant!.id;
	const clientId = event.url.searchParams.get('clientId');

	// Distribuția interviurilor pe clienți, în tenantul curent.
	const perClient = await db
		.select({
			clientId: table.interview.clientId,
			clientName: table.client.name,
			total: count()
		})
		.from(table.interview)
		.leftJoin(
			table.client,
			and(eq(table.interview.clientId, table.client.id), eq(table.client.tenantId, tenantId))
		)
		.where(eq(table.interview.tenantId, tenantId))
		.groupBy(table.interview.clientId, table.client.name)
		.orderBy(sql`count(*) DESC`);

	const [{ total }] = await db
		.select({ total: count() })
		.from(table.interview)
		.where(eq(table.interview.tenantId, tenantId));

	const [{ unassigned }] = await db
		.select({ unassigned: count() })
		.from(table.interview)
		.where(and(eq(table.interview.tenantId, tenantId), isNull(table.interview.clientId)));

	// Clienții cu useri de portal — ei sunt cei care pot deschide /client/<tenant>/interviuri.
	const portalClients = await db
		.select({
			clientId: table.client.id,
			clientName: table.client.name,
			portalUsers: count(table.clientUser.userId)
		})
		.from(table.client)
		.innerJoin(table.clientUser, eq(table.clientUser.clientId, table.client.id))
		.where(eq(table.client.tenantId, tenantId))
		.groupBy(table.client.id, table.client.name)
		.orderBy(sql`count(*) DESC`);

	const byClient = Object.fromEntries(
		perClient.map((r) => [r.clientId ?? '(fără client)', r.total])
	);

	// Simulare portal: exact condiția din getInterviews pentru un user de portal.
	let simulare: unknown = null;
	if (clientId) {
		const [target] = await db
			.select({ id: table.client.id, name: table.client.name })
			.from(table.client)
			.where(and(eq(table.client.id, clientId), eq(table.client.tenantId, tenantId)))
			.limit(1);
		if (!target) throw error(404, 'Clientul nu există în acest tenant');

		const rows = await db
			.select({
				id: table.interview.id,
				nume: table.interview.nume,
				dataInterviu: table.interview.dataInterviu,
				clientId: table.interview.clientId
			})
			.from(table.interview)
			.where(
				and(eq(table.interview.tenantId, tenantId), eq(table.interview.clientId, clientId))
			);

		simulare = {
			client: target,
			// Câte rânduri întoarce EFECTIV interogarea portalului pentru clientul ăsta.
			returnateDeQuery: rows.length,
			// Restul interviurilor tenantului: nu sunt filtrate în UI, ci nici măcar
			// selectate — `client_id` e în WHERE, deci nu părăsesc niciodată baza.
			neatinseDeQuery: total - rows.length,
			// Trebuie să fie 0: orice rând al altui client în rezultat = scurgere.
			scurgeri: rows.filter((r) => r.clientId !== clientId).length,
			exemple: rows.slice(0, 5)
		};
	}

	return json({
		tenantId,
		total,
		unassigned,
		byClient,
		perClient,
		portalClients,
		simulare,
		hint: 'Adaugă ?clientId=<id> ca să vezi exact ce ar returna portalul acelui client.'
	});
};
