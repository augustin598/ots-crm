/**
 * Standalone demo of the task assignment email layout, rendered for BOTH
 * agency and client recipients. Verifies the kind-routed `taskUrl` —
 * agency → `/{tenant}/tasks/{id}`, client → `/client/{tenant}/tasks/{id}`.
 *
 * Run:
 *   bun --bun scripts/demo-task-assignment-email.ts > /tmp/task-assign-demo.html && open /tmp/task-assign-demo.html
 */

function escapeHtml(s: string): string {
	return s
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;');
}

const tenantSlug = 'ots';
const tenantName = 'OneTop Solutions';
const themeColor = '#1877F2';
const taskId = 'demo-task-id-7s8h2k';
const taskTitle = 'Pregătește materiale Q3 pentru lansare';
const taskDescription =
	'Coordonează echipa pentru asset-uri de campanie, livrabile finale până vineri.';
const dueDate = '2026-06-12';
const priority = 'high';
const status = 'todo';

const agencyRecipient = {
	name: 'Augustin Constantin',
	url: `http://localhost:5173/${tenantSlug}/tasks/${taskId}`
};
const clientRecipient = {
	name: 'Lucian Stoica',
	url: `http://localhost:5173/client/${tenantSlug}/tasks/${taskId}`
};

function renderCtaButton(url: string, label: string, color: string): string {
	return `
		<table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin: 16px 0 24px 0;">
			<tr>
				<td>
					<a href="${url}"
						style="display: inline-block; padding: 12px 22px; background: ${color}; color: white; text-decoration: none; border-radius: 9px; font-weight: 700; font-size: 14px; font-family: 'Inter', system-ui, sans-serif;">
						${label}
					</a>
				</td>
			</tr>
		</table>
	`;
}

function statusBadge(s: string): string {
	const map: Record<string, [string, string]> = {
		todo: ['#fef3c7', '#92400e'],
		'in-progress': ['#dbeafe', '#1e40af'],
		review: ['#ede9fe', '#5b21b6'],
		done: ['#d1fae5', '#065f46']
	};
	const [bg, fg] = map[s] ?? ['#f1f5f9', '#475569'];
	return `<span style="display:inline-block; padding:3px 12px; border-radius:9999px; font-size:13px; font-weight:600; background:${bg}; color:${fg};">${s}</span>`;
}

function priorityBadge(p: string): string {
	const map: Record<string, [string, string]> = {
		urgent: ['#fee2e2', '#991b1b'],
		high: ['#fef3c7', '#92400e'],
		medium: ['#dbeafe', '#1e40af'],
		low: ['#f1f5f9', '#475569']
	};
	const [bg, fg] = map[p] ?? map.medium;
	return `<span style="display:inline-block; padding:3px 12px; border-radius:9999px; font-size:13px; font-weight:600; background:${bg}; color:${fg};">${p}</span>`;
}

function renderEmail(kind: 'agency' | 'client', name: string, taskUrl: string): string {
	const safeName = escapeHtml(name);
	const safeTitle = escapeHtml(taskTitle);
	const safeDesc = escapeHtml(taskDescription);

	const bodyHtml = `
		<p style="color: #111827; font-size: 15px; line-height: 1.6; margin: 0 0 12px 0;">Bună ziua ${safeName},</p>
		<p style="color: #111827; font-size: 15px; line-height: 1.6; margin: 0 0 20px 0;">Ți-a fost atribuit un task nou:</p>
		<table role="presentation" cellpadding="0" cellspacing="0" style="width: 100%; background-color: #f9fafb; border-radius: 8px; margin: 0 0 20px 0;">
			<tr>
				<td style="padding: 16px 18px; color: #374151; font-size: 14px; line-height: 1.7;">
					<div style="font-weight: 600; color: #111827; font-size: 15px; margin-bottom: 8px;">${safeTitle}</div>
					<div style="color: #6b7280; font-size: 13px; margin-bottom: 12px;">${safeDesc}</div>
					<div><span style="color: #6b7280;">Prioritate</span> &nbsp;·&nbsp; ${priorityBadge(priority)}</div>
					<div style="margin-top: 6px;"><span style="color: #6b7280;">Status</span> &nbsp;·&nbsp; ${statusBadge(status)}</div>
					<div style="margin-top: 6px;"><span style="color: #6b7280;">Termen</span> &nbsp;·&nbsp; <strong>${dueDate}</strong></div>
				</td>
			</tr>
		</table>
		${renderCtaButton(taskUrl, 'Vezi task-ul', themeColor)}
		<p style="color: #9ca3af; font-size: 12px; margin: 0;">URL țintă: <code>${taskUrl}</code></p>
	`;

	return `
		<div class="email-card">
			<div class="email-header" style="display:flex; justify-content:space-between; align-items:center;">
				<h1>Task nou atribuit · ${tenantName}</h1>
				<span class="kind-pill" style="background:${kind === 'client' ? '#10b981' : '#1877F2'}; color:white; padding:3px 10px; border-radius:9999px; font-size:11px; font-weight:700; text-transform:uppercase;">${kind}</span>
			</div>
			<div class="email-body">${bodyHtml}</div>
			<div class="email-foot">
				Trimis automat de ${tenantName} · destinatar: ${kind}
			</div>
		</div>
	`;
}

const html = `<!doctype html>
<html lang="ro">
<head>
	<meta charset="utf-8" />
	<title>Demo: task assignment emails (agency + client)</title>
	<style>
		body { margin: 0; padding: 24px; background: #f4f6fa; font-family: 'Inter', system-ui, sans-serif; }
		h2 { font-size: 13px; text-transform: uppercase; letter-spacing: 0.04em; color: #64748b; max-width: 600px; margin: 24px auto 8px auto; }
		.email-card { max-width: 600px; margin: 0 auto; background: white; border-radius: 14px; overflow: hidden; box-shadow: 0 4px 12px rgba(15,23,42,.06); }
		.email-header { background: ${themeColor}; padding: 18px 24px; color: white; }
		.email-header h1 { margin: 0; font-size: 16px; font-weight: 800; letter-spacing: -.02em; }
		.email-body { padding: 24px; }
		.email-foot { padding: 14px 24px; border-top: 1px solid #e5e9f0; font-size: 11.5px; color: #94a3b8; text-align: center; }
	</style>
</head>
<body>
	<h2>1. Agency assignee email → links to <code>/${tenantSlug}/tasks/${taskId}</code></h2>
	${renderEmail('agency', agencyRecipient.name, agencyRecipient.url)}

	<h2>2. ClientUser assignee email → links to <code>/client/${tenantSlug}/tasks/${taskId}</code></h2>
	${renderEmail('client', clientRecipient.name, clientRecipient.url)}
</body>
</html>`;

console.log(html);
