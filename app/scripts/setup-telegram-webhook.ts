// One-time script to register the Telegram webhook URL with the bot.
// Usage:
//   bun run app/scripts/setup-telegram-webhook.ts
//
// Requires env vars: TELEGRAM_BOT_TOKEN, optionally TELEGRAM_WEBHOOK_SECRET.
// Public URL is read from PUBLIC_BASE_URL or falls back to the prod domain.

const TELEGRAM_API = 'https://api.telegram.org';

async function main() {
	const token = (process.env.TELEGRAM_BOT_TOKEN ?? '').trim();
	if (!token) {
		console.error('TELEGRAM_BOT_TOKEN is not set');
		process.exit(1);
	}

	const baseUrl = (process.env.PUBLIC_BASE_URL ?? 'https://clients.onetopsolution.ro').replace(/\/$/, '');
	const webhookUrl = `${baseUrl}/api/telegram/webhook`;
	const secret = (process.env.TELEGRAM_WEBHOOK_SECRET ?? '').trim();

	const body: Record<string, unknown> = {
		url: webhookUrl,
		allowed_updates: ['message']
	};
	if (secret) body.secret_token = secret;

	console.log(`Setting Telegram webhook to: ${webhookUrl}`);
	const res = await fetch(`${TELEGRAM_API}/bot${token}/setWebhook`, {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify(body)
	});
	const json = (await res.json()) as { ok?: boolean; description?: string };
	if (!res.ok || !json.ok) {
		console.error('Failed:', json.description ?? `HTTP ${res.status}`);
		process.exit(1);
	}
	console.log('OK:', json.description);

	// Print bot info
	const meRes = await fetch(`${TELEGRAM_API}/bot${token}/getMe`);
	const meJson = (await meRes.json()) as { ok?: boolean; result?: { username?: string; first_name?: string } };
	if (meJson.ok && meJson.result) {
		console.log(`Bot username: @${meJson.result.username}`);
		console.log(`Bot name: ${meJson.result.first_name}`);
		console.log(`\nMake sure TELEGRAM_BOT_USERNAME=${meJson.result.username} is set in your env.`);
	}
}

main().catch((e) => {
	console.error(e);
	process.exit(1);
});
