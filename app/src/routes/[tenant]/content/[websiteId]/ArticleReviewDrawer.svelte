<script lang="ts">
	import {
		getContentArticle,
		updateContentArticle,
		getWebsiteArticles,
		regenerateArticle,
		modifyArticle
	} from '$lib/remotes/content-articles.remote';
	import RichEditor from '$lib/components/RichEditor/RichEditor.svelte';
	import { toast } from 'svelte-sonner';
	import XIcon from '@lucide/svelte/icons/x';
	import Loader2Icon from '@lucide/svelte/icons/loader-2';
	import TriangleAlertIcon from '@lucide/svelte/icons/triangle-alert';
	import RefreshCwIcon from '@lucide/svelte/icons/refresh-cw';
	import SaveIcon from '@lucide/svelte/icons/save';
	import CheckIcon from '@lucide/svelte/icons/check';
	import Wand2Icon from '@lucide/svelte/icons/wand-2';

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
	let modifyInstruction = $state('');
	let modifying = $state(false);

	// Regenerează ÎNTREGUL articol din sursă, folosind direcția salvată.
	async function regenerate() {
		if (generating) return;
		generating = true;
		try {
			// Save the current direction first so a regenerate uses it.
			await updateContentArticle({ id: articleId, articleDirection: direction });
			await regenerateArticle(articleId).updates(
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

	// Modificare ȚINTITĂ: aplică o singură instrucțiune pe textul curent.
	async function doModify() {
		if (modifying || !modifyInstruction.trim()) return;
		modifying = true;
		try {
			await modifyArticle({ articleId, instruction: modifyInstruction }).updates(
				getContentArticle(articleId),
				getWebsiteArticles({ websiteId, status: status || undefined })
			);
			toast.success('Modificat');
			modifyInstruction = '';
		} catch (e) {
			toast.error(e instanceof Error ? e.message : 'Modificare eșuată');
		} finally {
			modifying = false;
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

		{#if !article}
			<div class="ct-drawer-loading">
				<XIcon size={22} />
				<span>Articol negăsit.</span>
			</div>
		{:else}
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

				<h4 style="margin-top:16px">Direcție articol (pentru Regenerează)</h4>
				<textarea
					class="cl-input cl-textarea"
					bind:value={direction}
					placeholder="Context/direcție permanentă folosită la regenerarea întregului articol…"
					aria-label="Direcție articol"
				></textarea>
			</div>

			<div class="ct-drawer-col">
				<h4>Rescris</h4>
				<div class="ct-modify">
					<input
						type="text"
						bind:value={modifyInstruction}
						placeholder={'Modifică țintit: ex. „fă introducerea mai scurtă", „adaugă un paragraf despre program"…'}
						disabled={modifying}
						onkeydown={(e) => {
							if (e.key === 'Enter') doModify();
						}}
					/>
					<button
						class="cl-btn-ai cl-btn-sm"
						onclick={doModify}
						disabled={modifying || !modifyInstruction.trim()}
					>
						<Wand2Icon size={14} />
						{modifying ? 'Se modifică…' : 'Modifică'}
					</button>
				</div>
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
			<button class="cl-btn-secondary" onclick={onClose}>
				<XIcon size={15} />
				Închide
			</button>
			<button class="cl-btn-ai" disabled={generating} onclick={regenerate}>
				<RefreshCwIcon size={15} class={generating ? 'ct-spin' : ''} />
				{generating ? 'Se generează…' : 'Regenerează'}
			</button>
			<button class="cl-btn-secondary" disabled={saving} onclick={() => save(false)}>
				<SaveIcon size={15} />
				Salvează
			</button>
			<button class="cl-btn-success" disabled={saving} onclick={() => save(true)}>
				<CheckIcon size={15} />
				Aprobă
			</button>
		</div>
		{/if}

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
	.ct-drawer-foot :global(.ct-spin) {
		animation: ct-spin 0.8s linear infinite;
	}
	@keyframes ct-spin {
		to {
			transform: rotate(360deg);
		}
	}
</style>
