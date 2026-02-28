import { env } from '$env/dynamic/private';
import { Client as MinioClient } from 'minio';

let minioClient: MinioClient | null = null;

function getMinioClient(): MinioClient {
	if (!minioClient) {
		const endpoint = env.MINIO_ENDPOINT || 'localhost';
		const port = parseInt(env.MINIO_PORT || '9000');
		const useSSL = env.MINIO_USE_SSL === 'true';
		const accessKey = env.MINIO_ACCESS_KEY || 'minioadmin';
		const secretKey = env.MINIO_SECRET_KEY || 'minioadmin';

		minioClient = new MinioClient({
			endPoint: endpoint,
			port,
			useSSL,
			accessKey,
			secretKey
		});
	}

	return minioClient;
}

const BUCKET_NAME = env.MINIO_BUCKET_NAME || 'crm-documents';

/**
 * Ensure bucket exists
 */
export async function ensureBucket() {
	try {
		const client = getMinioClient();
		const exists = await client.bucketExists(BUCKET_NAME);
		if (!exists) {
			await client.makeBucket(BUCKET_NAME);
		}
	} catch (error) {
		console.error('Error ensuring bucket:', error);
		throw error;
	}
}

/**
 * Upload a file to MinIO
 */
export async function uploadFile(
	tenantId: string,
	file: File,
	metadata?: Record<string, string>
): Promise<{ path: string; size: number; mimeType: string }> {
	try {
		await ensureBucket();

		const client = getMinioClient();
		const fileName = `${tenantId}/${Date.now()}-${file.name}`;
		const buffer = Buffer.from(await file.arrayBuffer());

		await client.putObject(BUCKET_NAME, fileName, buffer, buffer.length, {
			'Content-Type': file.type,
			...metadata
		});

		return {
			path: fileName,
			size: file.size,
			mimeType: file.type
		};
	} catch (error) {
		console.error('Error uploading file:', error);
		throw error;
	}
}

/**
 * Get a presigned URL for downloading a file
 */
export async function getDownloadUrl(filePath: string, expirySeconds = 3600): Promise<string> {
	try {
		const client = getMinioClient();
		return await client.presignedGetObject(BUCKET_NAME, filePath, expirySeconds);
	} catch (error) {
		console.error('Error generating download URL:', error);
		throw error;
	}
}

/**
 * Upload a buffer to MinIO
 */
export async function uploadBuffer(
	tenantId: string,
	buffer: Buffer,
	fileName: string,
	mimeType: string,
	metadata?: Record<string, string>
): Promise<{ path: string; size: number; mimeType: string }> {
	try {
		await ensureBucket();

		const client = getMinioClient();
		const filePath = `${tenantId}/${Date.now()}-${fileName}`;

		await client.putObject(BUCKET_NAME, filePath, buffer, buffer.length, {
			'Content-Type': mimeType,
			...metadata
		});

		return {
			path: filePath,
			size: buffer.length,
			mimeType
		};
	} catch (error) {
		console.error('Error uploading buffer:', error);
		throw error;
	}
}

/**
 * Get file contents as a Buffer from MinIO
 */
export async function getFileBuffer(filePath: string): Promise<Buffer> {
	try {
		const client = getMinioClient();
		const stream = await client.getObject(BUCKET_NAME, filePath);
		const chunks: Buffer[] = [];
		for await (const chunk of stream) {
			chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
		}
		return Buffer.concat(chunks);
	} catch (error) {
		console.error('Error getting file buffer:', error);
		throw error;
	}
}

/**
 * Delete a file from MinIO
 */
export async function deleteFile(filePath: string): Promise<void> {
	try {
		const client = getMinioClient();
		await client.removeObject(BUCKET_NAME, filePath);
	} catch (error) {
		console.error('Error deleting file:', error);
		throw error;
	}
}
