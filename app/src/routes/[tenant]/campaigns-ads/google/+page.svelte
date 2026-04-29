<script lang="ts">
	import IconGoogleAds from '$lib/components/marketing/icon-google-ads.svelte';
</script>

<div class="p-6 space-y-4">
	<div class="flex items-center gap-3">
		<IconGoogleAds class="h-7 w-7" />
		<h1 class="text-2xl font-semibold">Google Ads</h1>
		<span class="text-xs uppercase bg-amber-100 text-amber-800 px-2 py-0.5 rounded">În curând</span>
	</div>

	<div class="bg-white border rounded p-8 space-y-3">
		<h2 class="text-lg font-medium">Crearea campaniilor Google Ads nu este încă implementată</h2>
		<p class="text-sm text-gray-600">
			MVP-ul actual susține doar <strong>Meta Ads</strong>. Conturile MCC + 41 sub-conturi sunt
			deja sincronizate (citire spend, invoices, insights), dar API-ul Google Ads pentru creare
			campanii (Customer / Campaign / AdGroup / Ad mutate operations cu GAQL) este cel mai complex
			și necesită un developer token cu Basic Access — funcționalitate planificată pentru o
			iterație ulterioară.
		</p>
		<p class="text-sm text-gray-600">
			Workerul din PersonalOPS acceptă deja <code class="bg-gray-100 px-1 py-0.5 rounded text-xs"
				>platform: 'google'</code
			>
			ca tip, iar CRM-ul returnează 422 <code class="bg-gray-100 px-1 py-0.5 rounded text-xs"
				>platform_not_implemented</code
			>
			pentru request-uri non-Meta.
		</p>
		<div class="text-xs text-gray-500 pt-2 border-t">
			📋 Următorul pas: implementare în <code class="bg-gray-100 px-1 py-0.5 rounded"
				>app/src/lib/server/google-ads/client.ts</code
			> a metodelor createCampaign / createAdGroup / createAd.
		</div>
	</div>
</div>
