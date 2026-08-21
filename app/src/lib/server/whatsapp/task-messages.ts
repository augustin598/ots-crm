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

export function buildMentionMessage(input: {
	taskTitle: string;
	authorName: string;
	mentioned: { name: string; phoneE164: string | null };
	commentHtml: string;
	taskUrl: string;
}): { text: string; mentions: string[] } {
	const name = cleanInline(input.mentioned.name);
	const mentions = input.mentioned.phoneE164 ? [e164ToJid(input.mentioned.phoneE164)] : [];
	const who = mentions.length > 0 ? `@${name}` : name;
	const snippet = htmlToSnippet(input.commentHtml);
	const text =
		`💬 *${cleanInline(input.taskTitle)}*\n` +
		`Mențiune de la ${cleanInline(input.authorName)} pentru ${who}:\n` +
		(snippet ? `„${snippet}"\n` : '') +
		input.taskUrl;
	return { text, mentions };
}
