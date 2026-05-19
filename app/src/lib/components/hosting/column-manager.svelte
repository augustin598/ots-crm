<script lang="ts">
	import type { ColumnDef, ColumnConfig } from './column-manager';

	type Props = {
		columns: ColumnDef[];
		value: ColumnConfig;
		onchange: (next: ColumnConfig) => void;
		class?: string;
	};

	let { columns, value, onchange, class: className = '' }: Props = $props();

	let draggedKey = $state<string | null>(null);
	let dragOverKey = $state<string | null>(null);

	function move(fromKey: string, toKey: string): void {
		if (fromKey === toKey) return;
		const next = [...value.order];
		const fromIdx = next.indexOf(fromKey);
		const toIdx = next.indexOf(toKey);
		if (fromIdx === -1 || toIdx === -1) return;
		next.splice(fromIdx, 1);
		next.splice(toIdx, 0, fromKey);
		onchange({ order: next, visible: value.visible });
	}

	function toggle(key: string): void {
		onchange({
			order: value.order,
			visible: { ...value.visible, [key]: !value.visible[key] }
		});
	}
</script>

<div role="list" aria-label="Configurare coloane" class="flex flex-col gap-1 {className}">
	{#each value.order as key (key)}
		{@const col = columns.find((c) => c.key === key)}
		{#if col}
			{@const isVisible = col.required === true || value.visible[key] === true}
			{@const isDragOver = dragOverKey === key && draggedKey !== key}
			<div
				role="listitem"
				aria-grabbed={draggedKey === key}
				draggable={!col.required}
				ondragstart={() => (draggedKey = key)}
				ondragend={() => {
					draggedKey = null;
					dragOverKey = null;
				}}
				ondragover={(e) => {
					e.preventDefault();
					dragOverKey = key;
				}}
				ondragleave={() => (dragOverKey = null)}
				ondrop={(e) => {
					e.preventDefault();
					if (draggedKey) move(draggedKey, key);
					draggedKey = null;
					dragOverKey = null;
				}}
				class={[
					'flex items-center gap-2 rounded-lg border px-3 py-2 select-none',
					isDragOver
						? 'border-dashed border-blue-500 bg-blue-50 dark:bg-blue-950'
						: 'border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-800',
					isVisible ? 'opacity-100' : 'opacity-55',
					col.required ? 'cursor-default' : 'cursor-grab'
				].join(' ')}
			>
				<span
					aria-hidden="true"
					class="font-mono text-sm leading-none text-slate-300 {col.required
						? 'cursor-not-allowed'
						: 'cursor-grab'}">⋮⋮</span
				>

				<div class="min-w-0 flex-1">
					<div class="flex items-center gap-1.5 text-xs font-semibold text-slate-900 dark:text-slate-100">
						{col.label}
						{#if col.isNew}
							<span class="rounded bg-blue-600 px-1 py-0.5 text-[9px] font-bold tracking-wider text-white"
								>NEW</span
							>
						{/if}
						{#if col.required}
							<span
								class="rounded bg-slate-200 px-1 py-0.5 text-[9px] font-semibold text-slate-600 dark:bg-slate-700 dark:text-slate-300"
								>REQUIRED</span
							>
						{/if}
					</div>
					{#if col.field || col.type}
						<div class="mt-0.5 font-mono text-[10px] text-slate-400">
							{col.field ?? ''}{col.field && col.type ? ': ' : ''}{col.type ?? ''}
						</div>
					{/if}
				</div>

				<button
					type="button"
					onclick={() => !col.required && toggle(key)}
					disabled={col.required}
					aria-pressed={isVisible}
					aria-label={isVisible ? `Ascunde ${col.label}` : `Afișează ${col.label}`}
					class={[
						'relative h-[18px] w-8 shrink-0 rounded-full border-0 p-0 transition-colors',
						isVisible ? 'bg-blue-600' : 'bg-slate-300 dark:bg-slate-600',
						col.required ? 'cursor-not-allowed' : 'cursor-pointer'
					].join(' ')}
				>
					<span
						class="absolute top-0.5 size-3.5 rounded-full bg-white shadow transition-[left]"
						style:left={isVisible ? '16px' : '2px'}
					></span>
				</button>
			</div>
		{/if}
	{/each}
</div>
