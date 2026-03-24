<script lang="ts">
	import type { Editor } from '@tiptap/core';
	import { BubbleMenuPlugin } from '@tiptap/extension-bubble-menu';
	import { onMount, onDestroy } from 'svelte';
	import ToolbarButton from './ToolbarButton.svelte';
	import { Bold, Italic, Underline as UnderlineIcon, Link as LinkIcon, Highlighter } from '@lucide/svelte';

	interface Props {
		editor: Editor;
	}

	let { editor }: Props = $props();

	let menuEl: HTMLDivElement | null = $state(null);

	onMount(() => {
		if (!menuEl || !editor) return;

		const plugin = BubbleMenuPlugin({
			pluginKey: 'bubbleMenu',
			editor,
			element: menuEl,
		});

		editor.registerPlugin(plugin);
	});

	onDestroy(() => {
		editor?.unregisterPlugin('bubbleMenu');
	});

	function toggleLink() {
		if (editor.isActive('link')) {
			editor.chain().focus().unsetLink().run();
		} else {
			const url = prompt('URL:');
			if (url) {
				editor.chain().focus().extendMarkRange('link').setLink({ href: url }).run();
			}
		}
	}
</script>

<div bind:this={menuEl} class="flex items-center gap-0.5 rounded-lg border bg-popover p-1 shadow-lg">
	<ToolbarButton onclick={() => editor.chain().focus().toggleBold().run()} active={editor.isActive('bold')} title="Bold">
		<Bold class="h-3.5 w-3.5" />
	</ToolbarButton>
	<ToolbarButton onclick={() => editor.chain().focus().toggleItalic().run()} active={editor.isActive('italic')} title="Italic">
		<Italic class="h-3.5 w-3.5" />
	</ToolbarButton>
	<ToolbarButton onclick={() => editor.chain().focus().toggleUnderline().run()} active={editor.isActive('underline')} title="Underline">
		<UnderlineIcon class="h-3.5 w-3.5" />
	</ToolbarButton>
	<ToolbarButton onclick={toggleLink} active={editor.isActive('link')} title="Link">
		<LinkIcon class="h-3.5 w-3.5" />
	</ToolbarButton>
	<ToolbarButton onclick={() => editor.chain().focus().toggleHighlight().run()} active={editor.isActive('highlight')} title="Highlight">
		<Highlighter class="h-3.5 w-3.5" />
	</ToolbarButton>
</div>
