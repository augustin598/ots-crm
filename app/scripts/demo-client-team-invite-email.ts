/**
 * Standalone demo of the client portal team-invite email
 * (sendClientTeamInviteEmail in src/lib/server/email.ts). Renders the email
 * body inside a minimal mock branded shell so the demo has zero DB
 * dependencies (mirrors the convention used by the other demo-*-email.ts
 * scripts in this folder).
 *
 * Run:
 *   bun --bun scripts/demo-client-team-invite-email.ts > /tmp/client-team-invite-preview.html && open /tmp/client-team-invite-preview.html
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
	tenantName: 'One Top Solution',
	tenantSlug: 'ots',
	clientName: 'Lucky Group SRL',
	inviterName: 'Maria Ionescu',
	token: 'DEMO-TOKEN'
};

const themeColor = '#1877F2';
const baseUrl = 'https://clients.onetopsolution.ro';
const loginUrl = `${baseUrl}/client/${fixture.tenantSlug}/verify?token=${encodeURIComponent(fixture.token)}`;
const tenantName = escapeHtml(fixture.tenantName);
const clientName = escapeHtml(fixture.clientName);
const inviterName = escapeHtml(fixture.inviterName);
const subject = `${fixture.inviterName} te-a invitat în portalul ${fixture.clientName}`;

// Body identical to sendClientTeamInviteEmail's bodyHtml.
const bodyHtml = `
	<p style="color: #111827; font-size: 15px; line-height: 1.6; margin: 0 0 12px 0;">Bună ziua,</p>
	<p style="color: #111827; font-size: 15px; line-height: 1.6; margin: 0 0 12px 0;"><strong>${inviterName}</strong> v-a invitat în portalul de client <strong>${clientName}</strong>, găzduit de ${tenantName}.</p>
	<p style="color: #111827; font-size: 15px; line-height: 1.6; margin: 0 0 4px 0;">Apăsați butonul de mai jos pentru a intra în portal. Linkul expiră în 24 de ore; ulterior vă puteți autentifica oricând cu adresa aceasta de email.</p>
	<div style="text-align: center; margin: 24px 0;">
		<a href="${loginUrl}" style="background-color: ${themeColor}; color: #ffffff; padding: 12px 24px; text-decoration: none; border-radius: 6px; display: inline-block; font-weight: 600; font-size: 14px;">Accesează portalul</a>
	</div>
	<p style="color: #6b7280; font-size: 13px; line-height: 1.6; margin: 0 0 4px 0;">Sau copiați acest link în browser:</p>
	<p style="color: #9ca3af; font-size: 12px; line-height: 1.5; margin: 0 0 18px 0; word-break: break-all;">${loginUrl}</p>
	<div style="background-color: #fffbeb; border-left: 3px solid #f59e0b; padding: 12px 14px; border-radius: 6px; margin: 0 0 20px 0;">
		<p style="color: #92400e; font-size: 13px; line-height: 1.5; margin: 0;"><strong>Securitate</strong> · Linkul este personal, valabil 24 de ore și poate fi folosit o singură dată. Dacă nu așteptați această invitație, ignorați emailul.</p>
	</div>
`;

const html = `<!DOCTYPE html>
<html>
<head>
	<meta charset="utf-8">
	<meta name="viewport" content="width=device-width, initial-scale=1.0">
	<title>Invitație în portalul ${clientName}</title>
</head>
<body style="margin: 0; padding: 0; background-color: #f4f5f7; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif;">
	<div style="max-width: 600px; margin: 0 auto; padding: 32px 20px;">
		<div style="background-color: #ffffff; border: 1px solid #e5e7eb; border-radius: 10px; padding: 32px;">
			<h1 style="color: ${themeColor}; font-size: 22px; margin: 0 0 6px 0; line-height: 1.2;">Invitație în portalul ${clientName}</h1>
			<p style="color: #6b7280; font-size: 13px; margin: 0 0 24px 0;">${tenantName} · Portal Client</p>
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
