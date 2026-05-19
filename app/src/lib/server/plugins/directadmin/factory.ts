import { DirectAdminClient } from './client';
import { decrypt } from '../smartbill/crypto';

export interface EncryptedServerCreds {
	hostname: string;
	port: number | null;
	useHttps?: boolean | null;
	usernameEncrypted: string;
	passwordEncrypted: string;
}

/**
 * Create a DirectAdmin client from an encrypted server record.
 * Decrypts credentials using the per-tenant AES-256-GCM scheme.
 * Defaults port to 2222 (DirectAdmin standard) if missing; defaults to HTTPS.
 *
 * `timeoutMs` lets callers shorten the request timeout for high-frequency,
 * best-effort reads (e.g. live metrics on page load) so dead servers don't
 * stall the request for the default 10s.
 */
export function createDAClient(
	tenantId: string,
	server: EncryptedServerCreds,
	options: { timeoutMs?: number } = {}
): DirectAdminClient {
	const username = decrypt(tenantId, server.usernameEncrypted);
	const password = decrypt(tenantId, server.passwordEncrypted);
	return new DirectAdminClient({
		hostname: server.hostname,
		port: server.port ?? 2222,
		useHttps: server.useHttps !== false,
		username,
		password,
		timeoutMs: options.timeoutMs
	});
}
