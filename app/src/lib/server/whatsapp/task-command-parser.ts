/**
 * Parsarea comenzii „/task …" scrisă într-un grup WhatsApp. Pur, fără DB.
 *
 * Un mesaj devine comandă doar dacă începe chiar cu „/task" urmat de spațiu
 * sau capăt de rând: „/taskuri de mâine" e vorbire obișnuită, nu comandă.
 */

const TITLE_MAX = 120;

/** Spații pe care le trimit tastaturile mobile și care nu sunt " " simplu. */
function normalizeSpaces(text: string): string {
	return text.replace(/[    - ]/g, ' ');
}

export type ParsedTaskCommand = {
	title: string;
	description: string | null;
};

export function parseTaskCommand(body: string | null | undefined): ParsedTaskCommand | null {
	if (!body) return null;
	const text = normalizeSpaces(body).trimStart();
	const match = /^\/task(?=$|\s)/i.exec(text);
	if (!match) return null;

	const rest = text.slice(match[0].length).trim();
	if (!rest) return null;

	const [firstLine, ...restLines] = rest.split('\n');
	let title = firstLine.trim();
	const extra = restLines.join('\n').trim();

	// Un titlu foarte lung nu se aruncă: coada lui deschide descrierea, ca omul
	// să nu piardă ce a scris.
	let overflow = '';
	if (title.length > TITLE_MAX) {
		overflow = title.slice(TITLE_MAX).trim();
		title = title.slice(0, TITLE_MAX).trim();
	}

	const description = [overflow, extra].filter(Boolean).join('\n') || null;
	return { title, description };
}
