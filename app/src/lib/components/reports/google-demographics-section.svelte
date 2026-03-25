<script lang="ts">
	import { getGoogleDemographicInsights } from '$lib/remotes/google-reports.remote';
	import { Card } from '$lib/components/ui/card';
	import { Skeleton } from '$lib/components/ui/skeleton';
	import DemographicCard from './demographic-card.svelte';
	import DemographicDetailDialog from './demographic-detail-dialog.svelte';
	import { getDemographicLabel } from '$lib/utils/report-helpers';
	import UsersIcon from '@lucide/svelte/icons/users';
	import CalendarIcon from '@lucide/svelte/icons/calendar-days';
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

	$effect(() => {
		if (customerId && since && until) {
			demographicsQuery = getGoogleDemographicInsights({ customerId, since, until });
		}
	});

	const demographics = $derived(demographicsQuery?.current);
	const loading = $derived(demographicsQuery?.loading ?? false);

	const GENDER_COLORS = ['#3b82f6', '#ec4899', '#94a3b8'];
	const AGE_COLORS = ['#bfdbfe', '#93c5fd', '#60a5fa', '#3b82f6', '#2563eb', '#1d4ed8', '#1e40af'];
	const DEVICE_COLORS = ['#8b5cf6', '#a78bfa', '#c4b5fd', '#94a3b8'];

	type Segment = { label: string; spend: number; impressions: number; clicks: number; results: number };

	function toCardData(segments: Segment[], type: 'gender' | 'age' | 'devicePlatform', colors: string[]) {
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
	const deviceData = $derived(demographics ? toCardData(demographics.devicePlatform, 'devicePlatform', DEVICE_COLORS) : []);

	let openType = $state<'gender' | 'age' | 'devicePlatform' | null>(null);
	let dialogOpen = $state(false);

	function openDialog(type: typeof openType) {
		openType = type;
		dialogOpen = true;
	}

	const dialogTitle = $derived.by(() => {
		switch (openType) {
			case 'gender': return 'Gen';
			case 'age': return 'Vârstă';
			case 'devicePlatform': return 'Dispozitive';
			default: return '';
		}
	});

	const dialogData = $derived.by((): Segment[] => {
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
			case 'devicePlatform': return DEVICE_COLORS;
			default: return ['#94a3b8'];
		}
	});
</script>

<div class="space-y-3">
	<h3 class="text-lg font-semibold">Audiență</h3>

	{#if loading}
		<div class="grid grid-cols-2 xl:grid-cols-3 gap-4">
			{#each Array(3) as _}
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
		<div class="grid grid-cols-2 xl:grid-cols-3 gap-4">
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
