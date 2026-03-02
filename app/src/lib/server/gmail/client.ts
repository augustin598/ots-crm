import { google } from 'googleapis';
import type { gmail_v1 } from 'googleapis';
import { getAuthenticatedClient } from './auth';

export interface GmailMessage {
	id: string;
	threadId: string;
	from: string;
	subject: string;
	date: Date;
	body: string;
	attachments: GmailAttachment[];
}

export interface GmailAttachment {
	id: string;
	filename: string;
	mimeType: string;
	size: number;
}

/**
 * Search emails in Gmail using Gmail search syntax
 */
export async function searchEmails(
	tenantId: string,
	query: string,
	maxResults: number = 50
): Promise<Array<{ id: string; threadId: string }>> {
	const auth = await getAuthenticatedClient(tenantId);
	if (!auth) throw new Error('Gmail not connected');

	const gmail = google.gmail({ version: 'v1', auth });
	const res = await gmail.users.messages.list({
		userId: 'me',
		q: query,
		maxResults
	});

	return (res.data.messages || []).map((m) => ({
		id: m.id!,
		threadId: m.threadId!
	}));
}

/**
 * Get full email details including headers and attachment info
 */
export async function getEmail(tenantId: string, messageId: string): Promise<GmailMessage> {
	const auth = await getAuthenticatedClient(tenantId);
	if (!auth) throw new Error('Gmail not connected');

	const gmail = google.gmail({ version: 'v1', auth });
	const res = await gmail.users.messages.get({
		userId: 'me',
		id: messageId,
		format: 'full'
	});

	const headers = res.data.payload?.headers || [];
	const getHeader = (name: string) =>
		headers.find((h) => h.name?.toLowerCase() === name.toLowerCase())?.value || '';

	const from = getHeader('From');
	const subject = getHeader('Subject');
	const dateStr = getHeader('Date');
	const date = dateStr ? new Date(dateStr) : new Date();

	const body = extractBody(res.data.payload);
	const attachments = extractAttachmentInfo(res.data.payload);

	return {
		id: messageId,
		threadId: res.data.threadId || '',
		from,
		subject,
		date,
		body,
		attachments
	};
}

/**
 * Download an attachment from Gmail
 */
export async function getAttachment(
	tenantId: string,
	messageId: string,
	attachmentId: string
): Promise<Buffer> {
	const auth = await getAuthenticatedClient(tenantId);
	if (!auth) throw new Error('Gmail not connected');

	const gmail = google.gmail({ version: 'v1', auth });
	const res = await gmail.users.messages.attachments.get({
		userId: 'me',
		messageId,
		id: attachmentId
	});

	const data = res.data.data;
	if (!data) throw new Error('Attachment data is empty');

	// Gmail API returns base64url encoded data
	return Buffer.from(data, 'base64url');
}

/**
 * Extract plain text body from email payload
 */
function extractBody(payload: gmail_v1.Schema$MessagePart | undefined): string {
	if (!payload) return '';

	// Direct body
	if (payload.mimeType === 'text/plain' && payload.body?.data) {
		return Buffer.from(payload.body.data, 'base64url').toString('utf-8');
	}

	// Check parts recursively
	if (payload.parts) {
		for (const part of payload.parts) {
			if (part.mimeType === 'text/plain' && part.body?.data) {
				return Buffer.from(part.body.data, 'base64url').toString('utf-8');
			}
		}
		// If no plain text, try HTML
		for (const part of payload.parts) {
			if (part.mimeType === 'text/html' && part.body?.data) {
				return Buffer.from(part.body.data, 'base64url').toString('utf-8');
			}
		}
		// Recursive for multipart
		for (const part of payload.parts) {
			const result = extractBody(part);
			if (result) return result;
		}
	}

	return '';
}

/**
 * Extract attachment metadata from email payload
 */
function extractAttachmentInfo(
	payload: gmail_v1.Schema$MessagePart | undefined
): GmailAttachment[] {
	const attachments: GmailAttachment[] = [];
	if (!payload) return attachments;

	function walk(part: gmail_v1.Schema$MessagePart) {
		if (part.filename && part.body?.attachmentId) {
			attachments.push({
				id: part.body.attachmentId,
				filename: part.filename,
				mimeType: part.mimeType || 'application/octet-stream',
				size: part.body.size || 0
			});
		}
		if (part.parts) {
			for (const child of part.parts) {
				walk(child);
			}
		}
	}

	walk(payload);
	return attachments;
}
