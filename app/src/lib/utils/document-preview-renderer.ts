import { replaceVariables, type VariableMap } from './document-variables';
import type { DocumentTemplate } from '$lib/server/db/schema';
import { marked } from 'marked';

/**
 * Converts markdown to HTML
 */
function markdownToHtml(markdown: string): string {
	try {
		return marked(markdown) as string;
	} catch (e) {
		return `<p class="text-red-500">Error parsing markdown: ${e instanceof Error ? e.message : 'Unknown error'}</p>`;
	}
}

/**
 * Renders document preview with variable replacement and styling
 */
export function renderDocumentPreview(
	template: DocumentTemplate,
	variables: VariableMap
): string {
	// Replace variables in content first
	let contentWithVariables = replaceVariables(template.content, variables);
	
	// Convert markdown to HTML
	let rendered = markdownToHtml(contentWithVariables);

	// Apply styling wrapper
	if (template.styling) {
		const styling = template.styling as {
			primaryColor?: string;
			secondaryColor?: string;
			fontFamily?: string;
			fontSize?: string;
			header?: { content: string; height?: number };
			footer?: { content: string; height?: number };
		};

		const styles: string[] = [];
		if (styling.primaryColor) {
			styles.push(`--primary-color: ${styling.primaryColor}`);
			styles.push(`color: ${styling.primaryColor}`);
		}
		if (styling.secondaryColor) {
			styles.push(`--secondary-color: ${styling.secondaryColor}`);
		}
		if (styling.fontFamily) {
			styles.push(`font-family: ${styling.fontFamily}`);
		}
		if (styling.fontSize) {
			styles.push(`font-size: ${styling.fontSize}`);
		}

		// Build wrapper HTML
		let wrapper = '<div class="document-preview"';
		if (styles.length > 0) {
			wrapper += ` style="${styles.join('; ')}"`;
		}
		wrapper += '>';

		// Add header if present
		if (styling.header?.content) {
			const headerContent = replaceVariables(styling.header.content, variables);
			wrapper += `<header class="document-header" style="height: ${styling.header.height || 60}px; padding: 20px; border-bottom: 1px solid #eee;">${headerContent}</header>`;
		}

		// Add main content (rendered is already HTML from markdown conversion)
		wrapper += `<main class="document-content" style="padding: 20px; min-height: 400px;">${rendered}</main>`;

		// Add footer if present
		if (styling.footer?.content) {
			const footerContent = replaceVariables(styling.footer.content, variables);
			wrapper += `<footer class="document-footer" style="height: ${styling.footer.height || 60}px; padding: 20px; border-top: 1px solid #eee; margin-top: auto;">${footerContent}</footer>`;
		}

		wrapper += '</div>';

		// Add CSS for styling
		const css = `
			<style>
				.document-preview {
					max-width: 800px;
					margin: 0 auto;
					background: white;
					box-shadow: 0 2px 8px rgba(0,0,0,0.1);
					min-height: 100vh;
					display: flex;
					flex-direction: column;
				}
				.document-header {
					background-color: var(--secondary-color, #f5f5f5);
				}
				.document-content {
					flex: 1;
				}
				.document-footer {
					background-color: var(--secondary-color, #f5f5f5);
				}
				.document-preview h1, .document-preview h2, .document-preview h3 {
					color: var(--primary-color, inherit);
				}
			</style>
		`;

		return css + wrapper;
	}

	// If no styling, just return the rendered HTML
	return rendered;
}
