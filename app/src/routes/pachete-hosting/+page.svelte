<script lang="ts">
	import {
		getPublicHostingPackages,
		submitHostingInquiry,
		validateCuiAndFetch
	} from '$lib/remotes/public-hosting.remote';
	import * as Dialog from '$lib/components/ui/dialog';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import { Textarea } from '$lib/components/ui/textarea';
	import { toast } from 'svelte-sonner';
	import HostingCheckoutModal from '$lib/components/hosting-checkout-modal.svelte';
	import MapPinIcon from '@lucide/svelte/icons/map-pin';
	import PhoneIcon from '@lucide/svelte/icons/phone';
	import MailIcon from '@lucide/svelte/icons/mail';

	type Pkg = {
		id: string;
		name: string;
		description: string | null;
		features: string[] | null;
		highlightBadge: string | null;
		price: number;
		currency: string;
		billingCycle: string;
		bandwidth: number | null;
		quota: number | null;
		maxEmailAccounts: number | null;
		maxDatabases: number | null;
		maxDomains: number | null;
		maxSubdomains: number | null;
		ssl: boolean | null;
		ssh: boolean | null;
		wordpress: boolean | null;
		redis: boolean | null;
		git: boolean | null;
		cron: boolean | null;
	};

	const packagesQuery = getPublicHostingPackages();
	const packages = $derived<Pkg[]>((packagesQuery.current?.packages ?? []) as Pkg[]);
	const vatRate = $derived(packagesQuery.current?.vatRate ?? 21);
	const tenantInfo = $derived(packagesQuery.current?.tenantInfo ?? null);
	const loading = $derived(packagesQuery.loading && !packagesQuery.current);
	const currentYear = 2026;

	function fullAddress(): string {
		if (!tenantInfo) return '';
		// Skip country and skip county when it duplicates the city (e.g.
		// city "Mun. Suceava" + county "SUCEAVA" reads redundantly).
		const cityNorm = (tenantInfo.city ?? '').replace(/^(mun\.?|municipiul|oras\.?|or\.?|sat)\s*/i, '').trim().toLowerCase();
		const countyNorm = (tenantInfo.county ?? '').trim().toLowerCase();
		const skipCounty = cityNorm && countyNorm && cityNorm === countyNorm;
		const parts = [tenantInfo.address, tenantInfo.city, skipCounty ? null : tenantInfo.county]
			.filter((p): p is string => !!p && p.trim().length > 0)
			.map((p) => p.trim());
		return parts.join(', ');
	}

	function cleanCompanyName(name: string | null | undefined): string {
		if (!name) return 'OneTop Solution SRL';
		return name.trim().replace(/\.+$/, '');
	}

	let yearly = $state(true);

	let checkoutPkg = $state<Pkg | null>(null);

	let modalOpen = $state(false);
	let selectedPackage = $state<{ id: string; name: string } | null>(null);
	let submitting = $state(false);

	function openCheckout(pkg: Pkg) {
		checkoutPkg = pkg;
	}
	function closeCheckout() {
		checkoutPkg = null;
	}

	type AnafLookupData = {
		cui: string;
		vatNumber: string;
		denumire: string;
		adresa: string;
		nrRegCom: string;
		telefon: string;
		codPostal: string;
		platitorTva: boolean;
		eFacturaActiv: boolean;
	};
	let anafLoading = $state(false);
	let anafData = $state<AnafLookupData | null>(null);
	let anafError = $state<string | null>(null);

	let form = $state({
		contactName: '',
		contactEmail: '',
		contactPhone: '',
		companyName: '',
		vatNumber: '',
		message: ''
	});

	function resetAnaf() {
		anafLoading = false;
		anafData = null;
		anafError = null;
	}

	function openInquiry(pkgId: string | null, pkgName: string | null) {
		selectedPackage = pkgId && pkgName ? { id: pkgId, name: pkgName } : null;
		modalOpen = true;
		resetAnaf();
	}

	async function lookupAnaf() {
		anafError = null;
		const cui = form.vatNumber.trim();
		if (!cui) {
			anafError = 'Introdu un CUI mai întâi.';
			return;
		}
		anafLoading = true;
		try {
			const res = await validateCuiAndFetch(cui);
			if (!res.valid) {
				anafError = res.error;
				anafData = null;
				return;
			}
			anafData = res.data;
			form.companyName = res.data.denumire || form.companyName;
			form.vatNumber = res.data.vatNumber;
			if (!form.contactPhone && res.data.telefon) {
				form.contactPhone = res.data.telefon;
			}
		} catch (err) {
			anafError = err instanceof Error ? err.message : 'Eroare la verificare ANAF.';
		} finally {
			anafLoading = false;
		}
	}

	async function handleSubmit(e: SubmitEvent) {
		e.preventDefault();
		if (!form.contactName.trim() || !form.contactEmail.trim()) {
			toast.error('Numele și email-ul sunt obligatorii.');
			return;
		}
		submitting = true;
		try {
			await submitHostingInquiry({
				hostingProductId: selectedPackage?.id,
				contactName: form.contactName,
				contactEmail: form.contactEmail,
				contactPhone: form.contactPhone || undefined,
				companyName: form.companyName || undefined,
				vatNumber: form.vatNumber || undefined,
				message: form.message || undefined
			});
			toast.success('Cererea ta a fost primită! Te vom contacta în maxim 24h.');
			modalOpen = false;
			form = {
				contactName: '',
				contactEmail: '',
				contactPhone: '',
				companyName: '',
				vatNumber: '',
				message: ''
			};
			selectedPackage = null;
			resetAnaf();
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'Eroare la trimitere. Încearcă din nou.');
		} finally {
			submitting = false;
		}
	}

	// ===== Price math — normalize across billingCycle =====
	// Marketing toggle is display-only: we estimate "monthly" and "yearly with -2 months"
	// off whichever cycle the admin configured. Checkout still bills the actual cycle.
	function monthlyEquivalentRon(pkg: Pkg): number {
		const ron = pkg.price / 100;
		switch (pkg.billingCycle) {
			case 'annually':
				return Math.round((ron * 12) / 120);
			case 'biennially':
				return Math.round((ron * 12) / 240);
			case 'triennially':
				return Math.round((ron * 12) / 360);
			case 'biannually':
			case 'semiannually':
				return Math.round((ron * 12) / 60);
			case 'quarterly':
				return Math.round((ron * 12) / 36);
			case 'monthly':
			default:
				return Math.round(ron);
		}
	}
	function yearlyTotalRon(pkg: Pkg): number {
		const monthly = monthlyEquivalentRon(pkg);
		return monthly * 10;
	}
	function monthlyBilledRon(pkg: Pkg): number {
		const ron = pkg.price / 100;
		return pkg.billingCycle === 'monthly' ? Math.round(ron) : monthlyEquivalentRon(pkg);
	}

	function mbToGb(mb: number | null | undefined): string {
		if (mb === null || mb === undefined) return 'Nelimitat';
		if (mb < 1024) return `${mb} MB`;
		return `${Math.round(mb / 1024).toLocaleString('ro-RO')} GB`;
	}
	function mbToGbNumber(mb: number | null | undefined): number | null {
		if (mb === null || mb === undefined) return null;
		return Math.round(mb / 1024);
	}
	function fmtCount(v: number | null | undefined): string {
		if (v === null || v === undefined) return 'Nelimitat';
		return v.toLocaleString('ro-RO');
	}
	function isPopular(p: Pkg): boolean {
		return !!(p.highlightBadge && p.highlightBadge.trim().length > 0);
	}
	function tagFor(p: Pkg): string {
		return (p.description ?? '').trim() || 'Hosting administrat, optimizat pentru WordPress și WooCommerce.';
	}
	function backupHint(p: Pkg): string {
		const found = (p.features ?? []).find((f) => /backup/i.test(f));
		return found ?? 'zilnic';
	}

	function comandaHref(pkgId: string): string {
		const period = yearly ? 'yearly' : 'monthly';
		return `/pachete-hosting/comanda?package=${encodeURIComponent(pkgId)}&period=${period}`;
	}

	function periodKey(): 'monthly' | 'yearly' {
		return yearly ? 'yearly' : 'monthly';
	}

	const faqItems = [
		{
			q: 'Pot migra gratuit site-ul de la alt provider?',
			a: 'Da. Echipa OTS migrează gratuit site-ul tău (WordPress, PrestaShop, Joomla sau site static) de pe orice provider, în maxim 24 de ore lucrătoare, fără timp de nefuncționare. Tot ce avem nevoie sunt datele de acces.'
		},
		{
			q: 'Ce se întâmplă dacă depășesc trafic sau spațiu?',
			a: 'Te anunțăm pe email la 80% și la 95% din limită. Site-ul nu este oprit niciodată automat — îți recomandăm upgrade sau optimizare. Cele câteva zile peste limită nu sunt taxate.'
		},
		{
			q: 'Pot face upgrade între pachete?',
			a: 'Da, oricând, cu pro-rata. Diferența rămasă din pachetul curent se transferă automat în pachetul nou. Procesul durează 5 minute și nu pierzi nimic din site.'
		},
		{
			q: 'Există garanție de returnare a banilor?',
			a: 'Da, ai 30 de zile pentru a încerca serviciul. Dacă nu ești mulțumit, primești integral banii înapoi, fără întrebări — direct pe metoda de plată folosită.'
		},
		{
			q: 'Ce versiune de PHP / MySQL este disponibilă?',
			a: 'Toate pachetele suportă PHP 7.4, 8.0, 8.1, 8.2 și 8.3. Schimbi versiunea cu un click din panoul de administrare. MySQL 8.0 / MariaDB 10.6 cu PHPMyAdmin inclus.'
		},
		{
			q: 'Acceptați plata cu cardul / Stripe / Revolut?',
			a: 'Da. Acceptăm card bancar (Visa / Mastercard), ordin de plată, PayPal și Revolut. Pentru clienții pe persoană juridică emitem factură fiscală în 10 minute, cu TVA reverse charge pentru clienții din UE.'
		}
	];
</script>

<svelte:head>
	<title>Pachete Hosting · OneTop Solution</title>
	<meta
		name="description"
		content="Hosting WordPress & WooCommerce rapid și sigur, pe servere din România. SSD NVMe, LiteSpeed, SSL gratuit, backup zilnic și suport 24/7 în limba română."
	/>
	<meta property="og:title" content="Hosting rapid & sigur, pe servere din România — OneTop Solution" />
	<meta
		property="og:description"
		content="LiteSpeed, NVMe SSD, SSL gratuit și backup zilnic. 99.99% uptime și suport 24/7 RO."
	/>
	<meta property="og:type" content="website" />
	<link
		rel="stylesheet"
		href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&display=swap"
	/>
</svelte:head>

<div class="ph-page">
	<!-- Nav -->
	<nav class="ph-nav">
		<div class="ph-nav-inner">
			<a class="ph-logo" href="/pachete-hosting">
				<img src="/onetop-logo.png" alt="One Top Solution" />
			</a>
			<div class="ph-nav-links">
				<a href="#pachete">Hosting</a>
				<a href="#features">Funcții</a>
				<a href="#compara">Compară</a>
				<a href="#faq">Support</a>
			</div>
			<div class="ph-nav-spacer"></div>
			<a class="ph-nav-secondary" href="/login">Autentificare</a>
			<button type="button" class="ph-nav-cta" onclick={() => openInquiry(null, null)}>
				Cont nou
				<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
					<line x1="7" y1="17" x2="17" y2="7"></line>
					<polyline points="7 7 17 7 17 17"></polyline>
				</svg>
			</button>
		</div>
	</nav>

	<!-- Hero -->
	<section class="ph-hero">
		<div class="ph-hero-eyebrow">
			<span class="ph-dot"></span>
			Hosting cu suport în limba română
		</div>
		<h1>
			Hosting rapid & sigur, pe servere
			<em>din România</em>
		</h1>
		<p>
			SSD NVMe, LiteSpeed, SSL gratuit și backup zilnic. 99.9% uptime garantat și suport tehnic 24/7
			de la echipa OneTop Solution.
		</p>
		<div class="ph-hero-tagline">
			<div class="ph-hero-trust">
				<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
					<polyline points="20 6 9 17 4 12"></polyline>
				</svg>
				<strong>99.99%</strong> uptime ultimul an
			</div>
			<div class="ph-hero-trust">
				<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
					<polyline points="20 6 9 17 4 12"></polyline>
				</svg>
				<strong>30 zile</strong> garanție returnare bani
			</div>
			<div class="ph-hero-trust">
				<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
					<polyline points="20 6 9 17 4 12"></polyline>
				</svg>
				<strong>Migrare gratuită</strong> de pe alt provider
			</div>
		</div>

		<div class="ph-billing-toggle">
			<button type="button" class={yearly ? '' : 'active'} onclick={() => (yearly = false)}>
				Plătit lunar
			</button>
			<button type="button" class={yearly ? 'active' : ''} onclick={() => (yearly = true)}>
				Plătit anual
				<span class="ph-billing-save">−2 luni</span>
			</button>
		</div>
	</section>

	<!-- Pricing -->
	<section id="pachete" class="ph-pricing">
		{#if loading}
			{#each Array.from({ length: 4 }) as _, i (i)}
				<div class="ph-plan ph-skeleton" aria-hidden="true">
					<div class="ph-sk-line ph-sk-w-32"></div>
					<div class="ph-sk-line ph-sk-w-60"></div>
					<div class="ph-sk-block"></div>
					<div class="ph-sk-block-tall"></div>
				</div>
			{/each}
		{:else if packages.length === 0}
			<div class="ph-empty">
				Pachetele sunt în curs de actualizare. <button
					type="button"
					class="ph-link"
					onclick={() => openInquiry(null, null)}>Contactează-ne</button
				> pentru o ofertă personalizată.
			</div>
		{:else}
			{#each packages as pkg (pkg.id)}
				{@const monthly = monthlyEquivalentRon(pkg)}
				{@const yearTotal = yearlyTotalRon(pkg)}
				{@const monthlyBilled = monthlyBilledRon(pkg)}
				{@const price = yearly ? Math.round(yearTotal / 12) : monthlyBilled}
				{@const popular = isPopular(pkg)}
				<div class={popular ? 'ph-plan popular' : 'ph-plan'}>
					{#if popular}
						<span class="ph-plan-badge">{pkg.highlightBadge}</span>
					{/if}
					<div class="ph-plan-name">{pkg.name}</div>
					<div class="ph-plan-tag">{tagFor(pkg)}</div>

					<div class="ph-plan-price">
						<span class="ph-plan-price-val">{price}</span>
						<span class="ph-plan-price-cur">{pkg.currency}</span>
						<span class="ph-plan-price-per">/ lună</span>
					</div>
					<div class="ph-plan-price-orig">
						{#if yearly}
							{yearTotal.toLocaleString('ro-RO')} {pkg.currency} / an (echivalent {monthlyBilled} {pkg.currency}/lună
							lunar)
						{:else}
							sau {yearTotal.toLocaleString('ro-RO')} {pkg.currency} anual ({Math.round(
								(1 - yearTotal / (monthlyBilled * 12)) * 100
							)}% reducere)
						{/if}
					</div>

					<button type="button" class="ph-plan-cta" onclick={() => openCheckout(pkg)}>
						Comandă {pkg.name}
					</button>

					<div class="ph-plan-divider">Include</div>
					<ul class="ph-plan-features">
						{#if pkg.quota !== null && pkg.quota !== undefined}
							<li>
								<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
									<polyline points="20 6 9 17 4 12"></polyline>
								</svg>
								<span><strong>{mbToGb(pkg.quota)}</strong> spațiu SSD NVMe</span>
							</li>
						{/if}
						{#if pkg.bandwidth !== null && pkg.bandwidth !== undefined}
							<li>
								<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
									<polyline points="20 6 9 17 4 12"></polyline>
								</svg>
								<span><strong>{mbToGb(pkg.bandwidth)}</strong> trafic / lună</span>
							</li>
						{/if}
						<li>
							<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
								<polyline points="20 6 9 17 4 12"></polyline>
							</svg>
							<span><strong>{fmtCount(pkg.maxDomains)}</strong> domenii găzduite</span>
						</li>
						<li>
							<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
								<polyline points="20 6 9 17 4 12"></polyline>
							</svg>
							<span><strong>{fmtCount(pkg.maxDatabases)}</strong> baze de date MySQL</span>
						</li>
						<li>
							<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
								<polyline points="20 6 9 17 4 12"></polyline>
							</svg>
							<span><strong>{fmtCount(pkg.maxEmailAccounts)}</strong> conturi email</span>
						</li>
						{#if pkg.ssl}
							<li>
								<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
									<polyline points="20 6 9 17 4 12"></polyline>
								</svg>
								<span>SSL Let's Encrypt gratuit</span>
							</li>
						{/if}
						<li>
							<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
								<polyline points="20 6 9 17 4 12"></polyline>
							</svg>
							<span>Backup {backupHint(pkg)}</span>
						</li>
						<li>
							<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
								<polyline points="20 6 9 17 4 12"></polyline>
							</svg>
							<span>PHP 8.3 + alegere versiune</span>
						</li>
						<li>
							<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
								<polyline points="20 6 9 17 4 12"></polyline>
							</svg>
							<span>Panou administrare · Instalare aplicații cu un click</span>
						</li>
						{#if pkg.features && pkg.features.length > 0}
							{#each pkg.features.slice(0, 3) as feat (feat)}
								<li>
									<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
										<polyline points="20 6 9 17 4 12"></polyline>
									</svg>
									<span>{feat}</span>
								</li>
							{/each}
						{/if}
					</ul>
				</div>
			{/each}
		{/if}
	</section>

	{#if !loading && packages.length > 0}
		<div class="ph-pricing-foot">
			Toate prețurile sunt afișate <strong>fără TVA</strong>; TVA {vatRate}% se adaugă la checkout. Ai nevoie
			de mai mult? <button type="button" class="ph-link" onclick={() => openInquiry(null, null)}
				>Cere o ofertă personalizată</button
			>.
		</div>
	{/if}

	<!-- Features -->
	<section id="features" class="ph-features">
		<div class="ph-section-head">
			<h2>Tot ce ai nevoie ca site-ul tău să zboare</h2>
			<p>
				Infrastructură performantă în 4 orașe din România și Germania, configurată pentru WordPress,
				WooCommerce și PrestaShop.
			</p>
		</div>
		<div class="ph-features-grid">
			<div class="ph-feat">
				<div class="ph-feat-icon">
					<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
						<polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"></polygon>
					</svg>
				</div>
				<h3>LiteSpeed + SSD NVMe</h3>
				<p>Răspuns sub 200 ms la nivel de TTFB. Cache configurat din primul minut.</p>
			</div>
			<div class="ph-feat">
				<div class="ph-feat-icon">
					<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
						<path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"></path>
						<circle cx="12" cy="10" r="3"></circle>
					</svg>
				</div>
				<h3>4 datacentere în RO</h3>
				<p>București, Cluj-Napoca, Timișoara și Iași. Latență 12-20 ms de oriunde din țară.</p>
			</div>
			<div class="ph-feat">
				<div class="ph-feat-icon">
					<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
						<rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect>
						<path d="M7 11V7a5 5 0 0 1 10 0v4"></path>
					</svg>
				</div>
				<h3>SSL & WAF inclus</h3>
				<p>Let's Encrypt instalat automat. Imunify360 blochează atacurile cunoscute.</p>
			</div>
			<div class="ph-feat">
				<div class="ph-feat-icon">
					<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
						<polyline points="23 4 23 10 17 10"></polyline>
						<polyline points="1 20 1 14 7 14"></polyline>
						<path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path>
					</svg>
				</div>
				<h3>Backup zilnic</h3>
				<p>Restaurare cu un click din panou. Backup-uri păstrate 14 zile, replicate offsite.</p>
			</div>
			<div class="ph-feat">
				<div class="ph-feat-icon">
					<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
						<path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"></path>
					</svg>
				</div>
				<h3>Suport 24/7 în RO</h3>
				<p>Răspuns mediu sub 11 minute. Vorbim limba ta și te ajutăm cu migrarea.</p>
			</div>
			<div class="ph-feat">
				<div class="ph-feat-icon">
					<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
						<polyline points="22 12 18 12 15 21 9 3 6 12 2 12"></polyline>
					</svg>
				</div>
				<h3>99.99% uptime</h3>
				<p>Garantat prin SLA. Dacă pică, primești înapoi 10× timpul pierdut.</p>
			</div>
		</div>
	</section>

	<!-- Compare table -->
	{#if !loading && packages.length > 0}
		<section id="compara" class="ph-compare-wrap">
			<div class="ph-section-head">
				<h2>Compară pachetele</h2>
				<p>Toate planurile includ migrare gratuită, SSL și backup zilnic.</p>
			</div>
			<table class="ph-compare-table">
				<thead>
					<tr>
						<th>Caracteristică</th>
						{#each packages as p (p.id)}
							<th class={isPopular(p) ? 'ph-compare-popular' : ''}>{p.name}</th>
						{/each}
					</tr>
				</thead>
				<tbody>
					<tr>
						<td>Preț lunar</td>
						{#each packages as p (p.id)}
							<td class={isPopular(p) ? 'ph-compare-popular' : ''}>
								<strong class="ph-ink">{monthlyBilledRon(p)} {p.currency}</strong>
							</td>
						{/each}
					</tr>
					<tr>
						<td>Spațiu SSD NVMe</td>
						{#each packages as p (p.id)}
							<td class={isPopular(p) ? 'ph-compare-popular' : ''}>
								{p.quota !== null && p.quota !== undefined
									? mbToGbNumber(p.quota) !== null
										? `${mbToGbNumber(p.quota)} GB`
										: mbToGb(p.quota)
									: 'Nelimitat'}
							</td>
						{/each}
					</tr>
					<tr>
						<td>Trafic lunar</td>
						{#each packages as p (p.id)}
							<td class={isPopular(p) ? 'ph-compare-popular' : ''}>
								{p.bandwidth !== null && p.bandwidth !== undefined
									? mbToGbNumber(p.bandwidth) !== null
										? `${mbToGbNumber(p.bandwidth)} GB`
										: mbToGb(p.bandwidth)
									: 'Nelimitat'}
							</td>
						{/each}
					</tr>
					<tr>
						<td>Domenii găzduite</td>
						{#each packages as p (p.id)}
							<td class={isPopular(p) ? 'ph-compare-popular' : ''}>{fmtCount(p.maxDomains)}</td>
						{/each}
					</tr>
					<tr>
						<td>Subdomenii</td>
						{#each packages as p (p.id)}
							<td class={isPopular(p) ? 'ph-compare-popular' : ''}>{fmtCount(p.maxSubdomains)}</td>
						{/each}
					</tr>
					<tr>
						<td>Baze de date</td>
						{#each packages as p (p.id)}
							<td class={isPopular(p) ? 'ph-compare-popular' : ''}>{fmtCount(p.maxDatabases)}</td>
						{/each}
					</tr>
					<tr>
						<td>Conturi email</td>
						{#each packages as p (p.id)}
							<td class={isPopular(p) ? 'ph-compare-popular' : ''}>{fmtCount(p.maxEmailAccounts)}</td>
						{/each}
					</tr>
					<tr>
						<td>SSL Let's Encrypt</td>
						{#each packages as p (p.id)}
							<td class={isPopular(p) ? 'ph-compare-popular ph-success' : 'ph-success'}>
								{#if p.ssl}
									<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
										<polyline points="20 6 9 17 4 12"></polyline>
									</svg>
								{:else}
									—
								{/if}
							</td>
						{/each}
					</tr>
					<tr>
						<td>WordPress optimizat</td>
						{#each packages as p (p.id)}
							<td class={isPopular(p) ? 'ph-compare-popular ph-success' : 'ph-success'}>
								{#if p.wordpress}
									<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
										<polyline points="20 6 9 17 4 12"></polyline>
									</svg>
								{:else}
									—
								{/if}
							</td>
						{/each}
					</tr>
					<tr>
						<td>Redis cache</td>
						{#each packages as p (p.id)}
							<td class={isPopular(p) ? 'ph-compare-popular ph-success' : 'ph-success'}>
								{#if p.redis}
									<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
										<polyline points="20 6 9 17 4 12"></polyline>
									</svg>
								{:else}
									—
								{/if}
							</td>
						{/each}
					</tr>
					<tr>
						<td>SSH access</td>
						{#each packages as p (p.id)}
							<td class={isPopular(p) ? 'ph-compare-popular ph-success' : 'ph-success'}>
								{#if p.ssh}
									<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
										<polyline points="20 6 9 17 4 12"></polyline>
									</svg>
								{:else}
									—
								{/if}
							</td>
						{/each}
					</tr>
					<tr>
						<td>Migrare gratuită</td>
						{#each packages as p (p.id)}
							<td class={isPopular(p) ? 'ph-compare-popular ph-success' : 'ph-success'}>
								<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
									<polyline points="20 6 9 17 4 12"></polyline>
								</svg>
							</td>
						{/each}
					</tr>
					<tr>
						<td>Panou administrare + instalare aplicații</td>
						{#each packages as p (p.id)}
							<td class={isPopular(p) ? 'ph-compare-popular ph-success' : 'ph-success'}>
								<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
									<polyline points="20 6 9 17 4 12"></polyline>
								</svg>
							</td>
						{/each}
					</tr>
					<tr>
						<td>SLA uptime</td>
						{#each packages as p (p.id)}
							<td class={isPopular(p) ? 'ph-compare-popular' : ''}>99.9%</td>
						{/each}
					</tr>
				</tbody>
			</table>
		</section>
	{/if}

	<!-- FAQ -->
	<section id="faq" class="ph-faq">
		<div class="ph-section-head">
			<h2>Întrebări frecvente</h2>
			<p>Răspundem la ce te interesează cel mai des înainte să comanzi.</p>
		</div>
		{#each faqItems as item, i (item.q)}
			<details class="ph-faq-item" open={i === 0}>
				<summary>{item.q}</summary>
				<p>{item.a}</p>
			</details>
		{/each}
	</section>

	<!-- CTA -->
	<section class="ph-cta-band">
		<h2>Începe astăzi. Migrăm noi site-ul.</h2>
		<p>
			Alege pachetul, plasezi comanda, iar restul e treaba noastră. Suport 24/7 de la oameni reali
			din echipa OneTop.
		</p>
		<div class="ph-cta-band-buttons">
			<a href="#pachete" class="ph-cta-primary">Vezi pachetele</a>
			<button type="button" class="ph-cta-secondary" onclick={() => openInquiry(null, null)}>
				Vorbește cu un consultant
			</button>
		</div>
	</section>

	<!-- Footer -->
	<footer class="ph-foot">
		<div class="ph-foot-inner">
			<div>
				<a class="ph-logo ph-logo-foot" href="/pachete-hosting" style="margin-bottom: 12px;">
					<img src="/onetop-logo.png" alt="One Top Solution" />
				</a>
				<p class="ph-foot-blurb">
					Hosting web, cloud servers și management infrastructură pentru afaceri din România. Toate
					datele rămân pe servere din UE.
				</p>
				<ul class="ph-foot-contact">
					{#if tenantInfo?.address || tenantInfo?.city}
						<li>
							<MapPinIcon size={14} class="ph-foot-icon" aria-hidden="true" />
							<span>
								<strong>Sediu:</strong>
								{fullAddress()}
							</span>
						</li>
					{/if}
					{#if tenantInfo?.phone}
						<li>
							<PhoneIcon size={14} class="ph-foot-icon" aria-hidden="true" />
							<span>
								<strong>Telefon:</strong>
								<a class="ph-foot-link" href="tel:{tenantInfo.phone.replace(/\s+/g, '')}"
									>{tenantInfo.phone}</a
								>
							</span>
						</li>
					{/if}
					{#if tenantInfo?.email}
						<li>
							<MailIcon size={14} class="ph-foot-icon" aria-hidden="true" />
							<span>
								<strong>Email:</strong>
								<a class="ph-foot-link" href="mailto:{tenantInfo.email}">{tenantInfo.email}</a>
							</span>
						</li>
					{/if}
				</ul>
			</div>
			<div>
				<h4>Produse</h4>
				{#each packages as p (p.id)}
					<a href={comandaHref(p.id)}>Hosting {p.name}</a>
				{/each}
				<a href="#pachete">Toate pachetele</a>
			</div>
			<div>
				<h4>Companie</h4>
				<a href="#features">Despre noi</a>
				<a href="#features">Datacentere</a>
				<a href="#faq">Support</a>
				<a href="/login">Cont client</a>
			</div>
			<div>
				<h4>Legal</h4>
				<a href="#faq">Termeni și condiții</a>
				<a href="#faq">Politica de confidențialitate</a>
				<a href="#faq">SLA</a>
				<a href="#faq">GDPR</a>
			</div>
		</div>
		<div class="ph-foot-meta">
			<span>
				© {currentYear} {cleanCompanyName(tenantInfo?.name)}. Toate drepturile rezervate.
			</span>
			{#if tenantInfo?.cui || tenantInfo?.registrationNumber}
				<span class="ph-foot-legals">
					{#if tenantInfo.cui}
						<span>CUI {tenantInfo.vatNumber || tenantInfo.cui}</span>
					{/if}
					{#if tenantInfo.registrationNumber}
						<span>{tenantInfo.registrationNumber}</span>
					{/if}
				</span>
			{/if}
		</div>
	</footer>
</div>

{#if checkoutPkg}
	<HostingCheckoutModal
		plan={{
			id: checkoutPkg.id,
			name: checkoutPkg.name,
			currency: checkoutPkg.currency,
			billingCycle: checkoutPkg.billingCycle
		}}
		period={periodKey()}
		{vatRate}
		monthlyBilled={monthlyBilledRon(checkoutPkg)}
		yearlyTotal={yearlyTotalRon(checkoutPkg)}
		bankInfo={{
			name: tenantInfo?.name ?? null,
			bankName: tenantInfo?.bankName ?? null,
			iban: tenantInfo?.iban ?? null,
			ibanEuro: tenantInfo?.ibanEuro ?? null,
			cui: tenantInfo?.cui ?? null,
			vatNumber: tenantInfo?.vatNumber ?? null,
			phone: tenantInfo?.phone ?? null,
			email: tenantInfo?.email ?? null
		}}
		onClose={closeCheckout}
	/>
{/if}

<!-- Inquiry modal (fallback for "Cere o ofertă personalizată" / "Vorbește cu un consultant") -->
<Dialog.Root bind:open={modalOpen}>
	<Dialog.Content class="max-w-md">
		<Dialog.Header>
			<Dialog.Title>
				{selectedPackage ? `Cere ofertă pentru ${selectedPackage.name}` : 'Cere o ofertă'}
			</Dialog.Title>
			<Dialog.Description>
				Te contactăm în maxim 24h cu detaliile complete și activarea contului.
			</Dialog.Description>
		</Dialog.Header>

		<form onsubmit={handleSubmit} class="space-y-3">
			<div>
				<Label for="contactName">Nume complet *</Label>
				<Input id="contactName" bind:value={form.contactName} required placeholder="Ion Popescu" />
			</div>
			<div>
				<Label for="contactEmail">Email *</Label>
				<Input
					id="contactEmail"
					type="email"
					bind:value={form.contactEmail}
					required
					placeholder="ion@firma.ro"
				/>
			</div>
			<div>
				<Label for="contactPhone">Telefon</Label>
				<Input id="contactPhone" bind:value={form.contactPhone} placeholder="07XX XXX XXX" />
			</div>
			<div>
				<Label for="vatNumber">CUI</Label>
				<div class="ph-cui-row">
					<Input
						id="vatNumber"
						bind:value={form.vatNumber}
						placeholder="RO12345678 sau 12345678"
						onblur={() => {
							if (form.vatNumber.trim() && !anafData && !anafLoading) lookupAnaf();
						}}
					/>
					<Button
						type="button"
						variant="outline"
						size="sm"
						disabled={anafLoading || !form.vatNumber.trim()}
						onclick={lookupAnaf}
					>
						{anafLoading ? 'Verifică…' : 'Verifică ANAF'}
					</Button>
				</div>
				{#if anafError}
					<p class="ph-cui-err">{anafError}</p>
				{:else if anafData}
					<div class="ph-cui-ok">
						<strong>{anafData.denumire}</strong>
						{#if anafData.adresa}<span>{anafData.adresa}</span>{/if}
						<span class="ph-cui-tags">
							{#if anafData.platitorTva}
								<span class="ph-cui-tag">Plătitor TVA</span>
							{/if}
							{#if anafData.eFacturaActiv}
								<span class="ph-cui-tag">e-Factura activ</span>
							{/if}
							{#if anafData.nrRegCom}
								<span class="ph-cui-tag">{anafData.nrRegCom}</span>
							{/if}
						</span>
					</div>
				{:else}
					<p class="ph-cui-hint">
						Introdu CUI-ul, apoi click „Verifică ANAF" — completăm denumirea și adresa
						automat.
					</p>
				{/if}
			</div>
			<div>
				<Label for="companyName">Companie</Label>
				<Input
					id="companyName"
					bind:value={form.companyName}
					placeholder="SC Firma SRL"
				/>
			</div>
			<div>
				<Label for="message">Mesaj (opțional)</Label>
				<Textarea
					id="message"
					bind:value={form.message}
					rows={3}
					placeholder="Detalii suplimentare, domeniu existent, migrare etc."
				/>
			</div>

			<div class="flex justify-end gap-2 pt-2">
				<Button type="button" variant="outline" onclick={() => (modalOpen = false)}>Anulează</Button>
				<Button type="submit" disabled={submitting}>
					{submitting ? 'Se trimite...' : 'Trimite cererea'}
				</Button>
			</div>
		</form>
	</Dialog.Content>
</Dialog.Root>

<style>
	.ph-page {
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
	.ph-page :global(*) {
		box-sizing: border-box;
	}
	.ph-page a {
		color: inherit;
	}
	.ph-ink {
		color: var(--ink);
	}

	/* ===== Nav ===== */
	.ph-nav {
		position: sticky;
		top: 0;
		z-index: 50;
		background: rgba(255, 255, 255, 0.92);
		backdrop-filter: blur(10px);
		border-bottom: 1px solid var(--border);
	}
	.ph-nav-inner {
		max-width: 1200px;
		margin: 0 auto;
		padding: 16px 24px;
		display: flex;
		align-items: center;
		gap: 24px;
	}
	.ph-logo {
		display: inline-flex;
		align-items: center;
		gap: 10px;
		font-weight: 800;
		font-size: 14px;
		letter-spacing: -0.01em;
		text-decoration: none;
		color: inherit;
	}
	.ph-logo img {
		display: block;
		height: 32px;
		width: auto;
	}
	.ph-logo-foot img {
		height: 40px;
	}
	.ph-nav-links {
		display: flex;
		gap: 22px;
		font-size: 13px;
		color: var(--ink2);
		font-weight: 500;
	}
	.ph-nav-links a {
		text-decoration: none;
		transition: color 0.15s;
	}
	.ph-nav-links a:hover {
		color: var(--accent);
	}
	.ph-nav-spacer {
		flex: 1;
	}
	.ph-nav-cta {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		padding: 9px 16px;
		border-radius: 8px;
		background: var(--accent);
		color: white;
		text-decoration: none;
		font-weight: 600;
		font-size: 13px;
		border: none;
		cursor: pointer;
		font-family: inherit;
	}
	.ph-nav-cta:hover {
		background: var(--accent-dark);
	}
	.ph-nav-secondary {
		font-weight: 500;
		font-size: 13px;
		color: var(--ink2);
		text-decoration: none;
	}

	/* ===== Hero ===== */
	.ph-hero {
		padding: 80px 24px 60px;
		text-align: center;
		background: radial-gradient(ellipse at top, rgba(24, 119, 242, 0.06), transparent 60%);
	}
	.ph-hero-eyebrow {
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
	.ph-dot {
		width: 6px;
		height: 6px;
		border-radius: 50%;
		background: var(--accent);
	}
	.ph-hero h1 {
		font-size: clamp(36px, 6vw, 56px);
		font-weight: 800;
		letter-spacing: -0.03em;
		line-height: 1.05;
		max-width: 760px;
		margin: 0 auto 18px;
	}
	.ph-hero h1 em {
		font-style: normal;
		color: var(--accent);
		position: relative;
	}
	.ph-hero h1 em::after {
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
	.ph-hero p {
		font-size: 17px;
		color: var(--ink2);
		max-width: 580px;
		margin: 0 auto 28px;
	}
	.ph-hero-tagline {
		display: inline-flex;
		align-items: center;
		gap: 18px;
		flex-wrap: wrap;
		justify-content: center;
	}
	.ph-hero-trust {
		display: flex;
		align-items: center;
		gap: 6px;
		font-size: 13px;
		color: var(--ink2);
	}
	.ph-hero-trust svg {
		color: var(--success);
	}
	.ph-hero-trust strong {
		color: var(--ink);
	}

	/* ===== Billing toggle ===== */
	.ph-billing-toggle {
		margin: 40px auto 0;
		display: inline-flex;
		padding: 4px;
		background: var(--bg-soft);
		border: 1px solid var(--border);
		border-radius: 12px;
		position: relative;
	}
	.ph-billing-toggle button {
		padding: 10px 22px;
		border-radius: 8px;
		background: transparent;
		border: none;
		font-family: inherit;
		font-size: 13px;
		font-weight: 600;
		color: var(--ink2);
		cursor: pointer;
		display: inline-flex;
		align-items: center;
		gap: 8px;
	}
	.ph-billing-toggle button.active {
		background: white;
		color: var(--ink);
		box-shadow: 0 1px 3px rgba(15, 23, 42, 0.08);
	}
	.ph-billing-save {
		background: rgba(16, 185, 129, 0.12);
		color: var(--success);
		font-size: 10px;
		font-weight: 700;
		padding: 2px 7px;
		border-radius: 999px;
		text-transform: uppercase;
		letter-spacing: 0.04em;
	}

	/* ===== Pricing ===== */
	.ph-pricing {
		max-width: 1200px;
		margin: 50px auto 0;
		padding: 0 24px;
		display: grid;
		grid-template-columns: repeat(4, 1fr);
		gap: 16px;
	}
	.ph-plan {
		background: white;
		border: 1px solid var(--border);
		border-radius: 18px;
		padding: 28px 24px 24px;
		display: flex;
		flex-direction: column;
		position: relative;
		transition: all 0.2s;
	}
	.ph-plan:hover {
		transform: translateY(-3px);
		box-shadow: 0 12px 32px rgba(15, 23, 42, 0.08);
	}
	.ph-plan.popular {
		border-color: var(--accent);
		box-shadow: 0 12px 32px rgba(24, 119, 242, 0.14);
		background: linear-gradient(180deg, #f6faff 0%, white 60%);
	}
	.ph-plan-badge {
		position: absolute;
		top: -12px;
		left: 24px;
		background: linear-gradient(135deg, #1877f2, #0d5cc7);
		color: white;
		font-size: 11px;
		font-weight: 700;
		padding: 5px 12px;
		border-radius: 999px;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		box-shadow: 0 4px 12px rgba(24, 119, 242, 0.25);
	}
	.ph-plan-name {
		font-size: 14px;
		font-weight: 700;
		color: var(--accent);
		text-transform: uppercase;
		letter-spacing: 0.08em;
		margin-bottom: 6px;
	}
	.ph-plan-tag {
		font-size: 13px;
		color: var(--ink2);
		margin-bottom: 22px;
		min-height: 38px;
	}
	.ph-plan-price {
		display: flex;
		align-items: baseline;
		gap: 4px;
		margin-bottom: 4px;
	}
	.ph-plan-price-val {
		font-size: 44px;
		font-weight: 800;
		letter-spacing: -0.03em;
		line-height: 1;
		color: var(--ink);
	}
	.ph-plan-price-cur {
		font-size: 16px;
		font-weight: 600;
		color: var(--ink2);
	}
	.ph-plan-price-per {
		font-size: 13px;
		color: var(--muted);
		margin-left: 6px;
	}
	.ph-plan-price-orig {
		font-size: 12px;
		color: var(--muted);
		margin-top: 4px;
		min-height: 16px;
	}
	.ph-plan-cta {
		display: block;
		width: 100%;
		padding: 13px 16px;
		border-radius: 10px;
		background: var(--bg-soft);
		color: var(--ink);
		border: 1px solid var(--border);
		font-family: inherit;
		font-size: 13px;
		font-weight: 700;
		text-decoration: none;
		text-align: center;
		cursor: pointer;
		margin: 18px 0 22px;
		transition: all 0.15s;
	}
	.ph-plan-cta:hover {
		background: var(--ink);
		color: white;
		border-color: var(--ink);
	}
	.ph-plan.popular .ph-plan-cta {
		background: var(--accent);
		color: white;
		border-color: var(--accent);
	}
	.ph-plan.popular .ph-plan-cta:hover {
		background: var(--accent-dark);
		border-color: var(--accent-dark);
	}
	.ph-plan-divider {
		font-size: 10px;
		font-weight: 700;
		color: var(--muted);
		text-transform: uppercase;
		letter-spacing: 0.08em;
		margin-bottom: 12px;
	}
	.ph-plan-features {
		list-style: none;
		padding: 0;
		margin: 0;
		flex: 1;
	}
	.ph-plan-features li {
		display: flex;
		align-items: flex-start;
		gap: 10px;
		font-size: 13.5px;
		color: var(--ink2);
		padding: 6px 0;
	}
	.ph-plan-features li strong {
		color: var(--ink);
		font-weight: 600;
	}
	.ph-plan-features svg {
		flex-shrink: 0;
		color: var(--success);
		margin-top: 2px;
		width: 14px;
		height: 14px;
	}

	.ph-pricing-foot {
		text-align: center;
		max-width: 1200px;
		margin: 30px auto 0;
		padding: 0 24px;
		font-size: 13px;
		color: var(--ink2);
	}
	.ph-link {
		color: var(--accent);
		font-weight: 600;
		background: none;
		border: none;
		cursor: pointer;
		padding: 0;
		text-decoration: underline;
		font-family: inherit;
		font-size: inherit;
	}
	.ph-link:hover {
		color: var(--accent-dark);
	}

	/* Skeleton loaders */
	.ph-skeleton {
		gap: 14px;
	}
	.ph-sk-line,
	.ph-sk-block,
	.ph-sk-block-tall {
		background: #e8edf3;
		border-radius: 8px;
		animation: phPulse 1.4s ease-in-out infinite;
	}
	.ph-sk-line {
		height: 18px;
	}
	.ph-sk-w-32 {
		width: 60%;
	}
	.ph-sk-w-60 {
		width: 90%;
	}
	.ph-sk-block {
		height: 56px;
	}
	.ph-sk-block-tall {
		height: 200px;
	}
	@keyframes phPulse {
		0%,
		100% {
			opacity: 1;
		}
		50% {
			opacity: 0.55;
		}
	}

	.ph-empty {
		grid-column: 1 / -1;
		text-align: center;
		padding: 60px 24px;
		color: var(--ink2);
		background: var(--bg-soft);
		border: 1px solid var(--border);
		border-radius: 16px;
	}

	/* ===== Features ===== */
	.ph-features {
		max-width: 1200px;
		margin: 100px auto 0;
		padding: 0 24px;
	}
	.ph-section-head {
		text-align: center;
		max-width: 640px;
		margin: 0 auto 50px;
	}
	.ph-section-head h2 {
		font-size: 36px;
		font-weight: 800;
		letter-spacing: -0.02em;
		margin: 0 0 12px;
	}
	.ph-section-head p {
		font-size: 16px;
		color: var(--ink2);
		margin: 0;
	}
	.ph-features-grid {
		display: grid;
		grid-template-columns: repeat(3, 1fr);
		gap: 18px;
	}
	.ph-feat {
		padding: 24px;
		background: var(--bg-soft);
		border-radius: 14px;
		border: 1px solid transparent;
		transition: all 0.15s;
	}
	.ph-feat:hover {
		background: white;
		border-color: var(--border);
		box-shadow: 0 8px 20px rgba(15, 23, 42, 0.05);
	}
	.ph-feat-icon {
		width: 44px;
		height: 44px;
		border-radius: 11px;
		background: white;
		border: 1px solid var(--border);
		display: grid;
		place-items: center;
		color: var(--accent);
		margin-bottom: 16px;
	}
	.ph-feat h3 {
		font-size: 15px;
		font-weight: 700;
		margin: 0 0 6px;
	}
	.ph-feat p {
		font-size: 13.5px;
		color: var(--ink2);
		margin: 0;
	}

	/* ===== Compare table ===== */
	.ph-compare-wrap {
		max-width: 1200px;
		margin: 100px auto 0;
		padding: 0 24px;
	}
	.ph-compare-table {
		width: 100%;
		border-collapse: collapse;
		background: white;
		border: 1px solid var(--border);
		border-radius: 16px;
		overflow: hidden;
		font-size: 13.5px;
	}
	.ph-compare-table thead th {
		padding: 18px 18px;
		text-align: center;
		border-bottom: 1px solid var(--border);
		background: var(--bg-soft);
		font-weight: 700;
		font-size: 13px;
		color: var(--ink);
	}
	.ph-compare-table thead th:first-child {
		text-align: left;
	}
	.ph-compare-table tbody td {
		padding: 14px 18px;
		border-bottom: 1px solid var(--border);
		text-align: center;
		color: var(--ink2);
	}
	.ph-compare-table tbody td:first-child {
		text-align: left;
		color: var(--ink);
		font-weight: 500;
	}
	.ph-compare-table tbody tr:last-child td {
		border-bottom: none;
	}
	.ph-compare-table tbody tr:hover {
		background: var(--bg-soft);
	}
	.ph-compare-popular {
		background: rgba(24, 119, 242, 0.04);
	}
	.ph-success svg {
		color: var(--success);
		width: 16px;
		height: 16px;
		display: inline-block;
		vertical-align: middle;
	}

	/* ===== FAQ ===== */
	.ph-faq {
		max-width: 800px;
		margin: 100px auto 0;
		padding: 0 24px;
	}
	details.ph-faq-item {
		border-bottom: 1px solid var(--border);
		padding: 18px 0;
	}
	details.ph-faq-item summary {
		cursor: pointer;
		list-style: none;
		display: flex;
		align-items: center;
		gap: 12px;
		font-size: 15px;
		font-weight: 600;
	}
	details.ph-faq-item summary::-webkit-details-marker {
		display: none;
	}
	details.ph-faq-item summary::after {
		content: '+';
		margin-left: auto;
		font-size: 22px;
		color: var(--muted);
		line-height: 1;
		transition: transform 0.15s;
	}
	details.ph-faq-item[open] summary::after {
		content: '−';
	}
	details.ph-faq-item p {
		margin: 12px 0 0;
		font-size: 14px;
		color: var(--ink2);
		line-height: 1.6;
	}

	/* ===== CTA ===== */
	.ph-cta-band {
		margin: 100px auto 0;
		background: linear-gradient(135deg, #0b1220, #1e293b);
		border-radius: 24px;
		padding: 60px 40px;
		text-align: center;
		max-width: 1152px;
		color: white;
		position: relative;
		overflow: hidden;
	}
	.ph-cta-band::before {
		content: '';
		position: absolute;
		inset: 0;
		background: radial-gradient(ellipse at 30% 20%, rgba(24, 119, 242, 0.3), transparent 60%);
		pointer-events: none;
	}
	.ph-cta-band > * {
		position: relative;
	}
	.ph-cta-band h2 {
		font-size: 36px;
		font-weight: 800;
		letter-spacing: -0.02em;
		margin: 0 0 12px;
	}
	.ph-cta-band p {
		font-size: 16px;
		opacity: 0.8;
		max-width: 480px;
		margin: 0 auto 28px;
	}
	.ph-cta-band-buttons {
		display: inline-flex;
		gap: 10px;
		flex-wrap: wrap;
		justify-content: center;
	}
	.ph-cta-band-buttons a,
	.ph-cta-band-buttons button {
		padding: 13px 24px;
		border-radius: 10px;
		font-size: 14px;
		font-weight: 700;
		text-decoration: none;
		border: none;
		font-family: inherit;
		cursor: pointer;
	}
	.ph-cta-primary {
		background: var(--accent);
		color: white;
	}
	.ph-cta-secondary {
		background: rgba(255, 255, 255, 0.1);
		color: white;
		border: 1px solid rgba(255, 255, 255, 0.18) !important;
	}

	/* ===== Footer ===== */
	.ph-foot {
		margin-top: 80px;
		padding: 40px 24px 24px;
		border-top: 1px solid var(--border);
		color: var(--muted);
		font-size: 12.5px;
		background: var(--bg-soft);
	}
	.ph-foot-inner {
		max-width: 1200px;
		margin: 0 auto;
		display: grid;
		grid-template-columns: 2fr 1fr 1fr 1fr;
		gap: 32px;
	}
	.ph-foot h4 {
		font-size: 12px;
		color: var(--ink);
		margin: 0 0 14px;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.06em;
	}
	.ph-foot a {
		display: block;
		color: var(--ink2);
		text-decoration: none;
		padding: 4px 0;
		font-size: 13px;
	}
	.ph-foot a:hover {
		color: var(--accent);
	}
	.ph-foot-blurb {
		margin: 8px 0 0;
		font-size: 13px;
	}
	.ph-foot-contact {
		list-style: none;
		padding: 0;
		margin: 14px 0 0;
		font-size: 12.5px;
		display: flex;
		flex-direction: column;
		gap: 6px;
	}
	.ph-foot-contact li {
		display: flex;
		align-items: flex-start;
		gap: 8px;
	}
	.ph-foot-contact li > :global(.ph-foot-icon) {
		flex-shrink: 0;
		color: var(--accent);
		margin-top: 2px;
	}
	.ph-foot-contact li > span {
		display: inline;
		flex: 1;
	}
	.ph-foot-contact strong {
		color: var(--ink);
		font-weight: 600;
		margin-right: 4px;
	}
	.ph-foot-link {
		display: inline !important;
		padding: 0 !important;
	}
	.ph-foot-meta {
		max-width: 1200px;
		margin: 32px auto 0;
		padding-top: 20px;
		border-top: 1px solid var(--border);
		display: flex;
		align-items: center;
		justify-content: space-between;
		flex-wrap: wrap;
		gap: 12px;
	}
	.ph-foot-legals {
		display: inline-flex;
		gap: 16px;
	}
	.ph-foot-contact a {
		color: var(--ink2);
		text-decoration: none;
	}
	.ph-foot-contact a:hover {
		color: var(--accent);
	}
	.ph-foot-contact .ph-foot-link:hover {
		text-decoration: underline;
	}

	/* ===== ANAF lookup row (rendered in dialog portal — needs :global) ===== */
	:global(.ph-cui-row) {
		display: flex;
		gap: 8px;
		align-items: stretch;
	}
	:global(.ph-cui-row > :first-child) {
		flex: 1;
	}
	:global(.ph-cui-hint) {
		margin: 6px 0 0;
		font-size: 11.5px;
		color: #64748b;
	}
	:global(.ph-cui-err) {
		margin: 6px 0 0;
		font-size: 12.5px;
		color: #b91c1c;
		background: rgba(239, 68, 68, 0.06);
		border: 1px solid rgba(239, 68, 68, 0.2);
		border-radius: 8px;
		padding: 8px 12px;
	}
	:global(.ph-cui-ok) {
		margin-top: 8px;
		padding: 10px 12px;
		background: rgba(16, 185, 129, 0.08);
		border: 1px solid rgba(16, 185, 129, 0.25);
		border-radius: 8px;
		font-size: 12.5px;
		color: #047857;
		display: flex;
		flex-direction: column;
		gap: 4px;
	}
	:global(.ph-cui-ok strong) {
		font-size: 13px;
		color: #064e3b;
	}
	:global(.ph-cui-ok span) {
		color: #475569;
	}
	:global(.ph-cui-tags) {
		display: flex;
		flex-wrap: wrap;
		gap: 4px;
		margin-top: 2px;
	}
	:global(.ph-cui-tag) {
		background: white;
		border: 1px solid rgba(16, 185, 129, 0.3);
		border-radius: 999px;
		padding: 2px 8px;
		font-size: 10.5px;
		font-weight: 600;
		color: #047857;
		text-transform: uppercase;
		letter-spacing: 0.04em;
	}

	@media (max-width: 960px) {
		.ph-pricing {
			grid-template-columns: repeat(2, 1fr);
		}
		.ph-features-grid {
			grid-template-columns: 1fr 1fr;
		}
		.ph-foot-inner {
			grid-template-columns: 1fr 1fr;
		}
		.ph-compare-wrap {
			display: none;
		}
	}
	@media (max-width: 620px) {
		.ph-pricing {
			grid-template-columns: 1fr;
		}
		.ph-features-grid {
			grid-template-columns: 1fr;
		}
		.ph-nav-links {
			display: none;
		}
		.ph-foot-inner {
			grid-template-columns: 1fr;
		}
	}
</style>
