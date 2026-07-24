import { query, command, getRequestEvent } from '$app/server';
import * as v from 'valibot';
import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { eq } from 'drizzle-orm';
import { encodeBase32LowerCase } from '@oslojs/encoding';
import { requireStaff } from '$lib/server/get-actor';
import { encryptVerified } from '$lib/server/plugins/claude/crypto';
import { detectKeyType, keyHint, isValidClaudeKey } from '$lib/server/plugins/claude/key-utils';
import { getClaudeClient } from '$lib/server/plugins/claude';
import { isKnownClaudeModel } from '$lib/claude-models';
import { logInfo, logWarning, serializeError } from '$lib/server/logger';

function scope() {
	const event = getRequestEvent();
	if (!event?.locals.user || !event?.locals.tenant) throw new Error('Unauthorized');
	return { event, tenantId: event.locals.tenant.id };
}

function generateId(): string {
	return encodeBase32LowerCase(crypto.getRandomValues(new Uint8Array(15)));
}

/** Status integrare pentru tenantul curent. NU întoarce niciodată cheia. */
export const getClaudeIntegration = query(async () => {
	const { event, tenantId } = scope();
	await requireStaff(event);

	const [row] = await db
		.select({
			keyType: table.claudeIntegration.keyType,
			keyHint: table.claudeIntegration.keyHint,
			defaultModel: table.claudeIntegration.defaultModel,
			isActive: table.claudeIntegration.isActive,
			lastTestedAt: table.claudeIntegration.lastTestedAt,
			lastError: table.claudeIntegration.lastError
		})
		.from(table.claudeIntegration)
		.where(eq(table.claudeIntegration.tenantId, tenantId))
		.limit(1);

	if (!row) return null;
	return { connected: true, ...row };
});

const SaveSchema = v.object({
	// gol = păstrează cheia existentă (edit doar model); altfel trebuie sk-ant-…
	apiKey: v.optional(v.string(), ''),
	defaultModel: v.string()
});

export const saveClaudeIntegration = command(SaveSchema, async (data) => {
	const { event, tenantId } = scope();
	await requireStaff(event);

	const model = data.defaultModel;
	if (!isKnownClaudeModel(model)) throw new Error('Model Claude necunoscut.');

	const rawKey = (data.apiKey ?? '').trim();
	const [existing] = await db
		.select({ id: table.claudeIntegration.id })
		.from(table.claudeIntegration)
		.where(eq(table.claudeIntegration.tenantId, tenantId))
		.limit(1);

	// Edit fără cheie nouă → actualizează doar modelul.
	if (!rawKey) {
		if (!existing) throw new Error('Introdu o cheie Claude (sk-ant-…).');
		await db
			.update(table.claudeIntegration)
			.set({ defaultModel: model, updatedAt: new Date() })
			.where(eq(table.claudeIntegration.tenantId, tenantId));
		return { connected: true };
	}

	if (!isValidClaudeKey(rawKey)) {
		throw new Error('Cheia trebuie să înceapă cu sk-ant- și să fie validă.');
	}

	const keyType = detectKeyType(rawKey);
	const hint = keyHint(rawKey);
	const apiKeyEncrypted = encryptVerified(tenantId, rawKey);

	if (existing) {
		await db
			.update(table.claudeIntegration)
			.set({
				apiKeyEncrypted,
				keyType,
				keyHint: hint,
				defaultModel: model,
				isActive: true,
				lastError: null,
				updatedAt: new Date()
			})
			.where(eq(table.claudeIntegration.tenantId, tenantId));
	} else {
		await db.insert(table.claudeIntegration).values({
			id: generateId(),
			tenantId,
			apiKeyEncrypted,
			keyType,
			keyHint: hint,
			defaultModel: model,
			isActive: true
		});
	}

	logInfo('plugin', 'Claude integration saved', { tenantId, userId: event.locals.user!.id });
	return { connected: true };
});

export const testClaudeConnection = command(async () => {
	const { event, tenantId } = scope();
	await requireStaff(event);

	try {
		const client = await getClaudeClient(tenantId);
		if (!client) {
			throw new Error('Nicio cheie Claude configurată sau plugin dezactivat.');
		}
		const result = await client.testConnection();
		await db
			.update(table.claudeIntegration)
			.set({ lastTestedAt: new Date(), lastError: null, updatedAt: new Date() })
			.where(eq(table.claudeIntegration.tenantId, tenantId));
		return { ok: true as const, via: result.via, models: result.models };
	} catch (e) {
		const { message } = serializeError(e);
		await db
			.update(table.claudeIntegration)
			.set({ lastError: message, lastTestedAt: new Date(), updatedAt: new Date() })
			.where(eq(table.claudeIntegration.tenantId, tenantId));
		logWarning('plugin', 'Claude test connection failed', {
			tenantId,
			userId: event.locals.user!.id
		});
		throw new Error(message);
	}
});

export const deleteClaudeIntegration = command(async () => {
	const { event, tenantId } = scope();
	await requireStaff(event);

	await db.delete(table.claudeIntegration).where(eq(table.claudeIntegration.tenantId, tenantId));
	logInfo('plugin', 'Claude integration deleted', { tenantId, userId: event.locals.user!.id });
	return { connected: false };
});
