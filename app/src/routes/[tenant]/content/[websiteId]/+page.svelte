<script lang="ts">
	import '../content.css';
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import {
		getWebsiteArticles,
		getContentWebsites,
		generateArticleFromBrief,
		getWebsiteCalendar,
		getTenantWordpressSites,
		setWebsiteWpSite,
		refreshArticleWpCategories
	} from '$lib/remotes/content-articles.remote';
	import {
		getWebsiteContentProfile,
		updateWebsiteContentProfile,
		updateWebsitePublishPolicy
	} from '$lib/remotes/website-content-profile.remote';
	import { buildMonthGrid } from '$lib/content/calendar';
	import { toast } from 'svelte-sonner';
	import FolderIcon from '@lucide/svelte/icons/folder';
	import FileTextIcon from '@lucide/svelte/icons/file-text';
	import ExternalLinkIcon from '@lucide/svelte/icons/external-link';
	import SlidersHorizontalIcon from '@lucide/svelte/icons/sliders-horizontal';
	import TriangleAlertIcon from '@lucide/svelte/icons/triangle-alert';
	import SaveIcon from '@lucide/svelte/icons/save';
	import CalendarIcon from '@lucide/svelte/icons/calendar';
	import Settings2Icon from '@lucide/svelte/icons/settings-2';
	import RefreshCwIcon from '@lucide/svelte/icons/refresh-cw';

	// Route param is guaranteed by the [websiteId] segment; assert non-null so it
	// stays `string` for the remote-function calls below.
	const websiteId = $derived(page.params.websiteId!);

	type Tab = 'articole' | 'context' | 'calendar' | 'setari';
	let activeTab = $state<Tab>('articole');

	// ---- Articole tab state ----
	let statusFilter = $state('');

	// Categoriile WP ale unui articol (coloana `wp_categories`, JSON [{id,name,slug}]).
	function wpCats(raw: string | null): Array<{ id: number; name: string; slug: string }> {
		if (!raw) return [];
		try {
			const v = JSON.parse(raw);
			return Array.isArray(v) ? v : [];
		} catch {
			return [];
		}
	}

	let refreshingCats = $state(false);
	async function doRefreshCats() {
		if (refreshingCats) return;
		refreshingCats = true;
		try {
			const r = await refreshArticleWpCategories(websiteId).updates(
				getWebsiteArticles({ websiteId, status: statusFilter || undefined })
			);
			toast.success(`Categorii actualizate: ${r.updated}/${r.total} articole`);
		} catch (e) {
			toast.error(e instanceof Error ? e.message : 'Refresh categorii eșuat');
		} finally {
			refreshingCats = false;
		}
	}

	function openArticle(id: string) {
		goto(`/${page.params.tenant}/content/${websiteId}/${id}`);
	}

	// ---- Articol nou din brief ----
	let showBrief = $state(false);
	let brief = $state('');
	let creatingBrief = $state(false);

	// ---- Async data (read inside boundaries) ----
	const websites = $derived(await getContentWebsites());
	const site = $derived(websites.find((w) => w.id === websiteId));
	const websiteName = $derived(site?.name ?? site?.url ?? websiteId);
	const articles = $derived(await getWebsiteArticles({ websiteId, status: statusFilter || undefined }));
	const profile = $derived(await getWebsiteContentProfile(websiteId));

	// ---- Context tab: local editable form synced once per website ----
	let form = $state({
		tone: '',
		audience: '',
		language: 'ro',
		keywords: '',
		topics: '',
		doList: '',
		dontList: '',
		guardrails: '',
		sampleUrls: '',
		extraNotes: ''
	});
	let loadedFor = $state<string | null>(null);
	let savingProfile = $state(false);

	// Plain (non-async) title state so <svelte:head> never reads the async
	// derived directly (that would suspend outside a boundary). The effect
	// reads the async websiteName and mirrors it into document title.
	let pageTitle = $state('Content');
	$effect(() => {
		pageTitle = websiteName ? `${websiteName} · Content` : 'Content';
	});

	$effect(() => {
		if (profile && loadedFor !== websiteId) {
			form = {
				tone: profile.tone ?? '',
				audience: profile.audience ?? '',
				language: profile.language ?? 'ro',
				keywords: profile.keywords ?? '',
				topics: profile.topics ?? '',
				doList: profile.doList ?? '',
				dontList: profile.dontList ?? '',
				guardrails: profile.guardrails ?? '',
				sampleUrls: profile.sampleUrls ?? '',
				extraNotes: profile.extraNotes ?? ''
			};
			loadedFor = websiteId;
		}
	});

	// ---- Calendar tab state ----
	const today = new Date();
	let calYear = $state(today.getFullYear());
	let calMonth = $state(today.getMonth()); // 0-based
	const grid = $derived(buildMonthGrid(calYear, calMonth));
	const calArticles = $derived(await getWebsiteCalendar({ websiteId, year: calYear, month: calMonth }));
	// mapează articolele pe zi (cheie iso YYYY-MM-DD)
	const byDay = $derived.by(() => {
		const m = new Map<string, typeof calArticles>();
		for (const a of calArticles) {
			if (!a.scheduledAt) continue;
			const d = a.scheduledAt instanceof Date ? a.scheduledAt : new Date(a.scheduledAt);
			const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
			const arr = m.get(iso) ?? [];
			arr.push(a);
			m.set(iso, arr);
		}
		return m;
	});
	function prevMonth() {
		if (calMonth === 0) {
			calMonth = 11;
			calYear--;
		} else calMonth--;
	}
	function nextMonthNav() {
		if (calMonth === 11) {
			calMonth = 0;
			calYear++;
		} else calMonth++;
	}
	const MONTHS = [
		'Ianuarie',
		'Februarie',
		'Martie',
		'Aprilie',
		'Mai',
		'Iunie',
		'Iulie',
		'August',
		'Septembrie',
		'Octombrie',
		'Noiembrie',
		'Decembrie'
	];

	// ---- Setări tab state (WP link + politică publicare) ----
	const wpSites = $derived(await getTenantWordpressSites());
	const PUB_MODES = [
		['manual', 'Manual'],
		['scheduled', 'Programat'],
		['auto', 'Auto']
	] as const;
	const DOW = [
		[1, 'Lu'],
		[2, 'Ma'],
		[3, 'Mi'],
		[4, 'Jo'],
		[5, 'Vi'],
		[6, 'Sâ'],
		[0, 'Du']
	] as const;
	let policyForm = $state<{
		publishMode: 'manual' | 'scheduled' | 'auto';
		cadencePerWeek: number;
		daysOfWeek: number[];
		publishTime: string;
		defaultWpStatus: 'draft' | 'publish';
		autoApprove: boolean;
	}>({
		publishMode: 'manual',
		cadencePerWeek: 3,
		daysOfWeek: [],
		publishTime: '10:00',
		defaultWpStatus: 'draft',
		autoApprove: false
	});
	let policyLoadedFor = $state<string | null>(null);
	let selectedWpSiteId = $state<string>('');
	let savingPolicy = $state(false);

	function parseDays(raw: string | null | undefined): number[] {
		if (!raw) return [];
		try {
			const a = JSON.parse(raw);
			return Array.isArray(a) ? a.filter((n) => typeof n === 'number') : [];
		} catch {
			return [];
		}
	}
	function toggleDay(d: number) {
		policyForm.daysOfWeek = policyForm.daysOfWeek.includes(d)
			? policyForm.daysOfWeek.filter((x) => x !== d)
			: [...policyForm.daysOfWeek, d];
	}

	$effect(() => {
		if (profile && policyLoadedFor !== websiteId) {
			policyForm = {
				publishMode: (profile.publishMode as 'manual' | 'scheduled' | 'auto') ?? 'manual',
				cadencePerWeek: profile.cadencePerWeek ?? 3,
				daysOfWeek: parseDays(profile.daysOfWeek),
				publishTime: profile.publishTime ?? '10:00',
				defaultWpStatus: (profile.defaultWpStatus as 'draft' | 'publish') ?? 'draft',
				autoApprove: profile.autoApprove ?? false
			};
			policyLoadedFor = websiteId;
		}
	});
	$effect(() => {
		if (site) selectedWpSiteId = site.wpSiteId ?? '';
	});

	async function savePolicy() {
		if (savingPolicy) return;
		savingPolicy = true;
		try {
			await updateWebsitePublishPolicy({
				websiteId,
				publishMode: policyForm.publishMode,
				cadencePerWeek: Number(policyForm.cadencePerWeek),
				daysOfWeek: policyForm.daysOfWeek,
				publishTime: policyForm.publishTime,
				defaultWpStatus: policyForm.defaultWpStatus,
				autoApprove: policyForm.autoApprove
			}).updates(getWebsiteContentProfile(websiteId));
			toast.success('Politică salvată');
		} catch (e) {
			toast.error(e instanceof Error ? e.message : 'Eroare');
		} finally {
			savingPolicy = false;
		}
	}
	async function saveWpLink() {
		try {
			await setWebsiteWpSite({ websiteId, wpSiteId: selectedWpSiteId || null }).updates(
				getContentWebsites()
			);
			toast.success('Legătură WordPress salvată');
		} catch (e) {
			toast.error(e instanceof Error ? e.message : 'Eroare');
		}
	}

	function statusPill(a: { rewriteStatus: string | null; origin: string | null }) {
		if (a.rewriteStatus === 'ready') return { cls: 'ready', label: 'Ready' };
		if (a.origin === 'rewrite') return { cls: 'draft', label: 'Draft' };
		return { cls: 'source', label: 'Sursă' };
	}

	function formatDate(d: Date | string | null | undefined): string {
		if (!d) return '—';
		const date = d instanceof Date ? d : new Date(d);
		if (Number.isNaN(date.getTime())) return '—';
		return date.toLocaleDateString('ro-RO', { day: '2-digit', month: 'short', year: 'numeric' });
	}

	function onRowKey(e: KeyboardEvent, id: string) {
		if (e.key === 'Enter' || e.key === ' ') {
			e.preventDefault();
			openArticle(id);
		}
	}

	async function createFromBrief() {
		if (creatingBrief || !brief.trim()) return;
		creatingBrief = true;
		try {
			const r = await generateArticleFromBrief({ websiteId, brief }).updates(
				getWebsiteArticles({ websiteId, status: statusFilter || undefined })
			);
			toast.success('Articol generat');
			brief = '';
			showBrief = false;
			// Navighează la editorul articolului nou creat.
			if (r?.id) await goto(`/${page.params.tenant}/content/${websiteId}/${r.id}`);
		} catch (e) {
			toast.error(e instanceof Error ? e.message : 'Generare eșuată');
		} finally {
			creatingBrief = false;
		}
	}

	async function saveProfile() {
		if (savingProfile) return;
		savingProfile = true;
		try {
			await updateWebsiteContentProfile({ websiteId, ...form }).updates(
				getWebsiteContentProfile(websiteId)
			);
			toast.success('Profil salvat');
		} catch (e) {
			toast.error(e instanceof Error ? e.message : 'Eroare la salvare');
		} finally {
			savingProfile = false;
		}
	}

	const skelRows = [0, 1, 2, 3, 4];
</script>

<svelte:head><title>{pageTitle}</title></svelte:head>

<div class="cl-wrap">
	<svelte:boundary>
		<div class="cl-crumbs">
			<a href={`/${page.params.tenant}`} aria-label="Dashboard"><FolderIcon size={12} /></a>
			<span class="sep">›</span>
			<a href={`/${page.params.tenant}/content`}>Content</a>
			<span class="sep">›</span>
			<strong>{websiteName}</strong>
		</div>

		<div class="cl-hero">
			<div>
				<h1>{websiteName}</h1>
				{#if site?.url}<p>{site.url}</p>{/if}
			</div>
		</div>

		<div class="cl-toolbar">
			<div class="cl-tabs">
				<button
					class="cl-tab"
					class:active={activeTab === 'articole'}
					onclick={() => (activeTab = 'articole')}
				>
					<FileTextIcon size={13} /> Articole
				</button>
				<button
					class="cl-tab"
					class:active={activeTab === 'context'}
					onclick={() => (activeTab = 'context')}
				>
					<SlidersHorizontalIcon size={13} /> Context brand
				</button>
				<button
					class="cl-tab"
					class:active={activeTab === 'calendar'}
					onclick={() => (activeTab = 'calendar')}
				>
					<CalendarIcon size={13} /> Calendar
				</button>
				<button
					class="cl-tab"
					class:active={activeTab === 'setari'}
					onclick={() => (activeTab = 'setari')}
				>
					<Settings2Icon size={13} /> Setări
				</button>
			</div>

			{#if activeTab === 'articole'}
				<div style="margin-left:auto; display:flex; align-items:center; gap:12px; flex-wrap:wrap">
					<div class="cl-select-wrap">
						<span class="cl-select-lbl">Status</span>
						<select class="cl-select" bind:value={statusFilter}>
							<option value="">Toate</option>
							<option value="ready">Ready</option>
							<option value="none">Nerescris</option>
							<option value="drafting">În lucru</option>
						</select>
					</div>
					<button
						class="cl-btn-secondary"
						onclick={doRefreshCats}
						disabled={refreshingCats}
						title="Preia categoriile articolelor publicate/programate de pe WordPress"
					>
						<RefreshCwIcon size={13} class={refreshingCats ? 'ct-spin' : ''} />
						{refreshingCats ? 'Se actualizează…' : 'Categorii WP'}
					</button>
					<button class="cl-btn-primary" onclick={() => (showBrief = true)}>+ Articol nou</button>
				</div>
			{/if}
		</div>

		{#if activeTab === 'articole' && showBrief}
			<div style="margin:0 28px 14px">
				<div class="cl-section">
					<div class="cl-field">
						<label for="brief-input">Articol nou din brief</label>
						<textarea
							id="brief-input"
							class="cl-input cl-textarea"
							bind:value={brief}
							placeholder="Subiect / keyword pentru articolul nou…"
						></textarea>
					</div>
					<div style="display:flex; justify-content:flex-end; gap:10px; margin-top:12px">
						<button
							class="cl-btn-secondary"
							disabled={creatingBrief}
							onclick={() => (showBrief = false)}
						>
							Renunță
						</button>
						<button
							class="cl-btn-primary"
							disabled={!brief.trim() || creatingBrief}
							onclick={createFromBrief}
						>
							{creatingBrief ? 'Se generează…' : 'Generează'}
						</button>
					</div>
				</div>
			</div>
		{/if}

		{#if activeTab === 'articole'}
			<svelte:boundary>
				{#if articles.length === 0}
					<div class="cl-list-wrap" style="padding:0">
						<div class="cl-empty" style="border:0">
							<FileTextIcon size={32} />
							<h3>Niciun articol</h3>
							<p>Nu există articole pentru filtrul curent.</p>
						</div>
					</div>
				{:else}
					<div class="cl-list-wrap">
						<table class="cl-list-table">
							<thead>
								<tr>
									<th>Titlu</th>
									<th>Status</th>
									<th>Categorii</th>
									<th>Cuvinte</th>
									<th>Data</th>
									<th>Sursă</th>
								</tr>
							</thead>
							<tbody>
								{#each articles as a (a.id)}
									{@const pill = statusPill(a)}
									{@const cats = wpCats(a.wpCategories)}
									<tr
										role="button"
										tabindex="0"
										aria-label={`Deschide ${a.generatedTitle ?? a.title ?? 'articol'}`}
										onclick={() => openArticle(a.id)}
										onkeydown={(e) => onRowKey(e, a.id)}
									>
										<td>{a.generatedTitle ?? a.title ?? '—'}</td>
										<td>
											<span class="ct-st {pill.cls}"><span class="dot"></span>{pill.label}</span>
										</td>
										<td>
											{#if cats.length > 0}
												<span class="ct-web-badges">
													{#each cats as c (c.id)}
														<span class="ct-badge off">{c.name}</span>
													{/each}
												</span>
											{:else}
												<span style="color:var(--cl-text-3)">—</span>
											{/if}
										</td>
										<td style="font-variant-numeric:tabular-nums">{a.wordCount ?? '—'}</td>
										<td>{formatDate(a.publishedAt)}</td>
										<td>
											{#if a.sourceUrl}
												<!-- svelte-ignore a11y_no_static_element_interactions -->
												<a
													href={a.sourceUrl}
													target="_blank"
													rel="noopener noreferrer"
													onclick={(e) => e.stopPropagation()}
													onkeydown={(e) => e.stopPropagation()}
													aria-label="Deschide sursa"
												>
													<ExternalLinkIcon size={14} />
												</a>
											{:else}
												<span style="color:var(--cl-text-3)">—</span>
											{/if}
										</td>
									</tr>
								{/each}
							</tbody>
						</table>
					</div>
				{/if}

				{#snippet pending()}
					<div class="cl-list-wrap">
						<table class="cl-list-table">
							<thead>
								<tr>
									<th>Titlu</th>
									<th>Status</th>
									<th>Categorii</th>
									<th>Cuvinte</th>
									<th>Data</th>
									<th>Sursă</th>
								</tr>
							</thead>
							<tbody>
								{#each skelRows as i (i)}
									<tr>
										<td colspan="6">
											<div class="ct-skel" style="height:16px; border-radius:6px"></div>
										</td>
									</tr>
								{/each}
							</tbody>
						</table>
					</div>
				{/snippet}

				{#snippet failed(error, reset)}
					<div class="cl-list-wrap" style="padding:0">
						<div class="cl-empty" style="border:0">
							<TriangleAlertIcon size={32} />
							<h3>Nu am putut încărca articolele</h3>
							<p>{error instanceof Error ? error.message : 'Eroare necunoscută.'}</p>
							<button class="cl-btn-secondary" style="margin-top:14px" onclick={reset}>
								Reîncearcă
							</button>
						</div>
					</div>
				{/snippet}
			</svelte:boundary>
		{/if}

		{#if activeTab === 'context'}
			<svelte:boundary>
				<div class="cl-ctx">
					<div class="cl-section">
						{#if profile === null}
							<div class="cl-empty" style="border:0; padding:20px 0 24px">
								<SlidersHorizontalIcon size={28} />
								<h3>Fără profil pentru acest website</h3>
								<p>Completează câmpurile de mai jos pentru a defini contextul de brand.</p>
							</div>
						{/if}

						<div class="cl-form-row two">
							<div class="cl-field">
								<label for="ctx-tone">Ton</label>
								<input
									id="ctx-tone"
									class="cl-input"
									bind:value={form.tone}
									placeholder="ex: cald, profesional"
								/>
							</div>
							<div class="cl-field">
								<label for="ctx-audience">Public țintă</label>
								<input
									id="ctx-audience"
									class="cl-input"
									bind:value={form.audience}
									placeholder="ex: femei 18-30 ani"
								/>
							</div>
						</div>

						<div class="cl-form-row two" style="margin-top:12px">
							<div class="cl-field">
								<label for="ctx-language">Limbă</label>
								<input id="ctx-language" class="cl-input" bind:value={form.language} placeholder="ro" />
							</div>
							<div class="cl-field">
								<label for="ctx-keywords">Cuvinte cheie</label>
								<input
									id="ctx-keywords"
									class="cl-input"
									bind:value={form.keywords}
									placeholder="separate prin virgulă"
								/>
							</div>
						</div>

						<div class="cl-form-row two" style="margin-top:12px">
							<div class="cl-field">
								<label for="ctx-topics">Subiecte</label>
								<input
									id="ctx-topics"
									class="cl-input"
									bind:value={form.topics}
									placeholder="teme recurente"
								/>
							</div>
							<div class="cl-field">
								<label for="ctx-sampleUrls">URL-uri exemplu</label>
								<input
									id="ctx-sampleUrls"
									class="cl-input"
									bind:value={form.sampleUrls}
									placeholder="link-uri de referință"
								/>
							</div>
						</div>

						<div class="cl-form-row two" style="margin-top:12px">
							<div class="cl-field">
								<label for="ctx-doList">De făcut (do)</label>
								<textarea
									id="ctx-doList"
									class="cl-input cl-textarea"
									bind:value={form.doList}
									placeholder="ce trebuie să facă textul"
								></textarea>
							</div>
							<div class="cl-field">
								<label for="ctx-dontList">De evitat (don't)</label>
								<textarea
									id="ctx-dontList"
									class="cl-input cl-textarea"
									bind:value={form.dontList}
									placeholder="ce trebuie evitat"
								></textarea>
							</div>
						</div>

						<div class="cl-form-row two" style="margin-top:12px">
							<div class="cl-field">
								<label for="ctx-guardrails">Reguli / limite</label>
								<textarea
									id="ctx-guardrails"
									class="cl-input cl-textarea"
									bind:value={form.guardrails}
									placeholder="limitări, restricții legale"
								></textarea>
							</div>
							<div class="cl-field">
								<label for="ctx-extraNotes">Note suplimentare</label>
								<textarea
									id="ctx-extraNotes"
									class="cl-input cl-textarea"
									bind:value={form.extraNotes}
									placeholder="orice altceva relevant"
								></textarea>
							</div>
						</div>

						<div style="display:flex; justify-content:flex-end; margin-top:16px">
							<button class="cl-btn-primary" disabled={savingProfile} onclick={saveProfile}>
								<SaveIcon size={13} /> Salvează profil
							</button>
						</div>
					</div>
				</div>

				{#snippet pending()}
					<div class="cl-ctx">
						<div class="cl-section ct-skel" style="height:360px"></div>
					</div>
				{/snippet}

				{#snippet failed(error, reset)}
					<div class="cl-ctx">
						<div class="cl-empty">
							<TriangleAlertIcon size={32} />
							<h3>Nu am putut încărca profilul</h3>
							<p>{error instanceof Error ? error.message : 'Eroare necunoscută.'}</p>
							<button class="cl-btn-secondary" style="margin-top:14px" onclick={reset}>
								Reîncearcă
							</button>
						</div>
					</div>
				{/snippet}
			</svelte:boundary>
		{/if}

		{#if activeTab === 'calendar'}
			<svelte:boundary>
				<div class="cl-ctx">
					<div class="cl-cal-head">
						<button class="cl-btn-secondary" onclick={prevMonth} aria-label="Luna anterioară"
							>‹</button
						>
						<strong>{MONTHS[calMonth]} {calYear}</strong>
						<button class="cl-btn-secondary" onclick={nextMonthNav} aria-label="Luna următoare"
							>›</button
						>
					</div>
					<div class="cl-cal-grid">
						{#each ['Lu', 'Ma', 'Mi', 'Jo', 'Vi', 'Sâ', 'Du'] as dn (dn)}
							<div class="cl-cal-dow">{dn}</div>
						{/each}
						{#each grid as week (week[0].iso)}
							{#each week as d (d.iso)}
								<div class="cl-cal-cell" class:out={!d.inMonth}>
									<span class="cl-cal-num">{d.day}</span>
									{#each byDay.get(d.iso) ?? [] as a (a.id)}
										<button
											class="cl-cal-chip {a.publishStatus}"
											onclick={() => openArticle(a.id)}
											title={a.generatedTitle ?? a.title ?? ''}
										>
											{(a.generatedTitle ?? a.title ?? '—').slice(0, 22)}
										</button>
									{/each}
								</div>
							{/each}
						{/each}
					</div>
				</div>
				{#snippet pending()}
					<div class="cl-ctx"><div class="cl-section ct-skel" style="height:360px"></div></div>
				{/snippet}
				{#snippet failed(error, reset)}
					<div class="cl-ctx">
						<div class="cl-empty">
							<TriangleAlertIcon size={32} />
							<h3>Eroare calendar</h3>
							<p>{error instanceof Error ? error.message : ''}</p>
							<button class="cl-btn-secondary" onclick={reset}>Reîncearcă</button>
						</div>
					</div>
				{/snippet}
			</svelte:boundary>
		{/if}

		{#if activeTab === 'setari'}
			<svelte:boundary>
				<div class="cl-ctx">
					<div class="cl-section">
						<div class="cl-field">
							<label for="wp-site">Site WordPress (publicare)</label>
							<div style="display:flex; gap:10px">
								<select id="wp-site" class="cl-input" bind:value={selectedWpSiteId}>
									<option value="">— nelegat —</option>
									{#each wpSites as s (s.id)}
										<option value={s.id}>{s.siteUrl}</option>
									{/each}
								</select>
								<button class="cl-btn-secondary" onclick={saveWpLink}>Salvează</button>
							</div>
						</div>

						<div class="cl-field" style="margin-top:16px">
							<label for="pub-mode">Mod publicare</label>
							<div class="cl-seg" id="pub-mode">
								{#each PUB_MODES as [val, lbl] (val)}
									<button
										class="cl-seg-btn"
										class:active={policyForm.publishMode === val}
										onclick={() => (policyForm.publishMode = val)}>{lbl}</button
									>
								{/each}
							</div>
						</div>

						<div class="cl-form-row two" style="margin-top:12px">
							<div class="cl-field">
								<label for="cadence">Articole / săptămână</label>
								<input
									id="cadence"
									type="number"
									min="0"
									max="21"
									class="cl-input"
									bind:value={policyForm.cadencePerWeek}
								/>
							</div>
							<div class="cl-field">
								<label for="ptime">Ora publicării</label>
								<input id="ptime" type="time" class="cl-input" bind:value={policyForm.publishTime} />
							</div>
						</div>

						<div class="cl-field" style="margin-top:12px">
							<span class="cl-lbl">Zile de publicare (mod programat/auto)</span>
							<div class="cl-seg" role="group" aria-label="Zile de publicare">
								{#each DOW as [d, lbl] (d)}
									<button
										type="button"
										class="cl-seg-btn"
										class:active={policyForm.daysOfWeek.includes(d)}
										onclick={() => toggleDay(d)}>{lbl}</button
									>
								{/each}
							</div>
						</div>

						<div class="cl-form-row two" style="margin-top:12px">
							<div class="cl-field">
								<label for="dwstatus">Status WP implicit</label>
								<select id="dwstatus" class="cl-input" bind:value={policyForm.defaultWpStatus}>
									<option value="draft">Ciornă</option>
									<option value="publish">Publicat</option>
								</select>
							</div>
							<div class="cl-field">
								<label for="autoappr">Auto-aprobare</label>
								<label class="cl-check">
									<input id="autoappr" type="checkbox" bind:checked={policyForm.autoApprove} />
									Publică automat fără review (mod auto)
								</label>
							</div>
						</div>

						<div style="display:flex; justify-content:flex-end; margin-top:16px">
							<button class="cl-btn-primary" disabled={savingPolicy} onclick={savePolicy}>
								<SaveIcon size={13} /> Salvează politica
							</button>
						</div>
					</div>
				</div>
				{#snippet pending()}
					<div class="cl-ctx"><div class="cl-section ct-skel" style="height:300px"></div></div>
				{/snippet}
				{#snippet failed(error, reset)}
					<div class="cl-ctx">
						<div class="cl-empty">
							<TriangleAlertIcon size={32} />
							<h3>Eroare setări</h3>
							<button class="cl-btn-secondary" onclick={reset}>Reîncearcă</button>
						</div>
					</div>
				{/snippet}
			</svelte:boundary>
		{/if}

		{#snippet pending()}
			<div class="cl-crumbs">
				<a href={`/${page.params.tenant}`} aria-label="Dashboard"><FolderIcon size={12} /></a>
				<span class="sep">›</span>
				<a href={`/${page.params.tenant}/content`}>Content</a>
				<span class="sep">›</span>
				<strong>{websiteId}</strong>
			</div>
			<div class="cl-hero">
				<div>
					<div class="ct-skel" style="width:220px; height:28px; border-radius:8px"></div>
				</div>
			</div>
		{/snippet}

		{#snippet failed(error, reset)}
			<div class="cl-crumbs">
				<a href={`/${page.params.tenant}/content`}>Content</a>
				<span class="sep">›</span>
				<strong>{websiteId}</strong>
			</div>
			<div class="cl-hero"><div><h1>Website</h1></div></div>
			<div class="cl-list-wrap" style="padding:0">
				<div class="cl-empty" style="border:0">
					<TriangleAlertIcon size={32} />
					<h3>Nu am putut încărca website-ul</h3>
					<p>{error instanceof Error ? error.message : 'Eroare necunoscută.'}</p>
					<button class="cl-btn-secondary" style="margin-top:14px" onclick={reset}>Reîncearcă</button>
				</div>
			</div>
		{/snippet}
	</svelte:boundary>
</div>

<style>
	.cl-ctx {
		margin: 0 28px 60px;
	}
	.ct-skel {
		background: var(--cl-border);
		animation: ct-skel-pulse 1.4s ease-in-out infinite;
	}
	.cl-toolbar :global(.ct-spin) {
		animation: ct-cats-spin 0.8s linear infinite;
	}
	@keyframes ct-cats-spin {
		to {
			transform: rotate(360deg);
		}
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
