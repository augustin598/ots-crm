#!/usr/bin/env node
// Convert downloaded Keez HTML docs to clean Markdown files
// Uses a simple regex-based HTML-to-text approach (no external deps)

import { readdir, readFile, writeFile } from 'fs/promises';
import { join, basename } from 'path';

const dir = new URL('.', import.meta.url).pathname;

function htmlToMarkdown(html) {
  // Extract only the body/main content area
  // Keez docs use Sphinx — main content is inside <div class="body" role="main"> or <div class="rst-content">
  let content = html;

  // Try to extract main content
  const bodyMatch = html.match(/<div\s+class="body"\s+role="main">([\s\S]*?)<\/div>\s*<\/div>\s*<\/div>/);
  const rstMatch = html.match(/<div\s+role="main"\s+class="document"[^>]*>([\s\S]*?)(?:<footer|<div\s+class="rst-footer)/);
  const sectionMatch = html.match(/<div\s+class="section"[^>]*>([\s\S]*?)(?:<\/div>\s*<\/div>\s*<footer|$)/);

  if (bodyMatch) content = bodyMatch[1];
  else if (rstMatch) content = rstMatch[1];
  else if (sectionMatch) content = sectionMatch[1];

  // Remove script and style tags
  content = content.replace(/<script[\s\S]*?<\/script>/gi, '');
  content = content.replace(/<style[\s\S]*?<\/style>/gi, '');
  content = content.replace(/<nav[\s\S]*?<\/nav>/gi, '');

  // Convert headers
  content = content.replace(/<h1[^>]*>([\s\S]*?)<\/h1>/gi, (_, text) => `# ${cleanText(text)}\n\n`);
  content = content.replace(/<h2[^>]*>([\s\S]*?)<\/h2>/gi, (_, text) => `## ${cleanText(text)}\n\n`);
  content = content.replace(/<h3[^>]*>([\s\S]*?)<\/h3>/gi, (_, text) => `### ${cleanText(text)}\n\n`);
  content = content.replace(/<h4[^>]*>([\s\S]*?)<\/h4>/gi, (_, text) => `#### ${cleanText(text)}\n\n`);
  content = content.replace(/<h5[^>]*>([\s\S]*?)<\/h5>/gi, (_, text) => `##### ${cleanText(text)}\n\n`);

  // Convert code blocks (pre/code)
  content = content.replace(/<div class="highlight[^"]*">\s*<pre>([\s\S]*?)<\/pre>\s*<\/div>/gi, (_, code) => {
    return '\n```\n' + cleanText(code).trim() + '\n```\n\n';
  });
  content = content.replace(/<pre[^>]*>([\s\S]*?)<\/pre>/gi, (_, code) => {
    return '\n```\n' + cleanText(code).trim() + '\n```\n\n';
  });

  // Convert inline code
  content = content.replace(/<code[^>]*>([\s\S]*?)<\/code>/gi, (_, code) => '`' + cleanText(code) + '`');
  content = content.replace(/<tt[^>]*>([\s\S]*?)<\/tt>/gi, (_, code) => '`' + cleanText(code) + '`');

  // Convert strong/bold
  content = content.replace(/<strong[^>]*>([\s\S]*?)<\/strong>/gi, (_, text) => `**${cleanText(text)}**`);
  content = content.replace(/<b[^>]*>([\s\S]*?)<\/b>/gi, (_, text) => `**${cleanText(text)}**`);

  // Convert em/italic
  content = content.replace(/<em[^>]*>([\s\S]*?)<\/em>/gi, (_, text) => `*${cleanText(text)}*`);
  content = content.replace(/<i[^>]*>([\s\S]*?)<\/i>/gi, (_, text) => `*${cleanText(text)}*`);

  // Convert links
  content = content.replace(/<a[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, (_, href, text) => {
    const cleanHref = href.replace(/^#/, '');
    return `[${cleanText(text)}](${href})`;
  });

  // Convert note/warning/admonition divs (Sphinx style)
  content = content.replace(/<div class="admonition\s+(\w+)">\s*<p class="admonition-title">[^<]*<\/p>\s*<p>([\s\S]*?)<\/p>\s*<\/div>/gi,
    (_, type, text) => `> **${type.charAt(0).toUpperCase() + type.slice(1)}:** ${cleanText(text)}\n\n`);

  // Convert tables
  content = content.replace(/<table[^>]*>([\s\S]*?)<\/table>/gi, (_, tableContent) => {
    const rows = [];
    const rowMatches = tableContent.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi);
    for (const rowMatch of rowMatches) {
      const cells = [];
      const cellMatches = rowMatch[1].matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi);
      for (const cellMatch of cellMatches) {
        cells.push(cleanText(cellMatch[1]).trim());
      }
      rows.push(cells);
    }

    if (rows.length === 0) return '';

    let table = '';
    const maxCols = Math.max(...rows.map(r => r.length));

    // Header row
    if (rows.length > 0) {
      table += '| ' + rows[0].map(c => c || ' ').join(' | ') + ' |\n';
      table += '| ' + rows[0].map(() => '---').join(' | ') + ' |\n';
    }

    // Data rows
    for (let i = 1; i < rows.length; i++) {
      while (rows[i].length < maxCols) rows[i].push('');
      table += '| ' + rows[i].join(' | ') + ' |\n';
    }

    return '\n' + table + '\n';
  });

  // Convert list items
  content = content.replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, (_, text) => `- ${cleanText(text).trim()}\n`);

  // Convert paragraphs
  content = content.replace(/<p[^>]*>([\s\S]*?)<\/p>/gi, (_, text) => `${cleanText(text).trim()}\n\n`);

  // Convert line breaks
  content = content.replace(/<br\s*\/?>/gi, '\n');

  // Convert horizontal rules
  content = content.replace(/<hr[^>]*\/?>/gi, '\n---\n\n');

  // Remove remaining HTML tags
  content = content.replace(/<[^>]+>/g, '');

  // Decode HTML entities
  content = content.replace(/&amp;/g, '&');
  content = content.replace(/&lt;/g, '<');
  content = content.replace(/&gt;/g, '>');
  content = content.replace(/&quot;/g, '"');
  content = content.replace(/&#39;/g, "'");
  content = content.replace(/&nbsp;/g, ' ');
  content = content.replace(/&#8216;/g, "'");
  content = content.replace(/&#8217;/g, "'");
  content = content.replace(/&rarr;/g, '→');
  content = content.replace(/&copy;/g, '©');
  content = content.replace(/&#x27;/g, "'");

  // Clean up whitespace
  content = content.replace(/\n{3,}/g, '\n\n');
  content = content.trim();

  return content;
}

function cleanText(html) {
  // Remove HTML tags but keep text
  return html.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ');
}

async function main() {
  const files = await readdir(dir);
  const htmlFiles = files.filter(f => f.endsWith('.html'));

  let converted = 0;
  for (const file of htmlFiles) {
    const html = await readFile(join(dir, file), 'utf-8');
    const md = htmlToMarkdown(html);
    const mdFile = file.replace('.html', '.md');
    await writeFile(join(dir, mdFile), md, 'utf-8');
    converted++;
    console.log(`Converted: ${file} → ${mdFile}`);
  }

  console.log(`\nDone! Converted ${converted} files.`);
}

main().catch(console.error);
