<script lang="ts">
	import './content.css';
	import { goto } from '$app/navigation';
	import { getContentWebsites } from '$lib/remotes/content-articles.remote';
	import { getFaviconUrl } from '$lib/utils';
	import FolderIcon from '@lucide/svelte/icons/folder';
	import FileTextIcon from '@lucide/svelte/icons/file-text';
	import CircleCheckIcon from '@lucide/svelte/icons/circle-check';
	import GlobeIcon from '@lucide/svelte/icons/globe';
	import SlidersHorizontalIcon from '@lucide/svelte/icons/sliders-horizontal';
	import RefreshCwIcon from '@lucide/svelte/icons/refresh-cw';
	import TriangleAlertIcon from '@lucide/svelte/icons/triangle-alert';

	// basePath: rădăcina modulului („/ots/content" în admin, „/client/ots/content" în portal).
	// homeHref: unde duce breadcrumb-ul de acasă. isClient: ascunde detalii interne (profil/WP).
	let {
		basePath,
		homeHref,
		isClient = false
	}: { basePath: string; homeHref: string; isClient?: boolean } = $props();

	const websites = $derived(await getContentWebsites());

	const totalArticles = $derived(websites.reduce((s, w) => s + Number(w.total), 0));
	const readyArticles = $derived(websites.reduce((s, w) => s + Number(w.ready), 0));
	const websiteCount = $derived(websites.length);

	const kpiSkel = [0, 1, 2];
	const cardSkel = [0, 1, 2, 3, 4, 5];

	function domainOf(url: string): string {
		try {
			return new URL(url).hostname.replace(/^www\./, '');
		} catch {
			return url;
		}
	}

	function openWebsite(id: string) {
		goto(`${basePath}/${id}`);
	}

	function onCardKey(e: KeyboardEvent, id: string) {
		if (e.key === 'Enter' || e.key === ' ') {
			e.preventDefault();
			openWebsite(id);
		}
	}

	async function refresh() {
		try {
			await getContentWebsites().refresh();
		} catch {
			/* refresh e best-effort; eroarea de fond e tratată de boundary */
		}
	}
</script>

<svelte:head><title>Content · CRM</title></svelte:head>

<div class="cl-wrap">
	<div class="cl-crumbs">
		<a href={homeHref} aria-label="Acasă"><FolderIcon size={12} /></a>
		<span class="sep">›</span>
		<strong>Content</strong>
	</div>

	<svelte:boundary>
		<div class="cl-hero">
			<div>
				<h1>Content</h1>
				<p>Articole AI per website · <strong>{websiteCount}</strong> website-uri</p>
			</div>
			<div class="cl-hero-actions">
				<button class="cl-btn-secondary" onclick={refresh}>
					<RefreshCwIcon size={13} /> Reîmprospătează
				</button>
			</div>
		</div>

		{#if websiteCount > 0}
			<div class="cl-hero" style="padding-top:0; padding-bottom:0">
				<div class="cl-kpis" style="width:100%; grid-template-columns:repeat(3, 1fr)">
					<div class="cl-kpi">
						<div class="cl-kpi-ic" style="background:rgba(24,119,242,.08); color:#1877F2">
							<FileTextIcon size={16} />
						</div>
						<div>
							<div class="cl-kpi-lbl">Total articole</div>
							<div class="cl-kpi-val">{totalArticles}</div>
						</div>
					</div>
					<div class="cl-kpi">
						<div class="cl-kpi-ic" style="background:rgba(16,185,129,.08); color:#10b981">
							<CircleCheckIcon size={16} />
						</div>
						<div>
							<div class="cl-kpi-lbl">Gata de publicare</div>
							<div class="cl-kpi-val cl-text-ok">{readyArticles}</div>
						</div>
					</div>
					<div class="cl-kpi">
						<div class="cl-kpi-ic" style="background:rgba(139,92,246,.08); color:#8b5cf6">
							<GlobeIcon size={16} />
						</div>
						<div>
							<div class="cl-kpi-lbl">Website-uri</div>
							<div class="cl-kpi-val">{websiteCount}</div>
						</div>
					</div>
				</div>
			</div>
		{/if}

		{#if websiteCount === 0}
			<div class="ct-web-grid">
				<div class="cl-empty">
					<FileTextIcon size={32} />
					<h3>Niciun conținut</h3>
					<p>Nu există încă articole procesate pentru niciun website.</p>
				</div>
			</div>
		{:else}
			<div class="ct-web-grid">
				{#each websites as w (w.id)}
					<div
						class="ct-web-card"
						role="button"
						tabindex="0"
						aria-label={`Deschide ${w.name ?? domainOf(w.url)}`}
						onclick={() => openWebsite(w.id)}
						onkeydown={(e) => onCardKey(e, w.id)}
					>
						<div class="ct-web-head">
							<img class="ct-web-fav" src={getFaviconUrl(w.url)} alt="" loading="lazy" />
							<div class="ct-web-meta">
								<div class="ct-web-name">{w.name ?? domainOf(w.url)}</div>
								<div class="ct-web-url">{w.url}</div>
								{#if w.clientName && !isClient}<div class="ct-web-url">{w.clientName}</div>{/if}
							</div>
						</div>
						<div class="ct-web-stats">
							<div>
								<div class="ct-web-stat-v">{Number(w.total)}</div>
								<div class="ct-web-stat-l">Articole</div>
							</div>
							<div>
								<div class="ct-web-stat-v">{Number(w.ready)}</div>
								<div class="ct-web-stat-l">Gata</div>
							</div>
						</div>
						{#if !isClient}
							<div class="ct-web-badges">
								<span class="ct-badge {w.wpSiteId ? 'on' : 'off'}">
									<GlobeIcon size={11} />
									{w.wpSiteId ? 'WP legat' : 'fără WP'}
								</span>
								<span class="ct-badge {w.profileId ? 'on' : 'off'}">
									<SlidersHorizontalIcon size={11} />
									{w.profileId ? 'Profil' : 'fără profil'}
								</span>
							</div>
						{/if}
					</div>
				{/each}
			</div>
		{/if}

		{#snippet pending()}
			<div class="cl-hero">
				<div>
					<div class="ct-skel" style="width:170px; height:28px; border-radius:8px"></div>
					<div class="ct-skel" style="width:250px; height:13px; margin-top:12px; border-radius:6px"></div>
				</div>
			</div>
			<div class="cl-hero" style="padding-top:0; padding-bottom:0">
				<div class="cl-kpis" style="width:100%; grid-template-columns:repeat(3, 1fr)">
					{#each kpiSkel as i (i)}
						<div class="cl-kpi ct-skel" style="height:66px"></div>
					{/each}
				</div>
			</div>
			<div class="ct-web-grid">
				{#each cardSkel as i (i)}
					<div class="ct-web-card ct-skel" style="height:128px; cursor:default; pointer-events:none"></div>
				{/each}
			</div>
		{/snippet}

		{#snippet failed(error, reset)}
			<div class="cl-hero">
				<div>
					<h1>Content</h1>
					<p>Articole AI per website</p>
				</div>
			</div>
			<div class="ct-web-grid">
				<div class="cl-empty">
					<TriangleAlertIcon size={32} />
					<h3>Nu am putut încărca conținutul</h3>
					<p>{error instanceof Error ? error.message : 'Eroare necunoscută. Încearcă din nou.'}</p>
					<button class="cl-btn-secondary" style="margin-top:14px" onclick={reset}>
						<RefreshCwIcon size={13} /> Reîncearcă
					</button>
				</div>
			</div>
		{/snippet}
	</svelte:boundary>
</div>

<style>
	.ct-web-meta {
		min-width: 0;
	}
	.ct-web-name,
	.ct-web-url {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.ct-skel {
		background: var(--cl-border);
		animation: ct-skel-pulse 1.4s ease-in-out infinite;
	}
	@keyframes ct-skel-pulse {
		0%,
		100% {
			opacity: 1;
		}
		50% {
			opacity: 0.5;
		}
	}
</style>
