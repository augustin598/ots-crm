/**
 * Mapping of Meta/Google/TikTok conversion result types to display config.
 * Used in cross-platform comparison tables and breakdown rows.
 *
 * Icon keys map to Lucide icon names.
 */

export interface ConversionTypeConfig {
	icon: string;
	color: string;
	label: string;
}

const CONFIG: Record<string, ConversionTypeConfig> = {
	// Purchases / Sales
	'Purchases': { icon: 'shopping-cart', color: 'text-green-600 bg-green-100 dark:text-green-400 dark:bg-green-900/30', label: 'Achiziții' },
	'Purchase': { icon: 'shopping-cart', color: 'text-green-600 bg-green-100 dark:text-green-400 dark:bg-green-900/30', label: 'Achiziție' },
	'Achiziție': { icon: 'shopping-cart', color: 'text-green-600 bg-green-100 dark:text-green-400 dark:bg-green-900/30', label: 'Achiziție' },

	// Leads
	'Leads': { icon: 'users', color: 'text-blue-600 bg-blue-100 dark:text-blue-400 dark:bg-blue-900/30', label: 'Leads' },
	'Lead': { icon: 'users', color: 'text-blue-600 bg-blue-100 dark:text-blue-400 dark:bg-blue-900/30', label: 'Lead' },

	// Calls
	'Calls placed': { icon: 'phone', color: 'text-amber-600 bg-amber-100 dark:text-amber-400 dark:bg-amber-900/30', label: 'Apeluri' },

	// Link clicks / Traffic
	'Link clicks': { icon: 'mouse-pointer-click', color: 'text-orange-600 bg-orange-100 dark:text-orange-400 dark:bg-orange-900/30', label: 'Link clicks' },
	'Landing page views': { icon: 'file-text', color: 'text-teal-600 bg-teal-100 dark:text-teal-400 dark:bg-teal-900/30', label: 'Landing page views' },

	// Engagement
	'Engagement': { icon: 'heart', color: 'text-pink-600 bg-pink-100 dark:text-pink-400 dark:bg-pink-900/30', label: 'Engagement' },
	'Post engagement': { icon: 'heart', color: 'text-pink-600 bg-pink-100 dark:text-pink-400 dark:bg-pink-900/30', label: 'Post engagement' },
	'Page engagement': { icon: 'thumbs-up', color: 'text-pink-600 bg-pink-100 dark:text-pink-400 dark:bg-pink-900/30', label: 'Page engagement' },

	// Video
	'Video views': { icon: 'play', color: 'text-purple-600 bg-purple-100 dark:text-purple-400 dark:bg-purple-900/30', label: 'Video views' },
	'ThruPlay': { icon: 'play', color: 'text-purple-600 bg-purple-100 dark:text-purple-400 dark:bg-purple-900/30', label: 'ThruPlay' },

	// Messages / Conversations
	'Conversations': { icon: 'message-circle', color: 'text-violet-600 bg-violet-100 dark:text-violet-400 dark:bg-violet-900/30', label: 'Conversații' },
	'Messaging conversations started': { icon: 'message-circle', color: 'text-violet-600 bg-violet-100 dark:text-violet-400 dark:bg-violet-900/30', label: 'Conversații' },

	// App
	'App installs': { icon: 'download', color: 'text-indigo-600 bg-indigo-100 dark:text-indigo-400 dark:bg-indigo-900/30', label: 'App installs' },

	// Reach / Awareness
	'Reach': { icon: 'megaphone', color: 'text-cyan-600 bg-cyan-100 dark:text-cyan-400 dark:bg-cyan-900/30', label: 'Reach' },
	'Impressions': { icon: 'eye', color: 'text-cyan-600 bg-cyan-100 dark:text-cyan-400 dark:bg-cyan-900/30', label: 'Impresii' },

	// Registrations
	'Registrations': { icon: 'user-plus', color: 'text-blue-600 bg-blue-100 dark:text-blue-400 dark:bg-blue-900/30', label: 'Înregistrări' },
	'Complete Registration': { icon: 'user-plus', color: 'text-blue-600 bg-blue-100 dark:text-blue-400 dark:bg-blue-900/30', label: 'Înregistrări' },
};

const DEFAULT_CONFIG: ConversionTypeConfig = {
	icon: 'target',
	color: 'text-gray-600 bg-gray-100 dark:text-gray-400 dark:bg-gray-800',
	label: ''
};

/** Get display config for a conversion result type. Case-insensitive partial match. */
export function getConversionTypeConfig(resultType: string): ConversionTypeConfig {
	// Exact match
	if (CONFIG[resultType]) return CONFIG[resultType];

	// Case-insensitive match
	const lower = resultType.toLowerCase();
	for (const [key, config] of Object.entries(CONFIG)) {
		if (key.toLowerCase() === lower) return config;
	}

	// Partial match (e.g. "Post engagement" matches "engagement")
	for (const [key, config] of Object.entries(CONFIG)) {
		if (lower.includes(key.toLowerCase()) || key.toLowerCase().includes(lower)) return config;
	}

	return { ...DEFAULT_CONFIG, label: resultType };
}

/** Normalize and localize a raw result type from Meta API to Romanian display label */
export function localizeResultType(resultType: string): string {
	const config = getConversionTypeConfig(resultType);
	return config.label || resultType;
}
