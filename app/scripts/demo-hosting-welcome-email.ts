/**
 * Standalone demo of the hosting welcome (account-created) email.
 * Renders the email body inside a minimal mock branded shell so the demo
 * has zero DB dependencies (mirrors the convention used by the other
 * demo-*-email.ts scripts in this folder).
 *
 * Run:
 *   bun --bun scripts/demo-hosting-welcome-email.ts > /tmp/hosting-welcome.html && open /tmp/hosting-welcome.html
 */

function escapeHtml(s: string): string {
	return s.replace(/[&<>"']/g, (c) => ({
		'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
	}[c] as string));
}

const fixture = {
	domain: 'example.ro',
	daUsername: 'exampleus',
	daPassword: 'Demo!Pass123',
	daServerHost: 'srv1.onetopsolution.ro',
	serverIp: '185.247.117.10',
	clientName: 'Ion Popescu',
};

const themeColor = '#0ea5e9';
const panelUrl = `https://${fixture.daServerHost}:2222`;
const changePasswordUrl = `${panelUrl}/CMD_PASSWD`;
const subject = `Contul tău de hosting este activ — ${fixture.domain}`;
const title = 'Bun venit la OTS Hosting';

const bodyHtml = `
	<p>Salut <strong>${escapeHtml(fixture.clientName)}</strong>,</p>
	<p>Contul tău de hosting pentru <strong>${escapeHtml(fixture.domain)}</strong> este activ și gata de folosit.</p>

	<h3 style="margin-top:24px;">Date de acces</h3>
	<table style="border-collapse:collapse;width:100%;max-width:480px;">
		<tr><td style="padding:6px 0;color:#666;">Domeniu</td><td style="padding:6px 0;"><strong>${escapeHtml(fixture.domain)}</strong></td></tr>
		<tr><td style="padding:6px 0;color:#666;">IP server</td><td style="padding:6px 0;"><code>${escapeHtml(fixture.serverIp)}</code></td></tr>
		<tr><td style="padding:6px 0;color:#666;">Utilizator DA</td><td style="padding:6px 0;"><code>${escapeHtml(fixture.daUsername)}</code></td></tr>
		<tr><td style="padding:6px 0;color:#666;">Parolă DA</td><td style="padding:6px 0;"><code>${escapeHtml(fixture.daPassword)}</code></td></tr>
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
