<script lang="ts">
	import Popover from './Popover.svelte';
	import Search from '@lucide/svelte/icons/search';
	import X from '@lucide/svelte/icons/x';
	import Activity from '@lucide/svelte/icons/activity';
	import Target from '@lucide/svelte/icons/target';
	import Layers from '@lucide/svelte/icons/layers';
	import DollarSign from '@lucide/svelte/icons/dollar-sign';
	import Sliders from '@lucide/svelte/icons/sliders-horizontal';
	import Users from '@lucide/svelte/icons/users';
	import ChevronDown from '@lucide/svelte/icons/chevron-down';
	import Check from '@lucide/svelte/icons/check';
	import IconFacebook from '$lib/components/marketing/icon-facebook.svelte';
	import Instagram from '@lucide/svelte/icons/instagram';
	import { rkIcon } from './rk-icons';

	export interface RkFilters {
		q: string;
		status: string[];
		objectives: string[];
		platforms: string[];
		placements: string[];
		budgetMin: number | null;
		budgetMax: number | null;
		thresholds: { ctrMin: number | null; roasMin: number | null; cpaMax: number | null };
		owner: string;
	}
	interface ObjectiveOpt {
		key: string;
		label: string;
		icon: string;
		color: string;
	}

	let {
		filters = $bindable(),
		objectives,
		owners,
		resultCount
	}: { filters: RkFilters; objectives: ObjectiveOpt[]; owners: string[]; resultCount: number } = $props();

	const STATUS_LIST = [
		{ key: 'ACTIVE', label: 'Active', dot: '#10b981' },
		{ key: 'WITH_ISSUES', label: 'Cu probleme', dot: '#f59e0b' },
		{ key: 'PAUSED', label: 'Paused', dot: '#94a3b8' },
		{ key: 'IN_REVIEW', label: 'În review', dot: '#6366f1' },
		{ key: 'DRAFT', label: 'Draft', dot: '#cbd5e1' }
	];
	const PLACEMENTS = ['Feed', 'Stories', 'Reels', 'Explore'];

	function toggleArr(key: 'status' | 'objectives' | 'platforms' | 'placements', val: string) {
		const arr = filters[key];
		filters = { ...filters, [key]: arr.includes(val) ? arr.filter((x) => x !== val) : [...arr, val] };
	}

	const thr = $derived(filters.thresholds);
	const thrCount = $derived([thr.ctrMin, thr.roasMin, thr.cpaMax].filter((x) => x != null).length);
	const budgetActive = $derived(filters.budgetMin != null || filters.budgetMax != null);
	const anyActive = $derived(
		!!filters.q || filters.status.length > 0 || filters.objectives.length > 0 || filters.platforms.length > 0 || filters.placements.length > 0 || budgetActive || thrCount > 0 || !!filters.owner
	);

	function clearAll() {
		filters = { q: '', status: [], objectives: [], platforms: [], placements: [], budgetMin: null, budgetMax: null, thresholds: { ctrMin: null, roasMin: null, cpaMax: null }, owner: '' };
	}

	// dual range
	const BMIN = 0,
		BMAX = 300,
		BSTEP = 5;
	const loV = $derived(filters.budgetMin ?? BMIN);
	const hiV = $derived(filters.budgetMax ?? BMAX);
	const bpct = (v: number) => ((v - BMIN) / (BMAX - BMIN)) * 100;
</script>

{#snippet chip(icon: typeof Search, label: string, active: boolean, count: number, openState: boolean, t: () => void)}
	{@const Ic = icon}
	<button class="rk-fchip {active ? 'active' : ''} {openState ? 'open' : ''}" onclick={t}>
		<Ic size={13} /><span>{label}</span>
		{#if count > 0}<span class="rk-fchip-count">{count}</span>{/if}
		<ChevronDown size={12} class="rk-fchip-caret" />
	</button>
{/snippet}

{#snippet activeTag(label: string, onClear: () => void)}
	<span class="rk-activetag">{label}<button onclick={onClear} aria-label="Elimină filtrul"><X size={10} /></button></span>
{/snippet}

<div class="rk-filterbar">
	<div class="rk-filterbar-main">
		<div class="rk-search">
			<Search size={15} />
			<input placeholder="Caută campanie, adset, ad sau ID…" value={filters.q} oninput={(e) => (filters = { ...filters, q: e.currentTarget.value })} />
			{#if filters.q}<button class="rk-search-x" onclick={() => (filters = { ...filters, q: '' })} aria-label="Șterge căutarea"><X size={12} /></button>{/if}
			<span class="rk-kbd">⌘K</span>
		</div>

		<!-- Status -->
		<Popover width={210}>
			{#snippet trigger({ open, toggle })}{@render chip(Activity, 'Status', filters.status.length > 0, filters.status.length, open, toggle)}{/snippet}
			{#snippet children()}
				<div class="rk-pop-list">
					{#each STATUS_LIST as s (s.key)}
						<button class="rk-checkrow" onclick={() => toggleArr('status', s.key)}>
							<span class="rk-check {filters.status.includes(s.key) ? 'on' : ''}">{#if filters.status.includes(s.key)}<Check size={11} />{/if}</span>
							<i class="rk-statusdot" style="background:{s.dot}"></i>{s.label}
						</button>
					{/each}
				</div>
			{/snippet}
		</Popover>

		<!-- Objective -->
		<Popover width={230}>
			{#snippet trigger({ open, toggle })}{@render chip(Target, 'Obiectiv', filters.objectives.length > 0, filters.objectives.length, open, toggle)}{/snippet}
			{#snippet children()}
				<div class="rk-pop-list">
					{#each objectives as o (o.key)}
						{@const OI = rkIcon(o.icon)}
						<button class="rk-checkrow" onclick={() => toggleArr('objectives', o.key)}>
							<span class="rk-check {filters.objectives.includes(o.key) ? 'on' : ''}">{#if filters.objectives.includes(o.key)}<Check size={11} />{/if}</span>
							<span class="rk-objic c-{o.color}"><OI size={12} /></span>{o.label}
						</button>
					{/each}
				</div>
			{/snippet}
		</Popover>

		<!-- Platform & placement -->
		<Popover width={250}>
			{#snippet trigger({ open, toggle })}{@render chip(Layers, 'Platformă', filters.platforms.length > 0 || filters.placements.length > 0, filters.platforms.length + filters.placements.length, open, toggle)}{/snippet}
			{#snippet children()}
				<div class="rk-pop-list">
					<div class="rk-pop-section">Platformă</div>
					<button class="rk-checkrow" onclick={() => toggleArr('platforms', 'facebook')}>
						<span class="rk-check {filters.platforms.includes('facebook') ? 'on' : ''}">{#if filters.platforms.includes('facebook')}<Check size={11} />{/if}</span>
						<span class="rk-objic" style="color:#1877F2"><IconFacebook class="h-3 w-3" /></span>Facebook
					</button>
					<button class="rk-checkrow" onclick={() => toggleArr('platforms', 'instagram')}>
						<span class="rk-check {filters.platforms.includes('instagram') ? 'on' : ''}">{#if filters.platforms.includes('instagram')}<Check size={11} />{/if}</span>
						<span class="rk-objic" style="color:#E1306C"><Instagram size={13} /></span>Instagram
					</button>
					<div class="rk-pop-section">Plasament</div>
					{#each PLACEMENTS as p (p)}
						<button class="rk-checkrow" onclick={() => toggleArr('placements', p.toLowerCase())}>
							<span class="rk-check {filters.placements.includes(p.toLowerCase()) ? 'on' : ''}">{#if filters.placements.includes(p.toLowerCase())}<Check size={11} />{/if}</span>{p}
						</button>
					{/each}
				</div>
			{/snippet}
		</Popover>

		<!-- Budget -->
		<Popover width={260}>
			{#snippet trigger({ open, toggle })}{@render chip(DollarSign, 'Buget', budgetActive, budgetActive ? 1 : 0, open, toggle)}{/snippet}
			{#snippet children()}
				<div class="rk-pop-pad">
					<div class="rk-pop-title">Buget zilnic (RON)</div>
					<div class="rk-range">
						<div class="rk-range-head"><span>{loV} RON</span><span>{hiV} RON</span></div>
						<div class="rk-range-track">
							<div class="rk-range-fill" style="left:{bpct(loV)}%; right:{100 - bpct(hiV)}%"></div>
							<input type="range" min={BMIN} max={BMAX} step={BSTEP} value={loV} oninput={(e) => (filters = { ...filters, budgetMin: Math.min(+e.currentTarget.value, hiV) })} aria-label="Buget minim" />
							<input type="range" min={BMIN} max={BMAX} step={BSTEP} value={hiV} oninput={(e) => (filters = { ...filters, budgetMax: Math.max(+e.currentTarget.value, loV) })} aria-label="Buget maxim" />
						</div>
					</div>
					{#if budgetActive}<button class="rk-pop-clear" onclick={() => (filters = { ...filters, budgetMin: null, budgetMax: null })}>Resetează</button>{/if}
				</div>
			{/snippet}
		</Popover>

		<!-- Performance thresholds -->
		<Popover width={250}>
			{#snippet trigger({ open, toggle })}{@render chip(Sliders, 'Performanță', thrCount > 0, thrCount, open, toggle)}{/snippet}
			{#snippet children()}
				<div class="rk-pop-pad">
					<div class="rk-pop-title">Praguri de performanță</div>
					<div class="rk-thr">
						<label for="thr-ctr">CTR link ≥</label>
						<div class="rk-thr-in"><input id="thr-ctr" type="number" step="0.1" placeholder="—" value={thr.ctrMin ?? ''} oninput={(e) => (filters = { ...filters, thresholds: { ...thr, ctrMin: e.currentTarget.value === '' ? null : +e.currentTarget.value } })} /><span>%</span></div>
					</div>
					<div class="rk-thr">
						<label for="thr-roas">ROAS ≥</label>
						<div class="rk-thr-in"><input id="thr-roas" type="number" step="0.1" placeholder="—" value={thr.roasMin ?? ''} oninput={(e) => (filters = { ...filters, thresholds: { ...thr, roasMin: e.currentTarget.value === '' ? null : +e.currentTarget.value } })} /><span>x</span></div>
					</div>
					<div class="rk-thr">
						<label for="thr-cpa">CPA ≤</label>
						<div class="rk-thr-in"><input id="thr-cpa" type="number" step="1" placeholder="—" value={thr.cpaMax ?? ''} oninput={(e) => (filters = { ...filters, thresholds: { ...thr, cpaMax: e.currentTarget.value === '' ? null : +e.currentTarget.value } })} /><span>RON</span></div>
					</div>
					{#if thrCount > 0}<button class="rk-pop-clear" onclick={() => (filters = { ...filters, thresholds: { ctrMin: null, roasMin: null, cpaMax: null } })}>Resetează</button>{/if}
				</div>
			{/snippet}
		</Popover>

		<!-- Owner -->
		{#if owners.length > 0}
			<Popover width={200}>
				{#snippet trigger({ open, toggle })}{@render chip(Users, 'Owner', !!filters.owner, filters.owner ? 1 : 0, open, toggle)}{/snippet}
				{#snippet children(close)}
					<div class="rk-pop-list">
						<button class="rk-checkrow" onclick={() => { filters = { ...filters, owner: '' }; close(); }}>
							<span class="rk-check {!filters.owner ? 'on' : ''}">{#if !filters.owner}<Check size={11} />{/if}</span>Toți
						</button>
						{#each owners as o (o)}
							<button class="rk-checkrow" onclick={() => { filters = { ...filters, owner: o }; close(); }}>
								<span class="rk-check {filters.owner === o ? 'on' : ''}">{#if filters.owner === o}<Check size={11} />{/if}</span>{o}
							</button>
						{/each}
					</div>
				{/snippet}
			</Popover>
		{/if}

		{#if anyActive}<button class="rk-clearall" onclick={clearAll}><X size={12} /> Șterge filtrele</button>{/if}
	</div>

	{#if anyActive}
		<div class="rk-activefilters">
			<span class="rk-af-count">{resultCount} rezultate</span>
			{#each filters.status as s (s)}{@render activeTag(STATUS_LIST.find((x) => x.key === s)?.label ?? s, () => toggleArr('status', s))}{/each}
			{#each filters.objectives as o (o)}{@render activeTag(objectives.find((x) => x.key === o)?.label ?? o, () => toggleArr('objectives', o))}{/each}
			{#each filters.platforms as p (p)}{@render activeTag(p === 'facebook' ? 'Facebook' : 'Instagram', () => toggleArr('platforms', p))}{/each}
			{#each filters.placements as p (p)}{@render activeTag(p[0].toUpperCase() + p.slice(1), () => toggleArr('placements', p))}{/each}
			{#if budgetActive}{@render activeTag(`Buget ${filters.budgetMin ?? 0}–${filters.budgetMax ?? BMAX} RON`, () => (filters = { ...filters, budgetMin: null, budgetMax: null }))}{/if}
			{#if thr.ctrMin != null}{@render activeTag(`CTR ≥ ${thr.ctrMin}%`, () => (filters = { ...filters, thresholds: { ...thr, ctrMin: null } }))}{/if}
			{#if thr.roasMin != null}{@render activeTag(`ROAS ≥ ${thr.roasMin}x`, () => (filters = { ...filters, thresholds: { ...thr, roasMin: null } }))}{/if}
			{#if thr.cpaMax != null}{@render activeTag(`CPA ≤ ${thr.cpaMax} RON`, () => (filters = { ...filters, thresholds: { ...thr, cpaMax: null } }))}{/if}
			{#if filters.owner}{@render activeTag(filters.owner, () => (filters = { ...filters, owner: '' }))}{/if}
		</div>
	{/if}
</div>
