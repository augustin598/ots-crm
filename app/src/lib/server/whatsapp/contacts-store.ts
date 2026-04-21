import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { and, eq } from 'drizzle-orm';
import type { Contact, Chat } from 'baileys';
import { isPnUser } from 'baileys';
import { encodeBase32LowerCase } from '@oslojs/encoding';
import { jidToE164 } from './phone';

function generateId(): string {
	return encodeBase32LowerCase(crypto.getRandomValues(new Uint8Array(15)));
}

export async function upsertPushNames(tenantId: string, contacts: Array<Partial<Contact>>): Promise<void> {
	let stored = 0;
	let skipped = 0;
	for (const c of contacts) {
		if (!c.id || !isPnUser(c.id)) {
			skipped++;
			continue;
		}
		const name = (c.notify || c.name || c.verifiedName || '').trim();
		if (!name) {
			skipped++;
			continue;
		}

		const phoneE164 = jidToE164(c.id);

		const [existing] = await db
			.select({ id: table.whatsappContact.id })
			.from(table.whatsappContact)
			.where(
				and(
					eq(table.whatsappContact.tenantId, tenantId),
					eq(table.whatsappContact.phoneE164, phoneE164)
				)
			)
			.limit(1);

		if (existing) {
			await db
				.update(table.whatsappContact)
				.set({ pushName: name, updatedAt: new Date() })
				.where(eq(table.whatsappContact.id, existing.id));
		} else {
			await db
				.insert(table.whatsappContact)
				.values({
					id: generateId(),
					tenantId,
					phoneE164,
					pushName: name,
					createdAt: new Date(),
					updatedAt: new Date()
				})
				.onConflictDoNothing();
		}
		stored++;
	}
	console.log(
		`[WHATSAPP] upsertPushNames tenant=${tenantId} stored=${stored} skipped=${skipped} total=${contacts.length}`
	);
}

export async function upsertChatNames(tenantId: string, chats: Array<Partial<Chat>>): Promise<void> {
	let stored = 0;
	for (const c of chats) {
		if (!c.id || !isPnUser(c.id)) continue;
		const name = (c.name || '').trim();
		if (!name) continue;
		const phoneE164 = jidToE164(c.id);

		const [existing] = await db
			.select({ id: table.whatsappContact.id, pushName: table.whatsappContact.pushName })
			.from(table.whatsappContact)
			.where(
				and(
					eq(table.whatsappContact.tenantId, tenantId),
					eq(table.whatsappContact.phoneE164, phoneE164)
				)
			)
			.limit(1);

		if (existing) {
			if (existing.pushName !== name) {
				await db
					.update(table.whatsappContact)
					.set({ pushName: name, updatedAt: new Date() })
					.where(eq(table.whatsappContact.id, existing.id));
				stored++;
			}
		} else {
			await db.insert(table.whatsappContact).values({
				id: generateId(),
				tenantId,
				phoneE164,
				pushName: name,
				createdAt: new Date(),
				updatedAt: new Date()
			}).onConflictDoNothing();
			stored++;
		}
	}
	if (stored > 0) console.log(`[WHATSAPP] upsertChatNames tenant=${tenantId} stored=${stored}`);
}

export async function setDisplayName(
	tenantId: string,
	phoneE164: string,
	displayName: string | null
): Promise<void> {
	const [existing] = await db
		.select({ id: table.whatsappContact.id })
		.from(table.whatsappContact)
		.where(
			and(eq(table.whatsappContact.tenantId, tenantId), eq(table.whatsappContact.phoneE164, phoneE164))
		)
		.limit(1);

	if (existing) {
		await db
			.update(table.whatsappContact)
			.set({ displayName, updatedAt: new Date() })
			.where(eq(table.whatsappContact.id, existing.id));
	} else {
		await db.insert(table.whatsappContact).values({
			id: generateId(),
			tenantId,
			phoneE164,
			displayName,
			createdAt: new Date(),
			updatedAt: new Date()
		});
	}
}
