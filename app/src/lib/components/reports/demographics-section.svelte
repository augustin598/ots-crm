<script lang="ts">
	import { getMetaDemographicInsights } from '$lib/remotes/reports.remote';
	import { Card } from '$lib/components/ui/card';
	import { Skeleton } from '$lib/components/ui/skeleton';
	import DemographicCard from './demographic-card.svelte';
	import DemographicDetailDialog from './demographic-detail-dialog.svelte';
	import { getDemographicLabel } from '$lib/utils/report-helpers';
	import type { DemographicSegment } from '$lib/server/meta-ads/client';
	import UsersIcon from '@lucide/svelte/icons/users';
	import CalendarIcon from '@lucide/svelte/icons/calendar-days';
	import GlobeIcon from '@lucide/svelte/icons/globe';
	import SmartphoneIcon from '@lucide/svelte/icons/smartphone';

	let {
		adAccountId,
		integrationId,
		since,
		until,
		currency = 'RON',
		campaignIds = []
	}: {
		adAccountId: string;
		integrationId: string;
		since: string;
		until: string;
		currency?: string;
		campaignIds?: string[];
	} = $props();

	let demographicsQuery = $state<ReturnType<typeof getMetaDemographicInsights> | null>(null);

	// Derive a stable key from campaignIds to ensure reactivity on selection changes
	const campaignKey = $derived(JSON.stringify(campaignIds.slice().sort()));

	$effect(() => {
		// Read campaignKey to track campaignIds changes
		const _ck = campaignKey;
		if (adAccountId && integrationId && since && until) {
			demographicsQuery = getMetaDemographicInsights({
				adAccountId,
				integrationId,
				since,
				until,
				campaignIds: campaignIds.length > 0 ? campaignIds : undefined
			});
		}
	});

	const demographics = $derived(demographicsQuery?.current);
	const loading = $derived(demographicsQuery?.loading ?? false);

	// Color palettes per type
	const GENDER_COLORS = ['#3b82f6', '#ec4899', '#94a3b8'];
	const AGE_COLORS = ['#bfdbfe', '#93c5fd', '#60a5fa', '#3b82f6', '#2563eb', '#1d4ed8', '#1e40af'];
	const REGION_COLORS = ['#10b981', '#34d399', '#6ee7b7', '#a7f3d0', '#d1fae5', '#99f6e4', '#5eead4', '#2dd4bf'];
	const DEVICE_COLORS = ['#8b5cf6', '#a78bfa', '#c4b5fd', '#94a3b8'];

	function toCardData(segments: DemographicSegment[], type: 'gender' | 'age' | 'region' | 'devicePlatform', colors: string[]) {
		const total = segments.reduce((s, d) => s + d.spend, 0);
		return segments.map((s, i) => ({
			label: getDemographicLabel(type, s.label),
			value: s.spend,
			percent: total > 0 ? (s.spend / total) * 100 : 0,
			color: colors[i % colors.length]
		}));
	}

	const genderData = $derived(demographics ? toCardData(demographics.gender, 'gender', GENDER_COLORS) : []);
	const ageData = $derived(demographics ? toCardData(demographics.age, 'age', AGE_COLORS) : []);
	const regionData = $derived(demographics ? toCardData(demographics.region, 'region', REGION_COLORS) : []);
	const deviceData = $derived(demographics ? toCardData(demographics.devicePlatform, 'devicePlatform', DEVICE_COLORS) : []);

	// Dialog state
	let openType = $state<'gender' | 'age' | 'region' | 'devicePlatform' | null>(null);
	let dialogOpen = $state(false);

	function openDialog(type: typeof openType) {
		openType = type;
		dialogOpen = true;
	}

	const dialogTitle = $derived.by(() => {
		switch (openType) {
			case 'gender': return 'Gen';
			case 'age': return 'Vârstă';
			case 'region': return 'Locație';
			case 'devicePlatform': return 'Dispozitive';
			default: return '';
		}
	});

	const dialogData = $derived.by((): DemographicSegment[] => {
		if (!demographics || !openType) return [];
		return demographics[openType];
	});

	const dialogLabelMap = $derived.by(() => {
		if (!openType) return (l: string) => l;
		const type = openType;
		return (l: string) => getDemographicLabel(type, l);
	});

	const dialogColors = $derived.by(() => {
		switch (openType) {
			case 'gender': return GENDER_COLORS;
			case 'age': return AGE_COLORS;
			case 'region': return REGION_COLORS;
			case 'devicePlatform': return DEVICE_COLORS;
			default: return ['#94a3b8'];
		}
	});
</script>

<div class="space-y-3">
	<h3 class="text-lg font-semibold">Audiență</h3>

	{#if loading}
		<div class="grid grid-cols-2 xl:grid-cols-4 gap-4">
			{#each Array(4) as _}
				<Card class="p-4">
					<div class="flex items-center gap-2 mb-3">
						<Skeleton class="h-8 w-8 rounded-lg" />
						<Skeleton class="h-4 w-20" />
					</div>
					<div class="space-y-2">
						<Skeleton class="h-5 w-full" />
						<Skeleton class="h-5 w-3/4" />
						<Skeleton class="h-5 w-1/2" />
					</div>
				</Card>
			{/each}
		</div>
	{:else if demographics}
		<div class="grid grid-cols-2 xl:grid-cols-4 gap-4">
			<DemographicCard
				title="Gen"
				icon={UsersIcon}
				data={genderData}
				onclick={() => openDialog('gender')}
			/>
			<DemographicCard
				title="Vârstă"
				icon={CalendarIcon}
				data={ageData}
				onclick={() => openDialog('age')}
			/>
			<DemographicCard
				title="Locație"
				icon={GlobeIcon}
				data={regionData}
				onclick={() => openDialog('region')}
			/>
			<DemographicCard
				title="Dispozitive"
				icon={SmartphoneIcon}
				data={deviceData}
				onclick={() => openDialog('devicePlatform')}
			/>
		</div>

		<DemographicDetailDialog
			bind:open={dialogOpen}
			title={dialogTitle}
			data={dialogData}
			{currency}
			labelMap={dialogLabelMap}
			colors={dialogColors}
		/>
	{/if}
</div>
