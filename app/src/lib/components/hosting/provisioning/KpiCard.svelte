<script lang="ts">
	import type { Component } from 'svelte';
	import ArrowUpIcon from '@lucide/svelte/icons/arrow-up';
	import ArrowDownIcon from '@lucide/svelte/icons/arrow-down';

	type Tone = 'primary' | 'success' | 'warn' | 'danger' | 'info';
	type TrendDir = 'up' | 'down' | 'flat';

	let {
		icon: Icon,
		tone = 'primary',
		label,
		value,
		sub,
		trend,
		trendDir
	}: {
		icon: Component<{ class?: string }>;
		tone?: Tone;
		label: string;
		value: string | number;
		sub?: string;
		trend?: string;
		trendDir?: TrendDir;
	} = $props();

	const toneBg: Record<Tone, string> = {
		primary: 'bg-blue-100 text-blue-600 dark:bg-blue-900/40 dark:text-blue-300',
		success:
			'bg-emerald-100 text-emerald-600 dark:bg-emerald-900/40 dark:text-emerald-300',
		warn: 'bg-amber-100 text-amber-600 dark:bg-amber-900/40 dark:text-amber-300',
		danger: 'bg-rose-100 text-rose-600 dark:bg-rose-900/40 dark:text-rose-300',
		info: 'bg-indigo-100 text-indigo-600 dark:bg-indigo-900/40 dark:text-indigo-300'
	};

	const trendBg: Record<TrendDir, string> = {
		up: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300',
		down: 'bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300',
		flat: 'bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300'
	};
</script>

<div
	class="flex flex-col rounded-xl border border-slate-200 bg-white p-3.5 dark:border-slate-800 dark:bg-slate-900"
>
	<div class="mb-2 flex items-center gap-2">
		<div
			class="flex h-7 w-7 items-center justify-center rounded-md {toneBg[tone]}"
		>
			<Icon class="h-3.5 w-3.5" />
		</div>
		<span
			class="text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400"
		>
			{label}
		</span>
	</div>

	<div
		class="font-bold leading-tight tabular-nums text-slate-900 dark:text-slate-50"
		style="font-size:24px;letter-spacing:-0.02em;"
	>
		{value}
	</div>

	<div class="mt-1.5 flex items-center gap-2 text-[11px]">
		{#if trend != null}
			<span
				class="inline-flex items-center gap-0.5 rounded-full px-1.5 py-px font-semibold {trendBg[
					trendDir ?? 'flat'
				]}"
			>
				{#if trendDir === 'up'}
					<ArrowUpIcon class="h-2.5 w-2.5" />
				{:else if trendDir === 'down'}
					<ArrowDownIcon class="h-2.5 w-2.5" />
				{/if}
				{trend}
			</span>
		{/if}
		{#if sub}
			<span class="text-slate-400 dark:text-slate-500">{sub}</span>
		{/if}
	</div>
</div>
