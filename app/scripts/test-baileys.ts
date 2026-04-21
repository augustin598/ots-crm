import makeWASocket, { DisconnectReason, useMultiFileAuthState, fetchLatestBaileysVersion } from 'baileys';
import pino from 'pino';
import { mkdirSync } from 'fs';

const AUTH_DIR = '/tmp/test-baileys-auth';
try { mkdirSync(AUTH_DIR, { recursive: true }); } catch {}

console.log('[TEST] Loading auth state from', AUTH_DIR);
const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);

console.log('[TEST] Fetching Baileys version...');
let version: [number, number, number];
try {
	const res = await Promise.race([
		fetchLatestBaileysVersion(),
		new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timeout')), 8000))
	]);
	version = res.version as [number, number, number];
} catch (err) {
	console.warn('[TEST] version fetch failed, using fallback:', err);
	version = [2, 3000, 1035194821];
}
console.log('[TEST] Version:', version.join('.'));

const sock = makeWASocket({
	version,
	auth: state,
	logger: pino({ level: 'warn' }),
	browser: ['OTS CRM test', 'Chrome', '1.0'],
	printQRInTerminal: false,
	syncFullHistory: false,
	markOnlineOnConnect: false
});

console.log('[TEST] Socket created, waiting for events...');

sock.ev.on('creds.update', saveCreds);

sock.ev.on('connection.update', (update) => {
	const { connection, lastDisconnect, qr } = update;
	if (qr) {
		console.log('\n[TEST] ✓ QR RECEIVED (length:', qr.length, '):');
		console.log(qr.slice(0, 80) + '...');
		console.log('[TEST] QR generation works! Exiting.');
		setTimeout(() => process.exit(0), 500);
	}
	if (connection === 'connecting') console.log('[TEST] connection: connecting');
	if (connection === 'open') {
		console.log('[TEST] connection: OPEN — user:', sock.user?.id);
		process.exit(0);
	}
	if (connection === 'close') {
		const code = (lastDisconnect?.error as { output?: { statusCode?: number } } | undefined)?.output?.statusCode;
		const msg = lastDisconnect?.error instanceof Error ? lastDisconnect.error.message : String(lastDisconnect?.error);
		console.log('[TEST] connection: close — code:', code, 'msg:', msg);
		process.exit(1);
	}
});

// Fallback timeout — 30s to get a QR
setTimeout(() => {
	console.error('[TEST] ✗ No QR event within 30s — Baileys is stuck or network problem');
	process.exit(2);
}, 30_000);
