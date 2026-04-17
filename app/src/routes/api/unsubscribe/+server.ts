import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { suppressEmail } from '$lib/server/email';

/**
 * RFC 8058 One-Click Unsubscribe endpoint.
 * POST = one-click unsubscribe (from email client)
 * GET = manual unsubscribe (from browser link)
 */
export const POST: RequestHandler = async ({ url }) => {
	const email = url.searchParams.get('email');
	const type = url.searchParams.get('type');

	if (!email) {
		return json({ error: 'Missing email parameter' }, { status: 400 });
	}

	await suppressEmail({
		email,
		tenantId: null,
		reason: 'complaint',
		smtpMessage: `Unsubscribed via RFC 8058 one-click (type: ${type || 'unknown'})`
	});

	return json({ success: true, message: 'Unsubscribed successfully' });
};

export const GET: RequestHandler = async ({ url }) => {
	const email = url.searchParams.get('email');
	const type = url.searchParams.get('type');

	if (!email) {
		return new Response('Missing email parameter', { status: 400 });
	}

	await suppressEmail({
		email,
		tenantId: null,
		reason: 'complaint',
		smtpMessage: `Unsubscribed via web link (type: ${type || 'unknown'})`
	});

	return new Response(
		`<!DOCTYPE html><html><body style="font-family:Arial;text-align:center;padding:50px;">
		<h2>Dezabonare reusita</h2>
		<p>Adresa <strong>${email}</strong> a fost dezabonata de la notificari.</p>
		</body></html>`,
		{ headers: { 'Content-Type': 'text/html; charset=utf-8' } }
	);
};
