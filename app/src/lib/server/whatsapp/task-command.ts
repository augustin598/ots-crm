/**
 * Comanda „/task …" scrisă într-un grup WhatsApp devine task în CRM, cu
 * statusul `pending-approval`. Aprobarea rămâne la om, în CRM.
 *
 * Apărările, în ordinea în care se aplică:
 *  1. grupul trebuie să fie bifat (deja verificat de `handleInbound`) și legat
 *     de un client — altfel taskul n-ar avea pe seama cui să existe;
 *  2. expeditorul trebuie identificat printr-un număr cunoscut
 *     (`user_whatsapp_link`, fără `self_service`) și să fie fie din echipă,
 *     fie utilizator al clientului grupului;
 *  3. limite de rată pe expeditor, pe grup și pe tenant, fiindcă pe calea de
 *     primire nu exista niciuna;
 *  4. idempotență pe `wam_id`: Baileys poate livra același mesaj de două ori.
 *
 * Un mesaj respins nu primește răspuns în grup: un răspuns automat la fiecare
 * mesaj refuzat e chiar amplificatorul de spam și consumă din plafonul orar.
 */
import { and, eq } from 'drizzle-orm';
import { encodeBase32LowerCase } from '@oslojs/encoding';
import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { logInfo, logWarning } from '$lib/server/logger';
import { checkFixedWindowLimit } from '$lib/server/rate-limiter';
import { getStoredGroup } from './group-store';
import { resolveUserByWhatsappPhone } from './resolve-phone';
import { parseTaskCommand } from './task-command-parser';
import { buildTaskCommandAck } from './task-messages';
import { enqueueGroupMessage } from './outbox';

const HOUR_MS = 3_600_000;
const PER_SENDER_PER_HOUR = 5;
const PER_GROUP_PER_HOUR = 10;
const PER_TENANT_PER_DAY = 60;

function generateId(): string {
	return encodeBase32LowerCase(crypto.getRandomValues(new Uint8Array(15)));
}

export type TaskCommandInput = {
	tenantId: string;
	groupJid: string;
	senderPhoneE164: string | null;
	wamId: string;
	body: string | null;
};

export type TaskCommandOutcome =
	| { handled: false; reason: 'not-a-command' | 'no-sender' | 'unknown-sender' | 'no-client' | 'not-allowed' | 'rate-limited' | 'duplicate' }
	| { handled: true; taskId: string };

export async function handleTaskCommand(input: TaskCommandInput): Promise<TaskCommandOutcome> {
	const parsed = parseTaskCommand(input.body);
	if (!parsed) return { handled: false, reason: 'not-a-command' };

	if (!input.senderPhoneE164) {
		logWarning('whatsapp', 'comandă /task de la un expeditor fără număr rezolvat', {
			tenantId: input.tenantId,
			metadata: { groupJid: input.groupJid }
		});
		return { handled: false, reason: 'no-sender' };
	}

	const group = await getStoredGroup(input.tenantId, input.groupJid);
	if (!group || !group.watched) return { handled: false, reason: 'no-client' };
	if (!group.clientId) {
		logWarning('whatsapp', 'comandă /task într-un grup fără client legat', {
			tenantId: input.tenantId,
			metadata: { groupJid: input.groupJid }
		});
		return { handled: false, reason: 'no-client' };
	}

	const sender = await resolveUserByWhatsappPhone(input.tenantId, input.senderPhoneE164);
	if (!sender) return { handled: false, reason: 'unknown-sender' };

	// Un grup poate ține oameni de la mai mulți clienți: apartenența la grup nu
	// dovedește că expeditorul e al clientului grupului.
	if (!sender.isStaff && !sender.clientIds.includes(group.clientId)) {
		return { handled: false, reason: 'not-allowed' };
	}

	const limits: Array<[string, number, number]> = [
		[`wa-task:sender:${input.tenantId}:${input.senderPhoneE164}`, PER_SENDER_PER_HOUR, HOUR_MS],
		[`wa-task:group:${input.tenantId}:${input.groupJid}`, PER_GROUP_PER_HOUR, HOUR_MS],
		[`wa-task:tenant:${input.tenantId}`, PER_TENANT_PER_DAY, 24 * HOUR_MS]
	];
	for (const [key, max, windowMs] of limits) {
		if (checkFixedWindowLimit(key, { max, windowMs })) {
			logWarning('whatsapp', `limită de taskuri prin WhatsApp atinsă (${key})`, {
				tenantId: input.tenantId,
				metadata: { groupJid: input.groupJid }
			});
			return { handled: false, reason: 'rate-limited' };
		}
	}

	const taskId = generateId();
	const now = new Date();

	try {
		await db.insert(table.task).values({
			id: taskId,
			tenantId: input.tenantId,
			clientId: group.clientId,
			title: parsed.title,
			description: parsed.description,
			status: 'pending-approval',
			priority: 'medium',
			createdByUserId: sender.userId,
			whatsappGroupId: group.id,
			sourceWamId: input.wamId,
			createdAt: now,
			updatedAt: now
		});
	} catch (err) {
		// Indexul unic (tenant, source_wam_id) e apărarea împotriva livrării
		// duble a aceluiași mesaj de către Baileys.
		const message = err instanceof Error ? err.message : String(err);
		if (/UNIQUE|constraint/i.test(message)) return { handled: false, reason: 'duplicate' };
		throw err;
	}

	await db.insert(table.taskActivity).values({
		id: generateId(),
		taskId,
		tenantId: input.tenantId,
		userId: sender.userId,
		action: 'created',
		createdAt: now
	});

	logInfo('whatsapp', `task creat din grup: „${parsed.title}"`, {
		tenantId: input.tenantId,
		userId: sender.userId,
		metadata: { taskId, groupJid: input.groupJid, wamId: input.wamId }
	});

	await enqueueGroupMessage({
		tenantId: input.tenantId,
		groupJid: input.groupJid,
		kind: 'task.command-ack',
		taskId,
		body: buildTaskCommandAck({ taskTitle: parsed.title, authorName: sender.name })
	});

	return { handled: true, taskId };
}
