<script lang="ts">
	import { Button } from '$lib/components/ui/button';
	import * as DropdownMenu from '$lib/components/ui/dropdown-menu';
	import { marked } from 'marked';
	import { Eye, Code, Bold, Italic, Strikethrough, Link, Image, List, ListOrdered, Quote, ChevronDown, Type, Minus } from '@lucide/svelte';
	import MentionDropdown, { type MentionUser } from '$lib/components/mention-dropdown.svelte';

	interface Props {
		value: string;
		onChange: (value: string) => void;
		placeholder?: string;
		label?: string;
		compact?: boolean;
		onpaste?: (e: ClipboardEvent) => void;
		users?: MentionUser[];
	}

	let { value = $bindable(''), onChange, placeholder = 'Write your markdown here...', label, compact = false, onpaste, users = [] }: Props =
		$props();

	let showPreview = $state(false);
	let editorRef: HTMLTextAreaElement | null = $state(null);
	let editorWrapperRef: HTMLDivElement | null = $state(null);

	// Mention state
	let mentionOpen = $state(false);
	let mentionQuery = $state('');
	let mentionStartPos = $state(0);
	let mentionPosition = $state({ top: 0, left: 0 });
	let mentionSelectedIndex = $state(0);

	// Filtered users for mention (needed for keyboard nav bounds)
	const mentionFiltered = $derived.by(() => {
		if (!mentionQuery) return users.slice(0, 5);
		const q = mentionQuery.toLowerCase();
		return users
			.filter((u) => {
				const name = `${u.firstName} ${u.lastName}`.toLowerCase();
				return name.includes(q) || u.email.toLowerCase().includes(q);
			})
			.slice(0, 5);
	});

	function getCaretCoordinates(textarea: HTMLTextAreaElement, position: number): { top: number; left: number } {
		const div = document.createElement('div');
		const style = getComputedStyle(textarea);

		const properties = [
			'fontFamily', 'fontSize', 'fontWeight', 'fontStyle',
			'letterSpacing', 'textTransform', 'wordSpacing',
			'textIndent', 'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft',
			'borderTopWidth', 'borderRightWidth', 'borderBottomWidth', 'borderLeftWidth',
			'lineHeight', 'whiteSpace', 'wordWrap', 'overflowWrap'
		] as const;

		div.style.position = 'absolute';
		div.style.visibility = 'hidden';
		div.style.overflow = 'hidden';
		div.style.width = style.width;
		div.style.height = 'auto';

		for (const prop of properties) {
			(div.style as any)[prop] = style.getPropertyValue(prop.replace(/([A-Z])/g, '-$1').toLowerCase());
		}

		div.style.whiteSpace = 'pre-wrap';
		div.style.wordWrap = 'break-word';

		const textBefore = textarea.value.substring(0, position);
		const textNode = document.createTextNode(textBefore);
		const span = document.createElement('span');
		span.textContent = '|';

		div.appendChild(textNode);
		div.appendChild(span);
		document.body.appendChild(div);

		const top = span.offsetTop - textarea.scrollTop;
		const left = span.offsetLeft;

		document.body.removeChild(div);

		return { top: top + parseInt(style.lineHeight || '20'), left };
	}

	function checkMention() {
		if (!editorRef || users.length === 0) return;

		const pos = editorRef.selectionStart;
		const textBefore = value.substring(0, pos);

		// Find the last @ that's either at start or after a whitespace/newline
		const match = textBefore.match(/(^|[\s\n])@([^\s\n]*)$/);

		if (match) {
			mentionOpen = true;
			mentionQuery = match[2];
			mentionStartPos = pos - match[2].length - 1; // position of @
			mentionSelectedIndex = 0;

			const coords = getCaretCoordinates(editorRef, mentionStartPos);
			mentionPosition = { top: coords.top, left: coords.left };
		} else {
			mentionOpen = false;
		}
	}

	function handleMentionSelect(user: MentionUser) {
		if (!editorRef) return;

		const displayName = `${user.firstName} ${user.lastName}`.trim() || user.email;
		const pos = editorRef.selectionStart;
		const beforeMention = value.substring(0, mentionStartPos);
		const afterCursor = value.substring(pos);

		const newText = `${beforeMention}@${displayName} ${afterCursor}`;
		value = newText;
		onChange(newText);
		mentionOpen = false;
		mentionQuery = '';

		const newPos = mentionStartPos + 1 + displayName.length + 1;
		setTimeout(() => {
			editorRef?.focus();
			editorRef?.setSelectionRange(newPos, newPos);
		}, 0);
	}

	function handleKeydown(e: KeyboardEvent) {
		if (mentionOpen && mentionFiltered.length > 0) {
			if (e.key === 'ArrowDown') {
				e.preventDefault();
				mentionSelectedIndex = (mentionSelectedIndex + 1) % mentionFiltered.length;
			} else if (e.key === 'ArrowUp') {
				e.preventDefault();
				mentionSelectedIndex = (mentionSelectedIndex - 1 + mentionFiltered.length) % mentionFiltered.length;
			} else if (e.key === 'Enter') {
				e.preventDefault();
				handleMentionSelect(mentionFiltered[mentionSelectedIndex]);
			} else if (e.key === 'Escape') {
				e.preventDefault();
				mentionOpen = false;
			}
		}
	}

	function handleInput(e: Event) {
		onChange((e.target as HTMLTextAreaElement).value);
		// Check mention after value updates
		setTimeout(() => checkMention(), 0);
	}

	function insertTextInternal(before: string, after: string = '') {
		if (!editorRef) return;
		const start = editorRef.selectionStart;
		const end = editorRef.selectionEnd;
		const selectedText = value.substring(start, end);
		const beforeText = value.substring(0, start);
		const afterText = value.substring(end);
		const newText = `${beforeText}${before}${selectedText}${after}${afterText}`;
		value = newText;
		onChange(newText);
		setTimeout(() => {
			editorRef?.focus();
			if (selectedText) {
				editorRef?.setSelectionRange(start + before.length, start + before.length + selectedText.length);
			} else {
				const newPos = start + before.length;
				editorRef?.setSelectionRange(newPos, newPos);
			}
		}, 0);
	}

	function insertLinePrefix(prefix: string) {
		if (!editorRef) return;
		const start = editorRef.selectionStart;
		const lineStart = value.lastIndexOf('\n', start - 1) + 1;
		const beforeLine = value.substring(0, lineStart);
		const afterCursor = value.substring(start);
		const currentLineBeforeCursor = value.substring(lineStart, start);
		const newText = `${beforeLine}${prefix}${currentLineBeforeCursor}${afterCursor}`;
		value = newText;
		onChange(newText);
		setTimeout(() => {
			editorRef?.focus();
			const newPos = start + prefix.length;
			editorRef?.setSelectionRange(newPos, newPos);
		}, 0);
	}

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
		<div class="flex items-center justify-between border-b bg-muted/50 px-2 py-1.5">
			<div class="flex items-center gap-0.5">
				<!-- Text Style Dropdown (Tt) -->
				<DropdownMenu.Root>
					<DropdownMenu.Trigger>
						{#snippet child({ props })}
							<Button {...props} type="button" variant="ghost" size="sm" class="h-7 px-2 gap-1 text-xs font-semibold">
								<Type class="h-3.5 w-3.5" />
								<ChevronDown class="h-3 w-3" />
							</Button>
						{/snippet}
					</DropdownMenu.Trigger>
					<DropdownMenu.Content align="start" class="w-48">
						<DropdownMenu.Item onclick={() => insertLinePrefix('')}>
							<span class="text-sm">Normal text</span>
						</DropdownMenu.Item>
						<DropdownMenu.Item onclick={() => insertLinePrefix('# ')}>
							<span class="text-lg font-bold">Heading 1</span>
						</DropdownMenu.Item>
						<DropdownMenu.Item onclick={() => insertLinePrefix('## ')}>
							<span class="text-base font-bold">Heading 2</span>
						</DropdownMenu.Item>
						<DropdownMenu.Item onclick={() => insertLinePrefix('### ')}>
							<span class="text-sm font-bold">Heading 3</span>
						</DropdownMenu.Item>
						<DropdownMenu.Item onclick={() => insertLinePrefix('#### ')}>
							<span class="text-xs font-bold">Heading 4</span>
						</DropdownMenu.Item>
					</DropdownMenu.Content>
				</DropdownMenu.Root>

				<div class="w-px h-4 bg-border mx-0.5"></div>

				<!-- Bold -->
				<Button
					type="button"
					variant="ghost"
					size="sm"
					onclick={() => insertTextInternal('**', '**')}
					title="Bold"
					class="h-7 w-7 p-0"
				>
					<Bold class="h-3.5 w-3.5" />
				</Button>

				<!-- Italic -->
				<Button
					type="button"
					variant="ghost"
					size="sm"
					onclick={() => insertTextInternal('*', '*')}
					title="Italic"
					class="h-7 w-7 p-0"
				>
					<Italic class="h-3.5 w-3.5" />
				</Button>

				<!-- More Formatting Dropdown (...) -->
				<DropdownMenu.Root>
					<DropdownMenu.Trigger>
						{#snippet child({ props })}
							<Button {...props} type="button" variant="ghost" size="sm" class="h-7 w-7 p-0" title="More formatting">
								<span class="text-xs font-bold tracking-wider">...</span>
							</Button>
						{/snippet}
					</DropdownMenu.Trigger>
					<DropdownMenu.Content align="start" class="w-48">
						<DropdownMenu.Item onclick={() => insertTextInternal('~~', '~~')}>
							<Strikethrough class="h-4 w-4 mr-2" />
							Strikethrough
						</DropdownMenu.Item>
						<DropdownMenu.Item onclick={() => insertTextInternal('`', '`')}>
							<Code class="h-4 w-4 mr-2" />
							Code
						</DropdownMenu.Item>
					</DropdownMenu.Content>
				</DropdownMenu.Root>

				<div class="w-px h-4 bg-border mx-0.5"></div>

				<!-- List Dropdown -->
				<DropdownMenu.Root>
					<DropdownMenu.Trigger>
						{#snippet child({ props })}
							<Button {...props} type="button" variant="ghost" size="sm" class="h-7 px-2 gap-1" title="Lists">
								<List class="h-3.5 w-3.5" />
								<ChevronDown class="h-3 w-3" />
							</Button>
						{/snippet}
					</DropdownMenu.Trigger>
					<DropdownMenu.Content align="start" class="w-48">
						<DropdownMenu.Item onclick={() => insertLinePrefix('- ')}>
							<List class="h-4 w-4 mr-2" />
							Bullet list
						</DropdownMenu.Item>
						<DropdownMenu.Item onclick={() => insertLinePrefix('1. ')}>
							<ListOrdered class="h-4 w-4 mr-2" />
							Numbered list
						</DropdownMenu.Item>
					</DropdownMenu.Content>
				</DropdownMenu.Root>

				<div class="w-px h-4 bg-border mx-0.5"></div>

				<!-- Link -->
				<Button
					type="button"
					variant="ghost"
					size="sm"
					onclick={() => insertTextInternal('[', '](url)')}
					title="Link"
					class="h-7 w-7 p-0"
				>
					<Link class="h-3.5 w-3.5" />
				</Button>

				<!-- Image -->
				<Button
					type="button"
					variant="ghost"
					size="sm"
					onclick={() => insertTextInternal('![alt](', ')')}
					title="Image"
					class="h-7 w-7 p-0"
				>
					<Image class="h-3.5 w-3.5" />
				</Button>

				<!-- Insert Extras Dropdown (+) -->
				<DropdownMenu.Root>
					<DropdownMenu.Trigger>
						{#snippet child({ props })}
							<Button {...props} type="button" variant="ghost" size="sm" class="h-7 px-2 gap-1" title="Insert">
								<span class="text-sm font-semibold">+</span>
								<ChevronDown class="h-3 w-3" />
							</Button>
						{/snippet}
					</DropdownMenu.Trigger>
					<DropdownMenu.Content align="start" class="w-48">
						<DropdownMenu.Item onclick={() => insertTextInternal('> ')}>
							<Quote class="h-4 w-4 mr-2" />
							Quote
						</DropdownMenu.Item>
						<DropdownMenu.Item onclick={() => insertTextInternal('```\n', '\n```')}>
							<Code class="h-4 w-4 mr-2" />
							Code block
						</DropdownMenu.Item>
						<DropdownMenu.Item onclick={() => insertTextInternal('\n---\n')}>
							<Minus class="h-4 w-4 mr-2" />
							Horizontal rule
						</DropdownMenu.Item>
					</DropdownMenu.Content>
				</DropdownMenu.Root>
			</div>

			<!-- Right side: Preview toggle -->
			<Button
				type="button"
				variant="ghost"
				size="sm"
				onclick={() => (showPreview = !showPreview)}
				class="h-7 px-2 gap-1"
				title={showPreview ? 'Edit' : 'Preview'}
			>
				{#if showPreview}
					<Code class="h-3.5 w-3.5" />
					{#if !compact}<span class="text-xs">Edit</span>{/if}
				{:else}
					<Eye class="h-3.5 w-3.5" />
					{#if !compact}<span class="text-xs">Preview</span>{/if}
				{/if}
			</Button>
		</div>

		<!-- Editor/Preview -->
		<div class="grid {showPreview && !compact ? 'grid-cols-2' : 'grid-cols-1'} divide-x">
			{#if !(showPreview && compact)}
				<div class="relative" bind:this={editorWrapperRef}>
					<textarea
						bind:this={editorRef}
						bind:value={value}
						oninput={handleInput}
						onkeydown={handleKeydown}
						onpaste={onpaste}
						placeholder={placeholder}
						class="{compact ? 'min-h-[120px]' : 'min-h-[400px]'} resize-none border-0 rounded-none font-mono text-sm focus-visible:ring-0 w-full p-4 bg-transparent outline-none"
					/>
					{#if users.length > 0}
						<MentionDropdown
							{users}
							visible={mentionOpen}
							query={mentionQuery}
							position={mentionPosition}
							selectedIndex={mentionSelectedIndex}
							onSelect={handleMentionSelect}
						/>
					{/if}
				</div>
			{/if}
			{#if showPreview}
				<div class="prose prose-sm max-w-none p-4 overflow-auto {compact ? 'min-h-[120px]' : 'min-h-[400px]'}">
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
	:global(.prose ul) {
		list-style-type: disc;
	}
	:global(.prose ol) {
		list-style-type: decimal;
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
	:global(.prose blockquote) {
		border-left: 3px solid hsl(var(--border));
		padding-left: 1em;
		margin-left: 0;
		color: hsl(var(--muted-foreground));
		font-style: italic;
	}
	:global(.prose code) {
		background: hsl(var(--muted));
		padding: 0.15em 0.35em;
		border-radius: 0.25em;
		font-size: 0.875em;
	}
	:global(.prose pre) {
		background: hsl(var(--muted));
		padding: 1em;
		border-radius: 0.5em;
		overflow-x: auto;
		margin-bottom: 1em;
	}
	:global(.prose pre code) {
		background: none;
		padding: 0;
	}
	:global(.prose hr) {
		border: none;
		border-top: 1px solid hsl(var(--border));
		margin: 1.5em 0;
	}
	:global(.prose s) {
		text-decoration: line-through;
	}
	:global(.mention) {
		background: hsl(var(--primary) / 0.15);
		color: hsl(var(--primary));
		padding: 0.1em 0.3em;
		border-radius: 0.25em;
		font-weight: 500;
	}
</style>
