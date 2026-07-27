<script lang="ts">
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
	import Mention from '@tiptap/extension-mention';
	import Toolbar from './Toolbar.svelte';
	import { createMentionSuggestion, type MentionUser } from './mention-suggestion';
	import { cn } from '$lib/utils';
	import './editor.css';

	interface Props {
		content?: string | object;
		placeholder?: string;
		editable?: boolean;
		onUpdate?: ((data: { html: string; json: object; text: string }) => void) | null;
		onImageUpload?: ((file: File) => Promise<string>) | null;
		onPasteImage?: ((file: File) => void) | null;
		users?: MentionUser[];
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
		users = [],
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

	// Inițializare ca acțiune pe element (nu onMount): cu experimental.async, în
	// build-ul de producție onMount poate rula ÎNAINTE ca bind:this să lege
	// elementul (svelte#16582) → early-return silențios și editor gol. Acțiunea
	// primește nodul direct, deci nu depinde de ordinea bind:this/onMount.
	function initEditor(node: HTMLDivElement) {
		editorElement = node;

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

		if (users.length > 0) {
			extensions.push(
				Mention.configure({
					HTMLAttributes: { class: 'mention' },
					suggestion: createMentionSuggestion(users),
				})
			);
		}

		if (maxCharacters) {
			extensions.push(CharacterCount.configure({ limit: maxCharacters }));
		} else {
			extensions.push(CharacterCount);
		}

		function syncCounts(e: Editor) {
			const storage = e.storage.characterCount;
			wordCount = storage?.words?.() ?? 0;
			charCount = storage?.characters?.() ?? 0;
		}

		editor = new Editor({
			element: node,
			extensions,
			content,
			editable,
			// Conținutul inițial NU emite onTransaction — fără onCreate contorul rămâne 0
			// până la prima tastare.
			onCreate: ({ editor: e }) => syncCounts(e),
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
				if (editor) syncCounts(editor);
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

		return {
			destroy() {
				editor?.destroy();
				editor = null;
				editorElement = null;
			},
		};
	}
</script>

<div class={cn('rich-editor overflow-visible rounded-lg border', className)} style="--editor-min-height: {minHeight};">
	{#if editor && editable}
		{#key editorRevision}
			<Toolbar {editor} {onImageUpload} />
		{/key}
	{/if}

	<div use:initEditor></div>

	{#if editor && showFooter}
		<div class="flex items-center justify-end gap-3 border-t bg-muted/30 px-3 py-1 text-xs text-muted-foreground">
			<span>{wordCount} cuvinte</span>
			<span class={cn(maxCharacters && charCount > maxCharacters && 'text-destructive font-medium')}>
				{charCount}{maxCharacters ? ` / ${maxCharacters}` : ''} caractere
			</span>
		</div>
	{/if}
</div>
