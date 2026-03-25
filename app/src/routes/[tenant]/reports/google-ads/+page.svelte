<script lang="ts">
	import { Card } from '$lib/components/ui/card';
	import BarChart3Icon from '@lucide/svelte/icons/bar-chart-3';
	import IconGoogleAds from '$lib/components/marketing/icon-google-ads.svelte';
</script>

<div class="space-y-6">
	<div>
		<h1 class="text-3xl font-bold flex items-center gap-3">
			<IconGoogleAds class="h-8 w-8" />
			Google Ads
		</h1>
		<p class="text-muted-foreground">Rapoarte performanță campanii Google Ads</p>
	</div>

	<Card class="p-12 text-center">
		<div class="flex flex-col items-center gap-4">
			<div class="flex h-16 w-16 items-center justify-center rounded-full bg-muted">
				<BarChart3Icon class="h-8 w-8 text-muted-foreground" />
			</div>
			<div>
				<h3 class="text-lg font-semibold">În curând</h3>
				<p class="text-muted-foreground">Rapoartele Google Ads vor fi disponibile în curând.</p>
			</div>
		</div>
	</Card>
</div>
