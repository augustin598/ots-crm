import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { suppressEmail, verifyUnsubscribeToken } from '$lib/server/email';

function escapeHtml(s: string): string {
	return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/**
 * RFC 8058 One-Click Unsubscribe endpoint.
 * POST = one-click unsubscribe (from email client, requires valid HMAC token)
 * GET = shows confirmation page with form (does NOT auto-suppress)
 */
export const POST: RequestHandler = async ({ url }) => {
	const email = url.searchParams.get('email');
	const token = url.searchParams.get('token');
	const tenantId = url.searchParams.get('tenantId');

	if (!email || !token) {
		return json({ error: 'Missing parameters' }, { status: 400 });
	}

	// Verify HMAC token to prevent unauthorized suppression
	if (!verifyUnsubscribeToken(email, tenantId, token)) {
		return json({ error: 'Invalid or expired token' }, { status: 403 });
	}

	await suppressEmail({
		email,
		tenantId: tenantId || null,
		reason: 'complaint',
		smtpMessage: 'Unsubscribed via RFC 8058 one-click'
	});

	return json({ success: true, message: 'Unsubscribed successfully' });
};

export const GET: RequestHandler = async ({ url }) => {
	const email = url.searchParams.get('email');
	const token = url.searchParams.get('token');
	const tenantId = url.searchParams.get('tenantId') || '';

	if (!email || !token) {
		return new Response('Link invalid', { status: 400, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
	}

	if (!verifyUnsubscribeToken(email, tenantId || null, token)) {
		return new Response('Link invalid sau expirat', { status: 403, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
	}

	const safeEmail = escapeHtml(email);
	const params = new URLSearchParams({ email, token, tenantId }).toString();

	// Show confirmation page -- do NOT suppress on GET (RFC 8058, link scanners)
	return new Response(
		`<!DOCTYPE html><html><head><meta charset="utf-8"></head>
		<body style="font-family:Arial;text-align:center;padding:50px;">
		<h2>Confirmare dezabonare</h2>
		<p>Doriti sa dezabonati adresa <strong>${safeEmail}</strong> de la notificari?</p>
		<form method="POST" action="/api/unsubscribe?${params}">
			<button type="submit" style="background:#2563eb;color:white;padding:12px 24px;border:none;border-radius:6px;cursor:pointer;font-size:16px;">
				Da, dezaboneaza-ma
			</button>
		</form>
		</body></html>`,
		{ headers: { 'Content-Type': 'text/html; charset=utf-8' } }
	);
};
