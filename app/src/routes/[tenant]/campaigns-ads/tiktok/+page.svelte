<script lang="ts">
	import IconTiktok from '$lib/components/marketing/icon-tiktok.svelte';
</script>

<div class="p-6 space-y-4">
	<div class="flex items-center gap-3">
		<IconTiktok class="h-7 w-7" />
		<h1 class="text-2xl font-semibold">TikTok Ads</h1>
		<span class="text-xs uppercase bg-amber-100 text-amber-800 px-2 py-0.5 rounded">În curând</span>
	</div>

	<div class="bg-white border rounded p-8 space-y-3">
		<h2 class="text-lg font-medium">Crearea campaniilor TikTok nu este încă implementată</h2>
		<p class="text-sm text-gray-600">
			MVP-ul actual susține doar <strong>Meta Ads</strong> (Facebook + Instagram). API-ul TikTok
			pentru sincronizarea conturilor și citirea datelor este deja conectat (vezi
			<code class="bg-gray-100 px-1 py-0.5 rounded text-xs">/{'{tenant}'}/settings/tiktok-ads</code>),
			dar metodele de creare a campaniilor (<code
				class="bg-gray-100 px-1 py-0.5 rounded text-xs">createCampaign</code
			>, <code class="bg-gray-100 px-1 py-0.5 rounded text-xs">createAdGroup</code>,
			<code class="bg-gray-100 px-1 py-0.5 rounded text-xs">createAd</code>) trebuie adăugate în
			<code class="bg-gray-100 px-1 py-0.5 rounded text-xs"
				>app/src/lib/server/tiktok-ads/client.ts</code
			>.
		</p>
		<p class="text-sm text-gray-600">
			Workerul din PersonalOPS deja acceptă <code class="bg-gray-100 px-1 py-0.5 rounded text-xs"
				>platform: 'tiktok'</code
			> ca tip, dar API-ul CRM returnează 422 <code
				class="bg-gray-100 px-1 py-0.5 rounded text-xs">platform_not_implemented</code
			>
			pentru orice request care nu e Meta.
		</p>
		<div class="text-xs text-gray-500 pt-2 border-t">
			📋 Roadmap: vezi <code class="bg-gray-100 px-1 py-0.5 rounded">TIKTOK_ADS_AUDIT.md</code> în
			rădăcina repo-ului CRM.
		</div>
	</div>
</div>
