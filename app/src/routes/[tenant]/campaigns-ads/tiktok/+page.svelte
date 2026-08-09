<script lang="ts">
	import { page } from '$app/state';
	import IconTiktok from '$lib/components/marketing/icon-tiktok.svelte';

	const tenantSlug = $derived(page.params.tenant as string);
</script>

<div class="soon-card">
	<div class="soon-head">
		<IconTiktok class="h-7 w-7" />
		<h2>TikTok</h2>
		<span class="badge warn">În curând</span>
	</div>
	<p>
		Gestionarea campaniilor TikTok din CRM se conectează la API-ul intern într-o iterație
		viitoare. Datele de performanță sunt deja sincronizate și disponibile în rapoarte.
	</p>
	<a class="btn primary" href={`/${tenantSlug}/reports/tiktok-ads`}>Vezi raportul TikTok</a>
</div>

<style>
	.soon-card {
		background: var(--ca-surface);
		border: 1px solid var(--ca-border);
		border-radius: var(--ca-radius-lg);
		box-shadow: var(--ca-shadow-sm);
		padding: 28px;
		max-width: 640px;
		display: flex;
		flex-direction: column;
		gap: 14px;
		align-items: flex-start;
	}
	.soon-head {
		display: flex;
		align-items: center;
		gap: 12px;
	}
	.soon-head h2 {
		margin: 0;
		font-size: 18px;
		font-weight: 600;
		color: var(--ca-text);
	}
	.soon-card p {
		margin: 0;
		font-size: 13px;
		color: var(--ca-text-2);
		line-height: 1.6;
	}
</style>
