import { fetchTenantBrand, renderCtaButton } from '$lib/server/email';
import { renderHostingShellWithBrand } from './_branded-shell';
import { escapeHtml } from './_escape-html';

export interface ProvisioningFailedInput {
	tenantId: string;
	tenantSlug: string;
	accountId: string;
	domain: string;
	/**
	 * Failure classification used by the alert title + recommendations table.
	 * Known values (mapped to human-readable advice):
	 *   - `da_username_exists`   — username collision after retries
	 *   - `da_create_failed`     — generic DA create failure (non-classified)
	 *   - `da_unreachable`       — DA panel/network unreachable
	 *   - `orphan_no_customer`   — account has no client and no inquiry
	 *   - `da_<kind>`            — other DirectAdminApiError.kind values
	 */
	reason: string;
	/** 1-indexed attempt number ("Încercarea N") shown to the admin. */
	attemptNumber: number;
	/** Full URL to the CRM admin page for this account. */
	adminCrmUrl: string;
}

/**
 * Maps a reason string → Romanian "Pași recomandați" copy for the admin.
 * Falls back to a generic message for unknown reasons (forward-compat: if a
 * new `da_<kind>` shows up we still surface the alert with useful CTA + table).
 */
function recommendedStepsHtml(reason: string): string {
	switch (reason) {
		case 'da_username_exists':
			return `
				<ul>
					<li>Verifică în panoul DirectAdmin dacă username-ul există deja (poate fi un cont vechi sau de la alt client).</li>
					<li>Dacă fluxul a fost auto-retry cu seed, verifică dacă seed-ul este prea îngust (toate variantele sunt deja folosite).</li>
					<li>Crează manual contul cu un username unic din UI: <em>Hosting → Conturi → Creează cont</em>.</li>
				</ul>`;
		case 'da_create_failed':
			return `
				<ul>
					<li>Deschide log-ul DA Audit pentru acest cont și verifică răspunsul exact al panoului.</li>
					<li>Confirmă că pachetul DA selectat există pe serverul țintă (poate fi șters sau redenumit pe DA).</li>
					<li>Verifică spațiul disponibil pe server și statusul licenței DirectAdmin.</li>
				</ul>`;
		case 'da_unreachable':
			return `
				<ul>
					<li>Verifică starea serverului DA: <em>Hosting → Servere → Health Check</em>.</li>
					<li>Confirmă că portul 2222 este accesibil din rețeaua CRM (firewall, IP whitelist).</li>
					<li>Dacă serverul răspunde manual din browser, e probabil o problemă de DNS sau TLS.</li>
				</ul>`;
		case 'orphan_no_customer':
			return `
				<ul>
					<li>Acest cont nu are nici client linkat, nici inquiry. E probabil un cont admin-only sau o creare manuală fără pas precedent.</li>
					<li>Linkează contul la un client din <em>Hosting → Conturi → Detalii cont</em>.</li>
				</ul>`;
		default:
			return `
				<ul>
					<li>Deschide contul în CRM și inspectează log-ul DA Audit pentru detalii tehnice.</li>
					<li>Consultă documentația DirectAdmin pentru codul de eroare returnat.</li>
				</ul>`;
	}
}

export async function render(
	input: ProvisioningFailedInput
): Promise<{ subject: string; html: string }> {
	const escDomain = escapeHtml(input.domain);
	const escSlug = escapeHtml(input.tenantSlug);
	const escReason = escapeHtml(input.reason);
	const escAccountId = escapeHtml(input.accountId);
	const escAttempt = escapeHtml(String(input.attemptNumber));
	const escUrl = escapeHtml(input.adminCrmUrl);

	// Subject interpolations escaped to keep parity with the body and to defend
	// against any downstream consumer (admin CRM email-log viewer, log files
	// rendered as HTML) that may render the subject in an HTML context.
	const subject = `\u{1F6A8} Provisioning DA eșuat — ${escDomain} (${escSlug}) — ${escReason}`;

	// Brand fetched ONCE so the body can reuse themeColor for the CTA button
	// and the shell can skip a second DB read.
	const brand = await fetchTenantBrand(input.tenantId);

	const bodyHtml = `
		<p>
			Provisioning DirectAdmin a eșuat pentru un cont din tenant
			<strong>${escSlug}</strong>. Detaliile sunt mai jos.
		</p>

		<h3 style="margin-top:24px;">Detalii cont</h3>
		<table style="border-collapse:collapse;width:100%;max-width:480px;">
			<tr><td style="padding:6px 0;color:#666;">Tenant</td><td style="padding:6px 0;"><strong>${escSlug}</strong></td></tr>
			<tr><td style="padding:6px 0;color:#666;">Domeniu</td><td style="padding:6px 0;"><strong>${escDomain}</strong></td></tr>
			<tr><td style="padding:6px 0;color:#666;">ID cont</td><td style="padding:6px 0;"><code>${escAccountId}</code></td></tr>
			<tr><td style="padding:6px 0;color:#666;">Motiv</td><td style="padding:6px 0;"><code>${escReason}</code></td></tr>
			<tr><td style="padding:6px 0;color:#666;">Încercarea</td><td style="padding:6px 0;"><strong>Încercarea ${escAttempt}</strong></td></tr>
		</table>

		${renderCtaButton(escUrl, 'Deschide contul în CRM', brand.themeColor)}

		<h3 style="margin-top:32px;">Pași recomandați</h3>
		${recommendedStepsHtml(input.reason)}

		<p style="margin-top:32px;color:#666;font-size:13px;">
			Acest email este o alertă internă — nu a fost trimis clientului.
			Dedupe rolling: alerte cu același motiv se grupează pentru 5 minute,
			deci re-încercări rapide nu vor genera mai multe emailuri.
		</p>
	`;

	const html = renderHostingShellWithBrand({
		brand,
		title: 'Provisioning DA eșuat',
		bodyHtml,
		previewTitle: `Provisioning eșuat — ${escDomain}`
	});
	return { subject, html };
}
