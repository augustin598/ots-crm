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

/** Map Meta API action_type to display config (label + lucide icon name) */
const ACTION_TYPE_DISPLAY: Record<string, { label: string; icon: string }> = {
	'offsite_conversion.fb_pixel_purchase': { label: 'Website purchases', icon: 'shopping-cart' },
	'offsite_conversion.fb_pixel_lead': { label: 'Website leads', icon: 'users' },
	'offsite_conversion.fb_pixel_complete_registration': { label: 'Website registrations', icon: 'user-plus' },
	'offsite_conversion.fb_pixel_add_to_cart': { label: 'Website adds to cart', icon: 'shopping-bag' },
	'offsite_conversion.fb_pixel_add_to_wishlist': { label: 'Website adds to wishlist', icon: 'heart' },
	'offsite_conversion.fb_pixel_initiate_checkout': { label: 'Website checkouts initiated', icon: 'credit-card' },
	'offsite_conversion.fb_pixel_search': { label: 'Website searches', icon: 'search' },
	'offsite_conversion.fb_pixel_view_content': { label: 'Website content views', icon: 'eye' },
	'offsite_conversion.fb_pixel_add_payment_info': { label: 'Website payment info added', icon: 'credit-card' },
	'offsite_conversion.fb_pixel_custom': { label: 'Website custom conversions', icon: 'target' },
	// Skipped: 'purchase', 'lead', 'complete_registration' — duplicates of offsite_conversion.fb_pixel_* versions

	'link_click': { label: 'Link clicks', icon: 'mouse-pointer-click' },
	'landing_page_view': { label: 'Landing page views', icon: 'file-text' },
	'page_engagement': { label: 'Page engagement', icon: 'thumbs-up' },
	'post_engagement': { label: 'Post engagement', icon: 'heart' },
	'post_reaction': { label: 'Post reactions', icon: 'smile' },
	'comment': { label: 'Comments', icon: 'message-circle' },
	'onsite_conversion.post_save': { label: 'Post saves', icon: 'bookmark' },
	'post_share': { label: 'Post shares', icon: 'share-2' },
	'video_view': { label: 'Video views', icon: 'play' },
	'app_install': { label: 'App installs', icon: 'download' },
	'onsite_conversion.messaging_conversation_started_7d': { label: 'Messaging conversations', icon: 'message-circle' },
	'click_to_call_native_call_placed': { label: 'Calls placed', icon: 'phone' },
	'contact_total': { label: 'Contacts', icon: 'contact' },
};

/** Get display label for a Meta API action_type. Returns null if not a recognized type. */
export function getActionTypeLabel(actionType: string): string | null {
	return ACTION_TYPE_DISPLAY[actionType]?.label || null;
}

/** Action types relevant per Meta objective (matches Meta Ads Manager breakdown) */
const OBJECTIVE_ACTION_TYPES: Record<string, Set<string>> = {
	OUTCOME_SALES: new Set([
		'offsite_conversion.fb_pixel_purchase', 'purchase',
		'offsite_conversion.fb_pixel_add_to_cart',
		'offsite_conversion.fb_pixel_initiate_checkout',
		'offsite_conversion.fb_pixel_view_content',
		'offsite_conversion.fb_pixel_search',
		'offsite_conversion.fb_pixel_add_to_wishlist',
		'offsite_conversion.fb_pixel_add_payment_info'
	]),
	CONVERSIONS: new Set([
		'offsite_conversion.fb_pixel_purchase', 'purchase',
		'offsite_conversion.fb_pixel_add_to_cart',
		'offsite_conversion.fb_pixel_initiate_checkout',
		'offsite_conversion.fb_pixel_view_content',
		'offsite_conversion.fb_pixel_search'
	]),
	OUTCOME_LEADS: new Set([
		'offsite_conversion.fb_pixel_lead', 'lead',
		'offsite_conversion.fb_pixel_complete_registration', 'complete_registration',
		'landing_page_view', 'link_click'
	]),
	LEAD_GENERATION: new Set([
		'offsite_conversion.fb_pixel_lead', 'lead',
		'offsite_conversion.fb_pixel_complete_registration', 'complete_registration',
		'landing_page_view', 'link_click'
	]),
	OUTCOME_ENGAGEMENT: new Set([
		'page_engagement', 'post_engagement', 'post_reaction',
		'comment', 'onsite_conversion.post_save', 'post_share', 'video_view', 'like'
	]),
	POST_ENGAGEMENT: new Set([
		'page_engagement', 'post_engagement', 'post_reaction',
		'comment', 'onsite_conversion.post_save', 'post_share', 'video_view'
	]),
	OUTCOME_TRAFFIC: new Set([
		'link_click', 'landing_page_view',
		'offsite_conversion.fb_pixel_view_content'
	]),
	LINK_CLICKS: new Set([
		'link_click', 'landing_page_view'
	]),
	OUTCOME_AWARENESS: new Set([
		'video_view', 'link_click', 'page_engagement', 'post_engagement'
	]),
	REACH: new Set([
		'video_view', 'link_click', 'page_engagement'
	]),
	OUTCOME_APP_PROMOTION: new Set([
		'app_install', 'link_click'
	]),
	APP_INSTALLS: new Set([
		'app_install', 'link_click'
	])
};

/** Filter raw Meta actions to only relevant types for the campaign objective */
export function filterDisplayableActions(
	rawActions: Array<{ action_type: string; value: number }>,
	objective?: string
): Array<{ label: string; icon: string; value: number }> {
	const allowedTypes = objective ? OBJECTIVE_ACTION_TYPES[objective] : null;

	return rawActions
		.filter(a => {
			if (!ACTION_TYPE_DISPLAY[a.action_type]) return false;
			if (allowedTypes) return allowedTypes.has(a.action_type);
			return true;
		})
		.map(a => ({ label: ACTION_TYPE_DISPLAY[a.action_type].label, icon: ACTION_TYPE_DISPLAY[a.action_type].icon, value: a.value }))
		.sort((a, b) => b.value - a.value);
}
