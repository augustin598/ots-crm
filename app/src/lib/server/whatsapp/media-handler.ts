import { downloadMediaMessage, type WAMessage } from 'baileys';
import pino from 'pino';
import { putStable, getIfExists } from './minio-helpers';
import { logError, logInfo } from '$lib/server/logger';

const SILENT_LOGGER = pino({ level: 'silent' });

export type MediaKind = 'image' | 'video' | 'audio' | 'document' | 'sticker';

export interface MediaInfo {
	kind: MediaKind;
	mimeType: string | null;
	fileName: string | null;
}

export function detectMedia(msg: WAMessage): MediaInfo | null {
	const m = msg.message;
	if (!m) return null;

	// Unwrap common wrappers
	const core =
		m.ephemeralMessage?.message ??
		m.viewOnceMessage?.message ??
		m.viewOnceMessageV2?.message ??
		m.documentWithCaptionMessage?.message ??
		m;

	if (core.imageMessage) {
		return { kind: 'image', mimeType: core.imageMessage.mimetype ?? 'image/jpeg', fileName: null };
	}
	if (core.videoMessage) {
		return { kind: 'video', mimeType: core.videoMessage.mimetype ?? 'video/mp4', fileName: null };
	}
	if (core.audioMessage) {
		return { kind: 'audio', mimeType: core.audioMessage.mimetype ?? 'audio/ogg', fileName: null };
	}
	if (core.documentMessage) {
		return {
			kind: 'document',
			mimeType: core.documentMessage.mimetype ?? 'application/octet-stream',
			fileName: core.documentMessage.fileName ?? core.documentMessage.title ?? null
		};
	}
	if (core.stickerMessage) {
		return { kind: 'sticker', mimeType: core.stickerMessage.mimetype ?? 'image/webp', fileName: null };
	}
	return null;
}

function extForMime(mime: string): string {
	const mapping: Record<string, string> = {
		'image/jpeg': 'jpg',
		'image/png': 'png',
		'image/webp': 'webp',
		'image/gif': 'gif',
		'video/mp4': 'mp4',
		'video/webm': 'webm',
		'audio/ogg': 'ogg',
		'audio/mp4': 'm4a',
		'audio/mpeg': 'mp3',
		'audio/wav': 'wav',
		'application/pdf': 'pdf',
		'application/msword': 'doc',
		'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
		'application/vnd.ms-excel': 'xls',
		'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx'
	};
	return mapping[mime.toLowerCase()] ?? 'bin';
}

export function buildMediaKey(tenantId: string, wamId: string, info: MediaInfo): string {
	const safeId = wamId.replace(/[^A-Za-z0-9_-]/g, '_');
	const ext = info.fileName?.includes('.')
		? info.fileName.split('.').pop() ?? extForMime(info.mimeType ?? '')
		: extForMime(info.mimeType ?? '');
	return `${tenantId}/whatsapp/media/${safeId}.${ext}`;
}

export async function downloadAndStoreMedia(
	tenantId: string,
	msg: WAMessage,
	info: MediaInfo
): Promise<{ path: string; sizeBytes: number } | null> {
	const wamId = msg.key?.id;
	if (!wamId) return null;

	try {
		const buffer = (await downloadMediaMessage(
			msg,
			'buffer',
			{},
			{ logger: SILENT_LOGGER, reuploadRequest: undefined as never }
		)) as Buffer;

		if (!buffer || buffer.length === 0) {
			logInfo('whatsapp', 'Media download returned empty buffer', {
				tenantId,
				metadata: { wamId, mime: info.mimeType, kind: info.kind }
			});
			return null;
		}

		const key = buildMediaKey(tenantId, wamId, info);
		await putStable(key, buffer, info.mimeType ?? 'application/octet-stream');
		logInfo('whatsapp', `Media stored (${info.kind})`, {
			tenantId,
			metadata: { wamId, kind: info.kind, size: buffer.length, key }
		});
		return { path: key, sizeBytes: buffer.length };
	} catch (err) {
		logError('whatsapp', 'Failed to download/store media', {
			tenantId,
			metadata: { wamId, err: err instanceof Error ? err.message : String(err) }
		});
		return null;
	}
}

export async function loadMediaBuffer(path: string): Promise<Buffer | null> {
	return getIfExists(path);
}
