<script lang="ts">
	import { Input } from '$lib/components/ui/input';
	import { Textarea } from '$lib/components/ui/textarea';
	import { tick } from 'svelte';
	import { cn } from '$lib/utils';

	interface Props {
		value: string;
		onSave: (newValue: string) => Promise<void>;
		multiline?: boolean;
		placeholder?: string;
		displayClass?: string;
		emptyPlaceholder?: string;
		ariaLabel?: string;
	}

	let {
		value,
		onSave,
		multiline = false,
		placeholder = '',
		displayClass = '',
		emptyPlaceholder = 'Click to edit',
		ariaLabel
	}: Props = $props();

	let editing = $state(false);
	let buffer = $state('');
	let saving = $state(false);
	let inputEl = $state<HTMLInputElement | HTMLTextAreaElement | null>(null);

	async function startEdit() {
		buffer = value;
		editing = true;
		await tick();
		inputEl?.focus();
		if (inputEl && 'select' in inputEl) inputEl.select();
	}

	async function commit() {
		if (buffer === value) {
			editing = false;
			return;
		}
		saving = true;
		try {
			await onSave(buffer);
			editing = false;
		} catch {
			// caller shows toast; stay in edit mode, preserve buffer so user can retry
		} finally {
			saving = false;
		}
	}

	function cancel() {
		buffer = value;
		editing = false;
	}

	function handleKey(e: KeyboardEvent) {
		if (e.key === 'Escape') {
			e.preventDefault();
			cancel();
		} else if (e.key === 'Enter' && (!multiline || e.ctrlKey || e.metaKey)) {
			e.preventDefault();
			commit();
		}
	}
</script>

{#if editing}
	{#if multiline}
		<Textarea
			bind:ref={inputEl}
			bind:value={buffer}
			{placeholder}
			disabled={saving}
			onkeydown={handleKey}
			onblur={commit}
			class={cn('w-full', displayClass)}
		/>
	{:else}
		<Input
			bind:ref={inputEl}
			bind:value={buffer}
			{placeholder}
			disabled={saving}
			onkeydown={handleKey}
			onblur={commit}
			class={cn('w-full', displayClass)}
		/>
	{/if}
{:else}
	<button
		type="button"
		class={cn(
			'-mx-1 w-full cursor-text rounded px-1 text-left transition-colors hover:bg-accent/50 focus:bg-accent/50 focus:outline-none',
			displayClass,
			!value && 'text-muted-foreground italic'
		)}
		onclick={startEdit}
		aria-label={ariaLabel ?? 'Click to edit'}
	>
		{value || emptyPlaceholder}
	</button>
{/if}
