<script lang="ts">
	import * as Dialog from '$lib/components/ui/dialog';
	import { Button } from '$lib/components/ui/button';
	import MonitorIcon from '@lucide/svelte/icons/monitor';
	import RocketIcon from '@lucide/svelte/icons/rocket';
	import SearchIcon from '@lucide/svelte/icons/search';
	import MegaphoneIcon from '@lucide/svelte/icons/megaphone';
	import SaveIcon from '@lucide/svelte/icons/save';
	import LoaderIcon from '@lucide/svelte/icons/loader';
	import { toast } from 'svelte-sonner';
	import {
		GOOGLE_ADS_SPECS,
		GOOGLE_ADS_CAMPAIGN_TYPES,
		getRequirementsCompletion,
		validateTextFields,
		type GoogleAdsCampaignType,
		type CampaignTypeSpec
	} from '$lib/shared/google-ads-specs';
	import { createMarketingMaterial } from '$lib/remotes/marketing-materials.remote';
	import GoogleAdsTextForm from './google-ads-text-form.svelte';
	import GoogleAdsImageSlot from './google-ads-image-slot.svelte';
	import GoogleAdsProgressBar from './google-ads-progress-bar.svelte';

	let {
		open = $bindable(false),
		clientId,
		uploadUrl,
		onSaved
	}: {
		open: boolean;
		clientId: string;
		uploadUrl: string;
		onSaved?: () => void;
	} = $props();

	let selectedCampaignType = $state<GoogleAdsCampaignType | null>(null);
	let textData = $state<Record<string, string[]>>({});
	let imageCounts = $state<Record<string, number>>({});
	let saving = $state(false);

	const spec = $derived(selectedCampaignType ? GOOGLE_ADS_SPECS[selectedCampaignType] : null);

	const completion = $derived(
		spec ? getRequirementsCompletion(spec, textData, imageCounts) : { met: 0, total: 0, missing: [] }
	);

	const campaignTypeCards: { type: GoogleAdsCampaignType; icon: typeof MonitorIcon; color: string }[] = [
		{ type: 'display', icon: MonitorIcon, color: 'text-blue-500' },
		{ type: 'pmax', icon: RocketIcon, color: 'text-purple-500' },
		{ type: 'search', icon: SearchIcon, color: 'text-green-500' },
		{ type: 'demand-gen', icon: MegaphoneIcon, color: 'text-orange-500' }
	];

	function selectCampaignType(type: GoogleAdsCampaignType) {
		selectedCampaignType = type;
		textData = {};
		imageCounts = {};
	}

	function resetDialog() {
		selectedCampaignType = null;
		textData = {};
		imageCounts = {};
		saving = false;
	}

	async function saveTextAssets() {
		if (!spec || !selectedCampaignType) return;

		const errors = validateTextFields(spec, textData);
		if (Object.keys(errors).length > 0) {
			const firstError = Object.values(errors)[0];
			toast.error(firstError);
			return;
		}

		// Build the title from first headline or business name
		const headlines = (textData.headlines || []).filter((v) => v.trim());
		const businessName = (textData.businessName || []).filter((v) => v.trim());
		const title = headlines[0] || businessName[0] || `Google Ads ${spec.label}`;

		// Clean textData: remove empty trailing entries
		const cleanedData: Record<string, string[]> = {};
		for (const [key, values] of Object.entries(textData)) {
			const filtered = values.filter((v) => v.trim().length > 0);
			if (filtered.length > 0) {
				cleanedData[key] = filtered;
			}
		}

		saving = true;
		try {
			await createMarketingMaterial({
				clientId,
				category: 'google-ads',
				type: 'text',
				title,
				description: `${spec.label} - Text Assets`,
				textContent: JSON.stringify(cleanedData),
				campaignType: selectedCampaignType,
				status: 'active'
			});
			toast.success('Text assets salvate cu succes');
			onSaved?.();
			open = false;
		} catch (e: any) {
			toast.error(e.message || 'Eroare la salvare');
		} finally {
			saving = false;
		}
	}

	function handleImageUploaded() {
		onSaved?.();
	}

	function handleClose() {
		resetDialog();
	}
</script>

<Dialog.Root bind:open onOpenChange={(o) => { if (!o) handleClose(); }}>
	<Dialog.Content class="max-w-3xl max-h-[85vh] overflow-y-auto">
		<Dialog.Header>
			<Dialog.Title>Google Ads - Creează Materiale</Dialog.Title>
			<Dialog.Description>
				Selectează tipul campaniei și adaugă text și imagini conform specificațiilor Google Ads.
			</Dialog.Description>
		</Dialog.Header>

		<!-- Campaign Type Selector -->
		<div class="grid grid-cols-2 gap-3 my-4">
			{#each campaignTypeCards as card (card.type)}
				{@const cardSpec = GOOGLE_ADS_SPECS[card.type]}
				<button
					class="flex items-start gap-3 p-3 rounded-lg border-2 text-left transition-all
						{selectedCampaignType === card.type
							? 'border-primary bg-primary/5'
							: 'border-muted hover:border-primary/30'}"
					onclick={() => selectCampaignType(card.type)}
				>
					<card.icon class="h-5 w-5 mt-0.5 {card.color}" />
					<div>
						<p class="text-sm font-medium">{cardSpec.label}</p>
						<p class="text-xs text-muted-foreground">{cardSpec.description}</p>
						{#if cardSpec.textOnly}
							<span class="text-[10px] px-1.5 py-0.5 rounded bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300 mt-1 inline-block">
								Doar text
							</span>
						{/if}
					</div>
				</button>
			{/each}
		</div>

		{#if spec && selectedCampaignType}
			<!-- Progress Bar -->
			<GoogleAdsProgressBar
				met={completion.met}
				total={completion.total}
				missing={completion.missing}
			/>

			<!-- Text Assets Section -->
			<div class="mt-6 space-y-4">
				<h3 class="text-sm font-semibold flex items-center gap-2">
					Text Assets
					<span class="text-xs font-normal text-muted-foreground">({spec.label})</span>
				</h3>

				<GoogleAdsTextForm
					fields={spec.textFields}
					bind:textData
				/>

				<div class="flex justify-end">
					<Button
						onclick={saveTextAssets}
						disabled={saving}
						size="sm"
					>
						{#if saving}
							<LoaderIcon class="h-4 w-4 mr-2 animate-spin" />
						{:else}
							<SaveIcon class="h-4 w-4 mr-2" />
						{/if}
						Salvează Text
					</Button>
				</div>
			</div>

			<!-- Image Slots Section -->
			{#if !spec.textOnly && spec.imageSlots.length > 0}
				<div class="mt-6 space-y-4">
					<h3 class="text-sm font-semibold flex items-center gap-2">
						Imagini
						<span class="text-xs font-normal text-muted-foreground">
							(se salvează automat la upload)
						</span>
					</h3>

					{#each spec.imageSlots as slot (slot.key)}
						<GoogleAdsImageSlot
							{slot}
							campaignType={selectedCampaignType}
							{clientId}
							{uploadUrl}
							bind:uploadedCount={imageCounts[slot.key]}
							onUploaded={handleImageUploaded}
						/>
					{/each}
				</div>
			{/if}

			<!-- Video Info -->
			{#if spec.maxVideos > 0}
				<div class="mt-4 p-3 rounded-lg bg-muted/50 text-xs text-muted-foreground">
					<p class="font-medium text-foreground mb-1">Video (opțional)</p>
					<p>
						Max {spec.maxVideos} videoclipuri.
						{#if spec.minVideoSeconds}
							Min {spec.minVideoSeconds}s.
						{/if}
						{#if spec.maxVideoSeconds}
							Max {spec.maxVideoSeconds}s.
						{/if}
						Folosește upload-ul standard pentru video.
					</p>
				</div>
			{/if}
		{/if}

		<Dialog.Footer class="mt-6">
			<Button variant="outline" onclick={() => { open = false; }}>
				Finalizat
			</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
