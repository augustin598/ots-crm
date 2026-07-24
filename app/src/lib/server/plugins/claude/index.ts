import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { eq } from 'drizzle-orm';
import { decrypt, DecryptionError } from './crypto';
import { createClaudeClient, type ClaudeClient } from './client';
import type { ClaudeKeyType } from './key-utils';
import { getPluginRegistry } from '../registry';
import { logWarning } from '$lib/server/logger';
import { isKnownClaudeModel } from '$lib/claude-models';
import {
	resolveUseCaseRoute,
	isKnownUseCase,
	GENERAL_USE_CASE_ID,
	type ClaudeUseCaseId
} from '$lib/claude-usecases';

export type { ClaudeClient } from './client';

type ClaudeRow = typeof table.claudeIntegration.$inferSelect;

/** Un slot de cheie stocat pe rând: ciphertext + tipul cheii. */
interface StoredSlot {
	keyType: ClaudeKeyType;
	ciphertext: string;
}
/** Selector stabil între citirea inițială și re-citirea de retry (alege ACELAȘI slot logic). */
type SlotSelector = (row: ClaudeRow) => StoredSlot | null;

async function readRow(tenantId: string): Promise<ClaudeRow | null> {
	const [row] = await db
		.select()
		.from(table.claudeIntegration)
		.where(eq(table.claudeIntegration.tenantId, tenantId))
		.limit(1);
	return row ?? null;
}

function normalizeKeyType(v: string | null | undefined): ClaudeKeyType | null {
	return v === 'api' || v === 'oat' ? v : null;
}

/**
 * Sloturile stocate pe rând, în ordine: PRIMAR (coloane istorice apiKeyEncrypted/keyType)
 * apoi SECUNDAR (second_key_*). Fiecare tenant are cel mult un slot per keyType (garantat
 * de write path). Slotul primar poate ține 'api' SAU 'oat'.
 */
function storedSlots(row: ClaudeRow): StoredSlot[] {
	const slots: StoredSlot[] = [];
	const primaryType = normalizeKeyType(row.keyType);
	if (primaryType && row.apiKeyEncrypted) {
		slots.push({ keyType: primaryType, ciphertext: row.apiKeyEncrypted });
	}
	const secondType = normalizeKeyType(row.secondKeyType);
	if (secondType && row.secondKeyEncrypted) {
		slots.push({ keyType: secondType, ciphertext: row.secondKeyEncrypted });
	}
	return slots;
}

const findSlot = (slots: StoredSlot[], want: ClaudeKeyType): StoredSlot | null =>
	slots.find((s) => s.keyType === want) ?? null;

const selectPrimary: SlotSelector = (row) => storedSlots(row)[0] ?? null;
const selectStrict =
	(want: ClaudeKeyType): SlotSelector =>
	(row) =>
		findSlot(storedSlots(row), want);
const selectLenient =
	(want: ClaudeKeyType): SlotSelector =>
	(row) => {
		const slots = storedSlots(row);
		return findSlot(slots, want) ?? slots[0] ?? null; // cerut → orice cheie stocată
	};

/**
 * Decriptare cu 1 retry pe DecryptionError (Turso transient), re-selectând ACELAȘI slot
 * logic din rândul proaspăt (decrypt e sync și aruncă DecryptionError).
 */
async function decryptSlot(
	tenantId: string,
	row: ClaudeRow,
	select: SlotSelector
): Promise<{ plaintext: string; slot: StoredSlot; row: ClaudeRow } | null> {
	const slot = select(row);
	if (!slot) return null;
	try {
		return { plaintext: decrypt(tenantId, slot.ciphertext), slot, row };
	} catch (e) {
		if (!(e instanceof DecryptionError)) throw e;
		logWarning(
			'plugin',
			'Claude key decrypt failed — retrying with fresh DB read (possible Turso transient)',
			{ tenantId, metadata: { keyType: slot.keyType } }
		);
		const fresh = await readRow(tenantId);
		if (!fresh || !fresh.isActive) return null;
		const freshSlot = select(fresh);
		if (!freshSlot) return null;
		return { plaintext: decrypt(tenantId, freshSlot.ciphertext), slot: freshSlot, row: fresh };
	}
}

/**
 * Client Claude pentru un slot anume — sau slotul primar dacă `keyType` lipsește.
 * COMPAT: `getClaudeClient(tenantId)` (fără al 2-lea arg) întoarce clientul cheii primare,
 * identic cu comportamentul de dinainte de rutare. Cu `keyType` explicit e STRICT:
 * null dacă acel slot nu e stocat (fără fallback). null și dacă plugin inactiv / rând inactiv.
 */
export async function getClaudeClient(
	tenantId: string,
	keyType?: ClaudeKeyType
): Promise<ClaudeClient | null> {
	const registry = getPluginRegistry();
	if (!(await registry.isPluginActiveForTenant(tenantId, 'claude'))) return null;

	const row = await readRow(tenantId);
	if (!row || !row.isActive) return null;

	const resolved = await decryptSlot(
		tenantId,
		row,
		keyType ? selectStrict(keyType) : selectPrimary
	);
	if (!resolved) return null;

	return createClaudeClient({
		apiKey: resolved.plaintext,
		keyType: resolved.slot.keyType,
		defaultModel: resolved.row.defaultModel
	});
}

/**
 * Client Claude RUTAT pentru un use-case (ce vor apela funcțiile AI viitoare).
 *  - Rută: ruta use-case-ului → ruta 'general' → default din catalog (resolveUseCaseRoute).
 *  - Cheie: slotul cu keyType-ul rutat → orice cheie stocată → null (selectLenient).
 *  - Model: modelul rutat dacă e cunoscut, altfel row.defaultModel.
 * null dacă plugin inactiv / rând inactiv / nicio cheie stocată.
 */
export async function getClaudeClientFor(
	tenantId: string,
	useCaseId: ClaudeUseCaseId
): Promise<ClaudeClient | null> {
	const registry = getPluginRegistry();
	if (!(await registry.isPluginActiveForTenant(tenantId, 'claude'))) return null;

	const row = await readRow(tenantId);
	if (!row || !row.isActive) return null;

	const id: ClaudeUseCaseId = isKnownUseCase(useCaseId) ? useCaseId : GENERAL_USE_CASE_ID;
	const route = resolveUseCaseRoute(id, row.routes);

	const resolved = await decryptSlot(tenantId, row, selectLenient(route.keyType));
	if (!resolved) return null;

	return createClaudeClient({
		apiKey: resolved.plaintext,
		keyType: resolved.slot.keyType,
		defaultModel: isKnownClaudeModel(route.model) ? route.model : resolved.row.defaultModel
	});
}
