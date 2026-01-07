import { db } from '../db';
import * as table from '../db/schema';
import { eq } from 'drizzle-orm';

/**
 * Generate a URL-friendly slug from a string
 */
export function generateSlug(text: string): string {
	return (
		text
			.toLowerCase()
			.trim()
			// Replace spaces and underscores with hyphens
			.replace(/[\s_]+/g, '-')
			// Remove special characters except hyphens
			.replace(/[^\w\-]+/g, '')
			// Remove multiple consecutive hyphens
			.replace(/-+/g, '-')
			// Remove leading/trailing hyphens
			.replace(/^-+|-+$/g, '')
			// Limit length
			.slice(0, 255)
	);
}
