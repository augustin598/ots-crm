import { json, error } from '@sveltejs/kit';
import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { and, eq, sql } from 'drizzle-orm';
import { recordContractActivity } from '$lib/server/contract-activity';
import type { RequestHandler } from './$types';

/**
 * Find and resolve duplicate contract numbers within a tenant.
 *
 * GET  → returns groups of contracts that share the same contract_number
 *        (must be empty before applying the contract_tenant_number_unique migration).
 *
 * POST ?contractId=XXX → renumbers that contract to the next available
 *        sequential number (using the tenant's contractPrefix). Use this to
 *        resolve a duplicate by moving the lower-priority contract off the
 *        shared number. Records a contract activity entry for the change.
 *
 * Admin-only.
 */

function assertAdmin(event: Parameters<RequestHandler>[0]) {
	if (!event.locals.user || !event.locals.tenant) throw error(401, 'Unauthorized');
	if (event.locals.tenantUser?.role !== 'owner' && event.locals.tenantUser?.role !== 'admin') {
		throw error(403, 'Admin only');
	}
}

export const GET: RequestHandler = async (event) => {
	assertAdmin(event);
	const tenantId = event.locals.tenant!.id;

	const dupNumbers = await db
		.select({
			contractNumber: table.contract.contractNumber,
			count: sql<number>`count(*)`.as('cnt')
		})
		.from(table.contract)
		.where(eq(table.contract.tenantId, tenantId))
		.groupBy(table.contract.contractNumber)
		.having(sql`count(*) > 1`);

	if (dupNumbers.length === 0) {
		return json({ duplicates: [], total: 0 });
	}

	const groups = await Promise.all(
		dupNumbers.map(async (row) => {
			const contracts = await db
				.select({
					id: table.contract.id,
					contractNumber: table.contract.contractNumber,
					contractTitle: table.contract.contractTitle,
					contractDate: table.contract.contractDate,
					status: table.contract.status,
					clientId: table.contract.clientId,
					createdAt: table.contract.createdAt
				})
				.from(table.contract)
				.where(
					and(
						eq(table.contract.tenantId, tenantId),
						eq(table.contract.contractNumber, row.contractNumber)
					)
				);

			const clients = await Promise.all(
				contracts.map(async (c) => {
					const [client] = await db
						.select({ id: table.client.id, name: table.client.name, businessName: table.client.businessName })
						.from(table.client)
						.where(eq(table.client.id, c.clientId))
						.limit(1);
					return { ...c, client: client || null };
				})
			);
			return { contractNumber: row.contractNumber, count: row.count, contracts: clients };
		})
	);

	return json({ duplicates: groups, total: groups.length });
};

export const POST: RequestHandler = async (event) => {
	assertAdmin(event);
	const tenantId = event.locals.tenant!.id;
	const userId = event.locals.user!.id;
	const prefix = event.locals.tenant!.contractPrefix || 'CTR';

	const contractId = event.url.searchParams.get('contractId');
	if (!contractId) throw error(400, 'contractId query param required');

	const [target] = await db
		.select()
		.from(table.contract)
		.where(and(eq(table.contract.id, contractId), eq(table.contract.tenantId, tenantId)))
		.limit(1);

	if (!target) throw error(404, 'Contract not found');

	const oldNumber = target.contractNumber;

	const escapedPrefix = prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
	const re = new RegExp(`^${escapedPrefix}-(\\d+)$`);

	const allRows = await db
		.select({ contractNumber: table.contract.contractNumber })
		.from(table.contract)
		.where(eq(table.contract.tenantId, tenantId));

	let maxNum = 0;
	for (const row of allRows) {
		const m = row.contractNumber.match(re);
		if (m) {
			const n = parseInt(m[1], 10);
			if (n > maxNum) maxNum = n;
		}
	}
	const newNumber = `${prefix}-${String(maxNum + 1).padStart(4, '0')}`;

	if (newNumber === oldNumber) {
		throw error(409, `Computed number "${newNumber}" matches current. Aborting.`);
	}

	// Final guard against race with another renumber call
	const [collision] = await db
		.select({ id: table.contract.id })
		.from(table.contract)
		.where(
			and(
				eq(table.contract.tenantId, tenantId),
				eq(table.contract.contractNumber, newNumber)
			)
		)
		.limit(1);
	if (collision) throw error(409, `Number "${newNumber}" already taken; retry`);

	await db
		.update(table.contract)
		.set({ contractNumber: newNumber, version: target.version + 1, updatedAt: new Date() })
		.where(eq(table.contract.id, contractId));

	await recordContractActivity({
		contractId,
		userId,
		tenantId,
		action: 'updated',
		field: 'contractNumber',
		oldValue: oldNumber,
		newValue: newNumber
	});

	return json({ success: true, contractId, oldNumber, newNumber });
};
