/**
 * Standalone demo of the hosting provisioning-failed (admin alert) email.
 * Renders the email body inside a minimal mock branded shell so the demo
 * has zero DB dependencies (mirrors the convention used by the other
 * demo-*-email.ts scripts in this folder).
 *
 * Run:
 *   bun --bun scripts/demo-hosting-provisioning-failed-email.ts > /tmp/pf-preview.html && open /tmp/pf-preview.html
 */

function escapeHtml(s: string): string {
	return s.replace(
		/[&<>"']/g,
		(c) =>
			({
				'&': '&amp;',
				'<': '&lt;',
				'>': '&gt;',
				'"': '&quot;',
				"'": '&#39;'
			})[c] as string
	);
}

const fixture = {
	tenantSlug: 'ots',
	accountId: 'acc_xyz123',
	domain: 'example.ro',
	reason: 'da_username_exists',
	attemptNumber: 2,
	adminCrmUrl: 'https://clients.onetopsolution.ro/ots/hosting/accounts/acc_xyz123'
};

const themeColor = '#0ea5e9';
const title = 'Provisioning DA eșuat';
const subject = `\u{1F6A8} Provisioning DA eșuat — ${fixture.domain} (${fixture.tenantSlug}) — ${fixture.reason}`;

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

const bodyHtml = `
	<p>
		Provisioning DirectAdmin a eșuat pentru un cont din tenant
		<strong>${escapeHtml(fixture.tenantSlug)}</strong>. Detaliile sunt mai jos.
	</p>

	<h3 style="margin-top:24px;">Detalii cont</h3>
	<table style="border-collapse:collapse;width:100%;max-width:480px;">
		<tr><td style="padding:6px 0;color:#666;">Tenant</td><td style="padding:6px 0;"><strong>${escapeHtml(fixture.tenantSlug)}</strong></td></tr>
		<tr><td style="padding:6px 0;color:#666;">Domeniu</td><td style="padding:6px 0;"><strong>${escapeHtml(fixture.domain)}</strong></td></tr>
		<tr><td style="padding:6px 0;color:#666;">ID cont</td><td style="padding:6px 0;"><code>${escapeHtml(fixture.accountId)}</code></td></tr>
		<tr><td style="padding:6px 0;color:#666;">Motiv</td><td style="padding:6px 0;"><code>${escapeHtml(fixture.reason)}</code></td></tr>
		<tr><td style="padding:6px 0;color:#666;">Încercarea</td><td style="padding:6px 0;"><strong>Încercarea ${escapeHtml(String(fixture.attemptNumber))}</strong></td></tr>
	</table>

	<div style="text-align: center; margin: 24px 0;">
		<a href="${escapeHtml(fixture.adminCrmUrl)}"
		   style="background-color: ${themeColor}; color: #ffffff; padding: 12px 24px; text-decoration: none; border-radius: 6px; display: inline-block; font-weight: 600; font-size: 14px;">
			Deschide contul în CRM
		</a>
	</div>

	<h3 style="margin-top:32px;">Pași recomandați</h3>
	${recommendedStepsHtml(fixture.reason)}

	<p style="margin-top:32px;color:#666;font-size:13px;">
		Acest email este o alertă internă — nu a fost trimis clientului.
		Dedupe rolling: alerte cu același motiv se grupează pentru 5 minute,
		deci re-încercări rapide nu vor genera mai multe emailuri.
	</p>
`;

const html = `<!DOCTYPE html>
<html>
<head>
	<meta charset="utf-8">
	<meta name="viewport" content="width=device-width, initial-scale=1.0">
	<title>Provisioning eșuat — ${escapeHtml(fixture.domain)}</title>
</head>
<body style="margin: 0; padding: 0; background-color: #f4f5f7; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif;">
	<div style="max-width: 600px; margin: 0 auto; padding: 32px 20px;">
		<div style="background-color: #ffffff; border: 1px solid #e5e7eb; border-radius: 10px; padding: 32px;">
			<h1 style="color: ${themeColor}; font-size: 22px; margin: 0 0 6px 0; line-height: 1.2;">${title}</h1>
			<p style="color: #6b7280; font-size: 13px; margin: 0 0 24px 0;">Marketing &amp; Hosting</p>
			<div style="height: 1px; background-color: #e5e7eb; margin: 0 0 24px 0;"></div>
			${bodyHtml}
			<div style="height: 1px; background-color: #e5e7eb; margin: 18px 0 18px 0;"></div>
			<p style="color: #9ca3af; font-size: 12px; line-height: 1.5; margin: 0;">Pentru întrebări sau clarificări, nu ezitați să ne contactați.</p>
		</div>
	</div>
</body>
</html>`;

console.log(`<!-- Subject: ${subject} -->`);
console.log(html);
