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
 */
export function createDAClient(tenantId: string, server: EncryptedServerCreds): DirectAdminClient {
	const username = decrypt(tenantId, server.usernameEncrypted);
	const password = decrypt(tenantId, server.passwordEncrypted);
	return new DirectAdminClient({
		hostname: server.hostname,
		port: server.port ?? 2222,
		useHttps: server.useHttps !== false,
		username,
		password
	});
}
