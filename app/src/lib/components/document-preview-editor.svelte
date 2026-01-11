<script lang="ts">
	import { Card, CardContent } from '$lib/components/ui/card';
	import { Button } from '$lib/components/ui/button';
	import { renderDocumentPreview } from '$lib/utils/document-preview-renderer';
	import { replaceVariables } from '$lib/utils/document-variables';
	import type { DocumentTemplate } from '$lib/server/db/schema';
	import type { VariableMap } from '$lib/utils/document-variables';
	import { Bold, Italic, Underline, List } from '@lucide/svelte';

	interface Props {
		template: DocumentTemplate | null;
		variables: VariableMap;
		editedContent: string | null;
		onContentEdit: (content: string) => void;
	}

	let { template, variables, editedContent = $bindable(null), onContentEdit }: Props = $props();

	let previewRef: HTMLDivElement | null = $state(null);
	let showToolbar = $state(false);
	let toolbarPosition = $state({ top: 0, left: 0 });

	const renderedHTML = $derived.by(() => {
		if (!template) return '';
		if (editedContent) {
			// Use edited content - it's already HTML from contentEditable
			// But we still need to replace variables
			return replaceVariables(editedContent, variables);
		}
		return renderDocumentPreview(template, variables);
	});

	function handleSelection() {
		if (!previewRef) return;
		const selection = window.getSelection();
		if (selection && selection.toString().length > 0) {
			const range = selection.getRangeAt(0);
			const rect = range.getBoundingClientRect();
			const containerRect = previewRef.getBoundingClientRect();
			toolbarPosition = {
				top: rect.top - containerRect.top - 40,
				left: rect.left - containerRect.left + rect.width / 2
			};
			showToolbar = true;
		} else {
			showToolbar = false;
		}
	}

	function applyFormatting(command: string) {
		document.execCommand(command, false);
		previewRef?.focus();
		handleSelection();
	}

	function handleContentChange() {
		if (!previewRef) return;
		const content = previewRef.innerHTML;
		editedContent = content;
		onContentEdit(content);
	}
</script>

<Card class="h-full flex flex-col">
	<CardContent class="flex-1 overflow-auto p-0">
		<div
			bind:this={previewRef}
			contenteditable="true"
			class="document-preview-container min-h-full p-8"
			oninput={handleContentChange}
			onmouseup={handleSelection}
			onkeyup={handleSelection}
			
		>
			{@html renderedHTML}
		</div>

		{#if showToolbar}
			<div
				class="fixed z-50 flex gap-1 bg-white border rounded-md shadow-lg p-1"
				style="top: {toolbarPosition.top}px; left: {toolbarPosition.left}px; transform: translateX(-50%);"
			>
				<Button
					type="button"
					variant="ghost"
					size="sm"
					onclick={() => applyFormatting('bold')}
					title="Bold"
				>
					<Bold class="h-4 w-4" />
				</Button>
				<Button
					type="button"
					variant="ghost"
					size="sm"
					onclick={() => applyFormatting('italic')}
					title="Italic"
				>
					<Italic class="h-4 w-4" />
				</Button>
				<Button
					type="button"
					variant="ghost"
					size="sm"
					onclick={() => applyFormatting('underline')}
					title="Underline"
				>
					<Underline class="h-4 w-4" />
				</Button>
				<Button
					type="button"
					variant="ghost"
					size="sm"
					onclick={() => applyFormatting('insertUnorderedList')}
					title="Bullet List"
				>
					<List class="h-4 w-4" />
				</Button>
			</div>
		{/if}
	</CardContent>
</Card>

<style>
	.document-preview-container {
		outline: none;
	}

	.document-preview-container:focus {
		outline: 2px solid hsl(var(--ring));
		outline-offset: -2px;
	}
</style>
