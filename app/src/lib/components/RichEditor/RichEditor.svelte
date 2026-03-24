<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { Editor } from '@tiptap/core';
	import StarterKit from '@tiptap/starter-kit';
	import Placeholder from '@tiptap/extension-placeholder';
	import ImageExt from '@tiptap/extension-image';
	import Link from '@tiptap/extension-link';
	import { Table } from '@tiptap/extension-table';
	import TableRow from '@tiptap/extension-table-row';
	import TableCell from '@tiptap/extension-table-cell';
	import TableHeader from '@tiptap/extension-table-header';
	import CharacterCount from '@tiptap/extension-character-count';
	import Underline from '@tiptap/extension-underline';
	import TextAlign from '@tiptap/extension-text-align';
	import Highlight from '@tiptap/extension-highlight';
	import Color from '@tiptap/extension-color';
	import { TextStyle } from '@tiptap/extension-text-style';
	import TaskList from '@tiptap/extension-task-list';
	import TaskItem from '@tiptap/extension-task-item';
	import Toolbar from './Toolbar.svelte';
	import { cn } from '$lib/utils';
	import './editor.css';

	interface Props {
		content?: string | object;
		placeholder?: string;
		editable?: boolean;
		onUpdate?: ((data: { html: string; json: object; text: string }) => void) | null;
		onImageUpload?: ((file: File) => Promise<string>) | null;
		onPasteImage?: ((file: File) => void) | null;
		maxCharacters?: number | null;
		minHeight?: string;
		showFooter?: boolean;
		class?: string;
	}

	let {
		content = '',
		placeholder = 'Scrie ceva...',
		editable = true,
		onUpdate = null,
		onImageUpload = null,
		onPasteImage = null,
		maxCharacters = null,
		minHeight = '200px',
		showFooter = true,
		class: className
	}: Props = $props();

	let editorElement: HTMLDivElement | null = $state(null);
	let editor: Editor | null = $state(null);
	let wordCount = $state(0);
	let charCount = $state(0);

	// Force reactivity for toolbar active states
	let editorRevision = $state(0);

	// Public API
	export function getHTML(): string {
		return editor?.getHTML() ?? '';
	}

	export function getText(): string {
		return editor?.getText() ?? '';
	}

	export function getJSON(): object {
		return editor?.getJSON() ?? {};
	}

	export function clear() {
		editor?.commands.clearContent();
	}

	export function isEmpty(): boolean {
		return editor?.isEmpty ?? true;
	}

	export function setContent(newContent: string | object) {
		editor?.commands.setContent(newContent);
	}

	onMount(() => {
		if (!editorElement) return;

		const extensions: any[] = [
			StarterKit.configure({
				heading: { levels: [1, 2, 3] },
			}),
			Placeholder.configure({ placeholder }),
			ImageExt.configure({ inline: false, allowBase64: true }),
			Link.configure({
				openOnClick: false,
				HTMLAttributes: { rel: 'noopener noreferrer', target: '_blank' },
			}),
			Table.configure({ resizable: false }),
			TableRow,
			TableCell,
			TableHeader,
			Underline,
			TextAlign.configure({ types: ['heading', 'paragraph'] }),
			Highlight.configure({ multicolor: false }),
			TextStyle,
			Color,
			TaskList,
			TaskItem.configure({ nested: true }),
		];

		if (maxCharacters) {
			extensions.push(CharacterCount.configure({ limit: maxCharacters }));
		} else {
			extensions.push(CharacterCount);
		}

		editor = new Editor({
			element: editorElement,
			extensions,
			content,
			editable,
			editorProps: {
				handlePaste: (view, event) => {
					if (!onPasteImage) return false;
					const items = event.clipboardData?.items;
					if (!items) return false;
					for (const item of items) {
						if (item.type.startsWith('image/')) {
							event.preventDefault();
							const file = item.getAsFile();
							if (file) onPasteImage(file);
							return true;
						}
					}
					return false;
				},
			},
			onTransaction: () => {
				// Force Svelte reactivity
				editorRevision++;
				if (editor) {
					const storage = editor.storage.characterCount;
					wordCount = storage?.words?.() ?? 0;
					charCount = storage?.characters?.() ?? 0;
				}
			},
			onUpdate: ({ editor: e }) => {
				if (onUpdate) {
					onUpdate({
						html: e.getHTML(),
						json: e.getJSON(),
						text: e.getText(),
					});
				}
			},
		});
	});

	onDestroy(() => {
		editor?.destroy();
	});
</script>

<div class={cn('rich-editor overflow-hidden rounded-lg border', className)} style="--editor-min-height: {minHeight};">
	{#if editor && editable}
		{#key editorRevision}
			<Toolbar {editor} {onImageUpload} />
		{/key}
	{/if}

	<div bind:this={editorElement}></div>

	{#if editor && showFooter}
		<div class="flex items-center justify-end gap-3 border-t bg-muted/30 px-3 py-1 text-xs text-muted-foreground">
			<span>{wordCount} cuvinte</span>
			<span class={cn(maxCharacters && charCount > maxCharacters && 'text-destructive font-medium')}>
				{charCount}{maxCharacters ? ` / ${maxCharacters}` : ''} caractere
			</span>
		</div>
	{/if}
</div>
