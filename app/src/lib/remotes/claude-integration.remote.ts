import { query, command, getRequestEvent } from '$app/server';
import * as v from 'valibot';
import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { eq } from 'drizzle-orm';
import { encodeBase32LowerCase } from '@oslojs/encoding';
import { getActor } from '$lib/server/get-actor';
import { assertCan } from '$lib/server/access';
import { encryptVerified } from '$lib/server/plugins/claude/crypto';
import { detectKeyType, keyHint, isValidClaudeKey } from '$lib/server/plugins/claude/key-utils';
import { getClaudeClient } from '$lib/server/plugins/claude';
import { CLAUDE_MODEL_IDS } from '$lib/claude-models';
import {
	CLAUDE_USE_CASE_IDS,
	resolveRoutes,
	type ClaudeRouteKeyType,
	type ClaudeRoutes,
	type ClaudeUseCaseId
} from '$lib/claude-usecases';
import { logInfo, logWarning, serializeError } from '$lib/server/logger';

function scope() {
	const event = getRequestEvent();
	if (!event?.locals.user || !event?.locals.tenant) throw new Error('Unauthorized');
	return { event, tenantId: event.locals.tenant.id };
}

function generateId(): string {
	return encodeBase32LowerCase(crypto.getRandomValues(new Uint8Array(15)));
}

const KEY_TYPES = ['api', 'oat'] as const;

/** Un slot server-side: ciphertext (nu părăsește serverul) + hint (ultimele 4). */
type StoredKey = { enc: string; hint: string };
/** Sloturile stocate, indexate pe tip. Cel mult unul per tip (garantat de write path). */
type SlotsByType = Partial<Record<ClaudeRouteKeyType, StoredKey>>;

/** Coloanele de slot ale rândului (cu ciphertext — DOAR pentru carry-forward pe server). */
type SlotRow = {
	apiKeyEncrypted: string;
	keyType: string;
	keyHint: string;
	secondKeyEncrypted: string | null;
	secondKeyType: string | null;
	secondKeyHint: string | null;
};

function normalizeKeyType(x: string | null | undefined): ClaudeRouteKeyType | null {
	return x === 'api' || x === 'oat' ? x : null;
}

/** Extrage sloturile stocate pe tip din coloanele rândului (primar + secundar). */
function slotsByType(row: SlotRow): SlotsByType {
	const out: SlotsByType = {};
	const pt = normalizeKeyType(row.keyType);
	if (pt && row.apiKeyEncrypted) out[pt] = { enc: row.apiKeyEncrypted, hint: row.keyHint ?? '' };
	const st = normalizeKeyType(row.secondKeyType);
	if (st && row.secondKeyEncrypted)
		out[st] = { enc: row.secondKeyEncrypted, hint: row.secondKeyHint ?? '' };
	return out;
}

const SLOT_COLS = {
	apiKeyEncrypted: table.claudeIntegration.apiKeyEncrypted,
	keyType: table.claudeIntegration.keyType,
	keyHint: table.claudeIntegration.keyHint,
	secondKeyEncrypted: table.claudeIntegration.secondKeyEncrypted,
	secondKeyType: table.claudeIntegration.secondKeyType,
	secondKeyHint: table.claudeIntegration.secondKeyHint
} as const;

/**
 * Normalizează sloturile dorite în coloane: prima cheie prezentă → slot PRIMAR
 * (apiKeyEncrypted NOT NULL), a doua → slot SECUNDAR. Upsert pe rândul unic/tenant.
 * `desired` trebuie să aibă ≥1 cheie (0 chei = ștergere de rând, tratată separat).
 */
async function writeSlots(tenantId: string, desired: SlotsByType, rowExists: boolean) {
	const present: Array<{ keyType: ClaudeRouteKeyType; key: StoredKey }> = [];
	if (desired.oat) present.push({ keyType: 'oat', key: desired.oat });
	if (desired.api) present.push({ keyType: 'api', key: desired.api });
	// oat înainte de api doar ca ordine deterministă; poziția fizică nu contează (citim pe tip).
	const primary = present[0];
	const secondary = present[1];
	if (!primary) throw new Error('writeSlots fără nicio cheie'); // never (caller garantează ≥1)

	const cols = {
		apiKeyEncrypted: primary.key.enc,
		keyType: primary.keyType,
		keyHint: primary.key.hint,
		secondKeyEncrypted: secondary?.key.enc ?? null,
		secondKeyType: secondary?.keyType ?? null,
		secondKeyHint: secondary?.key.hint ?? null
	};

	if (rowExists) {
		await db
			.update(table.claudeIntegration)
			.set({ ...cols, isActive: true, updatedAt: new Date() })
			.where(eq(table.claudeIntegration.tenantId, tenantId));
	} else {
		await db.insert(table.claudeIntegration).values({
			id: generateId(),
			tenantId,
			...cols,
			isActive: true
		});
	}
}

/* ─────────────────────────── (a) READ ─────────────────────────── */

/**
 * Status integrare + rutare pentru tenantul curent. NU întoarce niciodată cheile
 * (doar hint-uri/booleeni). Întoarce mereu un obiect (chiar fără rând) ca UI-ul de
 * rutare să aibă default-uri complete.
 */
export const getClaudeIntegration = query(async () => {
	const { event, tenantId } = scope();
	const actor = await getActor(event);
	assertCan(actor, 'admin.claude.view');

	const [row] = await db
		.select({
			apiKeyEncrypted: table.claudeIntegration.apiKeyEncrypted,
			keyType: table.claudeIntegration.keyType,
			keyHint: table.claudeIntegration.keyHint,
			secondKeyEncrypted: table.claudeIntegration.secondKeyEncrypted,
			secondKeyType: table.claudeIntegration.secondKeyType,
			secondKeyHint: table.claudeIntegration.secondKeyHint,
			lastTestedAt: table.claudeIntegration.lastTestedAt,
			lastError: table.claudeIntegration.lastError,
			routes: table.claudeIntegration.routes
		})
		.from(table.claudeIntegration)
		.where(eq(table.claudeIntegration.tenantId, tenantId))
		.limit(1);

	if (!row) {
		return {
			configured: false,
			api: { connected: false, hint: null as string | null },
			oat: { connected: false, hint: null as string | null },
			lastTestedAt: null as Date | null,
			lastError: null as string | null,
			routes: resolveRoutes(null)
		};
	}

	const slots = slotsByType(row);
	return {
		configured: true,
		api: { connected: !!slots.api, hint: slots.api?.hint ?? null },
		oat: { connected: !!slots.oat, hint: slots.oat?.hint ?? null },
		lastTestedAt: row.lastTestedAt,
		lastError: row.lastError,
		// override-uri stocate suprapuse peste default-urile din catalog → hartă completă
		routes: resolveRoutes(row.routes as ClaudeRoutes | null)
	};
});

/* ─────────────────────────── (b) SAVE KEY ─────────────────────── */

const SaveKeySchema = v.object({
	apiKey: v.pipe(v.string(), v.trim(), v.nonEmpty('Introdu o cheie Claude (sk-ant-…).'))
});

/**
 * Detectează prefixul și scrie cheia în slotul CORECT (api|oat) fără a atinge celălalt.
 * Upsert pe rândul unic/tenant.
 */
export const saveClaudeKey = command(SaveKeySchema, async (data) => {
	const { event, tenantId } = scope();
	const actor = await getActor(event);
	assertCan(actor, 'admin.claude.manage');

	const rawKey = data.apiKey;
	if (!isValidClaudeKey(rawKey)) {
		throw new Error('Cheia trebuie să înceapă cu sk-ant- și să fie validă.');
	}

	const type: ClaudeRouteKeyType = detectKeyType(rawKey); // 'oat' dacă sk-ant-oat, altfel 'api'
	const enc = encryptVerified(tenantId, rawKey);
	const hint = keyHint(rawKey);

	const [existing] = await db.select(SLOT_COLS).from(table.claudeIntegration).where(eq(table.claudeIntegration.tenantId, tenantId)).limit(1);

	const desired: SlotsByType = existing ? slotsByType(existing) : {};
	desired[type] = { enc, hint }; // scrie/înlocuiește slotul acestui tip; celălalt rămâne

	await writeSlots(tenantId, desired, !!existing);

	logInfo('plugin', 'Claude key saved', {
		tenantId,
		userId: event.locals.user!.id,
		metadata: { slot: type }
	});
	return { ok: true as const, slot: type };
});

/* ─────────────────────────── (c) DELETE ONE SLOT ─────────────── */

const DeleteKeySchema = v.object({ keyType: v.picklist(KEY_TYPES) });

/**
 * Șterge cheia unui tip. Dacă rămâne cealaltă cheie → o compactăm în slotul primar.
 * Dacă era ultima → ștergem rândul (înapoi la neconfigurat; rutele se pierd, e ok).
 * Rutele care rămân pointând pe un slot gol sunt gestionate de fallback-ul resolver-ului.
 */
export const deleteClaudeKey = command(DeleteKeySchema, async (data) => {
	const { event, tenantId } = scope();
	const actor = await getActor(event);
	assertCan(actor, 'admin.claude.manage');

	const [existing] = await db.select(SLOT_COLS).from(table.claudeIntegration).where(eq(table.claudeIntegration.tenantId, tenantId)).limit(1);
	if (!existing) return { ok: true as const }; // idempotent

	const desired: SlotsByType = slotsByType(existing);
	delete desired[data.keyType];

	if (!desired.api && !desired.oat) {
		await db.delete(table.claudeIntegration).where(eq(table.claudeIntegration.tenantId, tenantId));
	} else {
		await writeSlots(tenantId, desired, true);
	}

	logInfo('plugin', 'Claude key slot cleared', {
		tenantId,
		userId: event.locals.user!.id,
		metadata: { slot: data.keyType }
	});
	return { ok: true as const };
});

/* ─────────────────────────── (d) SET ROUTE ───────────────────── */

const RouteSchema = v.object({
	useCaseId: v.picklist(CLAUDE_USE_CASE_IDS as [ClaudeUseCaseId, ...ClaudeUseCaseId[]]),
	keyType: v.picklist(KEY_TYPES),
	model: v.picklist(CLAUDE_MODEL_IDS as [string, ...string[]])
});

/**
 * Rutează un use-case către un slot + model. Validează use-case∈catalog, keyType∈{api,oat},
 * model∈CLAUDE_MODELS (picklist) ȘI că slotul ales chiar are o cheie. Persistă în jsonb routes.
 */
export const setClaudeRoute = command(RouteSchema, async (data) => {
	const { event, tenantId } = scope();
	const actor = await getActor(event);
	assertCan(actor, 'admin.claude.manage');

	const [row] = await db
		.select({ ...SLOT_COLS, routes: table.claudeIntegration.routes })
		.from(table.claudeIntegration)
		.where(eq(table.claudeIntegration.tenantId, tenantId))
		.limit(1);

	if (!row) throw new Error('Configurează întâi o cheie Claude înainte de a seta rutarea.');

	const slots = slotsByType(row);
	if (!slots[data.keyType]) {
		throw new Error(
			data.keyType === 'oat'
				? 'Nu există un token OAuth (Abonament) — adaugă-l înainte de a ruta pe Abonament.'
				: 'Nu există o cheie API — adaug-o înainte de a ruta pe API.'
		);
	}

	const routes: ClaudeRoutes = { ...((row.routes as ClaudeRoutes | null) ?? {}) };
	routes[data.useCaseId] = { keyType: data.keyType, model: data.model };

	await db
		.update(table.claudeIntegration)
		.set({ routes, updatedAt: new Date() })
		.where(eq(table.claudeIntegration.tenantId, tenantId));

	logInfo('plugin', 'Claude route set', {
		tenantId,
		userId: event.locals.user!.id,
		metadata: { useCaseId: data.useCaseId, keyType: data.keyType, model: data.model }
	});
	return { ok: true as const, useCaseId: data.useCaseId, keyType: data.keyType, model: data.model };
});

/* ─────────────────────────── (e) TEST ONE SLOT ───────────────── */

const TestSchema = v.object({ keyType: v.picklist(KEY_TYPES) });

/** Testează un slot anume la Anthropic. Actualizează lastTestedAt/lastError. */
export const testClaudeConnection = command(TestSchema, async (data) => {
	const { event, tenantId } = scope();
	const actor = await getActor(event);
	assertCan(actor, 'admin.claude.manage');

	try {
		const client = await getClaudeClient(tenantId, data.keyType);
		if (!client) {
			throw new Error(
				data.keyType === 'oat'
					? 'Niciun token OAuth (Abonament) configurat sau plugin dezactivat.'
					: 'Nicio cheie API configurată sau plugin dezactivat.'
			);
		}
		const result = await client.testConnection();
		await db
			.update(table.claudeIntegration)
			.set({ lastTestedAt: new Date(), lastError: null, updatedAt: new Date() })
			.where(eq(table.claudeIntegration.tenantId, tenantId));
		return { ok: true as const, slot: data.keyType, via: result.via, models: result.models };
	} catch (e) {
		const { message } = serializeError(e);
		await db
			.update(table.claudeIntegration)
			.set({ lastError: message, lastTestedAt: new Date(), updatedAt: new Date() })
			.where(eq(table.claudeIntegration.tenantId, tenantId));
		logWarning('plugin', 'Claude test connection failed', {
			tenantId,
			userId: event.locals.user!.id,
			metadata: { slot: data.keyType }
		});
		throw new Error(message);
	}
});
