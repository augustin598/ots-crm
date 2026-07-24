<script lang="ts">
	import '../../content.css';
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import {
		getContentArticle,
		updateContentArticle,
		getWebsiteArticles,
		regenerateArticle,
		modifyArticle,
		getContentWebsites
	} from '$lib/remotes/content-articles.remote';
	import RichEditor from '$lib/components/RichEditor/RichEditor.svelte';
	import { analyzeSeo } from '$lib/content/seo-analysis';
	import { toast } from 'svelte-sonner';
	import Loader2Icon from '@lucide/svelte/icons/loader-2';
	import TriangleAlertIcon from '@lucide/svelte/icons/triangle-alert';
	import RefreshCwIcon from '@lucide/svelte/icons/refresh-cw';
	import SaveIcon from '@lucide/svelte/icons/save';
	import CheckIcon from '@lucide/svelte/icons/check';
	import Wand2Icon from '@lucide/svelte/icons/wand-2';

	// Route params (guaranteed by the [websiteId]/[articleId] segments).
	const tenant = $derived(page.params.tenant!);
	const websiteId = $derived(page.params.websiteId!);
	const articleId = $derived(page.params.articleId!);

	// Async reads (accessed inside the <svelte:boundary> below).
	const article = $derived(await getContentArticle(articleId));
	const websites = $derived(await getContentWebsites());
	const websiteName = $derived.by(() => {
		const site = websites.find((w) => w.id === websiteId);
		return site?.name ?? site?.url ?? websiteId;
	});

	// Editable local state, synced whenever the article OR its generated output
	// changes. Keyed on id + generatedAt so a regeneration (same id, new
	// generatedAt) re-syncs the editable fields instead of keeping the old text.
	let gTitle = $state('');
	let gExcerpt = $state('');
	let gHtml = $state('');
	let direction = $state('');
	// SEO editable state, synced in the same guarded effect.
	let seoTitle = $state('');
	let metaDescription = $state('');
	let focusKeyword = $state('');
	let slug = $state('');
	let featuredImageUrl = $state('');
	let loadedKey = $state<string | null>(null);

	$effect(() => {
		if (article) {
			const key = article.id + ':' + (article.generatedAt ?? '');
			if (loadedKey !== key) {
				gTitle = article.generatedTitle ?? '';
				gExcerpt = article.generatedExcerpt ?? '';
				gHtml = article.generatedHtml ?? '';
				direction = article.articleDirection ?? '';
				seoTitle = article.seoTitle ?? article.generatedTitle ?? '';
				metaDescription = article.metaDescription ?? article.generatedExcerpt ?? '';
				focusKeyword = article.focusKeyword ?? '';
				slug = article.slug ?? '';
				featuredImageUrl = article.featuredImageUrl ?? '';
				loadedKey = key;
			}
		}
	});

	// Live SEO/AEO/GEO analysis on the current editable state (pure, client-side).
	const analysis = $derived(
		analyzeSeo({
			html: gHtml,
			title: seoTitle || gTitle,
			metaDescription: metaDescription || gExcerpt,
			focusKeyword,
			slug,
			featuredImageUrl: featuredImageUrl || null
		})
	);

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
				getWebsiteArticles({ websiteId })
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
				getWebsiteArticles({ websiteId })
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
				seoTitle,
				metaDescription,
				focusKeyword,
				slug,
				featuredImageUrl,
				...(approve ? { rewriteStatus: 'ready' as const } : {})
			}).updates(getContentArticle(articleId), getWebsiteArticles({ websiteId }));
			toast.success(approve ? 'Aprobat' : 'Salvat');
			if (approve) await goto(`/${tenant}/content/${websiteId}`);
		} catch (e) {
			toast.error(e instanceof Error ? e.message : 'Eroare la salvare');
		} finally {
			saving = false;
		}
	}

	const scoreClass = (n: number) => (n >= 70 ? 'ct-score-g' : n >= 40 ? 'ct-score-o' : 'ct-score-r');
	const barColor = (n: number) => (n >= 70 ? '#10b981' : n >= 40 ? '#f59e0b' : '#ef4444');
</script>

<svelte:head><title>{gTitle || 'Articol'} · Content</title></svelte:head>

<div class="cl-wrap">
	<svelte:boundary>
		<div class="cl-crumbs">
			<a href={`/${tenant}/content`}>Content</a>
			<span class="sep">›</span>
			<a href={`/${tenant}/content/${websiteId}`}>{websiteName}</a>
			<span class="sep">›</span>
			<strong>Editor</strong>
		</div>

		<div class="cl-hero">
			<div style="flex:1; min-width:0">
				<input
					class="cl-input"
					style="font-size:20px; font-weight:700"
					bind:value={gTitle}
					placeholder="Titlu articol"
					aria-label="Titlu articol"
				/>
			</div>
			<div class="cl-hero-actions">
				<button class="cl-btn-ai" onclick={regenerate} disabled={generating}>
					<RefreshCwIcon size={15} class={generating ? 'ct-spin' : ''} />
					{generating ? 'Se generează…' : 'Regenerează'}
				</button>
				<button class="cl-btn-secondary" onclick={() => save(false)} disabled={saving}>
					<SaveIcon size={15} /> Salvează
				</button>
				<button class="cl-btn-success" onclick={() => save(true)} disabled={saving}>
					<CheckIcon size={15} /> Aprobă
				</button>
			</div>
		</div>

		<div class="ct-editor-grid">
			<div class="ct-editor-main">
				<details class="ct-source-collapse">
					<summary>Sursă originală</summary>
					<div class="ct-source-inner">
						{#if article.bodyHtml}
							{@html article.bodyHtml}
						{:else}
							{article.bodyText ?? ''}
						{/if}
					</div>
				</details>

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
						<RichEditor content={gHtml} onUpdate={(d) => (gHtml = d.html)} minHeight="360px" />
					{/if}
				{/key}

				<div class="cl-field">
					<label for="art-direction">Direcție articol (pentru Regenerează)</label>
					<textarea
						id="art-direction"
						class="cl-input cl-textarea"
						bind:value={direction}
						placeholder="Context/direcție permanentă folosită la regenerarea întregului articol…"
					></textarea>
				</div>
			</div>

			<aside class="ct-seo">
				<div class="ct-seo-card">
					<h4>Imagine featured</h4>
					{#if featuredImageUrl}
						<img class="ct-fav-preview" src={featuredImageUrl} alt="" />
					{:else}
						<div class="ct-fav-empty">Fără imagine</div>
					{/if}
					<input
						class="ct-seo-input"
						style="width:100%"
						bind:value={featuredImageUrl}
						placeholder="URL imagine…"
						aria-label="URL imagine featured"
					/>
				</div>

				<div class="ct-seo-card">
					<h4>SEO</h4>
					<div class="ct-seo-field">
						<label for="seo-kw">Cuvânt-cheie focus</label>
						<input
							id="seo-kw"
							class="ct-seo-input"
							bind:value={focusKeyword}
							placeholder="ex: job videochat iași"
						/>
					</div>
					<div class="ct-seo-field">
						<label for="seo-title">
							Titlu SEO <span class="cnt">{(seoTitle || gTitle).length}/60</span>
						</label>
						<input id="seo-title" class="ct-seo-input" bind:value={seoTitle} placeholder={gTitle} />
					</div>
					<div class="ct-seo-field">
						<label for="seo-meta">
							Meta description <span class="cnt">{(metaDescription || gExcerpt).length}/160</span>
						</label>
						<textarea
							id="seo-meta"
							class="ct-seo-input"
							rows="3"
							bind:value={metaDescription}
							placeholder={gExcerpt}
						></textarea>
					</div>
					<div class="ct-seo-field">
						<label for="seo-slug">Slug (URL)</label>
						<input id="seo-slug" class="ct-seo-input" bind:value={slug} placeholder="slug-articol" />
					</div>
				</div>

				<div class="ct-seo-card">
					<div class="ct-score-hero">
						<div class="ct-score-ring {scoreClass(analysis.overall)}">{analysis.overall}</div>
						<div>
							<div style="font-weight:800; font-size:14px">
								Scor {analysis.overall >= 70 ? 'bun' : analysis.overall >= 40 ? 'ok' : 'slab'}
							</div>
							<div style="font-size:11.5px; color:var(--cl-text-3)">SEO · AEO · GEO</div>
						</div>
					</div>
					<div class="ct-seo-groups">
						{#each [{ k: 'SEO', g: analysis.seo }, { k: 'AEO', g: analysis.aeo }, { k: 'GEO', g: analysis.geo }] as row (row.k)}
							<div class="ct-seo-grouprow">
								<span class="lbl">{row.k}</span>
								<div class="ct-seo-bar">
									<span style="width:{row.g.score}%; background:{barColor(row.g.score)}"></span>
								</div>
								<span class="val">{row.g.score}</span>
							</div>
						{/each}
					</div>
				</div>

				{#each [{ k: 'Analiză SEO', g: analysis.seo }, { k: 'AEO (answer engine)', g: analysis.aeo }, { k: 'GEO (generative engine)', g: analysis.geo }] as grp (grp.k)}
					<div class="ct-seo-card">
						<h4>{grp.k}</h4>
						<div class="ct-checks">
							{#each grp.g.checks as c (c.id)}
								<div class="ct-check {c.status}">
									<span class="cdot"></span>
									<span>
										<span class="clbl">{c.label}</span>
										<span class="chint">{c.hint}</span>
									</span>
								</div>
							{/each}
						</div>
					</div>
				{/each}
			</aside>
		</div>

		{#snippet pending()}
			<div class="ct-page-loading">
				<Loader2Icon size={22} class="ct-spin" />
				<span>Se încarcă articolul…</span>
			</div>
		{/snippet}

		{#snippet failed(error, reset)}
			<div class="ct-page-loading">
				<TriangleAlertIcon size={26} />
				<span>{error instanceof Error ? error.message : 'Nu am putut încărca articolul.'}</span>
				<div style="display:flex; gap:8px">
					<button class="cl-btn-secondary" onclick={reset}>Reîncearcă</button>
					<a class="cl-btn-secondary" href={`/${tenant}/content/${websiteId}`}>Înapoi</a>
				</div>
			</div>
		{/snippet}
	</svelte:boundary>
</div>

<style>
	.ct-page-loading {
		flex: 1;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 14px;
		padding: 60px 40px;
		color: var(--cl-text-3);
		font-size: 13px;
		text-align: center;
	}
	.cl-hero-actions :global(.ct-spin),
	.ct-page-loading :global(.ct-spin) {
		animation: ct-spin 0.8s linear infinite;
	}
	@keyframes ct-spin {
		to {
			transform: rotate(360deg);
		}
	}
</style>
