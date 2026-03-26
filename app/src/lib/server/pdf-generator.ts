import PDFDocument from 'pdfkit';

export interface StylingConfig {
	primaryColor?: string;
	secondaryColor?: string;
	fontFamily?: string;
	fontSize?: number;
	header?: { content: string; height?: number };
	footer?: { content: string; height?: number };
}

/**
 * Converts HTML color to RGB array
 */
function hexToRgb(hex: string): [number, number, number] | null {
	if (!hex) return null;
	const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
	return result
		? [parseInt(result[1], 16), parseInt(result[2], 16), parseInt(result[3], 16)]
		: null;
}

/**
 * Parses simple HTML and extracts text content with basic formatting
 * This is a simplified HTML parser - for complex HTML, consider using a library
 */
function parseHTML(html: string): Array<{ text: string; bold?: boolean; fontSize?: number }> {
	// Remove script and style tags
	html = html.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '');
	html = html.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '');

	const result: Array<{ text: string; bold?: boolean; fontSize?: number }> = [];
	let currentText = '';
	let inBold = false;

	// Simple regex-based parsing for common HTML tags
	const tagRegex = /<(\/?)(\w+)[^>]*>/g;
	let lastIndex = 0;
	let match;

	while ((match = tagRegex.exec(html)) !== null) {
		// Add text before tag
		if (match.index > lastIndex) {
			const text = html.substring(lastIndex, match.index).trim();
			if (text) {
				result.push({ text, bold: inBold });
			}
		}

		const isClosing = match[1] === '/';
		const tagName = match[2].toLowerCase();

		if (tagName === 'b' || tagName === 'strong') {
			inBold = !isClosing;
		} else if (tagName === 'br' || tagName === 'p') {
			if (currentText) {
				result.push({ text: currentText, bold: inBold });
				currentText = '';
			}
			result.push({ text: '\n' });
		} else if (tagName === 'h1' || tagName === 'h2' || tagName === 'h3') {
			if (currentText) {
				result.push({ text: currentText, bold: inBold });
				currentText = '';
			}
			if (!isClosing) {
				const fontSize = tagName === 'h1' ? 24 : tagName === 'h2' ? 20 : 18;
				result.push({ text: '\n', fontSize });
			}
		}

		lastIndex = match.index + match[0].length;
	}

	// Add remaining text
	if (lastIndex < html.length) {
		const text = html
			.substring(lastIndex)
			.replace(/<[^>]*>/g, '')
			.trim();
		if (text) {
			result.push({ text, bold: inBold });
		}
	}

	return result;
}

/**
 * Generates PDF from HTML content using PDFKit
 */
export async function generatePDFFromHTML(
	htmlContent: string,
	options: {
		header?: string;
		footer?: string;
		styling?: StylingConfig;
	} = {}
): Promise<Buffer> {
	return new Promise((resolve, reject) => {
		try {
			const doc = new PDFDocument({
				size: 'A4',
				margins: { top: 50, bottom: 50, left: 50, right: 50 }
			});

			const buffers: Buffer[] = [];

			doc.on('data', (chunk: Buffer) => {
				buffers.push(chunk);
			});

			doc.on('end', () => {
				resolve(Buffer.concat(buffers));
			});

			doc.on('error', (error) => {
				reject(error);
			});

			const { styling = {}, header, footer } = options;
			const primaryColor = styling?.primaryColor || '#000000';
			const secondaryColor = styling?.secondaryColor || '#666666';
			const fontFamily = styling?.fontFamily || 'Helvetica';
			const baseFontSize = styling?.fontSize || 12;

			// Set up colors
			const primaryRgb = hexToRgb(primaryColor) || [0, 0, 0];
			const secondaryRgb = hexToRgb(secondaryColor) || [100, 100, 100];

			// Add header if provided
			if (header) {
				const headerHeight = styling.header?.height || 30;
				doc
					.fontSize(10)
					.fillColor(secondaryRgb as any)
					.text(header, 50, 20, { align: 'center', width: doc.page.width - 100 });
			}

			// Parse and render HTML content
			const parsedContent = parseHTML(htmlContent);
			let yPosition = header ? 60 : 50;

			for (const item of parsedContent) {
				if (item.text === '\n') {
					yPosition += baseFontSize * 1.5;
					// Check if we need a new page
					if (yPosition > doc.page.height - 100) {
						doc.addPage();
						yPosition = header ? 60 : 50;
					}
					continue;
				}

				const fontSize = item.fontSize || baseFontSize;
				const color = item.bold ? primaryRgb : secondaryRgb;

				doc
					.fontSize(fontSize)
					.fillColor(color as any)
					.font(item.bold ? `${fontFamily}-Bold` : fontFamily)
					.text(item.text, 50, yPosition, {
						width: doc.page.width - 100,
						align: 'left'
					});

				// Calculate height of text block
				const textHeight = doc.heightOfString(item.text, {
					width: doc.page.width - 100
				});
				yPosition += textHeight + 5;

				// Check if we need a new page
				if (yPosition > doc.page.height - 100) {
					doc.addPage();
					yPosition = header ? 60 : 50;
				}
			}

			// Add footer to each page
			if (footer) {
				// Footer will be added via pageAdded event
				doc.on('pageAdded', () => {
					const footerY = doc.page.height - 40;
					doc
						.fontSize(8)
						.fillColor(secondaryRgb as any)
						.text(footer, 50, footerY, {
							align: 'center',
							width: doc.page.width - 100
						});
				});

				// Add footer to first page
				const footerY = doc.page.height - 40;
				doc
					.fontSize(8)
					.fillColor(secondaryRgb as any)
					.text(footer, 50, footerY, {
						align: 'center',
						width: doc.page.width - 100
					});
			}

			doc.end();
		} catch (error) {
			reject(error);
		}
	});
}

/**
 * Generates PDF from plain text content
 */
export async function generatePDFFromText(
	textContent: string,
	options: {
		header?: string;
		footer?: string;
		styling?: StylingConfig;
	} = {}
): Promise<Buffer> {
	return generatePDFFromHTML(`<p>${textContent.replace(/\n/g, '</p><p>')}</p>`, options);
}
