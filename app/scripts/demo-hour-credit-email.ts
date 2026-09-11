/**
 * Standalone demo of the hour-credit emails (sendHourCreditEmail in
 * src/lib/server/email.ts): „credit scăzut", „ore consumate la finalizare",
 * „alimentare". Renders the three bodies inside a minimal mock branded shell,
 * zero DB dependencies (same convention as the other demo-*-email.ts scripts).
 *
 * Run:
 *   bun --bun scripts/demo-hour-credit-email.ts > /tmp/hour-credit-preview.html && open /tmp/hour-credit-preview.html
 */
import {
	buildHourCreditEmailBody,
	hourCreditEmailTitle
} from '../src/lib/server/hour-credit-email-body';

const fixture = {
	tenantName: 'One Top Solution',
	clientName: 'Lucky Group SRL',
	portalUrl: 'https://clients.onetopsolution.ro/client/ots/hour-credits',
	servicesUrl: 'https://clients.onetopsolution.ro/servicii',
	themeColor: '#1877F2'
};

const events = [
	{ kind: 'credited' as const, minutes: 1230, source: 'factura OTS 612' },
	{
		kind: 'consumed' as const,
		taskId: 'demo',
		taskTitle: 'Landing page campanie toamnă',
		realMinutes: 180,
		consumedMinutes: 213,
		overageRealMinutes: 0
	},
	{ kind: 'low' as const, balanceMinutes: 90, thresholdMinutes: 120 }
];

const sections = events
	.map((event, i) => {
		const balance = [1230, 1017, 90][i];
		const body = buildHourCreditEmailBody({
			clientName: fixture.clientName,
			event,
			balanceMinutes: balance,
			portalUrl: fixture.portalUrl,
			servicesUrl: fixture.servicesUrl,
			themeColor: fixture.themeColor
		});
		return `<section style="margin: 0 0 40px 0; border: 1px solid #e5e7eb; border-radius: 12px; overflow: hidden;">
	<div style="background:${fixture.themeColor}; color:#fff; padding: 16px 24px; font-weight: 700;">${hourCreditEmailTitle(event)}</div>
	<div style="padding: 24px;">${body}</div>
	<div style="padding: 12px 24px; color:#6b7280; font-size: 12px; border-top: 1px solid #e5e7eb;">Trimis automat de ${fixture.tenantName}.</div>
</section>`;
	})
	.join('\n');

process.stdout
	.write(`<!doctype html><html lang="ro"><head><meta charset="utf-8"><title>Demo emailuri credit de ore</title></head>
<body style="font-family: -apple-system, Segoe UI, Roboto, sans-serif; background:#f3f4f6; padding: 24px;">
<div style="max-width: 640px; margin: 0 auto;">${sections}</div>
</body></html>
`);
