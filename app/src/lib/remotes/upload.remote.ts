import { command } from '$app/server';
import * as v from 'valibot';
import { env } from '$env/dynamic/private';
import { Client } from 'minio';

/**
 * Initialize MinIO client
 */
function getMinioClient() {
	if (!env.MINIO_ENDPOINT || !env.MINIO_ACCESS_KEY || !env.MINIO_SECRET_KEY) {
		throw new Error(
			'MinIO configuration is missing. Please set MINIO_ENDPOINT, MINIO_ACCESS_KEY, and MINIO_SECRET_KEY environment variables.'
		);
	}

	return new Client({
		endPoint: env.MINIO_ENDPOINT,
		port: env.MINIO_PORT ? parseInt(env.MINIO_PORT) : 9000,
		useSSL: env.MINIO_USE_SSL === 'true',
		accessKey: env.MINIO_ACCESS_KEY,
		secretKey: env.MINIO_SECRET_KEY
	});
}

/**
 * Upload an image file to MinIO S3
 * Accepts base64-encoded file data since File objects don't serialize over remote functions
 */
export const uploadImage = command(
	v.object({
		fileData: v.string(), // base64-encoded file data
		fileName: v.string(),
		fileType: v.string(),
		folder: v.optional(v.string(), 'products')
	}),
	async ({ fileData, fileName: originalFileName, fileType, folder }) => {
		// Validate file type
		if (!fileType.startsWith('image/')) {
			throw new Error('File must be an image');
		}

		// Decode base64 data
		const base64Data = fileData.replace(/^data:image\/\w+;base64,/, '');
		const buffer = Buffer.from(base64Data, 'base64');

		// Validate file size (max 10MB)
		const maxSize = 10 * 1024 * 1024; // 10MB
		if (buffer.length > maxSize) {
			throw new Error('File size must be less than 10MB');
		}

		const minioClient = getMinioClient();
		const bucketName = env.MINIO_BUCKET_NAME || 'dafour';

		// Ensure bucket exists
		const bucketExists = await minioClient.bucketExists(bucketName);
		if (!bucketExists) {
			await minioClient.makeBucket(bucketName, env.MINIO_REGION || 'us-east-1');
		}

		// Generate unique filename
		const timestamp = Date.now();
		const randomString = Math.random().toString(36).substring(2, 15);
		const fileExtension = originalFileName.split('.').pop() || 'jpg';
		const fileName = `${folder}/${timestamp}-${randomString}.${fileExtension}`;

		// Upload to MinIO
		await minioClient.putObject(bucketName, fileName, buffer, buffer.length, {
			'Content-Type': fileType
		});

		// Construct public URL
		// If MINIO_PUBLIC_URL is set, use it; otherwise construct from endpoint
		const publicUrl = env.MINIO_PUBLIC_URL
			? `${env.MINIO_PUBLIC_URL}/${bucketName}/${fileName}`
			: `${env.MINIO_USE_SSL === 'true' ? 'https' : 'http'}://${env.MINIO_ENDPOINT}:${env.MINIO_PORT || 9000}/${bucketName}/${fileName}`;

		return {
			url: publicUrl,
			fileName,
			bucketName
		};
	}
);
