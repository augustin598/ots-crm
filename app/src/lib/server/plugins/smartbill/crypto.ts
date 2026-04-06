import { createCipheriv, createDecipheriv, randomBytes, pbkdf2Sync, createHash } from 'crypto';
import { env } from '$env/dynamic/private';

/**
 * Typed error for decryption failures - allows callers to distinguish
 * credential corruption from other errors and handle gracefully.
 */
export class DecryptionError extends Error {
	constructor(message: string, public readonly cause?: unknown) {
		super(message);
		this.name = 'DecryptionError';
	}
}

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;
const SALT_LENGTH = 32;
const KEY_LENGTH = 32;
const ITERATIONS = 100000;

/**
 * Cached fingerprint of the encryption secret — detects runtime changes
 * that would make all encrypted data unreadable.
 */
let cachedSecretFingerprint: string | null = null;

/**
 * Get encryption secret from environment
 */
function getEncryptionSecret(): string {
	const secret = env.ENCRYPTION_SECRET;
	if (!secret) {
		throw new Error('ENCRYPTION_SECRET environment variable is not set');
	}
	const fingerprint = createHash('sha256').update(secret).digest('hex').slice(0, 8);
	if (!cachedSecretFingerprint) {
		console.info(`[CRYPTO] ENCRYPTION_SECRET loaded — fingerprint: ${fingerprint}, length: ${secret.length}`);
	} else if (cachedSecretFingerprint !== fingerprint) {
		console.error(
			`[CRYPTO] ENCRYPTION_SECRET changed at runtime! Old fingerprint: ${cachedSecretFingerprint}, New: ${fingerprint}. All previously encrypted data is now unreadable.`
		);
	}
	cachedSecretFingerprint = fingerprint;
	return secret;
}

/**
 * Derive encryption key from tenant ID and secret
 */
function deriveKey(tenantId: string, secret: string): Buffer {
	const salt = pbkdf2Sync(secret, tenantId, 1000, SALT_LENGTH, 'sha256');
	return pbkdf2Sync(secret, salt.toString('hex'), ITERATIONS, KEY_LENGTH, 'sha256');
}

/**
 * Encrypt data for a specific tenant
 */
export function encrypt(tenantId: string, data: string): string {
	const secret = getEncryptionSecret();
	const key = deriveKey(tenantId, secret);
	const iv = randomBytes(IV_LENGTH);
	const cipher = createCipheriv(ALGORITHM, key, iv);

	let encrypted = cipher.update(data, 'utf8', 'hex');
	encrypted += cipher.final('hex');

	const tag = cipher.getAuthTag();

	// Return format: iv:tag:encrypted
	return `${iv.toString('hex')}:${tag.toString('hex')}:${encrypted}`;
}

/**
 * Encrypt and immediately verify decryption round-trip.
 * Prevents storing corrupted ciphertext that can't be decrypted later.
 */
export function encryptVerified(tenantId: string, data: string): string {
	const encrypted = encrypt(tenantId, data);
	const decrypted = decrypt(tenantId, encrypted);
	if (decrypted !== data) {
		throw new Error('Encryption round-trip verification failed');
	}
	return encrypted;
}

/**
 * Decrypt data for a specific tenant
 */
export function decrypt(tenantId: string, encryptedData: string): string {
	const secret = getEncryptionSecret();
	const key = deriveKey(tenantId, secret);

	const parts = encryptedData.split(':');
	if (parts.length !== 3) {
		throw new DecryptionError(`Invalid encrypted data format: expected 3 parts, got ${parts.length}`);
	}

	const [ivHex, tagHex, encrypted] = parts;
	const iv = Buffer.from(ivHex, 'hex');
	const tag = Buffer.from(tagHex, 'hex');

	const decipher = createDecipheriv(ALGORITHM, key, iv);
	decipher.setAuthTag(tag);

	try {
		let decrypted = decipher.update(encrypted, 'hex', 'utf8');
		decrypted += decipher.final('utf8');
		return decrypted;
	} catch (error) {
		throw new DecryptionError(
			error instanceof Error ? error.message : String(error),
			error
		);
	}
}
