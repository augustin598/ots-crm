import { fetchTenantBrand, renderCtaButton } from '$lib/server/email';
import { renderHostingShellWithBrand } from './_branded-shell';
import { escapeHtml } from './_escape-html';

export interface PasswordResetInput {
	tenantId: string;
	domain: string;
	daUsername: string;
	daPassword: string;
	daServerHost: string;
	clientName: string;
}

export async function render(input: PasswordResetInput): Promise<{ subject: string; html: string }> {
	const subject = `Parolă nouă pentru contul tău de hosting — ${input.domain}`;
	const panelUrl = `https://${input.daServerHost}:2222`;
	const changePasswordUrl = `${panelUrl}/CMD_PASSWD`;

	const brand = await fetchTenantBrand(input.tenantId);

	const bodyHtml = `
		<p>Salut <strong>${escapeHtml(input.clientName)}</strong>,</p>
		<p>Parola contului tău de hosting pentru <strong>${escapeHtml(input.domain)}</strong> a fost resetată la cerere. Vechea parolă nu mai este validă.</p>

		<h3 style="margin-top:24px;">Date de acces noi</h3>
		<table style="border-collapse:collapse;width:100%;max-width:480px;">
			<tr><td style="padding:6px 0;color:#666;">Utilizator DA</td><td style="padding:6px 0;"><code>${escapeHtml(input.daUsername)}</code></td></tr>
			<tr><td style="padding:6px 0;color:#666;">Parolă nouă</td><td style="padding:6px 0;"><code>${escapeHtml(input.daPassword)}</code></td></tr>
			<tr><td style="padding:6px 0;color:#666;">Panou DA</td><td style="padding:6px 0;"><a href="${panelUrl}">${panelUrl}</a></td></tr>
		</table>

		<p style="margin-top:24px;">
			<strong>Important:</strong> recomandăm să schimbi parola din nou imediat după primul login, ca să rămână cunoscută doar de tine.
		</p>
		${renderCtaButton(changePasswordUrl, 'Schimbă parola acum', brand.themeColor)}

		<p style="margin-top:32px;color:#666;font-size:13px;">
			Dacă nu ai cerut tu resetarea, contactează-ne imediat răspunzând la acest email.
		</p>
	`;

	const html = renderHostingShellWithBrand({
		brand,
		title: 'Parolă resetată',
		bodyHtml,
		previewTitle: `Parolă nouă — ${escapeHtml(input.domain)}`
	});
	return { subject, html };
}
