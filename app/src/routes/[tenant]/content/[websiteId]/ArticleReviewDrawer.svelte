<script lang="ts">
	import {
		getContentArticle,
		updateContentArticle,
		getWebsiteArticles,
		rewriteArticle,
		regenerateArticle
	} from '$lib/remotes/content-articles.remote';
	import RichEditor from '$lib/components/RichEditor/RichEditor.svelte';
	import { toast } from 'svelte-sonner';
	import XIcon from '@lucide/svelte/icons/x';
	import Loader2Icon from '@lucide/svelte/icons/loader-2';
	import TriangleAlertIcon from '@lucide/svelte/icons/triangle-alert';

	let {
		articleId,
		websiteId,
		status = '',
		onClose
	}: { articleId: string; websiteId: string; status?: string; onClose: () => void } = $props();

	const article = $derived(await getContentArticle(articleId));

	// Editable local state, synced whenever the article OR its generated output
	// changes. Keyed on id + generatedAt so a regeneration (same id, new
	// generatedAt) re-syncs gHtml/gTitle/… instead of keeping the old text.
	let gTitle = $state('');
	let gExcerpt = $state('');
	let gHtml = $state('');
	let direction = $state('');
	let loadedKey = $state<string | null>(null);

	$effect(() => {
		if (article) {
			const key = article.id + ':' + (article.generatedAt ?? '');
			if (loadedKey !== key) {
				gTitle = article.generatedTitle ?? '';
				gExcerpt = article.generatedExcerpt ?? '';
				gHtml = article.generatedHtml ?? '';
				direction = article.articleDirection ?? '';
				loadedKey = key;
			}
		}
	});

	let saving = $state(false);
	let generating = $state(false);

	async function doRewrite(regen: boolean) {
		if (generating) return;
		generating = true;
		try {
			// Save the current direction first so a regenerate uses it.
			await updateContentArticle({ id: articleId, articleDirection: direction });
			const fn = regen ? regenerateArticle : rewriteArticle;
			await fn(articleId).updates(
				getContentArticle(articleId),
				getWebsiteArticles({ websiteId, status: status || undefined })
			);
			toast.success('Generat');
		} catch (e) {
			toast.error(e instanceof Error ? e.message : 'Generare eșuată');
		} finally {
			generating = false;
		}
	}

	async function save(approve: boolean) {
		if (saving) return;
		saving = true;
		try {
			await updateContentArticle({
				id: articleId,
				generatedTitle: gTitle,
				generatedExcerpt: gExcerpt,
				generatedHtml: gHtml,
				articleDirection: direction,
				...(approve ? { rewriteStatus: 'ready' as const } : {})
			}).updates(getWebsiteArticles({ websiteId, status: status || undefined }));
			toast.success(approve ? 'Aprobat' : 'Salvat');
			onClose();
		} catch (e) {
			toast.error(e instanceof Error ? e.message : 'Eroare la salvare');
		} finally {
			saving = false;
		}
	}
</script>

<svelte:window onkeydown={(e) => e.key === 'Escape' && onClose()} />

<div
	class="ct-drawer-back"
	role="button"
	tabindex="-1"
	aria-label="Închide editorul"
	onclick={onClose}
	onkeydown={(e) => (e.key === 'Enter' || e.key === ' ') && onClose()}
></div>

<aside class="ct-drawer" aria-label="Editor articol">
	<svelte:boundary>
		<div class="ct-drawer-head">
			<input
				class="cl-input"
				bind:value={gTitle}
				placeholder="Titlu articol…"
				aria-label="Titlu articol"
			/>
			<button class="cl-icon-btn" onclick={onClose} aria-label="Închide">
				<XIcon size={16} />
			</button>
		</div>

		<div class="ct-drawer-body">
			<div class="ct-drawer-col">
				<h4>Sursă</h4>
				<div class="ct-source-box">
					{#if article.bodyHtml}
						{@html article.bodyHtml}
					{:else}
						{article.bodyText ?? ''}
					{/if}
				</div>

				<h4 style="margin-top:16px">Direcție articol</h4>
				<textarea
					class="cl-input cl-textarea"
					bind:value={direction}
					placeholder="Context/direcție specifică pt acest articol…"
					aria-label="Direcție articol"
				></textarea>
			</div>

			<div class="ct-drawer-col">
				<h4>Rescris</h4>
				{#key loadedKey}
					{#if loadedKey === article.id + ':' + (article.generatedAt ?? '')}
						<RichEditor content={gHtml} onUpdate={(d) => (gHtml = d.html)} minHeight="320px" />
					{/if}
				{/key}

				<h4 style="margin-top:16px">Rezumat (excerpt)</h4>
				<textarea
					class="cl-input cl-textarea"
					bind:value={gExcerpt}
					placeholder="Scurt rezumat al articolului…"
					aria-label="Rezumat"
				></textarea>
			</div>
		</div>

		<div class="ct-drawer-foot">
			<button class="cl-btn-secondary" onclick={onClose}>Închide</button>
			<button class="cl-btn-secondary" disabled={generating} onclick={() => doRewrite(false)}>
				{generating ? 'Se generează…' : 'Rescrie din sursă'}
			</button>
			<button class="cl-btn-secondary" disabled={generating} onclick={() => doRewrite(true)}>
				{generating ? 'Se generează…' : 'Regenerează'}
			</button>
			<button class="cl-btn-secondary" disabled={saving} onclick={() => save(false)}>Salvează</button>
			<button class="cl-btn-primary" disabled={saving} onclick={() => save(true)}>Aprobă</button>
		</div>

		{#snippet pending()}
			<div class="ct-drawer-loading">
				<Loader2Icon size={22} class="ct-spin" />
				<span>Se încarcă articolul…</span>
			</div>
		{/snippet}

		{#snippet failed(error)}
			<div class="ct-drawer-loading">
				<TriangleAlertIcon size={26} />
				<span>{error instanceof Error ? error.message : 'Nu am putut încărca articolul.'}</span>
				<button class="cl-btn-secondary" onclick={onClose}>Închide</button>
			</div>
		{/snippet}
	</svelte:boundary>
</aside>

<style>
	.ct-drawer-loading {
		flex: 1;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 14px;
		padding: 40px;
		color: var(--cl-text-3);
		font-size: 13px;
		text-align: center;
	}
	.ct-drawer-head .cl-input {
		flex: 1;
		font-weight: 600;
	}
	.ct-drawer-loading :global(.ct-spin) {
		animation: ct-spin 0.9s linear infinite;
	}
	@keyframes ct-spin {
		to {
			transform: rotate(360deg);
		}
	}
</style>
