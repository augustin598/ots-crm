<script lang="ts">
	import { getGoogleDemographicInsights, getGoogleGeographicInsights } from '$lib/remotes/google-reports.remote';
	import type { GoogleAdsGeographicInsight } from '$lib/server/google-ads/client';
	import { Card } from '$lib/components/ui/card';
	import { Skeleton } from '$lib/components/ui/skeleton';
	import DemographicCard from './demographic-card.svelte';
	import DemographicDetailDialog from './demographic-detail-dialog.svelte';
	import { getDemographicLabel } from '$lib/utils/report-helpers';
	import UsersIcon from '@lucide/svelte/icons/users';
	import CalendarIcon from '@lucide/svelte/icons/calendar-days';
	import MapPinIcon from '@lucide/svelte/icons/map-pin';
	import SmartphoneIcon from '@lucide/svelte/icons/smartphone';

	let {
		customerId,
		since,
		until,
		currency = 'RON'
	}: {
		customerId: string;
		since: string;
		until: string;
		currency?: string;
	} = $props();

	let demographicsQuery = $state<ReturnType<typeof getGoogleDemographicInsights> | null>(null);
	let geoQuery = $state<ReturnType<typeof getGoogleGeographicInsights> | null>(null);

	$effect(() => {
		if (customerId && since && until) {
			demographicsQuery = getGoogleDemographicInsights({ customerId, since, until });
			geoQuery = getGoogleGeographicInsights({ customerId, since, until });
		}
	});

	const demographics = $derived(demographicsQuery?.current);
	const loading = $derived(demographicsQuery?.loading ?? false);
	const geoData = $derived(geoQuery?.current);
	const geoLoading = $derived(geoQuery?.loading ?? false);

	const GENDER_COLORS = ['#3b82f6', '#ec4899', '#94a3b8'];
	const AGE_COLORS = ['#bfdbfe', '#93c5fd', '#60a5fa', '#3b82f6', '#2563eb', '#1d4ed8', '#1e40af'];
	const LOCATION_COLORS = [
		'#10b981', '#34d399', '#6ee7b7', '#a7f3d0',
		'#059669', '#047857', '#065f46', '#064e3b',
		'#d1fae5', '#ecfdf5', '#f0fdf4', '#14b8a6'
	];
	const DEVICE_COLORS = ['#8b5cf6', '#a78bfa', '#c4b5fd', '#94a3b8'];

	type Segment = { label: string; spend: number; impressions: number; clicks: number; results: number };

	function toCardData(segments: Segment[], type: 'gender' | 'age' | 'devicePlatform' | 'location', colors: string[]) {
		const total = segments.reduce((s, d) => s + d.spend, 0);
		return segments.map((s, i) => ({
			label: type === 'location' ? s.label : getDemographicLabel(type, s.label),
			value: s.spend,
			percent: total > 0 ? (s.spend / total) * 100 : 0,
			color: colors[i % colors.length]
		}));
	}

	const genderData = $derived(demographics ? toCardData(demographics.gender, 'gender', GENDER_COLORS) : []);
	const ageData = $derived(demographics ? toCardData(demographics.age, 'age', AGE_COLORS) : []);
	const deviceData = $derived(demographics ? toCardData(demographics.devicePlatform, 'devicePlatform', DEVICE_COLORS) : []);

	const geoSegments = $derived.by((): Segment[] => {
		if (!geoData) return [];
		return geoData.map((loc: GoogleAdsGeographicInsight) => ({
			label: loc.locationName,
			spend: loc.spend,
			impressions: loc.impressions,
			clicks: loc.clicks,
			results: loc.results
		}));
	});
	const locationData = $derived(toCardData(geoSegments, 'location', LOCATION_COLORS));

	let openType = $state<'gender' | 'age' | 'location' | 'devicePlatform' | null>(null);
	let dialogOpen = $state(false);

	function openDialog(type: typeof openType) {
		openType = type;
		dialogOpen = true;
	}

	const dialogTitle = $derived.by(() => {
		switch (openType) {
			case 'gender': return 'Gen';
			case 'age': return 'Vârstă';
			case 'location': return 'Locații';
			case 'devicePlatform': return 'Dispozitive';
			default: return '';
		}
	});

	const dialogData = $derived.by((): Segment[] => {
		if (!openType) return [];
		if (openType === 'location') return geoSegments;
		if (!demographics) return [];
		return demographics[openType];
	});

	const dialogLabelMap = $derived.by(() => {
		if (!openType || openType === 'location') return (l: string) => l;
		const type = openType;
		return (l: string) => getDemographicLabel(type, l);
	});

	const dialogColors = $derived.by(() => {
		switch (openType) {
			case 'gender': return GENDER_COLORS;
			case 'age': return AGE_COLORS;
			case 'location': return LOCATION_COLORS;
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
				title="Județe"
				icon={MapPinIcon}
				data={locationData}
				onclick={() => openDialog('location')}
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
			resultLabel="Conversii"
		/>
	{/if}
</div>
