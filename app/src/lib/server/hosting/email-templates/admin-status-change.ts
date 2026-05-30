import { fetchTenantBrand, renderCtaButton } from '$lib/server/email';
import { renderHostingShellWithBrand } from './_branded-shell';
import { escapeHtml } from './_escape-html';

export type StatusChangeAction = 'suspended' | 'reactivated';
export type StatusChangeTrigger = 'manual' | 'auto';

export interface AdminStatusChangeInput {
	tenantId: string;
	tenantSlug: string;
	accountId: string;
	domain: string;
	daUsername: string;
	action: StatusChangeAction;
	trigger: StatusChangeTrigger;
	/** Admin who clicked the button (manual trigger only). */
	actorName: string | null;
	/** Free-text reason supplied by the admin (manual suspend only). */
	reason: string | null;
	/** Invoice number tied to the change (auto trigger only). */
	invoiceNumber: string | null;
	/** Full URL to the CRM admin page for this account. */
	adminCrmUrl: string;
}

export async function render(
	input: AdminStatusChangeInput
): Promise<{ subject: string; html: string }> {
	const escDomain = escapeHtml(input.domain);
	const escSlug = escapeHtml(input.tenantSlug);
	const escDaUsername = escapeHtml(input.daUsername);
	const escAccountId = escapeHtml(input.accountId);
	const escUrl = escapeHtml(input.adminCrmUrl);
	const escActor = input.actorName ? escapeHtml(input.actorName) : null;
	const escReason = input.reason ? escapeHtml(input.reason) : null;
	const escInvoice = input.invoiceNumber ? escapeHtml(input.invoiceNumber) : null;

	const verb = input.action === 'suspended' ? 'suspendat' : 'reactivat';
	const icon = input.action === 'suspended' ? '\u{26A0}️' : '\u{2705}';
	const triggerLabel = input.trigger === 'manual' ? 'manual' : 'automat';
	const accentColor = input.action === 'suspended' ? '#dc2626' : '#16a34a';

	const subject = `${icon} Hosting ${verb} (${triggerLabel}) — ${escDomain} [${escSlug}]`;

	const brand = await fetchTenantBrand(input.tenantId);

	// Detail rows — only render the rows that are relevant for the trigger.
	const triggerRow = `
		<tr>
			<td style="padding:6px 0;color:#666;">Trigger</td>
			<td style="padding:6px 0;"><strong style="color:${accentColor};">${triggerLabel}</strong></td>
		</tr>`;

	const actorRow = escActor
		? `
		<tr>
			<td style="padding:6px 0;color:#666;">Operator</td>
			<td style="padding:6px 0;">${escActor}</td>
		</tr>`
		: '';

	const reasonRow = escReason
		? `
		<tr>
			<td style="padding:6px 0;color:#666;vertical-align:top;">Motiv</td>
			<td style="padding:6px 0;">${escReason}</td>
		</tr>`
		: '';

	const invoiceRow = escInvoice
		? `
		<tr>
			<td style="padding:6px 0;color:#666;">Factură</td>
			<td style="padding:6px 0;"><strong>${escInvoice}</strong></td>
		</tr>`
		: '';

	const bodyHtml = `
		<p>
			Cont de hosting <strong style="color:${accentColor};">${verb}</strong> ${triggerLabel} în tenant
			<strong>${escSlug}</strong>.
		</p>

		<h3 style="margin-top:24px;">Detalii cont</h3>
		<table style="border-collapse:collapse;width:100%;max-width:520px;">
			<tr><td style="padding:6px 0;color:#666;">Domeniu</td><td style="padding:6px 0;"><strong>${escDomain}</strong></td></tr>
			<tr><td style="padding:6px 0;color:#666;">User DA</td><td style="padding:6px 0;"><code>${escDaUsername}</code></td></tr>
			<tr><td style="padding:6px 0;color:#666;">ID cont</td><td style="padding:6px 0;"><code>${escAccountId}</code></td></tr>
			${triggerRow}
			${actorRow}
			${reasonRow}
			${invoiceRow}
		</table>

		${renderCtaButton(escUrl, 'Deschide contul în CRM', brand.themeColor)}

		<p style="margin-top:32px;color:#666;font-size:13px;">
			Alertă internă — clientul a primit un email separat (în limita dedupe).
		</p>
	`;

	const html = renderHostingShellWithBrand({
		brand,
		title: `Hosting ${verb}`,
		bodyHtml,
		previewTitle: `Hosting ${verb} — ${escDomain}`
	});
	return { subject, html };
}
