import { renderHostingShell } from './_branded-shell';

export interface AccountCreatedInput {
	tenantId: string;
	domain: string;
	daUsername: string;
	daPassword: string;
	daServerHost: string;
	serverIp: string;
	clientName: string;
	locale?: 'ro';
}

export async function render(input: AccountCreatedInput): Promise<{ subject: string; html: string }> {
	const subject = `Contul tău de hosting este activ — ${input.domain}`;
	const panelUrl = `https://${input.daServerHost}:2222`;
	const changePasswordUrl = `${panelUrl}/CMD_PASSWD`;

	const bodyHtml = `
		<p>Salut <strong>${escapeHtml(input.clientName)}</strong>,</p>
		<p>Contul tău de hosting pentru <strong>${escapeHtml(input.domain)}</strong> este activ și gata de folosit.</p>

		<h3 style="margin-top:24px;">Date de acces</h3>
		<table style="border-collapse:collapse;width:100%;max-width:480px;">
			<tr><td style="padding:6px 0;color:#666;">Domeniu</td><td style="padding:6px 0;"><strong>${escapeHtml(input.domain)}</strong></td></tr>
			<tr><td style="padding:6px 0;color:#666;">IP server</td><td style="padding:6px 0;"><code>${escapeHtml(input.serverIp)}</code></td></tr>
			<tr><td style="padding:6px 0;color:#666;">Utilizator DA</td><td style="padding:6px 0;"><code>${escapeHtml(input.daUsername)}</code></td></tr>
			<tr><td style="padding:6px 0;color:#666;">Parolă DA</td><td style="padding:6px 0;"><code>${escapeHtml(input.daPassword)}</code></td></tr>
			<tr><td style="padding:6px 0;color:#666;">Panou DA</td><td style="padding:6px 0;"><a href="${panelUrl}">${panelUrl}</a></td></tr>
		</table>

		<p style="margin-top:24px;">
			<strong>Recomandat:</strong> schimbă parola imediat după primul login.
		</p>
		<p>
			<a href="${changePasswordUrl}"
			   style="display:inline-block;background:#0ea5e9;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:600;">
				Schimbă parola acum
			</a>
		</p>

		<h3 style="margin-top:32px;">Ce urmează</h3>
		<ul>
			<li><strong>FTP:</strong> folosește utilizatorul DA și parola de mai sus pe portul 21</li>
			<li><strong>MySQL:</strong> creează baze de date prin panoul DA → MySQL Management</li>
			<li><strong>Instalare CMS (WordPress etc.):</strong> folosește Installatron din panoul DA</li>
		</ul>

		<p style="margin-top:32px;color:#666;font-size:13px;">
			Dacă ai întrebări, răspunde direct la acest email.
		</p>
	`;

	const html = await renderHostingShell({
		tenantId: input.tenantId,
		title: 'Bun venit la OTS Hosting',
		bodyHtml,
		previewTitle: `Hosting activ — ${input.domain}`,
	});
	return { subject, html };
}

function escapeHtml(s: string): string {
	return s.replace(/[&<>"']/g, (c) => ({
		'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
	}[c] as string));
}
