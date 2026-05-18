<script lang="ts">
	import { useQueryState, parseAsArrayOf, parseAsStringEnum, parseAsString } from 'nuqs-svelte';
	import { Popover, PopoverContent, PopoverTrigger } from '$lib/components/ui/popover';
	import SearchIcon from '@lucide/svelte/icons/search';
	import XIcon from '@lucide/svelte/icons/x';
	import ChevronDownIcon from '@lucide/svelte/icons/chevron-down';
	import FlameIcon from '@lucide/svelte/icons/flame';
	import BuildingIcon from '@lucide/svelte/icons/building-2';
	import UsersIcon from '@lucide/svelte/icons/users';
	import LayersIcon from '@lucide/svelte/icons/layers';
	import FilterIcon from '@lucide/svelte/icons/filter';
	import SettingsIcon from '@lucide/svelte/icons/settings';

	type ClientOpt = { id: string; name: string; color?: string | null };
	type UserOpt = {
		id: string;
		firstName: string;
		lastName: string;
		email: string;
	};

	type Props = {
		clients?: ClientOpt[];
		users?: UserOpt[];
	};

	let { clients = [], users = [] }: Props = $props();

	// Re-uses the SAME nuqs query keys as TaskFilters/TaskFiltersPopover so URL state
	// stays in sync across components. Pills are single-select; multi-select arrays
	// are normalized to 0-or-1 elements.
	const priorities = useQueryState(
		'priority',
		parseAsArrayOf(parseAsStringEnum(['low', 'medium', 'high', 'urgent']))
	);
	const clientId = useQueryState('client', parseAsString.withDefault(''));
	const assignees = useQueryState('assignee', parseAsArrayOf(parseAsString));
	const taskType = useQueryState(
		'type',
		parseAsStringEnum(['design', 'video', 'ads', 'dev', 'content', 'meeting', 'other'])
	);
	const search = useQueryState('search', parseAsString.withDefault(''));

	const TASK_TYPES = [
		{ id: 'design', label: 'Design', color: '#8b5cf6' },
		{ id: 'video', label: 'Video', color: '#ec4899' },
		{ id: 'ads', label: 'Ads', color: '#1877F2' },
		{ id: 'dev', label: 'Dev', color: '#06b6d4' },
		{ id: 'content', label: 'Content', color: '#10b981' },
		{ id: 'meeting', label: 'Meeting', color: '#f59e0b' },
		{ id: 'other', label: 'Other', color: '#94a3b8' }
	] as const;

	const PRIORITY_OPTS = [
		{ id: 'urgent', label: 'Urgent', color: '#ef4444' },
		{ id: 'high', label: 'High', color: '#f59e0b' },
		{ id: 'medium', label: 'Medium', color: '#10b981' },
		{ id: 'low', label: 'Low', color: '#94a3b8' }
	] as const;

	// Single selected values (first element of array, or null)
	const selectedPriority = $derived(
		((priorities.current as string[] | null) ?? [])[0] ?? null
	);
	const selectedAssignee = $derived(
		((assignees.current as string[] | null) ?? [])[0] ?? null
	);

	function setPriority(value: string | null) {
		priorities.current = (value ? [value] : null) as any;
	}
	function setAssignee(value: string | null) {
		assignees.current = (value ? [value] : null) as any;
	}
	function setClient(value: string | null) {
		clientId.current = value ?? '';
	}
	function setType(value: string | null) {
		taskType.current = value as any;
	}

	const activeCount = $derived(
		(selectedPriority ? 1 : 0) +
			(clientId.current ? 1 : 0) +
			(selectedAssignee ? 1 : 0) +
			(taskType.current ? 1 : 0)
	);

	const selectedPriorityLabel = $derived(
		selectedPriority
			? PRIORITY_OPTS.find((p) => p.id === selectedPriority)?.label
			: null
	);
	const selectedClientLabel = $derived(
		clientId.current ? clients.find((c) => c.id === clientId.current)?.name : null
	);
	const selectedAssigneeLabel = $derived.by(() => {
		if (!selectedAssignee) return null;
		const u = users.find((x) => x.id === selectedAssignee);
		if (!u) return null;
		const full = `${u.firstName} ${u.lastName}`.trim();
		return full || u.email;
	});
	const selectedTypeLabel = $derived(
		taskType.current ? TASK_TYPES.find((t) => t.id === taskType.current)?.label : null
	);

	function clearAll() {
		setPriority(null);
		setClient(null);
		setAssignee(null);
		setType(null);
		search.current = '';
	}

	function getUserDisplayName(u: UserOpt): string {
		const full = `${u.firstName} ${u.lastName}`.trim();
		return full || u.email;
	}
</script>

<div class="flex flex-wrap items-center gap-2">
	<!-- Search -->
	<div class="relative min-w-[240px] max-w-[420px] flex-1">
		<SearchIcon
			class="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[#94a3b8]"
		/>
		<input
			class="h-9 w-full rounded-lg border border-[#d5dbe5] bg-white pl-9 pr-8 text-[13px] text-[#0f172a] placeholder:text-[#94a3b8] focus:border-[#1877F2] focus:outline-none focus:ring-2 focus:ring-[#1877F2]/10 dark:bg-zinc-900 dark:text-zinc-100"
			placeholder="Caută în taskuri (titlu, client, tag...)"
			bind:value={search.current}
		/>
		{#if search.current}
			<button
				type="button"
				class="absolute right-2 top-1/2 grid h-5 w-5 -translate-y-1/2 place-items-center rounded bg-[#f1f5f9] text-[#475569] hover:bg-[#e2e8f0]"
				onclick={() => (search.current = '')}
				aria-label="Clear search"
			>
				<XIcon class="h-3 w-3" />
			</button>
		{/if}
	</div>

	<!-- Prioritate pill -->
	<Popover>
		<PopoverTrigger>
			{#snippet child({ props })}
				<button
					{...props}
					type="button"
					class={[
						'inline-flex items-center gap-1.5 rounded-lg border px-3 py-2 text-[12.5px] font-medium transition-colors',
						selectedPriority
							? 'border-[#1877F2] bg-[#f0f7ff] text-[#1877F2]'
							: 'border-[#d5dbe5] bg-white text-[#475569] hover:border-[#1877F2] hover:text-[#0f172a] dark:bg-zinc-900 dark:text-zinc-300'
					].join(' ')}
				>
					<FlameIcon class="h-3 w-3" />
					<span>{selectedPriorityLabel ?? 'Prioritate'}</span>
					{#if selectedPriority}
						<span
							role="button"
							tabindex="-1"
							class="grid h-4 w-4 cursor-pointer place-items-center rounded-full bg-[#1877F2]/15"
							onclick={(e) => {
								e.stopPropagation();
								setPriority(null);
							}}
							onkeydown={(e) => {
								if (e.key === 'Enter' || e.key === ' ') {
									e.preventDefault();
									e.stopPropagation();
									setPriority(null);
								}
							}}
							aria-label="Clear priority"
						>
							<XIcon class="h-2.5 w-2.5" />
						</span>
					{/if}
					<ChevronDownIcon class="h-2.5 w-2.5" />
				</button>
			{/snippet}
		</PopoverTrigger>
		<PopoverContent class="w-[200px] p-1" align="start">
			{#each PRIORITY_OPTS as opt (opt.id)}
				<button
					type="button"
					class={[
						'flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-[12.5px] transition-colors',
						selectedPriority === opt.id
							? 'bg-[#f0f7ff] font-semibold text-[#1877F2]'
							: 'text-[#0f172a] hover:bg-[#f1f5f9]'
					].join(' ')}
					onclick={() => setPriority(selectedPriority === opt.id ? null : opt.id)}
				>
					<span class="h-2 w-2 rounded-full" style:background-color={opt.color}></span>
					{opt.label}
				</button>
			{/each}
		</PopoverContent>
	</Popover>

	<!-- Client pill -->
	{#if clients.length > 0}
		<Popover>
			<PopoverTrigger>
				{#snippet child({ props })}
					<button
						{...props}
						type="button"
						class={[
							'inline-flex items-center gap-1.5 rounded-lg border px-3 py-2 text-[12.5px] font-medium transition-colors',
							clientId.current
								? 'border-[#1877F2] bg-[#f0f7ff] text-[#1877F2]'
								: 'border-[#d5dbe5] bg-white text-[#475569] hover:border-[#1877F2] hover:text-[#0f172a] dark:bg-zinc-900 dark:text-zinc-300'
						].join(' ')}
					>
						<BuildingIcon class="h-3 w-3" />
						<span class="max-w-[140px] truncate">{selectedClientLabel ?? 'Client'}</span>
						{#if clientId.current}
							<span
								role="button"
								tabindex="-1"
								class="grid h-4 w-4 cursor-pointer place-items-center rounded-full bg-[#1877F2]/15"
								onclick={(e) => {
									e.stopPropagation();
									setClient(null);
								}}
								onkeydown={(e) => {
									if (e.key === 'Enter' || e.key === ' ') {
										e.preventDefault();
										e.stopPropagation();
										setClient(null);
									}
								}}
								aria-label="Clear client"
							>
								<XIcon class="h-2.5 w-2.5" />
							</span>
						{/if}
						<ChevronDownIcon class="h-2.5 w-2.5" />
					</button>
				{/snippet}
			</PopoverTrigger>
			<PopoverContent class="max-h-[280px] w-[240px] overflow-y-auto p-1" align="start">
				{#each clients as c (c.id)}
					<button
						type="button"
						class={[
							'flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-[12.5px] transition-colors',
							clientId.current === c.id
								? 'bg-[#f0f7ff] font-semibold text-[#1877F2]'
								: 'text-[#0f172a] hover:bg-[#f1f5f9]'
						].join(' ')}
						onclick={() => setClient(clientId.current === c.id ? null : c.id)}
						title={c.name}
					>
						<span
							class="h-2 w-2 shrink-0 rounded-full"
							style:background-color={c.color ?? '#94a3b8'}
						></span>
						<span class="truncate">{c.name}</span>
					</button>
				{/each}
			</PopoverContent>
		</Popover>
	{/if}

	<!-- Responsabil pill -->
	{#if users.length > 0}
		<Popover>
			<PopoverTrigger>
				{#snippet child({ props })}
					<button
						{...props}
						type="button"
						class={[
							'inline-flex items-center gap-1.5 rounded-lg border px-3 py-2 text-[12.5px] font-medium transition-colors',
							selectedAssignee
								? 'border-[#1877F2] bg-[#f0f7ff] text-[#1877F2]'
								: 'border-[#d5dbe5] bg-white text-[#475569] hover:border-[#1877F2] hover:text-[#0f172a] dark:bg-zinc-900 dark:text-zinc-300'
						].join(' ')}
					>
						<UsersIcon class="h-3 w-3" />
						<span class="max-w-[140px] truncate">{selectedAssigneeLabel ?? 'Responsabil'}</span>
						{#if selectedAssignee}
							<span
								role="button"
								tabindex="-1"
								class="grid h-4 w-4 cursor-pointer place-items-center rounded-full bg-[#1877F2]/15"
								onclick={(e) => {
									e.stopPropagation();
									setAssignee(null);
								}}
								onkeydown={(e) => {
									if (e.key === 'Enter' || e.key === ' ') {
										e.preventDefault();
										e.stopPropagation();
										setAssignee(null);
									}
								}}
								aria-label="Clear assignee"
							>
								<XIcon class="h-2.5 w-2.5" />
							</span>
						{/if}
						<ChevronDownIcon class="h-2.5 w-2.5" />
					</button>
				{/snippet}
			</PopoverTrigger>
			<PopoverContent class="max-h-[280px] w-[240px] overflow-y-auto p-1" align="start">
				{#each users as u (u.id)}
					<button
						type="button"
						class={[
							'flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-[12.5px] transition-colors',
							selectedAssignee === u.id
								? 'bg-[#f0f7ff] font-semibold text-[#1877F2]'
								: 'text-[#0f172a] hover:bg-[#f1f5f9]'
						].join(' ')}
						onclick={() => setAssignee(selectedAssignee === u.id ? null : u.id)}
					>
						<span class="truncate">{getUserDisplayName(u)}</span>
					</button>
				{/each}
			</PopoverContent>
		</Popover>
	{/if}

	<!-- Tip pill -->
	<Popover>
		<PopoverTrigger>
			{#snippet child({ props })}
				<button
					{...props}
					type="button"
					class={[
						'inline-flex items-center gap-1.5 rounded-lg border px-3 py-2 text-[12.5px] font-medium transition-colors',
						taskType.current
							? 'border-[#1877F2] bg-[#f0f7ff] text-[#1877F2]'
							: 'border-[#d5dbe5] bg-white text-[#475569] hover:border-[#1877F2] hover:text-[#0f172a] dark:bg-zinc-900 dark:text-zinc-300'
					].join(' ')}
				>
					<LayersIcon class="h-3 w-3" />
					<span>{selectedTypeLabel ?? 'Tip'}</span>
					{#if taskType.current}
						<span
							role="button"
							tabindex="-1"
							class="grid h-4 w-4 cursor-pointer place-items-center rounded-full bg-[#1877F2]/15"
							onclick={(e) => {
								e.stopPropagation();
								setType(null);
							}}
							onkeydown={(e) => {
								if (e.key === 'Enter' || e.key === ' ') {
									e.preventDefault();
									e.stopPropagation();
									setType(null);
								}
							}}
							aria-label="Clear type"
						>
							<XIcon class="h-2.5 w-2.5" />
						</span>
					{/if}
					<ChevronDownIcon class="h-2.5 w-2.5" />
				</button>
			{/snippet}
		</PopoverTrigger>
		<PopoverContent class="w-[200px] p-1" align="start">
			{#each TASK_TYPES as opt (opt.id)}
				<button
					type="button"
					class={[
						'flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-[12.5px] transition-colors',
						taskType.current === opt.id
							? 'bg-[#f0f7ff] font-semibold text-[#1877F2]'
							: 'text-[#0f172a] hover:bg-[#f1f5f9]'
					].join(' ')}
					onclick={() => setType(taskType.current === opt.id ? null : opt.id)}
				>
					<span class="h-2 w-2 rounded-full" style:background-color={opt.color}></span>
					{opt.label}
				</button>
			{/each}
		</PopoverContent>
	</Popover>

	{#if activeCount > 0}
		<button
			type="button"
			class="px-2 py-2 text-[12px] font-semibold text-[#ef4444] transition-colors hover:text-[#dc2626]"
			onclick={clearAll}
		>
			Șterge filtre ({activeCount})
		</button>
	{/if}

	<div class="flex-1"></div>

	<button
		type="button"
		class="grid h-8 w-8 place-items-center rounded-md text-[#94a3b8] hover:bg-[#f1f5f9] hover:text-[#0f172a]"
		title="Sortare"
		aria-label="Sortare"
	>
		<FilterIcon class="h-3.5 w-3.5" />
	</button>
	<button
		type="button"
		class="grid h-8 w-8 place-items-center rounded-md text-[#94a3b8] hover:bg-[#f1f5f9] hover:text-[#0f172a]"
		title="Setări coloane"
		aria-label="Setări coloane"
	>
		<SettingsIcon class="h-3.5 w-3.5" />
	</button>
</div>
