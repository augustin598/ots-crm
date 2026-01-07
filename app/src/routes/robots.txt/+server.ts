import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import type { RequestHandler } from './$types';

/**
 * Generate robots.txt content based on PageSEO settings
 * Pages with showInSearchEngines=false or metaRobotsNoindex=true will be disallowed
 */
async function generateRobotsTxt(baseUrl: string): Promise<string> {
	const lines: string[] = [];

	// Fetch all pages and filter for disallowed ones
	// Pages are disallowed if showInSearchEngines is false OR metaRobotsNoindex is true
	const allPages = await db.select().from(table.pageSeo);
	const disallowedPaths = allPages
		.filter((page) => page.showInSearchEngines === false || page.metaRobotsNoindex === true)
		.map((page) => page.path);

	// Default user-agent: allow all by default
	lines.push('User-agent: *');

	// Add Disallow rules for pages that shouldn't be indexed
	if (disallowedPaths.length > 0) {
		// Group paths by language prefix if they exist
		const pathsToDisallow = new Set<string>();

		for (const path of disallowedPaths) {
			// Add the path as-is
			pathsToDisallow.add(path);

			// If path doesn't start with /, add it
			const normalizedPath = path.startsWith('/') ? path : `/${path}`;

			// Add language-specific paths
			pathsToDisallow.add(`/ro${normalizedPath === '/' ? '' : normalizedPath}`);
			pathsToDisallow.add(`/en${normalizedPath === '/' ? '' : normalizedPath}`);
		}

		// Sort paths for consistent output
		const sortedPaths = Array.from(pathsToDisallow).sort();

		for (const path of sortedPaths) {
			lines.push(`Disallow: ${path}`);
		}
	} else {
		// If no pages are disallowed, allow all
		lines.push('Allow: /');
	}

	// Add blank line before sitemap
	lines.push('');

	// Add sitemap reference
	lines.push(`Sitemap: ${baseUrl}/sitemap.xml`);

	return lines.join('\n');
}

export const GET: RequestHandler = async ({ url }) => {
	const baseUrl = url.origin;
	const robotsTxt = await generateRobotsTxt(baseUrl);

	// Cache robots.txt for 1 hour (3600 seconds)
	// It will be regenerated when SEO settings change
	return new Response(robotsTxt, {
		headers: {
			'Content-Type': 'text/plain; charset=utf-8',
			'Cache-Control': 'public, max-age=3600' // Browser cache for 1 hour
		}
	});
};
