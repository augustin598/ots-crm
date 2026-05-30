import { fetchTenantBrand } from '$lib/server/email';
import { renderHostingShellWithBrand } from './_branded-shell';
import { escapeHtml } from './_escape-html';

export interface SuspendedManualInput {
	tenantId: string;
	domain: string;
	clientName: string;
	/** Optional admin-supplied reason. When empty/null we render a generic line. */
	reason: string | null;
	supportEmail: string;
}

export async function render(
	input: SuspendedManualInput
): Promise<{ subject: string; html: string }> {
	const escDomain = escapeHtml(input.domain);
	const escClientName = escapeHtml(input.clientName);
	const escSupportEmail = escapeHtml(input.supportEmail);
	const escReason = input.reason ? escapeHtml(input.reason) : null;

	const subject = `\u{26A0}️ Contul de hosting suspendat — ${escDomain}`;

	const brand = await fetchTenantBrand(input.tenantId);
	const dangerColor = '#dc2626';

	const reasonBlock = escReason
		? `
			<h3 style="margin-top:24px;">Motiv</h3>
			<p style="background:#fef2f2;border-left:3px solid ${dangerColor};padding:10px 12px;margin:0;border-radius:4px;">
				${escReason}
			</p>
		`
		: `<p style="color:#666;">Pentru detalii suplimentare, contactează-ne folosind adresa de mai jos.</p>`;

	const bodyHtml = `
		<p>Salut <strong>${escClientName}</strong>,</p>
		<p>
			Contul tău de hosting pentru <strong>${escDomain}</strong> a fost
			<strong style="color:${dangerColor};">suspendat</strong>. Site-ul nu mai este accesibil
			până la reactivare.
		</p>

		${reasonBlock}

		<p style="margin-top:32px;color:#666;font-size:13px;">
			Pentru întrebări sau reactivarea contului, scrie-ne la
			<a href="mailto:${escSupportEmail}">${escSupportEmail}</a>.
		</p>
	`;

	const html = renderHostingShellWithBrand({
		brand,
		title: 'Hosting suspendat',
		bodyHtml,
		previewTitle: `Hosting suspendat — ${escDomain}`
	});
	return { subject, html };
}
