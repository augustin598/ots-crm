import { fetchTenantBrand, renderCtaButton } from '$lib/server/email';
import { renderHostingShellWithBrand } from './_branded-shell';
import { escapeHtml } from './_escape-html';

export interface ReactivatedManualInput {
	tenantId: string;
	domain: string;
	clientName: string;
	/** Public DA panel URL — `https://${server.hostname}:2222`. */
	daPanelUrl: string;
}

export async function render(
	input: ReactivatedManualInput
): Promise<{ subject: string; html: string }> {
	const escDomain = escapeHtml(input.domain);
	const escClientName = escapeHtml(input.clientName);
	const escDaPanelUrl = escapeHtml(input.daPanelUrl);

	const subject = `\u{2705} Hosting reactivat — ${escDomain}`;

	const brand = await fetchTenantBrand(input.tenantId);

	const bodyHtml = `
		<p>Salut <strong>${escClientName}</strong>,</p>
		<p>
			Contul tău de hosting pentru <strong>${escDomain}</strong> a fost
			<strong style="color:${brand.themeColor};">reactivat</strong> și este din nou
			funcțional. Poți accesa panoul DirectAdmin folosind butonul de mai jos.
		</p>

		${renderCtaButton(escDaPanelUrl, 'Deschide panoul DA', brand.themeColor)}

		<p style="margin-top:32px;">Mulțumim pentru încredere!</p>
	`;

	const html = renderHostingShellWithBrand({
		brand,
		title: 'Hosting reactivat',
		bodyHtml,
		previewTitle: `Hosting reactivat — ${escDomain}`
	});
	return { subject, html };
}
