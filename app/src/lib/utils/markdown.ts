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

/**
 * Render markdown for comments (single newlines become <br>, @mentions highlighted)
 */
export function renderCommentMarkdown(markdown: string): string {
	if (!markdown) return '';
	// Highlight @mentions before markdown parsing
	const withMentions = markdown.replace(/(^|[\s\n])@([\w\u00C0-\u024F]+(?:\s[\w\u00C0-\u024F]+)?)/g,
		'$1<span class="mention">@$2</span>'
	);
	return marked.parse(withMentions, { breaks: true }) as string;
}
