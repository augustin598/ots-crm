<script lang="ts">
	import type { Editor } from '@tiptap/core';
	import ToolbarButton from './ToolbarButton.svelte';
	import * as DropdownMenu from '$lib/components/ui/dropdown-menu';
	import { Button } from '$lib/components/ui/button';
	import {
		Bold, Italic, Underline as UnderlineIcon, Strikethrough, Highlighter,
		Heading1, Heading2, Heading3, Type, ChevronDown,
		List, ListOrdered, ListChecks,
		AlignLeft, AlignCenter, AlignRight, AlignJustify,
		Link as LinkIcon, Image as ImageIcon, Table as TableIcon,
		Undo2, Redo2,
		Plus, Minus, Trash2
	} from '@lucide/svelte';

	interface Props {
		editor: Editor;
		onImageUpload?: ((file: File) => Promise<string>) | null;
	}

	let { editor, onImageUpload = null }: Props = $props();

	let linkUrl = $state('');
	let showLinkInput = $state(false);
	let linkInputRef: HTMLInputElement | null = $state(null);

	function setLink() {
		if (linkUrl) {
			editor.chain().focus().extendMarkRange('link').setLink({ href: linkUrl }).run();
		} else {
			editor.chain().focus().extendMarkRange('link').unsetLink().run();
		}
		showLinkInput = false;
		linkUrl = '';
	}

	function openLinkDialog() {
		const previousUrl = editor.getAttributes('link').href || '';
		linkUrl = previousUrl;
		showLinkInput = true;
		setTimeout(() => linkInputRef?.focus(), 0);
	}

	function handleImageClick() {
		const input = document.createElement('input');
		input.type = 'file';
		input.accept = 'image/*';
		input.onchange = async () => {
			const file = input.files?.[0];
			if (!file) return;

			if (onImageUpload) {
				const url = await onImageUpload(file);
				editor.chain().focus().setImage({ src: url }).run();
			} else {
				const reader = new FileReader();
				reader.onload = () => {
					editor.chain().focus().setImage({ src: reader.result as string }).run();
				};
				reader.readAsDataURL(file);
			}
		};
		input.click();
	}

	function insertTable() {
		editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run();
	}

	const isInTable = $derived(editor.isActive('table'));
</script>

<div class="flex flex-wrap items-center gap-0.5 border-b bg-muted/50 px-2 py-1.5">
	<!-- Grup 1: Text style -->
	<ToolbarButton onclick={() => editor.chain().focus().toggleBold().run()} active={editor.isActive('bold')} title="Bold (Ctrl+B)">
		<Bold class="h-3.5 w-3.5" />
	</ToolbarButton>
	<ToolbarButton onclick={() => editor.chain().focus().toggleItalic().run()} active={editor.isActive('italic')} title="Italic (Ctrl+I)">
		<Italic class="h-3.5 w-3.5" />
	</ToolbarButton>
	<ToolbarButton onclick={() => editor.chain().focus().toggleUnderline().run()} active={editor.isActive('underline')} title="Underline (Ctrl+U)">
		<UnderlineIcon class="h-3.5 w-3.5" />
	</ToolbarButton>
	<ToolbarButton onclick={() => editor.chain().focus().toggleStrike().run()} active={editor.isActive('strike')} title="Strikethrough">
		<Strikethrough class="h-3.5 w-3.5" />
	</ToolbarButton>
	<ToolbarButton onclick={() => editor.chain().focus().toggleHighlight().run()} active={editor.isActive('highlight')} title="Highlight">
		<Highlighter class="h-3.5 w-3.5" />
	</ToolbarButton>

	<div class="mx-0.5 h-4 w-px bg-border"></div>

	<!-- Grup 2: Heading dropdown -->
	<DropdownMenu.Root>
		<DropdownMenu.Trigger>
			{#snippet child({ props })}
				<Button {...props} type="button" variant="ghost" size="sm" class="h-7 gap-1 px-2 text-xs font-semibold">
					<Type class="h-3.5 w-3.5" />
					<ChevronDown class="h-3 w-3" />
				</Button>
			{/snippet}
		</DropdownMenu.Trigger>
		<DropdownMenu.Content align="start" class="w-44">
			<DropdownMenu.Item onclick={() => editor.chain().focus().setParagraph().run()}>
				<span class="text-sm">Paragraph</span>
			</DropdownMenu.Item>
			<DropdownMenu.Item onclick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}>
				<Heading1 class="mr-2 h-4 w-4" />
				<span class="text-lg font-bold">Heading 1</span>
			</DropdownMenu.Item>
			<DropdownMenu.Item onclick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}>
				<Heading2 class="mr-2 h-4 w-4" />
				<span class="text-base font-bold">Heading 2</span>
			</DropdownMenu.Item>
			<DropdownMenu.Item onclick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}>
				<Heading3 class="mr-2 h-4 w-4" />
				<span class="text-sm font-bold">Heading 3</span>
			</DropdownMenu.Item>
		</DropdownMenu.Content>
	</DropdownMenu.Root>

	<div class="mx-0.5 h-4 w-px bg-border"></div>

	<!-- Grup 3: Liste -->
	<ToolbarButton onclick={() => editor.chain().focus().toggleBulletList().run()} active={editor.isActive('bulletList')} title="Bullet list">
		<List class="h-3.5 w-3.5" />
	</ToolbarButton>
	<ToolbarButton onclick={() => editor.chain().focus().toggleOrderedList().run()} active={editor.isActive('orderedList')} title="Numbered list">
		<ListOrdered class="h-3.5 w-3.5" />
	</ToolbarButton>
	<ToolbarButton onclick={() => editor.chain().focus().toggleTaskList().run()} active={editor.isActive('taskList')} title="Task list">
		<ListChecks class="h-3.5 w-3.5" />
	</ToolbarButton>

	<div class="mx-0.5 h-4 w-px bg-border"></div>

	<!-- Grup 4: Aliniere -->
	<ToolbarButton onclick={() => editor.chain().focus().setTextAlign('left').run()} active={editor.isActive({ textAlign: 'left' })} title="Align left">
		<AlignLeft class="h-3.5 w-3.5" />
	</ToolbarButton>
	<ToolbarButton onclick={() => editor.chain().focus().setTextAlign('center').run()} active={editor.isActive({ textAlign: 'center' })} title="Align center">
		<AlignCenter class="h-3.5 w-3.5" />
	</ToolbarButton>
	<ToolbarButton onclick={() => editor.chain().focus().setTextAlign('right').run()} active={editor.isActive({ textAlign: 'right' })} title="Align right">
		<AlignRight class="h-3.5 w-3.5" />
	</ToolbarButton>
	<ToolbarButton onclick={() => editor.chain().focus().setTextAlign('justify').run()} active={editor.isActive({ textAlign: 'justify' })} title="Justify">
		<AlignJustify class="h-3.5 w-3.5" />
	</ToolbarButton>

	<div class="mx-0.5 h-4 w-px bg-border"></div>

	<!-- Grup 5: Insert -->
	<div class="relative">
		<ToolbarButton onclick={openLinkDialog} active={editor.isActive('link')} title="Link">
			<LinkIcon class="h-3.5 w-3.5" />
		</ToolbarButton>
		{#if showLinkInput}
			<div class="absolute left-0 top-full z-50 mt-1 flex items-center gap-1 rounded-lg border bg-popover p-2 shadow-lg">
				<input
					bind:this={linkInputRef}
					bind:value={linkUrl}
					placeholder="https://..."
					class="h-7 w-48 rounded border bg-transparent px-2 text-sm outline-none focus:ring-1 focus:ring-ring"
					onkeydown={(e) => { if (e.key === 'Enter') setLink(); if (e.key === 'Escape') showLinkInput = false; }}
				/>
				<Button size="sm" class="h-7" onclick={setLink}>OK</Button>
				{#if editor.isActive('link')}
					<Button size="sm" variant="destructive" class="h-7" onclick={() => { editor.chain().focus().unsetLink().run(); showLinkInput = false; }}>
						<Trash2 class="h-3 w-3" />
					</Button>
				{/if}
			</div>
		{/if}
	</div>

	<ToolbarButton onclick={handleImageClick} title="Image">
		<ImageIcon class="h-3.5 w-3.5" />
	</ToolbarButton>

	<!-- Table dropdown -->
	<DropdownMenu.Root>
		<DropdownMenu.Trigger>
			{#snippet child({ props })}
				<Button {...props} type="button" variant="ghost" size="sm" class="h-7 w-7 p-0" title="Table">
					<TableIcon class="h-3.5 w-3.5" />
				</Button>
			{/snippet}
		</DropdownMenu.Trigger>
		<DropdownMenu.Content align="start" class="w-48">
			{#if !isInTable}
				<DropdownMenu.Item onclick={insertTable}>
					<Plus class="mr-2 h-4 w-4" />
					Insereaza tabel 3x3
				</DropdownMenu.Item>
			{:else}
				<DropdownMenu.Item onclick={() => editor.chain().focus().addRowAfter().run()}>
					<Plus class="mr-2 h-4 w-4" />
					Adauga rand
				</DropdownMenu.Item>
				<DropdownMenu.Item onclick={() => editor.chain().focus().addColumnAfter().run()}>
					<Plus class="mr-2 h-4 w-4" />
					Adauga coloana
				</DropdownMenu.Item>
				<DropdownMenu.Item onclick={() => editor.chain().focus().deleteRow().run()}>
					<Minus class="mr-2 h-4 w-4" />
					Sterge rand
				</DropdownMenu.Item>
				<DropdownMenu.Item onclick={() => editor.chain().focus().deleteColumn().run()}>
					<Minus class="mr-2 h-4 w-4" />
					Sterge coloana
				</DropdownMenu.Item>
				<DropdownMenu.Separator />
				<DropdownMenu.Item onclick={() => editor.chain().focus().deleteTable().run()} class="text-destructive">
					<Trash2 class="mr-2 h-4 w-4" />
					Sterge tabel
				</DropdownMenu.Item>
			{/if}
		</DropdownMenu.Content>
	</DropdownMenu.Root>

	<div class="mx-0.5 h-4 w-px bg-border"></div>

	<!-- Grup 6: History -->
	<ToolbarButton onclick={() => editor.chain().focus().undo().run()} disabled={!editor.can().undo()} title="Undo (Ctrl+Z)">
		<Undo2 class="h-3.5 w-3.5" />
	</ToolbarButton>
	<ToolbarButton onclick={() => editor.chain().focus().redo().run()} disabled={!editor.can().redo()} title="Redo (Ctrl+Shift+Z)">
		<Redo2 class="h-3.5 w-3.5" />
	</ToolbarButton>
</div>
