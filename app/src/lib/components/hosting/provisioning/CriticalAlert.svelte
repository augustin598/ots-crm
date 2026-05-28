<script lang="ts">
	import AlertTriangleIcon from '@lucide/svelte/icons/alert-triangle';
	import RefreshCwIcon from '@lucide/svelte/icons/refresh-cw';
	import EyeIcon from '@lucide/svelte/icons/eye';
	import type { CriticalItem } from './types';

	let {
		items,
		onRetry,
		onOpen
	}: {
		items: CriticalItem[];
		onRetry: (item: CriticalItem) => void;
		onOpen: (item: CriticalItem) => void;
	} = $props();
</script>

{#if items.length > 0}
	<div
		class="overflow-hidden rounded-xl border border-rose-200 bg-rose-50 dark:border-rose-900/40 dark:bg-rose-950/30"
	>
		<div
			class="flex items-center gap-2.5 border-b border-rose-200 bg-rose-100/40 px-4 py-3 dark:border-rose-900/40 dark:bg-rose-900/20"
		>
			<div
				class="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-md bg-rose-500 text-white"
			>
				<AlertTriangleIcon class="h-3.5 w-3.5" />
			</div>
			<div class="flex-1">
				<strong class="block text-[13px] font-bold text-rose-900 dark:text-rose-200">
					{items.length}
					{items.length === 1 ? 'cont' : 'conturi'} în stare critică
				</strong>
				<span class="text-[11.5px] text-rose-700 dark:text-rose-300">
					Eșuate sau blocate &gt; 5min · acțiune recomandată: retry sau intervenție manuală
				</span>
			</div>
		</div>

		<div class="flex flex-col">
			{#each items as item (item.id)}
				<div
					class="flex items-center gap-3 border-b border-rose-200/60 px-4 py-2.5 last:border-b-0 dark:border-rose-900/30"
				>
					<div
						class="h-2 w-2 flex-shrink-0 rounded-full {item.status === 'failed'
							? 'bg-rose-500'
							: 'bg-amber-500'}"
					></div>
					<button
						type="button"
						class="min-w-0 flex-1 cursor-pointer text-left"
						onclick={() => onOpen(item)}
					>
						<div class="font-mono text-[13px] font-semibold text-slate-900 hover:text-blue-600 dark:text-slate-100 dark:hover:text-blue-400">
							{item.domain}
						</div>
						<div class="mt-0.5 text-[11px] text-slate-600 dark:text-slate-400">
							{#if item.status === 'failed'}
								Eșuat
							{:else}
								Pending {item.pendingSinceMin ?? 0} min
							{/if}
							· {item.daServerName ?? '—'}
							{#if item.clientName}
								· {item.clientName}
							{/if}
							{#if item.errorMessage}
								·
								<span class="font-mono font-semibold text-rose-700 dark:text-rose-400"
									>{item.errorMessage}</span
								>
							{/if}
						</div>
					</button>
					<button
						type="button"
						class="inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-2.5 py-1 text-[12px] font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
						onclick={() => onOpen(item)}
					>
						<EyeIcon class="h-3 w-3" /> Detalii
					</button>
					<button
						type="button"
						class="inline-flex items-center gap-1.5 rounded-md bg-rose-500 px-2.5 py-1 text-[12px] font-semibold text-white hover:bg-rose-600"
						onclick={() => onRetry(item)}
					>
						<RefreshCwIcon class="h-3 w-3" /> Retry
					</button>
				</div>
			{/each}
		</div>
	</div>
{/if}
