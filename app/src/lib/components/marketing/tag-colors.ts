export const TAG_COLORS = [
	{ id: 'red', label: 'Roșu', dot: 'bg-red-500', bg: 'bg-red-100 dark:bg-red-950', text: 'text-red-700 dark:text-red-300' },
	{ id: 'orange', label: 'Portocaliu', dot: 'bg-orange-500', bg: 'bg-orange-100 dark:bg-orange-950', text: 'text-orange-700 dark:text-orange-300' },
	{ id: 'yellow', label: 'Galben', dot: 'bg-yellow-500', bg: 'bg-yellow-100 dark:bg-yellow-950', text: 'text-yellow-700 dark:text-yellow-300' },
	{ id: 'green', label: 'Verde', dot: 'bg-green-500', bg: 'bg-green-100 dark:bg-green-950', text: 'text-green-700 dark:text-green-300' },
	{ id: 'blue', label: 'Albastru', dot: 'bg-blue-500', bg: 'bg-blue-100 dark:bg-blue-950', text: 'text-blue-700 dark:text-blue-300' },
	{ id: 'purple', label: 'Violet', dot: 'bg-purple-500', bg: 'bg-purple-100 dark:bg-purple-950', text: 'text-purple-700 dark:text-purple-300' },
	{ id: 'gray', label: 'Gri', dot: 'bg-gray-400', bg: 'bg-gray-100 dark:bg-gray-900', text: 'text-gray-600 dark:text-gray-400' }
] as const;

const VALID_IDS: Set<string> = new Set(TAG_COLORS.map((c) => c.id));

export type TagColorId = (typeof TAG_COLORS)[number]['id'];

export interface ColorTag {
	color: TagColorId;
	label: string;
}

export function getTagColor(id: string) {
	return TAG_COLORS.find((c) => c.id === id);
}

/**
 * Parse tags from DB string. Supports:
 * - New format: [{"color":"red","label":"website"}]
 * - Old format: ["red","blue"] (converts to {color, label: defaultLabel})
 */
export function parseColorTags(raw: string | null): ColorTag[] {
	if (!raw) return [];
	try {
		const parsed = JSON.parse(raw);
		if (!Array.isArray(parsed)) return [];
		// New object format
		if (parsed.length > 0 && typeof parsed[0] === 'object' && 'color' in parsed[0]) {
			return parsed.filter((t: any) => t.color && VALID_IDS.has(t.color)).map((t: any) => ({
				color: t.color as TagColorId,
				label: (t.label || '').trim()
			}));
		}
		// Old string array format: ["red", "blue"]
		return parsed
			.filter((t: unknown) => typeof t === 'string' && VALID_IDS.has(t as string))
			.map((id: string) => {
				const meta = getTagColor(id);
				return { color: id as TagColorId, label: meta?.label || id };
			});
	} catch {
		// not JSON
	}
	return [];
}

export function serializeColorTags(tags: ColorTag[] | string[] | string | null): string | null {
	if (!tags) return null;
	if (typeof tags === 'string') return null;
	if (!Array.isArray(tags)) return null;
	if (tags.length === 0) return null;
	// Handle ColorTag[] format
	const colorTags: ColorTag[] = tags
		.filter((t: any) => t && typeof t === 'object' && 'color' in t && VALID_IDS.has(t.color))
		.map((t: any) => ({ color: t.color, label: (t.label || '').trim() }));
	return colorTags.length > 0 ? JSON.stringify(colorTags) : null;
}
