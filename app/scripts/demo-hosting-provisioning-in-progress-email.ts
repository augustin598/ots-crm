/**
 * Standalone demo of the hosting "provisioning in progress" email (audit H4).
 * Sent when payment succeeded but automatic DA provisioning did NOT complete —
 * the customer is told the payment was received + the account is being set up,
 * instead of a misleading "account ready" confirmation.
 *
 * Zero DB deps — renders the body inside a minimal mock branded shell (mirrors
 * the other demo-*-email.ts scripts).
 *
 * Run:
 *   bun --bun scripts/demo-hosting-provisioning-in-progress-email.ts > /tmp/hosting-in-progress.html && open /tmp/hosting-in-progress.html
 */

function escapeHtml(s: string): string {
	return s.replace(/[&<>"']/g, (c) => ({
		'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
	}[c] as string));
}

const fixture = {
	clientName: 'Ion Popescu',
	planName: 'WordPress Premium',
	supportEmail: 'support@onetopsolution.ro',
};

const themeColor = '#0ea5e9';
const subject = 'Plata a fost confirmată — îți pregătim contul de hosting';
const title = 'Îți pregătim contul de hosting';
const planLine = fixture.planName
	? `pentru <strong>${escapeHtml(fixture.planName)}</strong> `
	: '';

const bodyHtml = `
	<p>Salut <strong>${escapeHtml(fixture.clientName)}</strong>,</p>
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
		Ai întrebări? Scrie-ne la <a href="mailto:${escapeHtml(fixture.supportEmail)}">${escapeHtml(fixture.supportEmail)}</a> sau răspunde direct la acest email.
	</p>
`;

const html = `<!DOCTYPE html>
<html>
<head>
	<meta charset="utf-8">
	<meta name="viewport" content="width=device-width, initial-scale=1.0">
	<title>${subject}</title>
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
