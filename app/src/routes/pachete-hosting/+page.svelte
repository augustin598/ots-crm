<script lang="ts">
	import '../layout.css';
	import { getPublicHostingPackages, submitHostingInquiry } from '$lib/remotes/public-hosting.remote';
	import { Card, CardContent } from '$lib/components/ui/card';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import { Textarea } from '$lib/components/ui/textarea';
	import * as Dialog from '$lib/components/ui/dialog';
	import { toast } from 'svelte-sonner';
	import PackageIcon from '@lucide/svelte/icons/package';
	import CheckIcon from '@lucide/svelte/icons/check';
	import HardDriveIcon from '@lucide/svelte/icons/hard-drive';
	import ActivityIcon from '@lucide/svelte/icons/activity';
	import MailIcon from '@lucide/svelte/icons/mail';
	import DatabaseIcon from '@lucide/svelte/icons/database';
	import GlobeIcon from '@lucide/svelte/icons/globe';
	import ShieldCheckIcon from '@lucide/svelte/icons/shield-check';
	import HeadphonesIcon from '@lucide/svelte/icons/headphones';
	import RocketIcon from '@lucide/svelte/icons/rocket';

	const packagesQuery = getPublicHostingPackages();
	const packages = $derived(packagesQuery.current?.packages ?? []);
	const vatRate = $derived(packagesQuery.current?.vatRate ?? 21);
	const loading = $derived(packagesQuery.loading && !packagesQuery.current);

	let modalOpen = $state(false);
	let selectedPackage = $state<{ id: string; name: string } | null>(null);
	let submitting = $state(false);

	let form = $state({
		contactName: '',
		contactEmail: '',
		contactPhone: '',
		companyName: '',
		vatNumber: '',
		message: ''
	});

	function openInquiry(pkgId: string, pkgName: string) {
		selectedPackage = { id: pkgId, name: pkgName };
		modalOpen = true;
	}

	function openGeneralInquiry() {
		selectedPackage = null;
		modalOpen = true;
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
			form = { contactName: '', contactEmail: '', contactPhone: '', companyName: '', vatNumber: '', message: '' };
			selectedPackage = null;
		} catch (e) {
			toast.error(e instanceof Error ? e.message : 'Eroare la trimitere. Încearcă din nou.');
		} finally {
			submitting = false;
		}
	}

	function fmtPrice(cents: number, currency: string): string {
		return (cents / 100).toLocaleString('ro-RO', { minimumFractionDigits: 0, maximumFractionDigits: 0 }) + ' ' + currency;
	}
	function fmtLimit(v: number | null | undefined, unit?: string): string {
		if (v === null || v === undefined) return 'Nelimitat';
		return unit ? `${v.toLocaleString('ro-RO')} ${unit}` : v.toLocaleString('ro-RO');
	}
	function priceWithVat(netCents: number): number {
		return Math.round(netCents * (1 + vatRate / 100));
	}
	function billingCycleLabel(cycle: string): string {
		const map: Record<string, string> = {
			monthly: 'lunar',
			quarterly: 'trimestrial',
			semiannually: 'semestrial',
			biannually: 'semestrial',
			annually: 'anual',
			triennially: '3 ani',
			one_time: 'plată unică'
		};
		return map[cycle] ?? cycle;
	}
</script>

<svelte:head>
	<title>Pachete Hosting WordPress & WooCommerce — One Top Solution</title>
	<meta
		name="description"
		content="Hosting WordPress optimizat cu LiteSpeed, Redis, JetBackup și suport în română. Pachete pentru blog, magazine WooCommerce și agency. Server EU, NVMe SSD."
	/>
	<meta property="og:title" content="Pachete Hosting WordPress & WooCommerce — One Top Solution" />
	<meta
		property="og:description"
		content="Hosting WordPress premium cu LiteSpeed, Redis, NVMe SSD. Pachete de la 749 RON/an. Suport în română."
	/>
	<meta property="og:type" content="website" />
</svelte:head>

<div class="min-h-screen bg-slate-50 dark:bg-slate-950">
	<!-- Header simplu -->
	<header class="border-b bg-white dark:bg-slate-900">
		<div class="mx-auto flex max-w-6xl items-center justify-between px-4 py-4">
			<div class="flex items-center gap-2">
				<PackageIcon class="size-6 text-primary" />
				<span class="text-lg font-bold">One Top Solution</span>
			</div>
			<nav class="flex gap-4 text-sm">
				<a href="/login" class="text-slate-600 hover:text-slate-900 dark:text-slate-300">Conectează-te</a>
				<Button size="sm" onclick={openGeneralInquiry}>Contact</Button>
			</nav>
		</div>
	</header>

	<!-- Hero -->
	<section class="px-4 py-12 text-center sm:py-20">
		<div class="mx-auto max-w-3xl">
			<h1 class="text-3xl font-bold tracking-tight sm:text-5xl">
				Hosting <span class="text-primary">WordPress &amp; WooCommerce</span> de încredere
			</h1>
			<p class="mt-4 text-base text-slate-600 sm:text-lg dark:text-slate-300">
				Servere EU cu LiteSpeed, NVMe SSD, Redis și backup-uri zilnice. Suport în română, fără
				overselling. Pachete pentru blog, magazine online și agenții.
			</p>
			<div class="mt-6 flex flex-wrap justify-center gap-3 text-sm">
				<span class="inline-flex items-center gap-1 rounded-full bg-white px-3 py-1 shadow-sm dark:bg-slate-800">
					<ShieldCheckIcon class="size-4 text-green-600" /> SSL Gratuit
				</span>
				<span class="inline-flex items-center gap-1 rounded-full bg-white px-3 py-1 shadow-sm dark:bg-slate-800">
					<RocketIcon class="size-4 text-blue-600" /> LiteSpeed + Redis
				</span>
				<span class="inline-flex items-center gap-1 rounded-full bg-white px-3 py-1 shadow-sm dark:bg-slate-800">
					<HeadphonesIcon class="size-4 text-purple-600" /> Support 24/7 RO
				</span>
				<span class="inline-flex items-center gap-1 rounded-full bg-white px-3 py-1 shadow-sm dark:bg-slate-800">
					<HardDriveIcon class="size-4 text-orange-600" /> Backup zilnic
				</span>
			</div>
		</div>
	</section>

	<!-- Packages -->
	<section class="px-4 pb-16">
		<div class="mx-auto max-w-6xl">
			<div class="mb-8 text-center">
				<h2 class="text-2xl font-bold sm:text-3xl">Alege pachetul potrivit</h2>
				<p class="mt-2 text-sm text-slate-500">
					Toate prețurile sunt afișate <strong>fără TVA</strong>; TVA {vatRate}% se adaugă la checkout.
				</p>
			</div>

			{#if loading}
				<div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
					{#each Array(4) as _}
						<Card class="animate-pulse">
							<CardContent class="space-y-4 p-6">
								<div class="h-6 w-32 rounded bg-slate-200 dark:bg-slate-700"></div>
								<div class="h-10 w-24 rounded bg-slate-200 dark:bg-slate-700"></div>
								<div class="h-40 rounded bg-slate-200 dark:bg-slate-700"></div>
							</CardContent>
						</Card>
					{/each}
				</div>
			{:else if packages.length === 0}
				<Card>
					<CardContent class="py-10 text-center text-slate-500">
						Pachetele sunt în curs de actualizare. Contactează-ne direct pentru o ofertă.
					</CardContent>
				</Card>
			{:else}
				<div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
					{#each packages as pkg (pkg.id)}
						<Card
							class="relative flex flex-col {pkg.highlightBadge
								? 'border-primary shadow-lg lg:scale-105'
								: ''}"
						>
							{#if pkg.highlightBadge}
								<div
									class="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-primary px-3 py-1 text-xs font-semibold text-primary-foreground"
								>
									{pkg.highlightBadge}
								</div>
							{/if}
							<CardContent class="flex flex-1 flex-col gap-4 p-6">
								<div>
									<h3 class="text-xl font-bold">{pkg.name}</h3>
									{#if pkg.description}
										<p class="mt-1 text-sm text-slate-500">{pkg.description}</p>
									{/if}
								</div>

								<div>
									<div class="flex items-baseline gap-1">
										<span class="text-3xl font-bold">{fmtPrice(pkg.price, pkg.currency)}</span>
										<span class="text-sm text-slate-500">/ {billingCycleLabel(pkg.billingCycle)}</span>
									</div>
									<p class="mt-0.5 text-xs text-slate-500">
										fără TVA · cu TVA {vatRate}%: <strong>{fmtPrice(priceWithVat(pkg.price), pkg.currency)}</strong>
									</p>
								</div>

								<!-- Specs principale -->
								<div class="space-y-1.5 text-sm">
									{#if pkg.quota !== null}
										<div class="flex items-center gap-2">
											<HardDriveIcon class="size-4 shrink-0 text-slate-400" />
											<span><strong>{fmtLimit(pkg.quota, 'MB')}</strong> SSD NVMe</span>
										</div>
									{/if}
									{#if pkg.bandwidth !== null}
										<div class="flex items-center gap-2">
											<ActivityIcon class="size-4 shrink-0 text-slate-400" />
											<span><strong>{fmtLimit(pkg.bandwidth, 'MB')}</strong> trafic/lună</span>
										</div>
									{/if}
									{#if pkg.maxDomains !== null}
										<div class="flex items-center gap-2">
											<GlobeIcon class="size-4 shrink-0 text-slate-400" />
											<span><strong>{fmtLimit(pkg.maxDomains)}</strong> site-uri</span>
										</div>
									{/if}
									{#if pkg.maxEmailAccounts !== null}
										<div class="flex items-center gap-2">
											<MailIcon class="size-4 shrink-0 text-slate-400" />
											<span><strong>{fmtLimit(pkg.maxEmailAccounts)}</strong> conturi email</span>
										</div>
									{/if}
									{#if pkg.maxDatabases !== null}
										<div class="flex items-center gap-2">
											<DatabaseIcon class="size-4 shrink-0 text-slate-400" />
											<span><strong>{fmtLimit(pkg.maxDatabases)}</strong> baze de date</span>
										</div>
									{/if}
								</div>

								<!-- Features manual -->
								{#if pkg.features && pkg.features.length > 0}
									<ul class="space-y-1 border-t pt-3 text-sm">
										{#each pkg.features.slice(0, 6) as feat}
											<li class="flex items-start gap-1.5">
												<CheckIcon class="mt-0.5 size-4 shrink-0 text-green-600" />
												<span>{feat}</span>
											</li>
										{/each}
										{#if pkg.features.length > 6}
											<li class="text-xs text-slate-400">+ {pkg.features.length - 6} caracteristici</li>
										{/if}
									</ul>
								{/if}

								<div class="mt-auto pt-3 space-y-2">
									<Button
										class="w-full"
										variant={pkg.highlightBadge ? 'default' : 'outline'}
										href="/pachete-hosting/comanda?package={pkg.id}"
									>
										Comandă online →
									</Button>
									<button
										type="button"
										class="w-full text-center text-xs text-muted-foreground hover:underline"
										onclick={() => openInquiry(pkg.id, pkg.name)}
									>
										sau cere ofertă personalizată
									</button>
								</div>
							</CardContent>
						</Card>
					{/each}
				</div>
			{/if}

			<p class="mt-8 text-center text-sm text-slate-500">
				Ai nevoie de configurare specială sau migrare site? <button
					type="button"
					class="text-primary underline"
					onclick={openGeneralInquiry}>Contactează-ne</button
				> pentru o ofertă personalizată.
			</p>
		</div>
	</section>

	<!-- Footer minimal -->
	<footer class="border-t bg-white py-8 text-center text-sm text-slate-500 dark:bg-slate-900">
		<div class="mx-auto max-w-6xl px-4">
			<p>© {new Date().getFullYear()} One Top Solution · office@onetopsolution.ro</p>
			<p class="mt-2">
				<a href="/login" class="hover:underline">Conectare client</a>
			</p>
		</div>
	</footer>
</div>

<!-- Inquiry modal -->
<Dialog.Root bind:open={modalOpen}>
	<Dialog.Content class="max-w-md">
		<Dialog.Header>
			<Dialog.Title>
				{selectedPackage ? `Comandă ${selectedPackage.name}` : 'Cere o ofertă'}
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
				<Input id="contactEmail" type="email" bind:value={form.contactEmail} required placeholder="ion@firma.ro" />
			</div>
			<div>
				<Label for="contactPhone">Telefon</Label>
				<Input id="contactPhone" bind:value={form.contactPhone} placeholder="07XX XXX XXX" />
			</div>
			<div class="grid grid-cols-2 gap-2">
				<div>
					<Label for="companyName">Companie</Label>
					<Input id="companyName" bind:value={form.companyName} placeholder="SC Firma SRL" />
				</div>
				<div>
					<Label for="vatNumber">CUI</Label>
					<Input id="vatNumber" bind:value={form.vatNumber} placeholder="RO12345678" />
				</div>
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
