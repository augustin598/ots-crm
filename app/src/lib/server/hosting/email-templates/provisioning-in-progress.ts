import { fetchTenantBrand } from '$lib/server/email';
import { renderHostingShellWithBrand } from './_branded-shell';
import { escapeHtml } from './_escape-html';

export interface ProvisioningInProgressInput {
	tenantId: string;
	clientName: string;
	/** Optional product/plan name for a friendlier line ("pachetul X"). */
	planName?: string | null;
	/** Customer-facing support address shown in the closing line. */
	supportEmail?: string;
}

/**
 * Customer email sent when payment succeeded but automatic DA provisioning did
 * NOT complete (audit H4). Replaces the misleading "cont activ / Plată
 * confirmată" message in that case: it confirms the payment + that the fiscal
 * invoice is issued, but is honest that the account is still being set up by
 * the team — so the customer never gets login promises for an account that
 * doesn't exist yet. Staff are alerted separately (admin-payment-received email
 * surfaces the failed `da_provision` step).
 */
export async function render(
	input: ProvisioningInProgressInput
): Promise<{ subject: string; html: string }> {
	const subject = 'Plata a fost confirmată — îți pregătim contul de hosting';
	const supportEmail = input.supportEmail ?? 'support@onetopsolution.ro';
	const planLine = input.planName
		? `pentru <strong>${escapeHtml(input.planName)}</strong> `
		: '';

	const brand = await fetchTenantBrand(input.tenantId);

	const bodyHtml = `
		<p>Salut <strong>${escapeHtml(input.clientName)}</strong>,</p>
		<p>Îți confirmăm că plata ${planLine}a fost primită cu succes — îți mulțumim! Factura fiscală a fost emisă și o vei primi separat.</p>

		<p>Mai avem un singur pas: <strong>activarea contului tău de hosting</strong>. Acesta se finalizează manual de către echipa noastră și durează de regulă câteva ore lucrătoare.</p>

		<h3 style="margin-top:24px;">Ce urmează</h3>
		<ul>
			<li>Echipa OTS îți configurează contul de hosting.</li>
			<li>Imediat ce e gata, primești pe email datele de acces (utilizator, parolă, panou).</li>
			<li>Nu trebuie să faci nimic între timp — te contactăm noi.</li>
		</ul>

		<p style="margin-top:24px;">Dacă ai introdus un domeniu sau ai cerințe speciale, ne poți răspunde direct la acest email și le luăm în calcul la activare.</p>

		<p style="margin-top:32px;color:#666;font-size:13px;">
			Ai întrebări? Scrie-ne la <a href="mailto:${escapeHtml(supportEmail)}">${escapeHtml(supportEmail)}</a> sau răspunde direct la acest email.
		</p>
	`;

	const html = renderHostingShellWithBrand({
		brand,
		title: 'Îți pregătim contul de hosting',
		bodyHtml,
		previewTitle: 'Plata confirmată — contul tău se activează în curând'
	});
	return { subject, html };
}
