import { marked } from 'marked';

// Configure marked for legal pages
marked.use({
	gfm: true, // GitHub Flavored Markdown
	breaks: false
});

/**
 * Render markdown content to HTML
 */
export function renderMarkdown(markdown: string): string {
	if (!markdown) return '';
	return marked.parse(markdown) as string;
}

