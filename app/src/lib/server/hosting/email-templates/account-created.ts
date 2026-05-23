import { fetchTenantBrand, renderCtaButton } from '$lib/server/email';
import { renderHostingShellWithBrand } from './_branded-shell';
import { escapeHtml } from './_escape-html';

export interface AccountCreatedInput {
	tenantId: string;
	domain: string;
	daUsername: string;
	daPassword: string;
	daServerHost: string;
	serverIp: string;
	clientName: string;
}

export async function render(input: AccountCreatedInput): Promise<{ subject: string; html: string }> {
	const subject = `Contul tău de hosting este activ — ${input.domain}`;
	const panelUrl = `https://${input.daServerHost}:2222`;
	const changePasswordUrl = `${panelUrl}/CMD_PASSWD`;

	// Fetch brand once so the body can use themeColor for the CTA button and
	// the shell can reuse the same brand bundle (avoids double DB read).
	const brand = await fetchTenantBrand(input.tenantId);

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
		${renderCtaButton(changePasswordUrl, 'Schimbă parola acum', brand.themeColor)}

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

	const html = renderHostingShellWithBrand({
		brand,
		title: 'Bun venit la OTS Hosting',
		bodyHtml,
		previewTitle: `Hosting activ — ${escapeHtml(input.domain)}`,
	});
	return { subject, html };
}
