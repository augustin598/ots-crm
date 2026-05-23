/**
 * Escape user-provided strings for safe inclusion in HTML text contexts.
 * Use for all body-interpolated user data (domain, name, etc.) in templates.
 * NOT for attribute contexts (use a different escape for href values).
 */
export function escapeHtml(s: string): string {
	return s.replace(
		/[&<>"']/g,
		(c) =>
			({
				'&': '&amp;',
				'<': '&lt;',
				'>': '&gt;',
				'"': '&quot;',
				"'": '&#39;',
			})[c] as string,
	);
}
