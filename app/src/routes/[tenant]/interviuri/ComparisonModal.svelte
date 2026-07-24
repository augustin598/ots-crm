<script lang="ts">
	import { untrack } from 'svelte';
	import BarChart3Icon from '@lucide/svelte/icons/bar-chart-3';
	import XIcon from '@lucide/svelte/icons/x';
	import {
		IV_MONTHS,
		STATUS_COLOR,
		STATUS_LABEL,
		type ChannelMeta,
		type IvRow,
		type StatusSlug
	} from './lib';

	let {
		all,
		channelMeta,
		channelOrder,
		years,
		onClose
	}: {
		all: IvRow[];
		channelMeta: Record<string, ChannelMeta>;
		channelOrder: string[];
		years: number[];
		onClose: () => void;
	} = $props();

	const yrs = $derived(years.length ? years : [new Date().getFullYear()]);
	let ay = $state(
		untrack(() => (years.length > 1 ? years[years.length - 2] : years[0] ?? new Date().getFullYear()))
	);
	let am = $state('all');
	let by = $state(untrack(() => years[years.length - 1] ?? new Date().getFullYear()));
	let bm = $state('all');
	let mode = $state<'channel' | 'status'>('channel');

	const pick = (y: number, m: string) =>
		all.filter((r) => r.year === y && (m === 'all' || r.month === m));
	const A = $derived(pick(ay, am));
	const B = $derived(pick(by, bm));

	const labelOf = (y: number, m: string) => (m === 'all' ? 'tot anul ' : m + ' ') + y;
	const shortOf = (y: number, m: string) =>
		m === 'all' ? String(y) : `${m.slice(0, 3)} ${String(y).slice(2)}`;

	const statusKeys: StatusSlug[] = ['admisa', 'in_evaluare', 'respinsa'];
	const keys = $derived.by(() =>
		mode === 'channel'
			? channelOrder.filter((ch) => A.some((r) => r.channel === ch) || B.some((r) => r.channel === ch))
			: statusKeys
	);
	const countBy = (arr: IvRow[], k: string) =>
		arr.filter((r) => (mode === 'channel' ? r.channel : r.status) === k).length;
	const metaOf = (k: string): { label: string; color: string } =>
		mode === 'channel'
			? { label: k, color: channelMeta[k]?.color ?? '#94a3b8' }
			: { label: STATUS_LABEL[k as StatusSlug], color: STATUS_COLOR[k as StatusSlug] };
	const max = $derived(Math.max(1, ...keys.map((k) => Math.max(countBy(A, k), countBy(B, k)))));

	const delta = $derived(B.length - A.length);
	const pctDelta = $derived(A.length ? Math.round((delta / A.length) * 100) : B.length ? 100 : 0);

	function onKey(e: KeyboardEvent) {
		if (e.key === 'Escape') onClose();
	}
</script>

<svelte:window onkeydown={onKey} />

<div
	class="iv-modal-backdrop"
	role="presentation"
	onclick={(e) => {
		if (e.target === e.currentTarget) onClose();
	}}
>
	<div class="iv-modal iv-cmp-modal" role="dialog" aria-modal="true">
		<div class="iv-modal-head">
			<div class="iv-modal-head-ic"><BarChart3Icon size={18} /></div>
			<div>
				<h3>Comparație perioade</h3>
				<p>Evoluția interviurilor pe canale și status, între două perioade</p>
			</div>
			<button class="cl-icon-btn iv-modal-close" onclick={onClose} aria-label="Închide">
				<XIcon size={16} />
			</button>
		</div>

		<div class="iv-modal-body">
			<div class="iv-cmp-periods">
				<div class="iv-cmp-period">
					<div class="iv-cmp-period-head">
						<span class="iv-cmp-swatch" style="background:#334155"></span> Perioada A
					</div>
					<div class="iv-cmp-selects">
						<select class="cl-select" bind:value={am}>
							<option value="all">Tot anul</option>
							{#each IV_MONTHS as m (m)}<option value={m}>{m}</option>{/each}
						</select>
						<select class="cl-select" bind:value={ay}>
							{#each yrs as y (y)}<option value={y}>{y}</option>{/each}
						</select>
					</div>
				</div>
				<div class="iv-cmp-vs">vs</div>
				<div class="iv-cmp-period">
					<div class="iv-cmp-period-head">
						<span class="iv-cmp-swatch" style="background:#334155; opacity:.4"></span> Perioada B
					</div>
					<div class="iv-cmp-selects">
						<select class="cl-select" bind:value={bm}>
							<option value="all">Tot anul</option>
							{#each IV_MONTHS as m (m)}<option value={m}>{m}</option>{/each}
						</select>
						<select class="cl-select" bind:value={by}>
							{#each yrs as y (y)}<option value={y}>{y}</option>{/each}
						</select>
					</div>
				</div>
			</div>

			<div class="iv-cmp-totals">
				<div class="iv-cmp-total-card">
					<div class="iv-cmp-total-lbl">A · {labelOf(ay, am)}</div>
					<div class="iv-cmp-total-val">{A.length}</div>
				</div>
				<div class="iv-cmp-total-card">
					<div class="iv-cmp-total-lbl">
						B · {labelOf(by, bm)}
						<span class="iv-cmp-delta {delta > 0 ? 'up' : delta < 0 ? 'down' : 'flat'}">
							{delta > 0 ? '▲' : delta < 0 ? '▼' : '='}
							{delta === 0 ? 'egal' : `${delta > 0 ? '+' : ''}${delta} (${pctDelta > 0 ? '+' : ''}${pctDelta}%)`}
						</span>
					</div>
					<div class="iv-cmp-total-val">{B.length}</div>
				</div>
			</div>

			<div class="iv-seg" style="max-width:260px">
				<button
					type="button"
					class={mode === 'channel' ? 'active ok' : ''}
					style={mode === 'channel' ? 'background:#0f172a; color:#fff' : ''}
					onclick={() => (mode = 'channel')}>Pe canal</button
				>
				<button
					type="button"
					class={mode === 'status' ? 'active ok' : ''}
					style={mode === 'status' ? 'background:#0f172a; color:#fff' : ''}
					onclick={() => (mode = 'status')}>Pe status</button
				>
			</div>

			<div class="iv-cmp-rows" style="margin-top:14px">
				{#each keys as k (k)}
					{@const m = metaOf(k)}
					{@const a = countBy(A, k)}
					{@const b = countBy(B, k)}
					<div class="iv-cmp-row">
						<div class="iv-cmp-row-name">
							<span class="iv-ch-dot" style="background:{m.color}"></span>
							<span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">{m.label}</span>
						</div>
						<div class="iv-cmp-bars">
							{#each [{ v: a, tag: shortOf(ay, am), fade: false }, { v: b, tag: shortOf(by, bm), fade: true }] as bar (bar.tag + bar.fade)}
								{@const w = (bar.v / max) * 100}
								{@const inside = w >= 18}
								<div class="iv-cmp-bar-line">
									<span class="iv-cmp-bar-tag">{bar.tag}</span>
									<div class="iv-cmp-bar-track">
										<div
											class="iv-cmp-bar-fill"
											style="width:{w}%; background:{m.color}; opacity:{bar.fade
												? 0.32
												: 1}; padding:{inside ? '0 9px' : '0'}"
										>
											{#if inside}<span
													class="iv-cmp-inbar"
													style="color:{bar.fade ? 'var(--cl-text)' : '#fff'}">{bar.v}</span
												>{/if}
										</div>
										{#if !inside}<span class="iv-cmp-tip">{bar.v}</span>{/if}
									</div>
								</div>
							{/each}
						</div>
					</div>
				{/each}
				{#if keys.length === 0}
					<div class="cl-budget-empty">Nicio dată în perioadele selectate.</div>
				{/if}
			</div>
		</div>

		<div class="iv-modal-foot">
			<button class="cl-btn-primary" onclick={onClose}>Închide</button>
		</div>
	</div>
</div>
