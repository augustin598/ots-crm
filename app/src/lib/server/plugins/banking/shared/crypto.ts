/**
 * Encryption utilities for banking tokens
 * Uses tenant-specific encryption like SmartBill plugin
 */

import { createCipheriv, createDecipheriv, randomBytes, pbkdf2Sync } from 'crypto';
import { env } from '$env/dynamic/private';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;
const SALT_LENGTH = 32;
const TAG_LENGTH = 16;
const KEY_LENGTH = 32;
const ITERATIONS = 100000;

/**
 * Get encryption secret from environment
 */
function getEncryptionSecret(): string {
	const secret = env.BANKING_ENCRYPTION_KEY || env.ENCRYPTION_SECRET;
	if (!secret) {
		throw new Error('BANKING_ENCRYPTION_KEY or ENCRYPTION_SECRET environment variable is not set');
	}
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
 * Encrypt token for a specific tenant
 */
export function encryptToken(tenantId: string, data: string): string {
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
 * Decrypt token for a specific tenant
 */
export function decryptToken(tenantId: string, encryptedData: string): string {
	const secret = getEncryptionSecret();
	const key = deriveKey(tenantId, secret);

	const parts = encryptedData.split(':');
	if (parts.length !== 3) {
		throw new Error('Invalid encrypted data format');
	}

	const [ivHex, tagHex, encrypted] = parts;
	const iv = Buffer.from(ivHex, 'hex');
	const tag = Buffer.from(tagHex, 'hex');

	const decipher = createDecipheriv(ALGORITHM, key, iv);
	decipher.setAuthTag(tag);

	let decrypted = decipher.update(encrypted, 'hex', 'utf8');
	decrypted += decipher.final('utf8');

	return decrypted;
}
