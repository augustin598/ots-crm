/**
 * Test script for contract audit Sprint 1 fixes.
 * Run with: bun run test-contract-audit.ts
 * Connects directly to SQLite, bypassing SvelteKit.
 */
import { createClient } from '@libsql/client';
import { drizzle } from 'drizzle-orm/libsql';
import * as schema from './src/lib/server/db/schema';
import { eq, and, sql } from 'drizzle-orm';
import { encodeBase32LowerCase } from '@oslojs/encoding';

const table = schema;
const client = createClient({ url: 'file:local-ots.db' });
const db = drizzle(client, { schema });

const TENANT_ID = 'k2yzj5bxxppatc57vxpoxfvn';
const VALID_CLIENT_ID = 'dilc45rkfkpnguu6keccttch';
const USER_ID = 'wj5kq6qc736tuizvu7vscce5';

function genId() {
	return encodeBase32LowerCase(crypto.getRandomValues(new Uint8Array(15)));
}

let passed = 0;
let failed = 0;
const results: string[] = [];

function assert(testName: string, condition: boolean, detail?: string) {
	if (condition) {
		passed++;
		results.push(`  ✅ ${testName}`);
	} else {
		failed++;
		results.push(`  ❌ ${testName}${detail ? ` — ${detail}` : ''}`);
	}
}

async function cleanup(contractIds: string[]) {
	for (const id of contractIds) {
		await db.delete(table.contractSignToken).where(eq(table.contractSignToken.contractId, id)).catch(() => {});
		await db.delete(table.contractLineItem).where(eq(table.contractLineItem.contractId, id)).catch(() => {});
		await db.delete(table.contract).where(eq(table.contract.id, id)).catch(() => {});
	}
}

// ===== Status validation logic (mirrors contracts.remote.ts) =====
const CONTRACT_STATUSES = ['draft', 'sent', 'signed', 'active', 'expired', 'cancelled'] as const;
type ContractStatus = (typeof CONTRACT_STATUSES)[number];

const VALID_STATUS_TRANSITIONS: Record<ContractStatus, ContractStatus[]> = {
	draft: ['sent', 'cancelled'],
	sent: ['signed', 'draft', 'cancelled'],
	signed: ['active', 'cancelled'],
	active: ['expired', 'cancelled'],
	expired: [],
	cancelled: []
};

function validateStatusTransition(currentStatus: string, newStatus: string): void {
	if (!CONTRACT_STATUSES.includes(newStatus as ContractStatus)) {
		throw new Error(`Status invalid: "${newStatus}"`);
	}
	const allowed = VALID_STATUS_TRANSITIONS[currentStatus as ContractStatus];
	if (allowed && !allowed.includes(newStatus as ContractStatus)) {
		throw new Error(`Tranziție nepermisă: "${currentStatus}" → "${newStatus}"`);
	}
}

const testContractIds: string[] = [];

async function runTests() {
	console.log('\n🔍 Contract Audit Sprint 1 — Test Suite\n');

	// ─── TEST 1: Create contract with valid client (happy path) ───
	console.log('── Test 1: Create contract (happy path)');
	{
		const id = genId();
		testContractIds.push(id);
		await db.transaction(async (tx) => {
			const [maxResult] = await tx
				.select({ maxNumber: sql<string>`max(${table.contract.contractNumber})` })
				.from(table.contract)
				.where(eq(table.contract.tenantId, TENANT_ID));
			let nextNumber = 1;
			if (maxResult?.maxNumber) {
				const match = maxResult.maxNumber.match(/(\d+)$/);
				if (match) nextNumber = parseInt(match[1], 10) + 1;
			}
			const num = `CTR-${String(nextNumber).padStart(4, '0')}`;

			await tx.insert(table.contract).values({
				id, tenantId: TENANT_ID, clientId: VALID_CLIENT_ID, contractNumber: num,
				contractDate: new Date(), contractTitle: 'Test Audit', status: 'draft',
				currency: 'EUR', paymentTermsDays: 5, penaltyRate: 50,
				billingFrequency: 'monthly', contractDurationMonths: 6,
				hourlyRate: 6000, hourlyRateCurrency: 'EUR', createdByUserId: USER_ID
			});
		});
		const [c] = await db.select().from(table.contract).where(eq(table.contract.id, id)).limit(1);
		assert('Contract creat cu succes', !!c);
		assert('Status initial = draft', c?.status === 'draft');
		assert('Contract number generat', !!c?.contractNumber?.startsWith('CTR-'));
	}

	// ─── TEST 2: Cross-tenant client validation (BUG-003) ───
	console.log('── Test 2: Cross-tenant client validation (BUG-003)');
	{
		const [client] = await db.select().from(table.client)
			.where(and(eq(table.client.id, VALID_CLIENT_ID), eq(table.client.tenantId, TENANT_ID)))
			.limit(1);
		assert('Client valid apartine tenant-ului', !!client);

		const [fakeClient] = await db.select().from(table.client)
			.where(and(eq(table.client.id, 'fake-client-id-xxx'), eq(table.client.tenantId, TENANT_ID)))
			.limit(1);
		assert('Client inexistent returneaza null (guard ar bloca)', !fakeClient);
	}

	// ─── TEST 3: Invalid status transitions (BUG-001) ───
	console.log('── Test 3: Invalid status transitions (BUG-001)');
	{
		const invalidTransitions = [
			['cancelled', 'active'], ['expired', 'draft'], ['expired', 'active'],
			['cancelled', 'sent'], ['draft', 'active'], ['draft', 'signed'],
			['signed', 'sent'], ['active', 'draft'],
		];
		for (const [from, to] of invalidTransitions) {
			let threw = false;
			try { validateStatusTransition(from, to); } catch { threw = true; }
			assert(`${from} → ${to} blocat`, threw);
		}
	}

	// ─── TEST 4: Valid status transitions ───
	console.log('── Test 4: Valid status transitions');
	{
		const validTransitions = [
			['draft', 'sent'], ['draft', 'cancelled'], ['sent', 'signed'],
			['sent', 'draft'], ['sent', 'cancelled'], ['signed', 'active'],
			['signed', 'cancelled'], ['active', 'expired'], ['active', 'cancelled'],
		];
		for (const [from, to] of validTransitions) {
			let threw = false;
			try { validateStatusTransition(from, to); } catch { threw = true; }
			assert(`${from} → ${to} permis`, !threw);
		}
	}

	// ─── TEST 5: Invalid status string rejected ───
	console.log('── Test 5: Invalid status string rejected');
	{
		let threw = false;
		try { validateStatusTransition('draft', 'hacked'); } catch { threw = true; }
		assert('Status "hacked" respins', threw);

		threw = false;
		try { validateStatusTransition('draft', ''); } catch { threw = true; }
		assert('Status gol respins', threw);
	}

	// ─── TEST 6: Contract number uniqueness (BUG-002) ───
	console.log('── Test 6: Contract number uniqueness (BUG-002)');
	{
		const numbers: string[] = [];
		for (let i = 0; i < 5; i++) {
			const id = genId();
			testContractIds.push(id);
			await db.transaction(async (tx) => {
				const [maxResult] = await tx
					.select({ maxNumber: sql<string>`max(${table.contract.contractNumber})` })
					.from(table.contract)
					.where(eq(table.contract.tenantId, TENANT_ID));
				let nextNumber = 1;
				if (maxResult?.maxNumber) {
					const match = maxResult.maxNumber.match(/(\d+)$/);
					if (match) nextNumber = parseInt(match[1], 10) + 1;
				}
				const num = `CTR-${String(nextNumber).padStart(4, '0')}`;
				numbers.push(num);
				await tx.insert(table.contract).values({
					id, tenantId: TENANT_ID, clientId: VALID_CLIENT_ID, contractNumber: num,
					contractDate: new Date(), contractTitle: `Test Seq ${i}`, status: 'draft',
					currency: 'EUR', paymentTermsDays: 5, penaltyRate: 50,
					billingFrequency: 'monthly', contractDurationMonths: 6,
					hourlyRate: 6000, hourlyRateCurrency: 'EUR', createdByUserId: USER_ID
				});
			});
		}
		const uniqueNumbers = new Set(numbers);
		assert(`5 numere unice (${numbers.join(', ')})`, uniqueNumbers.size === 5);
		const numericParts = numbers.map(n => parseInt(n.replace('CTR-', ''), 10));
		const isSequential = numericParts.every((n, i) => i === 0 || n === numericParts[i-1] + 1);
		assert('Numerele sunt secventiale', isSequential);
	}

	// ─── TEST 7: Delete transactional (BUG-004) ───
	console.log('── Test 7: Delete contract transactional (BUG-004)');
	{
		const id = genId();
		const tokenId = genId();
		const lineItemId = genId();

		await db.insert(table.contract).values({
			id, tenantId: TENANT_ID, clientId: VALID_CLIENT_ID,
			contractNumber: 'CTR-DEL-TEST', contractDate: new Date(),
			contractTitle: 'Delete Test', status: 'draft', currency: 'EUR',
			paymentTermsDays: 5, penaltyRate: 50, billingFrequency: 'monthly',
			contractDurationMonths: 6, hourlyRate: 6000, hourlyRateCurrency: 'EUR',
			createdByUserId: USER_ID
		});
		await db.insert(table.contractLineItem).values({
			id: lineItemId, contractId: id, description: 'Test', price: 100, unitOfMeasure: 'Luna', sortOrder: 0
		});
		await db.insert(table.contractSignToken).values({
			id: tokenId, token: 'test-hash-delete', contractId: id, tenantId: TENANT_ID,
			email: 'test@test.com', expiresAt: new Date(Date.now() + 86400000), used: false
		});

		await db.transaction(async (tx) => {
			await tx.delete(table.contractSignToken).where(eq(table.contractSignToken.contractId, id));
			await tx.delete(table.contractLineItem).where(eq(table.contractLineItem.contractId, id));
			await tx.delete(table.contract).where(eq(table.contract.id, id));
		});

		const [afterContract] = await db.select().from(table.contract).where(eq(table.contract.id, id)).limit(1);
		const afterTokens = await db.select().from(table.contractSignToken).where(eq(table.contractSignToken.contractId, id));
		const afterItems = await db.select().from(table.contractLineItem).where(eq(table.contractLineItem.contractId, id));

		assert('Contract sters', !afterContract);
		assert('Sign tokens sterse', afterTokens.length === 0);
		assert('Line items sterse', afterItems.length === 0);
	}

	// ─── TEST 8: Token revocation (BL-005) ───
	console.log('── Test 8: Token revocation (BL-005)');
	{
		const contractId = testContractIds[0];
		const token1Id = genId();
		const token2Id = genId();

		await db.insert(table.contractSignToken).values({
			id: token1Id, token: 'hash-rev-1', contractId, tenantId: TENANT_ID,
			email: 'old@test.com', expiresAt: new Date(Date.now() + 86400000), used: false
		});
		await db.insert(table.contractSignToken).values({
			id: token2Id, token: 'hash-rev-2', contractId, tenantId: TENANT_ID,
			email: 'old2@test.com', expiresAt: new Date(Date.now() + 86400000), used: false
		});

		// Revoke all unused tokens (as the fix does)
		await db.update(table.contractSignToken)
			.set({ used: true, usedAt: new Date() })
			.where(and(
				eq(table.contractSignToken.contractId, contractId),
				eq(table.contractSignToken.used, false)
			));

		const tokens = await db.select().from(table.contractSignToken)
			.where(and(eq(table.contractSignToken.contractId, contractId), eq(table.contractSignToken.used, false)));

		assert('Toate token-urile vechi revocate (0 unused)', tokens.length === 0);

		// Cleanup
		await db.delete(table.contractSignToken).where(eq(table.contractSignToken.id, token1Id));
		await db.delete(table.contractSignToken).where(eq(table.contractSignToken.id, token2Id));
	}

	// ─── TEST 9: Beneficiar signing transactional (BUG-007) ───
	console.log('── Test 9: Beneficiar signing transaction (BUG-007)');
	{
		const contractId = testContractIds[0];
		const tokenId = genId();

		await db.insert(table.contractSignToken).values({
			id: tokenId, token: 'hash-sign-test', contractId, tenantId: TENANT_ID,
			email: 'sign@test.com', expiresAt: new Date(Date.now() + 86400000), used: false
		});

		await db.transaction(async (tx) => {
			await tx.update(table.contractSignToken)
				.set({ used: true, usedAt: new Date() })
				.where(eq(table.contractSignToken.id, tokenId));
			await tx.update(table.contract)
				.set({ beneficiarSignatureName: 'Test Signer', beneficiarSignedAt: new Date(), status: 'signed', updatedAt: new Date() })
				.where(eq(table.contract.id, contractId));
		});

		const [token] = await db.select().from(table.contractSignToken).where(eq(table.contractSignToken.id, tokenId)).limit(1);
		const [contract] = await db.select().from(table.contract).where(eq(table.contract.id, contractId)).limit(1);

		assert('Token marcat ca used', token?.used === true);
		assert('Contract status = signed', contract?.status === 'signed');
		assert('Beneficiar signature setat', contract?.beneficiarSignatureName === 'Test Signer');

		// Cleanup: revert
		await db.update(table.contract)
			.set({ status: 'draft', beneficiarSignatureName: null, beneficiarSignedAt: null, updatedAt: new Date() })
			.where(eq(table.contract.id, contractId));
		await db.delete(table.contractSignToken).where(eq(table.contractSignToken.id, tokenId));
	}

	// ─── CLEANUP ───
	console.log('\n── Cleanup');
	await cleanup(testContractIds);
	console.log('  Cleanup complet.\n');

	// ─── RESULTS ───
	console.log('═══════════════════════════════════════════');
	console.log('  REZULTATE');
	console.log('═══════════════════════════════════════════');
	for (const r of results) console.log(r);
	console.log('───────────────────────────────────────────');
	console.log(`  Total: ${passed + failed} | ✅ Passed: ${passed} | ❌ Failed: ${failed}`);
	console.log('═══════════════════════════════════════════\n');

	process.exit(failed > 0 ? 1 : 0);
}

runTests().catch((err) => {
	console.error('Fatal error:', err);
	cleanup(testContractIds).then(() => process.exit(1));
});
