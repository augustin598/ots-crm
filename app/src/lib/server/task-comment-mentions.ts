/**
 * Mențiunile dintr-un comentariu de task: cine e menționat și cine află.
 *
 * Există fiindcă erau două căi care scriau conținutul unui comentariu și doar
 * una anunța pe cineva. `createTaskComment` trimitea email, notificare în
 * aplicație, Telegram și mesaj în grupul WhatsApp; `updateTaskComment` nu
 * trimitea nimic, deci un „@Nume" adăugat prin editare murea acolo. Acum
 * ambele trec pe aici.
 *
 * Regula la editare: se anunță doar mențiunile NOI, adică diferența față de
 * conținutul dinainte. Altfel fiecare corectură de virgulă ar fi re-anunțat
 * toată lumea menționată vreodată în comentariul acela.
 */
import { and, eq, inArray, isNotNull, or } from 'drizzle-orm';
import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { createNotification } from '$lib/server/notifications';
import { notifyTaskMention } from '$lib/server/telegram/task-notifications';
import { notifyTaskMentionInGroup } from '$lib/server/whatsapp/task-notifications';
import { logWarning } from '$lib/server/logger';

/**
 * Id-urile menționate în HTML-ul TipTap.
 *
 * TipTap scrie atributele în ordine variabilă, de aceea căutăm în ambele
 * ordini: `data-type` înaintea lui `data-id` și invers.
 */
export function extractMentionIds(html: string): string[] {
	const ids: string[] = [];
	const tagRegex = /<[^>]*data-type="mention"[^>]*>/g;
	let tagMatch;
	while ((tagMatch = tagRegex.exec(html)) !== null) {
		const idMatch = tagMatch[0].match(/data-id="([^"]+)"/);
		if (idMatch?.[1] && !ids.includes(idMatch[1])) {
			ids.push(idMatch[1]);
		}
	}
	const tagRegex2 = /<[^>]*data-id="([^"]+)"[^>]*data-type="mention"[^>]*>/g;
	let tagMatch2;
	while ((tagMatch2 = tagRegex2.exec(html)) !== null) {
		if (tagMatch2[1] && !ids.includes(tagMatch2[1])) {
			ids.push(tagMatch2[1]);
		}
	}
	return ids;
}

/**
 * Cine a apărut la editare: mențiunile din textul nou care nu erau în cel vechi.
 *
 * Ordinea din textul nou se păstrează, ca mesajul în grup să enumere oamenii
 * în ordinea în care apar în comentariu.
 */
export function newMentionIds(previousHtml: string, nextHtml: string): string[] {
	const before = new Set(extractMentionIds(previousHtml));
	return extractMentionIds(nextHtml).filter((id) => !before.has(id));
}

/**
 * Numele celor menționați, doar pentru oamenii din tenantul curent.
 *
 * Filtrul pe apartenență nu e cosmetic: `data-id` vine din HTML-ul trimis de
 * browser, deci un id fabricat ar strecura altfel în grupul WhatsApp numele
 * unui utilizator din alt tenant. Aceeași apărare ca în `task-recipients.ts`.
 */
export async function resolveMentionNames(
	tenantId: string,
	userIds: string[]
): Promise<Map<string, string>> {
	if (userIds.length === 0) return new Map();
	const rows = await db
		.selectDistinct({
			id: table.user.id,
			firstName: table.user.firstName,
			lastName: table.user.lastName,
			email: table.user.email
		})
		.from(table.user)
		.leftJoin(
			table.tenantUser,
			and(eq(table.tenantUser.userId, table.user.id), eq(table.tenantUser.tenantId, tenantId))
		)
		.leftJoin(
			table.clientUser,
			and(eq(table.clientUser.userId, table.user.id), eq(table.clientUser.tenantId, tenantId))
		)
		.where(
			and(
				inArray(table.user.id, userIds),
				or(isNotNull(table.tenantUser.userId), isNotNull(table.clientUser.userId))
			)
		);
	return new Map(
		rows.map((u) => [u.id, `${u.firstName ?? ''} ${u.lastName ?? ''}`.trim() || u.email])
	);
}

export interface MentionNotifyInput {
	tenantId: string;
	tenantSlug: string;
	taskId: string;
	taskTitle: string;
	taskClientId: string | null;
	commentId: string;
	actorUserId: string;
	actorName: string;
	/** HTML-ul comentariului, pentru fragmentul din mesajul de grup. */
	contentHtml: string;
	/** Id-urile de anunțat (la editare: doar cele noi). */
	mentionedUserIds: string[];
}

/**
 * Canalele personale ale unei mențiuni: în aplicație, Telegram, grupul WhatsApp.
 *
 * Emailul NU e aici: la un comentariu nou el pleacă prin `resolveTaskRecipients`
 * către responsabili și urmăritori deopotrivă, iar la editare doar către cei
 * nou menționați. Cele două liste sunt diferite, deci le decide apelantul.
 */
export async function notifyMentionTargets(input: MentionNotifyInput): Promise<void> {
	const targets = input.mentionedUserIds.filter((id) => id !== input.actorUserId);
	if (targets.length === 0) return;

	const names = await resolveMentionNames(input.tenantId, targets);

	for (const userId of targets) {
		await createNotification({
			tenantId: input.tenantId,
			userId,
			clientId: input.taskClientId ?? undefined,
			type: 'comment.mention',
			title: `${input.actorName} te-a menționat`,
			message: `Te-a menționat într-un comentariu la "${input.taskTitle}"`,
			link: `/${input.tenantSlug}/tasks/${input.taskId}`,
			priority: 'high',
			metadata: { taskId: input.taskId, commentId: input.commentId }
		}).catch(() => {});

		void notifyTaskMention({
			tenantId: input.tenantId,
			tenantSlug: input.tenantSlug,
			taskId: input.taskId,
			taskTitle: input.taskTitle,
			mentionedUserId: userId,
			authorUserId: input.actorUserId,
			authorName: input.actorName,
			commentSnippet: input.contentHtml
		}).catch(() => {});
	}

	// WhatsApp: UN singur mesaj în grupul task-ului pentru toți cei menționați.
	// Per persoană ar însemna trei mesaje aproape identice la un comentariu cu
	// trei mențiuni, exact volumul care duce la banarea numărului.
	void notifyTaskMentionInGroup({
		tenantId: input.tenantId,
		tenantSlug: input.tenantSlug,
		taskId: input.taskId,
		taskTitle: input.taskTitle,
		authorUserId: input.actorUserId,
		authorName: input.actorName,
		mentioned: targets
			.filter((id) => names.has(id))
			.map((id) => ({ userId: id, name: names.get(id)! })),
		commentHtml: input.contentHtml
	}).catch((err) => {
		// Fără logul ăsta, o mențiune care nu ajunge în grup n-ar lăsa nicio
		// urmă: nici rând în outbox, nici eroare nicăieri.
		logWarning('whatsapp', `mențiunea nu a intrat în coada grupului: ${(err as Error).message}`, {
			tenantId: input.tenantId,
			metadata: { taskId: input.taskId, commentId: input.commentId }
		});
	});
}
