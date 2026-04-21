import { env } from '$env/dynamic/private';
import { Client as MinioClient } from 'minio';

let client: MinioClient | null = null;

export function getMinio(): MinioClient {
	if (!client) {
		client = new MinioClient({
			endPoint: env.MINIO_ENDPOINT || 'localhost',
			port: parseInt(env.MINIO_PORT || '9000', 10),
			useSSL: env.MINIO_USE_SSL === 'true',
			accessKey: env.MINIO_ACCESS_KEY || 'minioadmin',
			secretKey: env.MINIO_SECRET_KEY || 'minioadmin'
		});
	}
	return client;
}

export function getBucket(): string {
	return env.MINIO_BUCKET_NAME || 'crm-documents';
}

export async function putStable(key: string, data: Buffer | string, mimeType = 'application/octet-stream'): Promise<void> {
	const buf = typeof data === 'string' ? Buffer.from(data, 'utf8') : data;
	await getMinio().putObject(getBucket(), key, buf, buf.length, { 'Content-Type': mimeType });
}

export async function getIfExists(key: string): Promise<Buffer | null> {
	try {
		const stream = await getMinio().getObject(getBucket(), key);
		const chunks: Buffer[] = [];
		for await (const chunk of stream) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
		return Buffer.concat(chunks);
	} catch (err) {
		const code = (err as { code?: string }).code;
		if (code === 'NoSuchKey' || code === 'NotFound') return null;
		throw err;
	}
}

export async function removeIfExists(key: string): Promise<void> {
	try {
		await getMinio().removeObject(getBucket(), key);
	} catch (err) {
		const code = (err as { code?: string }).code;
		if (code === 'NoSuchKey' || code === 'NotFound') return;
		throw err;
	}
}

export async function removePrefix(prefix: string): Promise<void> {
	const bucket = getBucket();
	const minio = getMinio();
	const stream = minio.listObjectsV2(bucket, prefix, true);
	const toRemove: string[] = [];
	for await (const obj of stream) {
		if (obj.name) toRemove.push(obj.name);
	}
	if (toRemove.length > 0) await minio.removeObjects(bucket, toRemove);
}
