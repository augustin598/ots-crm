<script lang="ts">
	import { Popover, PopoverContent, PopoverTrigger } from '$lib/components/ui/popover';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Check, ChevronsUpDown } from 'lucide-svelte';
	import { cn } from '$lib/utils';

	type Option = {
		value: string | number;
		label: string;
	};

	let {
		options = $bindable([] as Option[]),
		value = $bindable<number | string | undefined>(undefined),
		placeholder = 'Select option...',
		searchPlaceholder = 'Search...',
		disabled = false,
		class: className
	}: {
		options?: Option[];
		value?: number | string | undefined;
		placeholder?: string;
		searchPlaceholder?: string;
		disabled?: boolean;
		class?: string;
	} = $props();

	let open = $state(false);
	let searchQuery = $state('');

	const filteredOptions = $derived.by(() => {
		if (!searchQuery.trim()) {
			return options;
		}
		const query = searchQuery.toLowerCase();
		return options.filter((option) => option.label.toLowerCase().includes(query));
	});

	const selectedOption = $derived.by(() => {
		if (value === undefined || value === null) return undefined;
		return options.find((opt) => {
			// Handle both number and string comparisons
			if (typeof opt.value === 'number' && typeof value === 'number') {
				return opt.value === value;
			}
			return String(opt.value) === String(value);
		});
	});

	function selectOption(option: Option) {
		value = option.value;
		open = false;
		searchQuery = '';
	}
</script>

<Popover bind:open>
	<PopoverTrigger>
		{#snippet child({ props })}
			<Button
				{...props}
				variant="outline"
				role="combobox"
				aria-expanded={open}
				class={cn('w-full justify-between', className)}
				{disabled}
			>
				<span class="truncate">
					{selectedOption ? selectedOption.label : placeholder}
				</span>
				<ChevronsUpDown class="ml-2 h-4 w-4 shrink-0 opacity-50" />
			</Button>
		{/snippet}
	</PopoverTrigger>
	<PopoverContent class="w-(--bits-popover-trigger-width) p-0" align="start">
		<div class="flex flex-col">
			<div class="border-b p-2">
				<Input
					placeholder={searchPlaceholder}
					bind:value={searchQuery}
					class="h-8"
					onkeydown={(e) => {
						if (e.key === 'Escape') {
							open = false;
							searchQuery = '';
						}
					}}
				/>
			</div>
			<div class="max-h-[300px] overflow-y-auto p-1">
				{#if filteredOptions.length === 0}
					<div class="py-6 text-center text-sm text-muted-foreground">
						No options found.
					</div>
				{:else}
					{#each filteredOptions as option}
						<button
							type="button"
							class={cn(
								'relative flex w-full cursor-pointer select-none items-center rounded-sm px-2 py-1.5 text-sm outline-none transition-colors hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:text-accent-foreground',
								(String(value) === String(option.value)) && 'bg-accent text-accent-foreground'
							)}
							onclick={() => selectOption(option)}
						>
							<Check
								class={cn(
									'mr-2 h-4 w-4',
									(String(value) === String(option.value)) ? 'opacity-100' : 'opacity-0'
								)}
							/>
							{option.label}
						</button>
					{/each}
				{/if}
			</div>
		</div>
	</PopoverContent>
</Popover>

