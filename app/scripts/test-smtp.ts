/**
 * Test SMTP connection - run with: bun scripts/test-smtp.ts
 * Shows the actual error if connection fails.
 */
import nodemailer from 'nodemailer';

const host = process.env.SMTP_HOST;
const port = parseInt(process.env.SMTP_PORT || '587');
const user = process.env.SMTP_USER;
const pass = process.env.SMTP_PASSWORD;
const from = process.env.SMTP_FROM || user;

console.log('SMTP config:', { host, port, user, from: from ? '***' : '(missing)' });
console.log('');

if (!host || !user || !pass) {
	console.error('Missing SMTP_HOST, SMTP_USER or SMTP_PASSWORD in .env');
	process.exit(1);
}

const transporter = nodemailer.createTransport({
	host,
	port,
	secure: port === 465,
	auth: { user, pass },
	tls: { rejectUnauthorized: false }
});

async function test() {
	try {
		await transporter.verify();
		console.log('✓ SMTP connection OK');
	} catch (err) {
		console.error('✗ SMTP verify failed:', err);
		process.exit(1);
	}

	try {
		await transporter.sendMail({
			from: `"Test" <${from}>`,
			to: user,
			subject: 'SMTP Test',
			text: 'Test email from CRM'
		});
		console.log('✓ Test email sent to', user);
	} catch (err) {
		console.error('✗ Send failed:', err);
		process.exit(1);
	}
}

test();
