<script lang="ts">
	import { untrack } from 'svelte';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import { Button } from '$lib/components/ui/button';
	import PlusIcon from '@lucide/svelte/icons/plus';
	import XIcon from '@lucide/svelte/icons/x';
	import type { TextFieldSpec } from '$lib/shared/google-ads-specs';

	let {
		fields,
		textData = $bindable({})
	}: {
		fields: TextFieldSpec[];
		textData: Record<string, string[]>;
	} = $props();

	// Initialize textData for each field with min slots (only when fields change)
	$effect(() => {
		const f = fields; // track fields dependency only
		untrack(() => {
			for (const field of f) {
				if (!textData[field.key]) {
					textData[field.key] = Array(Math.max(field.min, 1)).fill('');
				}
			}
		});
	});

	function addField(key: string, max: number) {
		const current = textData[key] || [];
		if (current.length < max) {
			textData[key] = [...current, ''];
		}
	}

	function removeField(key: string, index: number, min: number) {
		const current = textData[key] || [];
		if (current.length > min) {
			textData[key] = current.filter((_, i) => i !== index);
		}
	}

	function updateField(key: string, index: number, value: string) {
		const current = [...(textData[key] || [])];
		current[index] = value;
		textData[key] = current;
	}
</script>

<div class="space-y-6">
	{#each fields as field (field.key)}
		{@const values = textData[field.key] || ['']}
		{@const filledCount = values.filter((v) => v.trim().length > 0).length}
		<div class="space-y-2">
			<div class="flex items-center justify-between">
				<Label class="text-sm font-medium">
					{field.label}
					{#if field.required}
						<span class="text-red-500">*</span>
					{/if}
				</Label>
				<div class="flex items-center gap-2">
					<span
						class="text-xs px-2 py-0.5 rounded-full {filledCount >= field.min
							? 'bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300'
							: 'bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300'}"
					>
						{filledCount}/{field.max}
					</span>
					{#if values.length < field.max}
						<Button
							variant="ghost"
							size="sm"
							class="h-6 w-6 p-0"
							onclick={() => addField(field.key, field.max)}
						>
							<PlusIcon class="h-3.5 w-3.5" />
						</Button>
					{/if}
				</div>
			</div>

			{#if field.hint}
				<p class="text-xs text-muted-foreground">{field.hint}</p>
			{/if}

			{#each values as value, idx (idx)}
				{@const charCount = value.length}
				{@const isOverLimit = charCount > field.maxLength}
				<div class="flex items-center gap-2">
					<div class="relative flex-1">
						<Input
							type="text"
							{value}
							oninput={(e) => updateField(field.key, idx, e.currentTarget.value)}
							placeholder="{field.label} {values.length > 1 ? idx + 1 : ''}"
							class="pr-16 {isOverLimit ? 'border-red-500 focus-visible:ring-red-500' : ''}"
							maxlength={field.maxLength + 10}
						/>
						<span
							class="absolute right-3 top-1/2 -translate-y-1/2 text-xs {isOverLimit
								? 'text-red-500 font-medium'
								: charCount > field.maxLength * 0.8
									? 'text-amber-500'
									: 'text-muted-foreground'}"
						>
							{charCount}/{field.maxLength}
						</span>
					</div>
					{#if values.length > field.min}
						<Button
							variant="ghost"
							size="sm"
							class="h-8 w-8 p-0 text-muted-foreground hover:text-destructive"
							onclick={() => removeField(field.key, idx, field.min)}
						>
							<XIcon class="h-3.5 w-3.5" />
						</Button>
					{/if}
				</div>
			{/each}
		</div>
	{/each}
</div>
