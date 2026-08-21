/**
 * Textele trimise în grupul WhatsApp al unui task. Pure, fără DB.
 *
 * WhatsApp nu randează Markdown ca Telegram: doar `*bold*` și `_italic_`.
 * Asteriscurile din titluri se scot, ca să nu rupă bold-ul; liniuța lungă se
 * înlocuiește cu virgulă (regula casei pentru textele în română).
 */
import { e164ToJid } from './phone';

const STATUS_RO: Record<string, { label: string; emoji: string }> = {
	todo: { label: 'De făcut', emoji: '📋' },
	'in-progress': { label: 'În lucru', emoji: '🔧' },
	review: { label: 'În verificare', emoji: '🔎' },
	done: { label: 'Finalizat', emoji: '✅' },
	blocked: { label: 'Blocat', emoji: '⛔' },
	cancelled: { label: 'Anulat', emoji: '🚫' }
};

/** `pending-approval` e pas intern de aprobare; nu se anunță în grup. */
export function notifiesGroup(status: string): boolean {
	return status in STATUS_RO;
}

export function statusLabelRo(status: string): string {
	return STATUS_RO[status]?.label ?? status;
}

function cleanInline(text: string): string {
	return text
		.replace(/[*_~`]/g, '')
		.replace(/\s*[—–]\s*/g, ', ')
		.replace(/\s+/g, ' ')
		.trim();
}

export function buildStatusMessage(input: {
	taskTitle: string;
	actorName: string;
	oldStatus: string;
	newStatus: string;
	taskUrl: string;
}): string {
	const emoji = STATUS_RO[input.newStatus]?.emoji ?? '🔔';
	return (
		`${emoji} *${cleanInline(input.taskTitle)}*\n` +
		`${cleanInline(input.actorName)} a trecut task-ul în *${statusLabelRo(input.newStatus)}* ` +
		`(din ${statusLabelRo(input.oldStatus)}).\n` +
		input.taskUrl
	);
}

function formatDateRo(d: Date): string {
	return d.toLocaleDateString('ro-RO', {
		day: 'numeric',
		month: 'short',
		year: 'numeric',
		timeZone: 'Europe/Bucharest'
	});
}

/** Prezentarea task-ului când e legat de grup: grupul află de el de atunci. */
export function buildLinkedTaskMessage(input: {
	taskTitle: string;
	actorName: string;
	status: string;
	assigneeName: string | null;
	dueDate: Date | null;
	taskUrl: string;
}): string {
	const details = [
		input.assigneeName ? `Responsabil: ${cleanInline(input.assigneeName)}` : null,
		input.dueDate ? `Termen: ${formatDateRo(input.dueDate)}` : null
	].filter(Boolean);
	return (
		`📌 *${cleanInline(input.taskTitle)}*\n` +
		`Task nou în grup, adăugat de ${cleanInline(input.actorName)}. Status: ${statusLabelRo(input.status)}.\n` +
		(details.length > 0 ? `${details.join(' · ')}\n` : '') +
		input.taskUrl
	);
}

const SNIPPET_MAX = 160;

function htmlToSnippet(html: string): string {
	const text = html
		.replace(/<br\s*\/?>/gi, ' ')
		.replace(/<\/(p|div|li|h\d)>/gi, ' ')
		.replace(/<[^>]*>/g, '')
		.replace(/&nbsp;/g, ' ')
		.replace(/&amp;/g, '&')
		.replace(/&lt;/g, '<')
		.replace(/&gt;/g, '>')
		.replace(/&quot;/g, '"')
		.replace(/&#39;/g, "'");
	const clean = cleanInline(text);
	return clean.length > SNIPPET_MAX ? `${clean.slice(0, SNIPPET_MAX)}…` : clean;
}

/**
 * O mențiune reală de WhatsApp cere DOUĂ lucruri: JID-ul în `mentions` și, în
 * text, ancora „@<cifrele numărului>". Cu „@Ana Pop" în text, `mentionedJid`
 * rămâne metadată fără ancoră: pastila nu se randează și nimeni nu e notificat
 * (verificat în Baileys, Utils/messages.js). Clientul WhatsApp înlocuiește
 * singur numărul cu numele din agendă la afișare.
 */
export function buildMentionMessage(input: {
	taskTitle: string;
	authorName: string;
	/** Toți cei menționați în același comentariu, într-un singur mesaj. */
	mentioned: Array<{ name: string; phoneE164: string | null }>;
	commentHtml: string;
	taskUrl: string;
}): { text: string; mentions: string[] } {
	const mentions: string[] = [];
	const parts = input.mentioned.map((m) => {
		if (!m.phoneE164) return cleanInline(m.name);
		mentions.push(e164ToJid(m.phoneE164));
		return `@${m.phoneE164.replace(/[^\d]/g, '')}`;
	});

	const who =
		parts.length <= 1
			? (parts[0] ?? '')
			: `${parts.slice(0, -1).join(', ')} și ${parts[parts.length - 1]}`;

	const snippet = htmlToSnippet(input.commentHtml);
	const text =
		`💬 *${cleanInline(input.taskTitle)}*\n` +
		`Mențiune de la ${cleanInline(input.authorName)} pentru ${who}:\n` +
		(snippet ? `„${snippet}"\n` : '') +
		input.taskUrl;
	return { text, mentions };
}
