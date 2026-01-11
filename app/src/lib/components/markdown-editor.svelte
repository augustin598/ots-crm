<script lang="ts">
	import { Textarea } from '$lib/components/ui/textarea';
	import { Button } from '$lib/components/ui/button';
	import { Card, CardContent, CardHeader, CardTitle } from '$lib/components/ui/card';
	import { marked } from 'marked';
	import { Eye, Code } from '@lucide/svelte';

	interface Props {
		value: string;
		onChange: (value: string) => void;
		placeholder?: string;
		label?: string;
	}

	let { value = $bindable(''), onChange, placeholder = 'Write your markdown here...', label }: Props =
		$props();

	let showPreview = $state(false);
	let editorRef: HTMLTextAreaElement | null = $state(null);

	// Internal function for toolbar buttons
	function insertTextInternal(before: string, after: string = '') {
		if (!editorRef) return;
		const start = editorRef.selectionStart;
		const end = editorRef.selectionEnd;
		const text = value;
		const beforeText = text.substring(0, start);
		const afterText = text.substring(end);
		const newText = `${beforeText}${before}${after}${afterText}`;
		value = newText;
		onChange(newText);
		setTimeout(() => {
			editorRef?.focus();
			const newPos = start + before.length;
			editorRef?.setSelectionRange(newPos, newPos);
		}, 0);
	}

	// Expose insertText function for parent components (simplified version)
	export function insertText(text: string) {
		insertTextInternal(text);
	}

	const htmlPreview = $derived(() => {
		if (!value) return '';
		try {
			return marked(value);
		} catch (e) {
			return '<p class="text-red-500">Error parsing markdown</p>';
		}
	});

</script>

<div class="space-y-2">
	{#if label}
		<label class="text-sm font-medium">{label}</label>
	{/if}

	<div class="border rounded-lg overflow-hidden">
		<!-- Toolbar -->
		<div class="flex items-center justify-between border-b bg-muted/50 px-3 py-2">
			<div class="flex items-center gap-1">
				<Button
					type="button"
					variant="ghost"
					size="sm"
					onclick={() => insertTextInternal('**', '**')}
					title="Bold"
					class="h-7 px-2"
				>
					<strong>B</strong>
				</Button>
				<Button
					type="button"
					variant="ghost"
					size="sm"
					onclick={() => insertTextInternal('*', '*')}
					title="Italic"
					class="h-7 px-2"
				>
					<em>I</em>
				</Button>
				<Button
					type="button"
					variant="ghost"
					size="sm"
					onclick={() => insertTextInternal('- ')}
					title="Bullet List"
					class="h-7 px-2"
				>
					•
				</Button>
				<Button
					type="button"
					variant="ghost"
					size="sm"
					onclick={() => insertTextInternal('1. ')}
					title="Numbered List"
					class="h-7 px-2"
				>
					1.
				</Button>
				<Button
					type="button"
					variant="ghost"
					size="sm"
					onclick={() => insertTextInternal('# ')}
					title="Heading"
					class="h-7 px-2"
				>
					H
				</Button>
				<Button
					type="button"
					variant="ghost"
					size="sm"
					onclick={() => insertTextInternal('[', '](url)')}
					title="Link"
					class="h-7 px-2"
				>
					🔗
				</Button>
			</div>
			<Button
				type="button"
				variant="ghost"
				size="sm"
				onclick={() => (showPreview = !showPreview)}
				class="h-7"
			>
				{#if showPreview}
					<Code class="h-4 w-4 mr-2" />
					Code
				{:else}
					<Eye class="h-4 w-4 mr-2" />
					Preview
				{/if}
			</Button>
		</div>

		<!-- Editor/Preview -->
		<div class="grid {showPreview ? 'grid-cols-2' : 'grid-cols-1'} divide-x">
			<div class="relative">
				<textarea
					bind:this={editorRef}
					bind:value={value}
					oninput={(e) => onChange((e.target as HTMLTextAreaElement).value)}
					placeholder={placeholder}
					class="min-h-[400px] resize-none border-0 rounded-none font-mono text-sm focus-visible:ring-0 w-full p-4 bg-transparent outline-none"
				/>
			</div>
			{#if showPreview}
				<div class="prose prose-sm max-w-none p-4 overflow-auto min-h-[400px]">
					{@html htmlPreview()}
				</div>
			{/if}
		</div>
	</div>
</div>

<style>
	:global(.prose) {
		color: inherit;
	}
	:global(.prose h1) {
		font-size: 1.5em;
		font-weight: bold;
		margin-top: 1em;
		margin-bottom: 0.5em;
	}
	:global(.prose h2) {
		font-size: 1.25em;
		font-weight: bold;
		margin-top: 1em;
		margin-bottom: 0.5em;
	}
	:global(.prose h3) {
		font-size: 1.1em;
		font-weight: bold;
		margin-top: 0.75em;
		margin-bottom: 0.5em;
	}
	:global(.prose p) {
		margin-bottom: 1em;
	}
	:global(.prose ul),
	:global(.prose ol) {
		margin-bottom: 1em;
		padding-left: 1.5em;
	}
	:global(.prose li) {
		margin-bottom: 0.25em;
	}
	:global(.prose strong) {
		font-weight: bold;
	}
	:global(.prose em) {
		font-style: italic;
	}
	:global(.prose a) {
		color: hsl(var(--primary));
		text-decoration: underline;
	}
</style>
