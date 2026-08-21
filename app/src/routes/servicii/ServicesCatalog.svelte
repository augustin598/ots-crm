<!--
	Catalogul public de servicii (starea „deblocată" a paginii /servicii).

	Toate datele vin prin props, de la `+page.server.ts` — vezi comentariul din
	`types.ts` pentru motivul (prețurile nu trebuie să ajungă în bundle-ul de
	client al vizitatorilor care n-au introdus parola).

	DESIGN — același sistem ca /pachete-hosting, pagina publică pe care o avem deja
	și care funcționează. Nu inventăm un limbaj nou pentru a doua pagină publică:
	aceiași tokeni (--accent #1877f2, --ink #0b1220, --border #e5e9f0), același
	Inter, aceleași raze (10px butoane, 18px carduri), același nav sticky
	translucid, aceleași carduri cu ridicare la hover și aceeași bandă de subsol
	pe --bg-soft.

	Heroul e tot alb, ca acolo; în plus are o textură foarte discretă din imaginea
	de fundal, explicată la `.sv-hero` în blocul de stil.

	Versiunea anterioară folosea tokenii aplicației (`text-muted-foreground` pe
	`background`), care sunt gândiți pentru dashboard, nu pentru o pagină de
	vânzare: nimic nu era negru, marginile erau invizibile și accentul apărea doar
	în transparențe de 5-15%. De aici lipsa de contrast.
-->
<script lang="ts">
	import CheckIcon from '@lucide/svelte/icons/check';
	import MinusIcon from '@lucide/svelte/icons/minus';
	import SparklesIcon from '@lucide/svelte/icons/sparkles';
	import PercentIcon from '@lucide/svelte/icons/percent';
	import ArrowRightIcon from '@lucide/svelte/icons/arrow-right';
	import MailIcon from '@lucide/svelte/icons/mail';
	import PhoneIcon from '@lucide/svelte/icons/phone';
	import LogOutIcon from '@lucide/svelte/icons/log-out';
	import WandIcon from '@lucide/svelte/icons/wand';
	import CategoryIcon from '$lib/components/services/CategoryIcon.svelte';
	import PackageComparisonView from '$lib/components/services/PackageComparisonView.svelte';
	import { onMount } from 'svelte';
	import ShoppingBagIcon from '@lucide/svelte/icons/shopping-bag';
	import XIcon from '@lucide/svelte/icons/x';
	import ServicesQuoteModal from './ServicesQuoteModal.svelte';
	import CartToast, { type CartToastKind } from './CartToast.svelte';
	import { ServicesCart } from './services-cart.svelte';
	import { computeQuoteSummary, isTierOffered } from '$lib/logic/quote-pricing';
	import { dragScroll } from '$lib/actions/drag-scroll';
	import { formatEur, formatFeatureValue, isBooleanFeature } from '$lib/constants/ots-catalog-format';
	import type { Category, Tier } from '$lib/constants/ots-catalog';
	import type { PublicCatalog, PublicCompany } from './types';

	type Props = {
		catalog: PublicCatalog;
		company: PublicCompany;
	};

	let { catalog, company }: Props = $props();

	const bySlug = $derived(new Map(catalog.categories.map((c) => [c.slug, c])));
	const webDevSlugs = $derived(new Set(catalog.webDevSlugs));

	let activeGroupId = $state<string>('all');
	const visibleGroups = $derived(
		activeGroupId === 'all'
			? catalog.groups
			: catalog.groups.filter((g) => g.id === activeGroupId)
	);

	function categoriesInGroup(slugs: string[]): Category[] {
		return slugs.map((s) => bySlug.get(s)).filter((c): c is Category => c !== undefined);
	}

	let selectedCategory = $state<Category | null>(null);
	let compareOpen = $state(false);

	// Coșul de servicii: un serviciu = un tier; cererea pleacă o singură dată, din modal.
	// Se încarcă după montare, ca prima randare să fie identică cu cea de pe server.
	const cart = new ServicesCart();
	onMount(() => {
		// Un item rămâne valid doar dacă tier-ul lui chiar e oferit de categorie.
		cart.load((slug, tier) => {
			const cat = bySlug.get(slug);
			return !!cat && (catalog.tiers as string[]).includes(tier) && isTierOffered(cat, tier as never);
		});
	});
	const cartSummary = $derived(
		computeQuoteSummary(cart.items, catalog.categories, catalog.discountRules)
	);

	let quoteOpen = $state(false);

	const isWebDev = $derived(selectedCategory ? webDevSlugs.has(selectedCategory.slug) : false);

	function openCompare(cat: Category) {
		selectedCategory = cat;
		compareOpen = true;
	}

	// Confirmarea din mijlocul ecranului: comparația se închide la click, iar bara de
	// jos și contorul din nav nu sunt destul de explicite — vizitatorul trebuie să
	// vadă clar ce a intrat în ofertă. `seq` remontează componenta la fiecare acțiune.
	type ToastState = {
		kind: CartToastKind;
		category: Category | null;
		tier: Tier | null;
		/** Ce se pune înapoi la „Anulează" (serviciul scos sau toată oferta golită). */
		undo: { categorySlug: string; tier: Tier }[] | null;
	};
	let toast = $state<ToastState | null>(null);
	let toastSeq = $state(0);

	function showToast(next: ToastState) {
		toast = next;
		toastSeq += 1;
	}

	function undoToast() {
		if (!toast?.undo) return;
		for (const item of toast.undo) cart.set(item.categorySlug, item.tier);
		toast = null;
	}

	function clearCart() {
		const snapshot = cart.items.map((i) => ({ ...i }));
		cart.clear();
		showToast({ kind: 'cleared', category: null, tier: null, undo: snapshot });
	}

	/** Din comparație: același tier = scoate, alt tier = înlocuiește, serviciu nou = adaugă. */
	function handleTierPick(tier: Tier) {
		if (!selectedCategory) return;
		const before = cart.tierOf(selectedCategory.slug);
		const kind: CartToastKind = before === null ? 'added' : before === tier ? 'removed' : 'replaced';
		cart.toggle(selectedCategory.slug, tier);
		compareOpen = false;
		showToast({
			kind,
			category: selectedCategory,
			tier,
			undo: kind === 'removed' ? [{ categorySlug: selectedCategory.slug, tier }] : null
		});
	}

	function openQuote() {
		toast = null;
		quoteOpen = true;
	}

	const currentYear = new Date().getFullYear();
</script>

<div class={['sv-page', cart.count > 0 && 'sv-has-cart']}>
	<nav class="sv-nav">
		<div class="sv-nav-inner">
			<a href="/servicii" class="sv-logo">
				<img src="/onetop-logo.png" alt="One Top Solution — Servicii &amp; Pachete" />
			</a>
			<div class="sv-nav-spacer"></div>
			{#if cart.count > 0}
				<button type="button" class="sv-nav-cart" onclick={() => (quoteOpen = true)}>
					<ShoppingBagIcon class="h-4 w-4" aria-hidden="true" />
					<span class="sv-nav-cart-label">Oferta mea</span>
					<i>{cart.count}</i>
				</button>
			{/if}
			<a href="/servicii/configurator" class="sv-nav-secondary">Configurator</a>
			<form method="POST" action="?/lock">
				<button type="submit" class="sv-nav-exit">
					<LogOutIcon class="h-4 w-4" />
					Ieși
				</button>
			</form>
		</div>
	</nav>

	<section class="sv-hero">
		<span class="sv-hero-eyebrow"><span class="sv-dot"></span> Ofertă One Top Solution</span>
		<h1>Marketing, web și hosting pe <em>patru niveluri</em></h1>
		<p>
			De la Bronze la Platinum. Alege categoria care te interesează și vezi exact ce include fiecare
			pachet, cu prețul pe fiecare nivel.
		</p>
		<div class="sv-hero-actions">
			<a href="#categorii" class="sv-btn sv-btn-primary ots-gloss">
				Vezi pachetele <ArrowRightIcon class="h-4 w-4" />
			</a>
			<a href="/servicii/configurator" class="sv-btn sv-btn-ghost">
				<WandIcon class="h-4 w-4" /> Deschide configuratorul
			</a>
		</div>
		<div class="sv-hero-tagline">
			<span class="sv-hero-trust"><CheckIcon class="sv-ok" /> Prețuri în EUR, fără TVA</span>
			<span class="sv-hero-trust"><CheckIcon class="sv-ok" /> Acces CRM real-time inclus</span>
			<span class="sv-hero-trust"><CheckIcon class="sv-ok" /> Contract minim 1–6 luni</span>
		</div>
	</section>

	<!-- CRM inclus -->
	<section class="sv-section">
		<div class="sv-section-head">
			<span class="sv-kicker"><SparklesIcon class="h-3.5 w-3.5" /> Inclus gratuit</span>
			<h2>Acces CRM real-time în toate pachetele</h2>
			<p>Spend, conversii, poziții SEO, uptime, open rate — live, 24/7, în contul tău.</p>
		</div>

		<!-- Pe telefon tabelul derulează orizontal; fără indiciu, coloanele Silver–Platinum par să lipsească. -->
		<p class="sv-scrollhint" aria-hidden="true">Glisează tabelul spre stânga pentru Silver, Gold și Platinum →</p>

		<div class="sv-tablewrap" {@attach dragScroll}>
			<table class="sv-table">
				<thead>
					<tr>
						<th scope="col" class="sv-th-label">Feature CRM</th>
						{#each catalog.tiers as tier (tier)}
							<th scope="col" class="sv-th-tier">
								<span class="sv-tierdot" data-tier={tier}></span>
								{catalog.tierLabels[tier]}
							</th>
						{/each}
					</tr>
				</thead>
				<tbody>
					{#each catalog.crmFeatures as feat (feat.id)}
						<tr>
							<th scope="row" class="sv-td-label">{feat.label}</th>
							{#each catalog.tiers as tier (tier)}
								{@const value = feat.values[tier]}
								<td class="sv-td-val">
									{#if isBooleanFeature(value)}
										{#if value}
											<CheckIcon class="sv-yes" />
											<span class="sv-sr">inclus</span>
										{:else}
											<MinusIcon class="sv-no" />
											<span class="sv-sr">neinclus</span>
										{/if}
									{:else}
										<span class="sv-num">{formatFeatureValue(value)}</span>
									{/if}
								</td>
							{/each}
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	</section>

	<!-- Discount -->
	{#if catalog.discountRules.length > 0}
		<section class="sv-section">
			<div class="sv-section-head">
				<span class="sv-kicker"><PercentIcon class="h-3.5 w-3.5" /> Discount multi-servicii</span>
				<h2>Cu cât combini mai multe servicii, cu atât plătești mai puțin</h2>
				<p>
					Se aplică pe abonamentul lunar combinat — nu pe bugetul media și nu pe costul
					platformelor externe.
				</p>
			</div>
			<div class="sv-discounts">
				{#each catalog.discountRules as rule (rule.minServices)}
					<div class="sv-discount">
						<span class="sv-discount-n">−{rule.discountPct}%</span>
						<span class="sv-discount-l">{rule.label}</span>
					</div>
				{/each}
			</div>
		</section>
	{/if}

	<!-- Wizard. Aceeași ofertă ca în portalul clientului, doar că aici cererea
	     trece prin formularul public de contact. -->
	<section class="sv-section">
		<a href="/servicii/configurator" class="sv-wizard">
			<span class="sv-wizard-icon"><WandIcon class="h-5 w-5" /></span>
			<span class="sv-wizard-body">
				<strong>Nu știi ce pachet să alegi? Hai să te ghidăm.</strong>
				<span>
					5 întrebări rapide — tip business, obiectiv, buget, canale — și îți spunem exact
					combinația care funcționează, cu preț estimat și discount aplicat.
				</span>
			</span>
			<span class="sv-wizard-cta ots-gloss">Începe <ArrowRightIcon class="h-4 w-4" /></span>
		</a>
	</section>

	<!-- Categorii -->
	<section class="sv-section" id="categorii">
		<div class="sv-section-head">
			<h2>Categorii servicii</h2>
			<p>
				Click pe o categorie pentru comparația Bronze → Platinum, adaugă pachetul dorit în ofertă
				și combină mai multe servicii pentru discount.
			</p>
		</div>

		<div class="sv-filters" role="group" aria-label="Filtrează pe grup de servicii" {@attach dragScroll}>
			<button
				type="button"
				class="sv-filter"
				aria-pressed={activeGroupId === 'all'}
				onclick={() => (activeGroupId = 'all')}
			>
				Toate <i>{catalog.categories.length}</i>
			</button>
			{#each catalog.groups as group (group.id)}
				<button
					type="button"
					class="sv-filter"
					aria-pressed={activeGroupId === group.id}
					onclick={() => (activeGroupId = group.id)}
				>
					{group.label} <i>{categoriesInGroup(group.slugs).length}</i>
				</button>
			{/each}
		</div>

		{#each visibleGroups as group (group.id)}
			{@const items = categoriesInGroup(group.slugs)}
			{#if items.length > 0}
				<div class="sv-group">
					<div class="sv-grouphead">
						<h3>{group.label}</h3>
						<p>{group.description}</p>
					</div>
					<div class="sv-grid">
						{#each items as category (category.slug)}
							{@const monthlyPrices = catalog.tiers
								.map((t) => category.prices[t])
								.filter((p): p is number => p !== null)}
							{@const setupOnly =
								monthlyPrices.length === 0 && category.setupFees
									? Object.values(category.setupFees).filter((p): p is number => p !== undefined)
									: []}
							<button type="button" class="sv-card" onclick={() => openCompare(category)}>
								<span class="sv-card-icon"><CategoryIcon slug={category.slug} class="h-5 w-5" /></span>
								<span class="sv-card-name">{category.name}</span>
								<span class="sv-card-tag">{category.tagline}</span>

								<span class="sv-card-price">
									{#if monthlyPrices.length > 0}
										<span class="sv-price-val">{formatEur(Math.min(...monthlyPrices))}</span>
										<span class="sv-price-per">/lună</span>
									{:else if setupOnly.length > 0}
										<span class="sv-price-val">{formatEur(Math.min(...setupOnly))}</span>
										<span class="sv-price-per">one-time</span>
									{/if}
								</span>
								<span class="sv-card-range">
									{#if monthlyPrices.length > 0}
										{catalog.tierLabels[catalog.tiers[0]]} → {catalog.tierLabels[
											catalog.tiers[catalog.tiers.length - 1]
										]}, până la {formatEur(Math.max(...monthlyPrices))}/lună
									{:else if setupOnly.length > 0}
										până la {formatEur(Math.max(...setupOnly))} one-time
									{/if}
								</span>

								<span class="sv-card-cta">
									Vezi detalii și cere ofertă
									<ArrowRightIcon class="h-4 w-4" />
								</span>
							</button>
						{/each}
					</div>
				</div>
			{/if}
		{/each}

		<p class="sv-fine">
			Toate prețurile sunt pentru management și sunt exprimate în EUR, fără TVA. Bugetul media (Ads)
			și costul platformelor externe (Brevo, Mailchimp, HubSpot etc.) se plătesc separat, direct
			către furnizor.
		</p>
	</section>

	<footer class="sv-foot">
		<div class="sv-foot-inner">
			<div class="sv-foot-brand">© {currentYear} {company?.name ?? 'One Top Solution'}</div>
			<div class="sv-foot-contact">
				{#if company?.email}
					<a class="sv-foot-link" href="mailto:{company.email}">
						<MailIcon class="h-4 w-4" />
						{company.email}
					</a>
				{/if}
				{#if company?.phone}
					<a class="sv-foot-link" href="tel:{company.phone.replace(/\s+/g, '')}">
						<PhoneIcon class="h-4 w-4" />
						{company.phone}
					</a>
				{/if}
			</div>
		</div>
	</footer>

	<!-- Ascunsă și cât e deschisă comparația: dialogul bits-ui e z-50, bara ar sta peste el. -->
	{#if cart.count > 0 && !quoteOpen && !compareOpen}
		<div class="sv-cartbar" role="region" aria-label="Oferta ta">
			<div class="sv-cartbar-inner">
				<div class="sv-cartbar-info">
					<span class="sv-cartbar-count" aria-live="polite">
						<ShoppingBagIcon class="h-4 w-4" aria-hidden="true" />
						{cart.count} {cart.count === 1 ? 'serviciu' : 'servicii'}
					</span>
					<span class="sv-cartbar-names">
						{cartSummary.lines.map((l) => `${l.name} ${catalog.tierLabels[l.tier]}`).join(' · ')}
					</span>
				</div>
				<div class="sv-cartbar-total">
					{#if cartSummary.discountPct > 0}
						<s>{formatEur(cartSummary.monthlySubtotal)}</s>
						<span class="sv-cartbar-discount">−{cartSummary.discountPct}%</span>
					{/if}
					<strong>{formatEur(cartSummary.monthlyTotal)}</strong><small>/lună</small>
				</div>
				<button
					type="button"
					class="sv-cartbar-clear"
					onclick={clearCart}
					aria-label="Golește oferta"
				>
					<XIcon class="h-4 w-4" aria-hidden="true" />
				</button>
				<button type="button" class="sv-btn sv-btn-primary ots-gloss" onclick={() => (quoteOpen = true)}>
					Solicită oferta <ArrowRightIcon class="h-4 w-4" />
				</button>
			</div>
		</div>
	{/if}

	<!-- Tokenii (--accent, --border) există doar în .sv-page — de aceea stă aici, nu după </div>. -->
	{#if toast && !quoteOpen}
		{#key toastSeq}
			<CartToast
				kind={toast.kind}
				category={toast.category}
				tier={toast.tier}
				tierLabel={toast.tier ? catalog.tierLabels[toast.tier] : ''}
				summary={cartSummary}
				onView={openQuote}
				onDismiss={() => (toast = null)}
				onUndo={toast.undo ? undoToast : undefined}
			/>
		{/key}
	{/if}
</div>

<PackageComparisonView
	bind:open={compareOpen}
	category={selectedCategory}
	tiers={catalog.tiers}
	tierLabels={catalog.tierLabels}
	tierColors={catalog.tierColors}
	setupDefaultDescription={catalog.setupDefaultDescription}
	hourlyRates={catalog.hourlyRates}
	{isWebDev}
	onRequest={handleTierPick}
	requestLabel={'Adaugă {tier}'}
	activeTier={selectedCategory ? cart.tierOf(selectedCategory.slug) : null}
	activeLabel="În ofertă ✓"
/>

{#if quoteOpen}
	<ServicesQuoteModal {cart} {catalog} onClose={() => (quoteOpen = false)} />
{/if}


<style>
	/* Tokenii sunt copiați 1:1 din /pachete-hosting, ca cele două pagini publice
	   să arate ca fiind din același produs. */
	.sv-page {
		--ink: #0b1220;
		--ink2: #475569;
		--muted: #94a3b8;
		--border: #e5e9f0;
		--bg: #ffffff;
		--bg-soft: #f7f8fa;
		--accent: #1877f2;
		--accent-dark: #0d5cc7;
		--success: #10b981;
		font-family: 'Inter', system-ui, sans-serif;
		color: var(--ink);
		background: var(--bg);
		line-height: 1.5;
		min-height: 100vh;
	}
	.sv-page :global(*) {
		box-sizing: border-box;
	}
	.sv-sr {
		position: absolute;
		width: 1px;
		height: 1px;
		overflow: hidden;
		clip-path: inset(50%);
		white-space: nowrap;
	}

	/* ===== Nav ===== */
	.sv-nav {
		position: sticky;
		top: 0;
		z-index: 50;
		background: rgba(255, 255, 255, 0.92);
		backdrop-filter: blur(10px);
		border-bottom: 1px solid var(--border);
	}
	.sv-nav-inner {
		max-width: 1200px;
		margin: 0 auto;
		padding: 16px 24px;
		display: flex;
		align-items: center;
		gap: 20px;
	}
	.sv-logo {
		display: inline-flex;
		align-items: center;
		gap: 10px;
		font-weight: 800;
		font-size: 14px;
		letter-spacing: -0.01em;
		text-decoration: none;
		color: inherit;
	}
	.sv-logo img {
		display: block;
		height: 32px;
		width: auto;
	}
	.sv-nav-spacer {
		flex: 1;
	}
	.sv-nav-secondary {
		font-weight: 500;
		font-size: 13px;
		color: var(--ink2);
		text-decoration: none;
		transition: color 0.15s;
	}
	.sv-nav-secondary:hover {
		color: var(--accent);
	}
	.sv-nav-cart {
		display: inline-flex;
		align-items: center;
		gap: 8px;
		padding: 8px 12px;
		border-radius: 10px;
		border: 1px solid var(--border);
		background: var(--bg);
		font-family: inherit;
		font-size: 13px;
		font-weight: 600;
		color: var(--ink);
		cursor: pointer;
		white-space: nowrap;
	}
	.sv-nav-cart:hover {
		border-color: var(--accent);
		color: var(--accent);
	}
	.sv-nav-cart:focus-visible,
	.sv-cartbar-clear:focus-visible {
		outline: 2px solid var(--accent);
		outline-offset: 2px;
	}
	.sv-nav-cart i {
		font-style: normal;
		min-width: 20px;
		height: 20px;
		padding: 0 6px;
		border-radius: 999px;
		background: var(--accent);
		color: white;
		font-size: 11px;
		font-weight: 800;
		display: inline-grid;
		place-items: center;
	}
	.sv-nav-exit {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		padding: 9px 16px;
		border-radius: 8px;
		background: var(--bg-soft);
		color: var(--ink);
		border: 1px solid var(--border);
		font-family: inherit;
		font-size: 13px;
		font-weight: 600;
		cursor: pointer;
		transition: all 0.15s;
	}
	.sv-nav-exit:hover {
		background: var(--ink);
		border-color: var(--ink);
		color: white;
	}

	/* ===== Hero =====
	   Alb, ca la /pachete-hosting: text închis pe fond deschis, cel mai bun
	   contrast posibil. Prima încercare a fost o bandă închisă cu fotografia pe
	   fundal — arăta murdar, iar linia de jos se pierdea în tranziția către alb.

	   Imaginea rămâne, dar ca TEXTURĂ, nu ca fundal: colorată în albastrul de
	   brand prin `mix-blend-mode`, la opacitate mică, mascată radial ca să se
	   stingă complet înainte de a ajunge sub text. Aduce adâncime sus, fără să
	   atingă lizibilitatea.

	   Fișier local `/servicii-hero.jpg` (Unsplash, licență liberă comercial,
	   photo-1758073519996), nu hotlink: pagina e în spatele unei parole și nu
	   trebuie să depindă de un CDN extern. */
	.sv-hero {
		position: relative;
		isolation: isolate;
		overflow: hidden;
		padding: 76px 24px 64px;
		text-align: center;
		background: radial-gradient(ellipse at top, rgba(24, 119, 242, 0.07), transparent 62%);
	}
	.sv-hero::before {
		content: '';
		position: absolute;
		inset: -20% -10% auto;
		height: 420px;
		z-index: -1;
		background-image: url('/servicii-hero.jpg');
		background-size: cover;
		background-position: center 30%;
		opacity: 0.16;
		filter: saturate(1.4);
		mix-blend-mode: multiply;
		-webkit-mask-image: radial-gradient(ellipse 70% 60% at 50% 15%, #000 0%, transparent 72%);
		mask-image: radial-gradient(ellipse 70% 60% at 50% 15%, #000 0%, transparent 72%);
	}
	.sv-hero-eyebrow {
		display: inline-flex;
		align-items: center;
		gap: 8px;
		padding: 6px 14px;
		border-radius: 999px;
		background: rgba(24, 119, 242, 0.08);
		color: var(--accent);
		font-size: 12px;
		font-weight: 600;
		margin-bottom: 18px;
	}
	.sv-dot {
		width: 6px;
		height: 6px;
		border-radius: 50%;
		background: var(--accent);
	}
	.sv-hero h1 {
		font-size: clamp(36px, 6vw, 56px);
		font-weight: 800;
		letter-spacing: -0.03em;
		line-height: 1.05;
		max-width: 760px;
		margin: 0 auto 18px;
	}
	.sv-hero h1 em {
		font-style: normal;
		color: var(--accent);
		position: relative;
		z-index: 0;
	}
	.sv-hero h1 em::after {
		content: '';
		position: absolute;
		left: 0;
		right: 0;
		bottom: -2px;
		height: 6px;
		background: rgba(24, 119, 242, 0.18);
		border-radius: 4px;
		z-index: -1;
	}
	.sv-hero p {
		font-size: 17px;
		color: var(--ink2);
		max-width: 580px;
		margin: 0 auto 28px;
	}
	/* Golul de sub titlu era spațiu mort — îl umplem cu acțiunile reale ale
	   paginii, nu cu decor. */
	.sv-hero-actions {
		display: flex;
		flex-wrap: wrap;
		justify-content: center;
		gap: 10px;
		margin-bottom: 26px;
	}
	.sv-btn {
		display: inline-flex;
		align-items: center;
		gap: 7px;
		padding: 12px 20px;
		border-radius: 10px;
		font-size: 13.5px;
		font-weight: 700;
		text-decoration: none;
		transition: all 0.15s;
	}
	.sv-btn-primary {
		background: var(--accent);
		color: white;
		border: 1px solid var(--accent);
		box-shadow: 0 6px 18px rgba(24, 119, 242, 0.22);
	}
	.sv-btn-primary:hover {
		background: var(--accent-dark);
		border-color: var(--accent-dark);
	}
	.sv-btn-ghost {
		background: white;
		color: var(--ink);
		border: 1px solid var(--border);
	}
	.sv-btn-ghost:hover {
		border-color: var(--accent);
		color: var(--accent);
	}

	.sv-hero-tagline {
		display: inline-flex;
		align-items: center;
		gap: 18px;
		flex-wrap: wrap;
		justify-content: center;
	}
	.sv-hero-trust {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		font-size: 13px;
		color: var(--ink2);
	}
	.sv-hero :global(.sv-ok) {
		width: 14px;
		height: 14px;
		color: var(--success);
	}

	/* ===== Secțiuni ===== */
	.sv-section {
		max-width: 1200px;
		margin: 90px auto 0;
		padding: 0 24px;
	}
	.sv-section-head {
		text-align: center;
		max-width: 640px;
		margin: 0 auto 42px;
	}
	.sv-kicker {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		font-size: 12px;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.08em;
		color: var(--accent);
		margin-bottom: 12px;
	}
	.sv-section-head h2 {
		font-size: 36px;
		font-weight: 800;
		letter-spacing: -0.02em;
		margin: 0 0 12px;
		line-height: 1.15;
	}
	.sv-section-head p {
		font-size: 16px;
		color: var(--ink2);
		margin: 0;
	}

	/* ===== Tabel CRM ===== */
	.sv-tablewrap {
		/* Poziționat, ca textul doar-pentru-screen-reader (.sv-sr, absolute) din celule să
		   rămână în containerul de scroll — altfel pagina capătă scroll orizontal pe mobil. */
		position: relative;
		overflow-x: auto;
		background: white;
		border: 1px solid var(--border);
		border-radius: 18px;
	}
	.sv-table {
		width: 100%;
		min-width: 640px;
		/* `separate` (nu `collapse`): cu coloana de etichete sticky pe mobil, bordurile
		   „collapsed" rămân în urmă la derulare în Chrome. */
		border-collapse: separate;
		border-spacing: 0;
		font-size: 13.5px;
	}
	.sv-scrollhint {
		display: none;
		margin: 0 0 10px;
		font-size: 12.5px;
		color: var(--ink2);
	}
	.sv-th-label,
	.sv-th-tier {
		padding: 14px 18px;
		font-size: 11px;
		font-weight: 700;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: var(--ink2);
		background: var(--bg-soft);
		border-bottom: 1px solid var(--border);
	}
	.sv-th-label {
		text-align: left;
	}
	.sv-th-tier {
		text-align: center;
		white-space: nowrap;
	}
	.sv-tierdot {
		display: inline-block;
		width: 6px;
		height: 6px;
		border-radius: 50%;
		margin-right: 7px;
		vertical-align: middle;
	}
	.sv-tierdot[data-tier='bronze'] {
		background: #c2823f;
	}
	.sv-tierdot[data-tier='silver'] {
		background: var(--muted);
	}
	.sv-tierdot[data-tier='gold'] {
		background: #d4a017;
	}
	.sv-tierdot[data-tier='platinum'] {
		background: var(--accent);
	}
	.sv-table tbody tr + tr .sv-td-label,
	.sv-table tbody tr + tr .sv-td-val {
		border-top: 1px solid var(--border);
	}
	.sv-td-label {
		padding: 11px 18px;
		text-align: left;
		font-weight: 500;
		color: var(--ink2);
	}
	.sv-td-val {
		padding: 11px 18px;
		text-align: center;
	}
	.sv-table :global(.sv-yes) {
		display: inline-block;
		width: 15px;
		height: 15px;
		color: var(--success);
	}
	.sv-table :global(.sv-no) {
		display: inline-block;
		width: 15px;
		height: 15px;
		color: #d7dee7;
	}
	.sv-num {
		font-weight: 700;
		font-size: 13px;
		color: var(--ink);
	}

	/* ===== Discount ===== */
	.sv-discounts {
		display: grid;
		grid-template-columns: repeat(3, 1fr);
		gap: 16px;
	}
	.sv-discount {
		background: white;
		border: 1px solid var(--border);
		border-radius: 18px;
		padding: 28px 24px;
		text-align: center;
		transition: all 0.2s;
	}
	.sv-discount:hover {
		transform: translateY(-3px);
		box-shadow: 0 12px 32px rgba(15, 23, 42, 0.08);
	}
	.sv-discount-n {
		display: block;
		font-size: 44px;
		font-weight: 800;
		letter-spacing: -0.03em;
		line-height: 1;
		color: var(--accent);
	}
	.sv-discount-l {
		display: block;
		margin-top: 10px;
		font-size: 13px;
		color: var(--ink2);
	}

	/* ===== Wizard ===== */
	.sv-wizard {
		display: flex;
		align-items: center;
		gap: 20px;
		padding: 26px 28px;
		background: linear-gradient(180deg, #f6faff 0%, white 60%);
		border: 1px solid var(--accent);
		border-radius: 18px;
		text-decoration: none;
		color: inherit;
		box-shadow: 0 12px 32px rgba(24, 119, 242, 0.14);
		transition: all 0.2s;
	}
	.sv-wizard:hover {
		transform: translateY(-3px);
		box-shadow: 0 16px 40px rgba(24, 119, 242, 0.2);
	}
	.sv-wizard-icon {
		display: grid;
		place-items: center;
		flex-shrink: 0;
		width: 44px;
		height: 44px;
		border-radius: 11px;
		background: white;
		border: 1px solid var(--border);
		color: var(--accent);
	}
	.sv-wizard-body {
		display: flex;
		flex-direction: column;
		gap: 4px;
		min-width: 0;
		flex: 1;
	}
	.sv-wizard-body strong {
		font-size: 16px;
		font-weight: 700;
		letter-spacing: -0.01em;
	}
	.sv-wizard-body > span {
		font-size: 13.5px;
		color: var(--ink2);
		max-width: 68ch;
	}
	.sv-wizard-cta {
		display: inline-flex;
		flex-shrink: 0;
		align-items: center;
		gap: 6px;
		padding: 11px 18px;
		border-radius: 10px;
		background: var(--accent);
		color: white;
		font-size: 13px;
		font-weight: 700;
		transition: background 0.15s;
	}
	.sv-wizard:hover .sv-wizard-cta {
		background: var(--accent-dark);
	}

	/* ===== Filtre ===== */
	.sv-filters {
		display: flex;
		flex-wrap: wrap;
		justify-content: center;
		gap: 8px;
		margin-bottom: 40px;
	}
	.sv-filter {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		padding: 9px 16px;
		border-radius: 999px;
		background: var(--bg-soft);
		border: 1px solid var(--border);
		font-family: inherit;
		font-size: 13px;
		font-weight: 600;
		color: var(--ink2);
		cursor: pointer;
		transition: all 0.15s;
	}
	.sv-filter i {
		font-style: normal;
		font-size: 11px;
		color: var(--muted);
	}
	.sv-filter:hover {
		border-color: var(--accent);
		color: var(--accent);
	}
	.sv-filter[aria-pressed='true'] {
		background: var(--accent);
		border-color: var(--accent);
		color: white;
	}
	.sv-filter[aria-pressed='true'] i {
		color: rgba(255, 255, 255, 0.75);
	}

	/* ===== Grupuri + carduri ===== */
	.sv-group + .sv-group {
		margin-top: 48px;
	}
	.sv-grouphead {
		display: flex;
		flex-wrap: wrap;
		align-items: baseline;
		gap: 4px 12px;
		margin-bottom: 18px;
	}
	.sv-grouphead h3 {
		margin: 0;
		font-size: 12px;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.08em;
		color: var(--accent);
	}
	.sv-grouphead p {
		margin: 0;
		font-size: 13px;
		color: var(--muted);
	}
	.sv-grid {
		display: grid;
		grid-template-columns: repeat(3, 1fr);
		gap: 16px;
	}
	.sv-card {
		display: flex;
		flex-direction: column;
		width: 100%;
		padding: 28px 24px 24px;
		text-align: left;
		background: white;
		border: 1px solid var(--border);
		border-radius: 18px;
		font-family: inherit;
		color: inherit;
		cursor: pointer;
		transition: all 0.2s;
	}
	.sv-card:hover {
		transform: translateY(-3px);
		box-shadow: 0 12px 32px rgba(15, 23, 42, 0.08);
		border-color: var(--accent);
	}
	.sv-card:focus-visible {
		outline: 2px solid var(--accent);
		outline-offset: 2px;
	}
	.sv-card-icon {
		display: grid;
		place-items: center;
		width: 44px;
		height: 44px;
		border-radius: 11px;
		background: var(--bg-soft);
		border: 1px solid var(--border);
		color: var(--accent);
		margin-bottom: 16px;
	}
	.sv-card-name {
		font-size: 16px;
		font-weight: 700;
		letter-spacing: -0.01em;
		line-height: 1.25;
	}
	.sv-card-tag {
		font-size: 13px;
		color: var(--ink2);
		margin-top: 4px;
		min-height: 38px;
	}
	.sv-card-price {
		display: flex;
		align-items: baseline;
		gap: 5px;
		margin-top: 6px;
	}
	.sv-price-val {
		font-size: 34px;
		font-weight: 800;
		letter-spacing: -0.03em;
		line-height: 1;
		color: var(--ink);
	}
	.sv-price-per {
		font-size: 13px;
		color: var(--muted);
	}
	.sv-card-range {
		font-size: 12px;
		color: var(--muted);
		margin-top: 8px;
		min-height: 32px;
		line-height: 1.4;
	}
	.sv-card-cta {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 8px;
		width: 100%;
		margin-top: auto;
		padding: 13px 16px;
		border-radius: 10px;
		background: var(--bg-soft);
		border: 1px solid var(--border);
		font-size: 13px;
		font-weight: 700;
		color: var(--ink);
		transition: all 0.15s;
	}
	.sv-card:hover .sv-card-cta {
		background: var(--accent);
		border-color: var(--accent);
		color: white;
	}

	.sv-fine {
		max-width: 860px;
		margin: 40px auto 0;
		text-align: center;
		font-size: 12.5px;
		line-height: 1.7;
		color: var(--muted);
	}

	/* ===== Subsol ===== */
	.sv-foot {
		margin-top: 80px;
		padding: 40px 24px 24px;
		border-top: 1px solid var(--border);
		background: var(--bg-soft);
		color: var(--muted);
		font-size: 12.5px;
	}
	.sv-foot-inner {
		max-width: 1200px;
		margin: 0 auto;
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: space-between;
		gap: 16px;
	}
	.sv-foot-brand {
		color: var(--ink2);
		font-weight: 600;
	}
	.sv-foot-contact {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 22px;
	}
	.sv-foot-link {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		color: var(--ink2);
		text-decoration: none;
		transition: color 0.15s;
	}
	.sv-foot-link:hover {
		color: var(--accent);
	}

	@media (prefers-reduced-motion: reduce) {
		.sv-card,
		.sv-discount,
		.sv-wizard {
			transition: none;
		}
		.sv-card:hover,
		.sv-discount:hover,
		.sv-wizard:hover {
			transform: none;
		}
	}

	@media (max-width: 1000px) {
		.sv-grid,
		.sv-discounts {
			grid-template-columns: repeat(2, 1fr);
		}
	}
	@media (max-width: 680px) {
		.sv-hero {
			padding: 56px 20px 56px;
		}
		.sv-section {
			margin-top: 60px;
		}
		.sv-section-head h2 {
			font-size: 27px;
		}
		.sv-grid {
			grid-template-columns: 1fr;
		}
		/* Cele trei praguri de discount rămân pe un rând, compacte — stivuite ocupau un ecran întreg. */
		.sv-discounts {
			grid-template-columns: repeat(3, 1fr);
			gap: 8px;
		}
		.sv-discount {
			min-width: 0;
			padding: 18px 6px;
			border-radius: 14px;
		}
		.sv-discount-n {
			/* Pe 320px cele trei carduri au ~64px utili: „−20%" la 28px nu încape. */
			font-size: clamp(20px, 7.5vw, 28px);
		}
		.sv-discount-l {
			font-size: 11.5px;
			line-height: 1.35;
			overflow-wrap: anywhere;
		}
		.sv-wizard {
			flex-wrap: wrap;
			padding: 20px;
		}
		.sv-wizard-cta {
			width: 100%;
			justify-content: center;
		}
		/* Filtrele: un rând derulabil, margine la margine, în loc de 5 rânduri de pastile. */
		.sv-filters {
			flex-wrap: nowrap;
			justify-content: flex-start;
			overflow-x: auto;
			margin: 0 -24px 28px;
			padding: 2px 24px 10px;
			scrollbar-width: none;
			-webkit-overflow-scrolling: touch;
		}
		.sv-filters::-webkit-scrollbar {
			display: none;
		}
		.sv-filter {
			flex-shrink: 0;
		}
		.sv-card {
			padding: 22px 20px 20px;
		}
		.sv-nav-secondary {
			display: none;
		}

		/* Tabelul CRM: coloana de etichete rămâne vizibilă cât derulezi spre Platinum. */
		.sv-scrollhint {
			display: block;
		}
		.sv-table {
			min-width: 560px;
			font-size: 13px;
		}
		.sv-th-label,
		.sv-td-label {
			position: sticky;
			left: 0;
			z-index: 1;
			max-width: 180px;
			box-shadow: 6px 0 10px -8px rgba(11, 18, 32, 0.25);
		}
		.sv-td-label {
			background: var(--bg);
		}
		.sv-th-label,
		.sv-th-tier {
			padding: 12px 14px;
		}
		.sv-td-label,
		.sv-td-val {
			padding: 10px 14px;
		}
	}

	/* ===== Bara de coș (sticky jos) ===== */
	.sv-cartbar {
		position: fixed;
		left: 0;
		right: 0;
		bottom: 0;
		/* Sub dialogurile bits-ui (z-50), peste conținutul paginii. */
		z-index: 40;
		padding: 12px 16px calc(12px + env(safe-area-inset-bottom));
		background: rgba(255, 255, 255, 0.96);
		backdrop-filter: blur(10px);
		border-top: 1px solid var(--border);
		box-shadow: 0 -12px 32px rgba(11, 18, 32, 0.08);
		animation: svSlideUp 0.2s ease-out;
	}
	@keyframes svSlideUp {
		from {
			transform: translateY(100%);
		}
		to {
			transform: translateY(0);
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.sv-cartbar {
			animation: none;
		}
	}
	.sv-cartbar-inner {
		max-width: 1200px;
		margin: 0 auto;
		display: flex;
		align-items: center;
		gap: 16px;
	}
	.sv-cartbar-info {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 2px;
	}
	.sv-cartbar-count {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		font-size: 13px;
		font-weight: 700;
		color: var(--ink);
	}
	.sv-cartbar-names {
		font-size: 12px;
		color: var(--ink2);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.sv-cartbar-total {
		display: inline-flex;
		align-items: baseline;
		gap: 8px;
		white-space: nowrap;
	}
	.sv-cartbar-total s {
		font-size: 12px;
		color: var(--ink2);
	}
	.sv-cartbar-discount {
		font-size: 11px;
		font-weight: 800;
		color: #047857;
		background: rgba(16, 185, 129, 0.12);
		padding: 2px 7px;
		border-radius: 999px;
	}
	.sv-cartbar-total strong {
		font-size: 20px;
		font-weight: 800;
		letter-spacing: -0.02em;
		color: var(--accent);
	}
	.sv-cartbar-total small {
		font-size: 12px;
		color: var(--ink2);
	}
	.sv-cartbar-clear {
		width: 36px;
		height: 36px;
		border-radius: 10px;
		border: 1px solid var(--border);
		background: var(--bg);
		color: var(--ink2);
		display: grid;
		place-items: center;
		cursor: pointer;
	}
	.sv-cartbar-clear:hover {
		color: #b91c1c;
		border-color: #fecaca;
	}
	@media (max-width: 720px) {
		/* Două rânduri: „N servicii … ×” și „total … Solicită oferta”. */
		.sv-cartbar-inner {
			display: grid;
			grid-template-columns: minmax(0, 1fr) auto;
			grid-template-areas:
				'info clear'
				'total cta';
			gap: 10px 12px;
			align-items: center;
		}
		.sv-cartbar-info {
			grid-area: info;
		}
		.sv-cartbar-clear {
			grid-area: clear;
		}
		.sv-cartbar-total {
			grid-area: total;
			min-width: 0;
		}
		/* Subtotalul tăiat nu încape lângă buton pe 375px; badge-ul −X% spune același lucru. */
		.sv-cartbar-total s {
			display: none;
		}
		.sv-cartbar-inner > .sv-btn-primary {
			grid-area: cta;
			padding-left: 16px;
			padding-right: 16px;
		}
		.sv-cartbar-names {
			display: none;
		}
		/* Eticheta rămâne în arborele de accesibilitate, doar vizual ascunsă. */
		.sv-nav-cart-label {
			position: absolute;
			width: 1px;
			height: 1px;
			overflow: hidden;
			clip-path: inset(50%);
			white-space: nowrap;
		}
		.sv-has-cart .sv-foot {
			padding-bottom: calc(128px + env(safe-area-inset-bottom));
		}
	}
	/* Telefoane înguste (320–360px): nav mai strâns și totalul din bară fără „/lună". */
	@media (max-width: 360px) {
		.sv-nav-inner {
			gap: 10px;
			padding: 12px 16px;
		}
		.sv-logo {
			flex-shrink: 0;
		}
		.sv-cartbar-total strong {
			font-size: 17px;
		}
		.sv-cartbar-total small {
			display: none;
		}
	}
	/* Bara acoperă ultimele rânduri ale paginii — lăsăm loc sub subsol. */
	.sv-has-cart .sv-foot {
		padding-bottom: calc(96px + env(safe-area-inset-bottom));
	}
</style>
