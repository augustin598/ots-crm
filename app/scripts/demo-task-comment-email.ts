/**
 * Demo standalone al blocului „comentariu nou" din emailurile de task —
 * citatul comentariului + imaginile atașate, inserate inline.
 *
 * În producție imaginile merg ca atașamente `cid:` (vezi buildCommentEmailBlock
 * din src/lib/server/email.ts). Aici sunt data: URI ca să se vadă în browser;
 * markup-ul <img> e identic.
 *
 * Randează cele două variante afectate:
 *   1. sendTaskUpdateEmail        → watcher/assignee/mention (agenție + clientUser)
 *   2. sendTaskClientNotificationEmail → emailul companiei-client
 *
 * Run:
 *   bun --bun scripts/demo-task-comment-email.ts > /tmp/task-comment-demo.html && open /tmp/task-comment-demo.html
 */

function escapeHtml(s: string): string {
	return s
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;');
}

const tenantName = 'OneTop Solutions';
const themeColor = '#1877F2';
const tenantSlug = 'ots';
const taskId = 'demo-task-id-7s8h2k';
const taskTitle = 'Plan articole și optimizări site (Heylux, Forum, Forumvideochat)';
const taskDescription = 'Coordonare conținut și optimizări on-page pentru cele trei proprietăți.';
const taskUrl = `http://localhost:5173/${tenantSlug}/tasks/${taskId}`;

const commentText =
	'Ti-am acordat acces, esti editor acum - https://docs.google.com/document/d/1JRutZ02xktBm3yYvLwH6rRjM6iFbFSTa2mEpT1s0YSw/edit?tab=t.0\n\nPagina recenzii — Lucky: https://www.luckystudio.ro/pareri-si-recenzii-despre-lucky-studio/\n\nDacă doriți să mai adăugăm recenzii, vă rog să mi le trimiteți pe email sau vă generez unele cu cum doriți.';

/** Două „poze" placeholder (SVG → data URI) pe post de atașamente de comentariu. */
function placeholder(label: string, bg: string): string {
	const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="520" height="300"><rect width="520" height="300" fill="${bg}"/><rect x="24" y="24" width="472" height="30" fill="#ffffff" opacity=".85"/><rect x="24" y="72" width="330" height="14" fill="#ffffff" opacity=".6"/><rect x="24" y="98" width="280" height="14" fill="#ffffff" opacity=".6"/><text x="24" y="270" font-family="Inter, system-ui, sans-serif" font-size="20" fill="#ffffff">${label}</text></svg>`;
	return `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
}

const images = [
	{ src: placeholder('recenzii-lucky.png', '#334155'), name: 'recenzii-lucky.png' },
	{ src: placeholder('pagina-contact.png', '#0f766e'), name: 'pagina-contact.png' }
];
const skipped = 1;

function renderCtaButton(url: string, label: string, color: string): string {
	return `
		<table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin: 16px 0 24px 0;">
			<tr>
				<td>
					<a href="${url}" style="display: inline-block; padding: 12px 22px; background: ${color}; color: white; text-decoration: none; border-radius: 9px; font-weight: 700; font-size: 14px; font-family: 'Inter', system-ui, sans-serif;">${label}</a>
				</td>
			</tr>
		</table>
	`;
}

/** Oglindește exact `buildCommentEmailBlock` din src/lib/server/email.ts. */
function commentBlockHtml(): string {
	const quoteHtml = `<table role="presentation" cellpadding="0" cellspacing="0" style="width: 100%; table-layout: fixed; margin: 0 0 16px 0;">
			<tr>
				<td style="padding: 12px 16px; background-color: #f9fafb; border-left: 3px solid ${themeColor}; border-radius: 0 8px 8px 0; color: #374151; font-size: 14px; line-height: 1.65;">
					${escapeHtml(commentText).replace(/\n/g, '<br />')}
				</td>
			</tr>
		</table>`;

	const imagesHtml = `<div style="margin: 0 0 16px 0;">
			${images
				.map(
					(a) =>
						`<img src="${a.src}" alt="${escapeHtml(a.name)}" style="display: block; width: 100%; max-width: 520px; height: auto; border-radius: 8px; margin: 0 0 10px 0;" />`
				)
				.join('')}
			<p style="color: #6b7280; font-size: 12px; margin: 0;">Încă ${skipped} ${skipped === 1 ? 'imagine este disponibilă' : 'imagini sunt disponibile'} în task.</p>
		</div>`;

	return `${quoteHtml}${imagesHtml}`;
}

function badge(bg: string, fg: string, label: string): string {
	return `<span style="display:inline-block; padding:3px 12px; border-radius:9999px; font-size:13px; font-weight:600; background:${bg}; color:${fg};">${label}</span>`;
}

const detailsTable = `<table role="presentation" cellpadding="0" cellspacing="0" style="width: 100%; table-layout: fixed; background-color: #f9fafb; border-radius: 8px; margin: 0 0 20px 0;">
		<tr>
			<td style="padding: 16px 18px; color: #374151; font-size: 14px; line-height: 1.7;">
				<div style="font-weight: 600; color: #111827; font-size: 15px; margin-bottom: 8px;">${escapeHtml(taskTitle)}</div>
				<div style="color: #6b7280; font-size: 13px; margin-bottom: 12px;">${escapeHtml(taskDescription)}</div>
				<div><span style="color: #6b7280;">Prioritate</span> &nbsp;·&nbsp; ${badge('#dbeafe', '#1e40af', 'Medie')}</div>
				<div style="margin-top: 6px;"><span style="color: #6b7280;">Status</span> &nbsp;·&nbsp; ${badge('#dbeafe', '#1e40af', 'În lucru')}</div>
			</td>
		</tr>
	</table>`;

/** sendTaskUpdateEmail — blocul vine DUPĂ tabelul de detalii. */
function renderUpdateEmail(changeDescription: string): string {
	return `
		<p style="color: #111827; font-size: 15px; line-height: 1.6; margin: 0 0 12px 0;">Bună ziua Augustin,</p>
		<p style="color: #111827; font-size: 15px; line-height: 1.6; margin: 0 0 20px 0;">Un task pe care îl urmăriți a fost actualizat — <em>${changeDescription}</em>.</p>
		${detailsTable}
		${commentBlockHtml()}
		${renderCtaButton(taskUrl, 'Vezi task-ul', themeColor)}
	`;
}

/** sendTaskClientNotificationEmail — blocul vine ÎNAINTEA tabelului de detalii. */
function renderClientEmail(): string {
	return `
		<p style="color: #111827; font-size: 15px; line-height: 1.6; margin: 0 0 12px 0;">Bună Lucian,</p>
		<p style="color: #111827; font-size: 15px; line-height: 1.6; margin: 0 0 12px 0;">Un comentariu nou a fost adăugat pe task:</p>
		${commentBlockHtml()}
		${detailsTable}
		${renderCtaButton(taskUrl, 'Vezi task-ul', themeColor)}
	`;
}

function card(title: string, pill: string, pillColor: string, bodyHtml: string): string {
	return `
	<div class="email-card">
		<div class="email-header" style="display:flex; justify-content:space-between; align-items:center;">
			<h1>${title}</h1>
			<span style="background:${pillColor}; color:white; padding:3px 10px; border-radius:9999px; font-size:11px; font-weight:700; text-transform:uppercase;">${pill}</span>
		</div>
		<div class="email-body">${bodyHtml}</div>
		<div class="email-foot">Trimis automat de ${tenantName}.</div>
	</div>`;
}

const html = `<!doctype html>
<html lang="ro">
<head>
	<meta charset="utf-8" />
	<title>Demo: comentariu cu poze în emailurile de task</title>
	<style>
		body { margin: 0; padding: 24px; background: #f4f6fa; font-family: 'Inter', system-ui, sans-serif; }
		h2 { font-size: 13px; text-transform: uppercase; letter-spacing: 0.04em; color: #64748b; max-width: 600px; margin: 24px auto 8px auto; }
		.email-card { max-width: 600px; margin: 0 auto; background: white; word-break: break-word; overflow-wrap: break-word; border-radius: 14px; overflow: hidden; box-shadow: 0 4px 12px rgba(15,23,42,.06); }
		.email-header { background: ${themeColor}; padding: 18px 24px; color: white; }
		.email-header h1 { margin: 0; font-size: 16px; font-weight: 800; letter-spacing: -.02em; }
		.email-body { padding: 24px; }
		.email-foot { padding: 14px 24px; border-top: 1px solid #e5e9f0; font-size: 11.5px; color: #94a3b8; text-align: center; }
	</style>
</head>
<body>
	<h2>1. sendTaskUpdateEmail · changeType = "comment"</h2>
	${card('Task actualizat', 'comment', '#1877F2', renderUpdateEmail('a fost adăugat un comentariu nou'))}

	<h2>2. sendTaskUpdateEmail · changeType = "mention"</h2>
	${card('Task actualizat', 'mention', '#7c3aed', renderUpdateEmail('ați fost menționat într-un comentariu'))}

	<h2>3. sendTaskClientNotificationEmail · notificationType = "comment"</h2>
	${card('Comentariu nou pe task', 'client', '#10b981', renderClientEmail())}
</body>
</html>`;

console.log(html);
