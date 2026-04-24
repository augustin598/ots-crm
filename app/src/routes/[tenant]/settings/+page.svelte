<script lang="ts">
	import type { PageData } from './$types';
	import { updateTenantSettings } from '$lib/remotes/tenant-settings.remote';
	import { getCompanyData } from '$lib/remotes/anaf.remote';
	import { sendInvitation, getInvitations, cancelInvitation } from '$lib/remotes/invitations.remote';
	import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '$lib/components/ui/card';
	import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '$lib/components/ui/collapsible';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import { Separator } from '$lib/components/ui/separator';
	import { Select, SelectContent, SelectItem, SelectTrigger } from '$lib/components/ui/select';
	import { Badge } from '$lib/components/ui/badge';
	import { X } from '@lucide/svelte';
	import SearchIcon from '@lucide/svelte/icons/search';
	import ChevronDownIcon from '@lucide/svelte/icons/chevron-down';
	import { getFaviconUrl } from '$lib/utils';
	import GlobeIcon from '@lucide/svelte/icons/globe';
	import FileSignatureIcon from '@lucide/svelte/icons/file-signature';
	import MailIcon from '@lucide/svelte/icons/mail';
	import ChevronRightIcon from '@lucide/svelte/icons/chevron-right';
	import WebhookIcon from '@lucide/svelte/icons/webhook';
	import IconGmail from '$lib/components/marketing/icon-gmail.svelte';
	import IconGoogleAds from '$lib/components/marketing/icon-google-ads.svelte';
	import IconFacebook from '$lib/components/marketing/icon-facebook.svelte';
	import IconTiktok from '$lib/components/marketing/icon-tiktok.svelte';
	import IconWhatsapp from '$lib/components/marketing/icon-whatsapp.svelte';
	import { getGmailConnectionStatus } from '$lib/remotes/supplier-invoices.remote';
	import { getGoogleAdsConnectionStatus } from '$lib/remotes/google-ads-invoices.remote';
	import { getMetaAdsConnectionStatus } from '$lib/remotes/meta-ads-invoices.remote';
	import { getTiktokAdsConnectionStatus } from '$lib/remotes/tiktok-ads.remote';
	import { getWhatsappConnectionStatus } from '$lib/remotes/whatsapp.remote';
	import { getWhmcsStatus } from '$lib/remotes/whmcs.remote';
	import { getBnrRates, refreshBnrRates } from '$lib/remotes/bnr.remote';
	import RefreshCwIcon from '@lucide/svelte/icons/refresh-cw';
	import { goto, invalidateAll } from '$app/navigation';
	import { page } from '$app/state';
	import { browser } from '$app/environment';
	import { THEME_PRESETS, DEFAULT_THEME_COLOR, hexToOklchHue, isValidHex } from '$lib/theme-utils';
	import PaletteIcon from '@lucide/svelte/icons/palette';
	import CheckIcon from '@lucide/svelte/icons/check';
	import ImageIcon from '@lucide/svelte/icons/image';
	import UploadIcon from '@lucide/svelte/icons/upload';
	import TrashIcon from '@lucide/svelte/icons/trash-2';
	import ShieldAlertIcon from '@lucide/svelte/icons/shield-alert';
	import UsersIcon from '@lucide/svelte/icons/users';
	import { getClientsRestrictionStatus, setClientRestriction } from '$lib/remotes/client-restrictions.remote';
	import { toast } from 'svelte-sonner';
	import { clientLogger } from '$lib/client-logger';

	const tenantSlug = $derived(page.params.tenant);

	let { data }: { data: PageData } = $props();

	let name = $state('');
	let slug = $state('');
	let website = $state('');
	let loading = $state(false);
	let loadingAnaf = $state(false);
	let error = $state<string | null>(null);

	// Romanian legal data
	let companyType = $state('');
	let cui = $state('');
	let registrationNumber = $state('');
	let tradeRegister = $state('');
	let vatNumber = $state('');
	let legalRepresentative = $state('');
	let iban = $state('');
	let ibanEuro = $state('');
	let bankName = $state('');
	let address = $state('');
	let city = $state('');
	let county = $state('');
	let postalCode = $state('');
	let country = $state('România');
	let phone = $state('');
	let email = $state('');
	let contractPrefix = $state('CTR');
	let themeColor = $state(DEFAULT_THEME_COLOR);
	let favicon = $state<string | null>(null);
	let faviconPreview = $state<string | null>(null);
	let faviconSaving = $state(false);
	let faviconError = $state<string | null>(null);

	// Sync from page data
	$effect(() => {
		const t = data.tenant;
		if (!t) return;
		name = t.name || '';
		slug = t.slug || '';
		website = t.website || '';
		companyType = t.companyType || '';
		cui = t.cui || '';
		registrationNumber = t.registrationNumber || '';
		tradeRegister = t.tradeRegister || '';
		vatNumber = t.vatNumber || '';
		legalRepresentative = t.legalRepresentative || '';
		iban = t.iban || '';
		ibanEuro = t.ibanEuro || '';
		bankName = t.bankName || '';
		address = t.address || '';
		city = t.city || '';
		county = t.county || '';
		postalCode = t.postalCode || '';
		country = t.country || 'România';
		phone = t.phone || '';
		email = t.email || '';
		contractPrefix = t.contractPrefix || 'CTR';
		themeColor = t.themeColor || DEFAULT_THEME_COLOR;
		favicon = t.favicon || null;
		faviconPreview = t.favicon || null;
	});

	// Live preview: update CSS variable immediately on color change
	$effect(() => {
		if (browser && themeColor && isValidHex(themeColor)) {
			document.documentElement.style.setProperty('--theme-hue', String(hexToOklchHue(themeColor)));
		}
	});

	// Gmail status
	const gmailStatusQuery = getGmailConnectionStatus();
	const gmailStatus = $derived(gmailStatusQuery.current);

	// WHMCS integration status
	const whmcsStatusQuery = getWhmcsStatus();
	const whmcsStatus = $derived(whmcsStatusQuery.current);

	// Google Ads status
	const googleAdsStatusQuery = getGoogleAdsConnectionStatus();
	const googleAdsStatus = $derived(googleAdsStatusQuery.current);

	// Meta Ads status
	const metaAdsStatusQuery = getMetaAdsConnectionStatus();
	const metaAdsConnections = $derived(metaAdsStatusQuery.current || []);
	const metaAdsActiveCount = $derived(metaAdsConnections.filter((c: any) => c.connected).length);

	// TikTok Ads status
	const tiktokAdsStatusQuery = getTiktokAdsConnectionStatus();
	const tiktokAdsConnections = $derived(tiktokAdsStatusQuery.current || []);
	const tiktokAdsActiveCount = $derived(tiktokAdsConnections.filter((c: any) => c.connected).length);

	const whatsappStatusQuery = getWhatsappConnectionStatus();
	const whatsappStatus = $derived(whatsappStatusQuery.current?.status ?? null);
	const whatsappConnected = $derived(whatsappStatus?.status === 'connected');
	const whatsappNeedsReauth = $derived(whatsappStatus?.status === 'needs_reauth');

	// BNR exchange rates
	const bnrRatesQuery = getBnrRates();
	const bnrRates = $derived(bnrRatesQuery.current || []);
	const mainCurrencies = ['EUR', 'USD', 'GBP', 'CHF'];
	const mainRates = $derived(
		mainCurrencies
			.map((c) => bnrRates.find((r: any) => r.currency === c))
			.filter(Boolean) as Array<{ currency: string; rate: number; multiplier: number; date: string }>
	);
	const bnrDate = $derived(mainRates.length > 0 ? mainRates[0].date : null);
	let refreshingBnr = $state(false);
	let bnrError = $state<string | null>(null);

	async function handleRefreshBnr() {
		refreshingBnr = true;
		bnrError = null;
		try {
			await refreshBnrRates().updates(bnrRatesQuery);
		} catch (e) {
			bnrError = e instanceof Error ? e.message : 'Eroare la actualizarea cursului';
		} finally {
			refreshingBnr = false;
		}
	}

	// Client restrictions
	const clientRestrictionsQuery = getClientsRestrictionStatus();
	const clientsRestriction = $derived(clientRestrictionsQuery.current || []);
	let restrictionsOpen = $state(true);
	let clientSearch = $state('');
	const filteredClients = $derived(
		clientSearch.trim()
			? clientsRestriction.filter((c: any) =>
				c.name.toLowerCase().includes(clientSearch.trim().toLowerCase())
			)
			: clientsRestriction
	);

	async function handleSetRestriction(clientId: string, value: string) {
		try {
			const restrictedAccess = value as 'auto' | 'forced' | 'unrestricted';
			await setClientRestriction({ clientId, restrictedAccess }).updates(clientRestrictionsQuery);
			toast.success('Restricția a fost actualizată');
		} catch (e) {
			clientLogger.apiError('settings_set_restriction', e);
		}
	}

	// Invitation state
	let invitationsOpen = $state(true);
	let invitationSearch = $state('');
	let invitationEmail = $state('');
	let invitationRole = $state<'member' | 'admin'>('member');
	let sendingInvitation = $state(false);
	let invitationError = $state<string | null>(null);
	let invitationSuccess = $state(false);

	const invitationsQuery = getInvitations();
	const invitations = $derived(invitationsQuery.current || []);
	const loadingInvitations = $derived(invitationsQuery.loading);
	const filteredInvitations = $derived(
		invitationSearch.trim()
			? invitations.filter((inv: any) =>
				inv.email.toLowerCase().includes(invitationSearch.trim().toLowerCase())
			)
			: invitations
	);

	async function handleAnafLookup() {
		if (!cui) {
			error = 'Please enter a CUI first';
			return;
		}

		loadingAnaf = true;
		error = null;

		try {
			const anafData = await getCompanyData(cui);

			name = anafData.denumire || name;
			registrationNumber = anafData.nrRegCom || registrationNumber;
			iban = anafData.iban || iban;
			companyType = anafData.forma_juridica || companyType;

			if (anafData.adresa_sediu_social) {
				const addr = anafData.adresa_sediu_social;
				address = [addr.sdenumire_Strada, addr.snumar_Strada].filter(Boolean).join(' ') || address;
				city = addr.sdenumire_Localitate || city;
				county = addr.sdenumire_Judet || county;
				postalCode = addr.scod_Postal || postalCode;
			}
		} catch (e) {
			error = e instanceof Error ? e.message : 'Failed to fetch company data from ANAF';
		} finally {
			loadingAnaf = false;
		}
	}

	function handleFaviconSelect(e: Event) {
		const input = e.target as HTMLInputElement;
		const file = input.files?.[0];
		if (!file) return;

		faviconError = null;

		const validTypes = ['image/png', 'image/x-icon', 'image/svg+xml', 'image/ico', 'image/jpeg', 'image/gif', 'image/webp'];
		if (!validTypes.includes(file.type)) {
			faviconError = 'Formatul trebuie să fie PNG, ICO, SVG, JPEG, GIF sau WebP';
			return;
		}

		if (file.size > 512 * 1024) {
			faviconError = 'Favicon-ul trebuie să fie mai mic de 512KB';
			return;
		}

		const reader = new FileReader();
		reader.onload = () => {
			const base64 = reader.result as string;
			favicon = base64;
			faviconPreview = base64;
		};
		reader.readAsDataURL(file);
	}

	async function handleFaviconSave() {
		faviconSaving = true;
		faviconError = null;
		try {
			await updateTenantSettings({
				name,
				slug,
				favicon
			});
			await invalidateAll();
			toast.success('Favicon-ul a fost actualizat');
		} catch (e) {
			faviconError = e instanceof Error ? e.message : 'Eroare la salvarea favicon-ului';
		} finally {
			faviconSaving = false;
		}
	}

	function removeFavicon() {
		favicon = null;
		faviconPreview = null;
	}

	async function handleSubmit() {
		loading = true;
		error = null;

		try {
			await updateTenantSettings({
				name,
				slug,
				website: website || undefined,
				companyType: companyType || undefined,
				cui: cui || undefined,
				registrationNumber: registrationNumber || undefined,
				tradeRegister: tradeRegister || undefined,
				vatNumber: vatNumber || undefined,
				legalRepresentative: legalRepresentative || undefined,
				iban: iban || undefined,
				ibanEuro: ibanEuro || undefined,
				bankName: bankName || undefined,
				address: address || undefined,
				city: city || undefined,
				county: county || undefined,
				postalCode: postalCode || undefined,
				country: country || undefined,
				phone: phone || undefined,
				email: email || undefined,
				contractPrefix: contractPrefix || undefined,
				themeColor: themeColor || undefined
			}).updates(getInvitations());
		} catch (e) {
			error = e instanceof Error ? e.message : 'Failed to update settings';
		} finally {
			loading = false;
		}
	}

	async function handleSendInvitation() {
		if (!invitationEmail) {
			invitationError = 'Email is required';
			return;
		}

		sendingInvitation = true;
		invitationError = null;
		invitationSuccess = false;

		try {
			await sendInvitation({
				email: invitationEmail,
				role: invitationRole
			}).updates(invitationsQuery);
			invitationEmail = '';
			invitationSuccess = true;
			setTimeout(() => {
				invitationSuccess = false;
			}, 3000);
		} catch (e) {
			invitationError = e instanceof Error ? e.message : 'Failed to send invitation';
		} finally {
			sendingInvitation = false;
		}
	}

	async function handleCancelInvitation(invitationId: string) {
		if (!confirm('Are you sure you want to cancel this invitation?')) {
			return;
		}

		try {
			await cancelInvitation(invitationId).updates(invitationsQuery);
		} catch (e) {
			invitationError = e instanceof Error ? e.message : 'Failed to cancel invitation';
		}
	}

	function getStatusBadgeVariant(status: string) {
		switch (status) {
			case 'pending':
				return 'default';
			case 'accepted':
				return 'secondary';
			case 'cancelled':
				return 'outline';
			case 'expired':
				return 'destructive';
			default:
				return 'outline';
		}
	}

	function formatDate(date: Date | string | null) {
		if (!date) return 'N/A';
		return new Date(date).toLocaleDateString();
	}
</script>

<div class="space-y-6">

	<Card>
		<CardHeader>
			<CardTitle>Organization Details</CardTitle>
			<CardDescription>Manage your organization information</CardDescription>
		</CardHeader>
		<CardContent>
			<form
				onsubmit={(e) => {
					e.preventDefault();
					handleSubmit();
				}}
				class="space-y-6"
			>
				<div class="space-y-4">
					<div class="space-y-2">
						<Label for="name">Organization Name *</Label>
						<Input id="name" bind:value={name} type="text" required />
					</div>
					<div class="space-y-2">
						<Label for="slug">Slug (URL) *</Label>
						<Input id="slug" bind:value={slug} type="text" required />
						<p class="text-xs text-gray-500">This is used in your organization URL</p>
					</div>
					<div class="space-y-2">
						<Label for="website">Website principal</Label>
						<div class="flex items-center gap-2">
							<div class="h-9 w-9 shrink-0 flex items-center justify-center rounded-md border bg-muted/40 overflow-hidden">
								{#if website.trim()}
									<img
										src={getFaviconUrl(website.trim(), 32)}
										alt=""
										class="h-6 w-6 object-contain"
										loading="lazy"
										onerror={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }}
									/>
								{:else}
									<GlobeIcon class="h-4 w-4 text-muted-foreground" />
								{/if}
							</div>
							<Input id="website" bind:value={website} type="url" placeholder="https://example.com" />
						</div>
						<p class="text-xs text-gray-500">Logo-ul este preluat automat din website</p>
					</div>
				</div>

				<Separator />

				<div class="space-y-4">
					<div class="flex items-center justify-between">
						<h3 class="text-lg font-semibold">Legal Data (Date Legale)</h3>
						<Button
							type="button"
							variant="outline"
							size="sm"
							onclick={handleAnafLookup}
							disabled={loadingAnaf || !cui}
						>
							{loadingAnaf ? 'Loading...' : 'Lookup by CUI'}
						</Button>
					</div>
					<div class="grid grid-cols-2 gap-4">
						<div class="space-y-2">
							<Label for="cui">CUI</Label>
							<Input id="cui" bind:value={cui} type="text" />
						</div>
						<div class="space-y-2">
							<Label for="companyType">Company Type</Label>
							<Input id="companyType" bind:value={companyType} type="text" />
						</div>
						<div class="space-y-2">
							<Label for="registrationNumber">Registration Number</Label>
							<Input id="registrationNumber" bind:value={registrationNumber} type="text" />
						</div>
						<div class="space-y-2">
							<Label for="tradeRegister">Trade Register</Label>
							<Input id="tradeRegister" bind:value={tradeRegister} type="text" />
						</div>
						<div class="space-y-2">
							<Label for="vatNumber">VAT Number</Label>
							<Input id="vatNumber" bind:value={vatNumber} type="text" />
						</div>
						<div class="space-y-2">
							<Label for="legalRepresentative">Legal Representative</Label>
							<Input id="legalRepresentative" bind:value={legalRepresentative} type="text" />
						</div>
						<div class="space-y-2">
							<Label for="iban">IBAN (LEI)</Label>
							<Input id="iban" bind:value={iban} type="text" placeholder="RO86BTRL..." />
						</div>
						<div class="space-y-2">
							<Label for="ibanEuro">IBAN (EURO)</Label>
							<Input id="ibanEuro" bind:value={ibanEuro} type="text" placeholder="RO36BTRL..." />
						</div>
						<div class="space-y-2">
							<Label for="bankName">Bank Name</Label>
							<Input id="bankName" bind:value={bankName} type="text" />
						</div>
					</div>
					<div class="grid grid-cols-2 gap-4">
						<div class="space-y-2">
							<Label for="phone">Phone</Label>
							<Input id="phone" bind:value={phone} type="tel" placeholder="07xxxxxxxx" />
						</div>
						<div class="space-y-2">
							<Label for="email">Email</Label>
							<Input id="email" bind:value={email} type="email" placeholder="office@company.ro" />
						</div>
					</div>
					<div class="space-y-2">
						<Label for="address">Address</Label>
						<Input id="address" bind:value={address} type="text" />
					</div>
					<div class="grid grid-cols-3 gap-4">
						<div class="space-y-2">
							<Label for="city">City</Label>
							<Input id="city" bind:value={city} type="text" />
						</div>
						<div class="space-y-2">
							<Label for="county">County (Județ)</Label>
							<Input id="county" bind:value={county} type="text" />
						</div>
						<div class="space-y-2">
							<Label for="postalCode">Postal Code</Label>
							<Input id="postalCode" bind:value={postalCode} type="text" />
						</div>
					</div>
					<div class="space-y-2">
						<Label for="country">Country</Label>
						<Input id="country" bind:value={country} type="text" />
					</div>
				</div>

				{#if error}
					<div class="rounded-md bg-red-50 p-3">
						<p class="text-sm text-red-800">{error}</p>
					</div>
				{/if}

				<Button type="submit" disabled={loading}>
					{loading ? 'Saving...' : 'Save Settings'}
				</Button>
			</form>
		</CardContent>
	</Card>

	<Card>
		<CardHeader>
			<div class="flex items-center gap-3">
				<PaletteIcon class="h-5 w-5 text-muted-foreground" />
				<div>
					<CardTitle>Culoare Tema</CardTitle>
					<CardDescription>Personalizati culoarea principala a aplicatiei</CardDescription>
				</div>
			</div>
		</CardHeader>
		<CardContent class="space-y-4">
			<div class="flex flex-wrap gap-3">
				{#each THEME_PRESETS as preset}
					<button
						type="button"
						onclick={() => { themeColor = preset.hex; }}
						class="relative w-10 h-10 rounded-full border-2 transition-all hover:scale-110 {themeColor === preset.hex ? 'border-foreground ring-2 ring-offset-2 ring-foreground scale-110' : 'border-transparent'}"
						style="background-color: {preset.hex}"
						title={preset.name}
					>
						{#if themeColor === preset.hex}
							<CheckIcon class="absolute inset-0 m-auto h-5 w-5 text-white drop-shadow-md" />
						{/if}
					</button>
				{/each}
			</div>
			<div class="flex items-center gap-3">
				<input
					type="color"
					value={themeColor}
					oninput={(e) => { themeColor = (e.currentTarget as HTMLInputElement).value.toUpperCase(); }}
					class="w-10 h-10 rounded cursor-pointer border p-0.5"
				/>
				<Input
					bind:value={themeColor}
					type="text"
					placeholder="#009AFF"
					maxlength={7}
					class="max-w-[120px] font-mono uppercase"
				/>
				<span class="text-xs text-muted-foreground">Culoare custom</span>
			</div>
		</CardContent>
	</Card>

	<Card>
		<CardHeader>
			<div class="flex items-center gap-3">
				<ImageIcon class="h-5 w-5 text-muted-foreground" />
				<div>
					<CardTitle>Favicon</CardTitle>
					<CardDescription>Iconița afișată în tab-ul browserului. Format recomandat: PNG sau ICO, 32x32px.</CardDescription>
				</div>
			</div>
		</CardHeader>
		<CardContent class="space-y-4">
			<div class="flex items-center gap-4">
				<div class="h-16 w-16 shrink-0 flex items-center justify-center rounded-lg border-2 border-dashed bg-muted/30 overflow-hidden">
					{#if faviconPreview}
						<img src={faviconPreview} alt="Favicon preview" class="h-10 w-10 object-contain" />
					{:else}
						<ImageIcon class="h-6 w-6 text-muted-foreground" />
					{/if}
				</div>
				<div class="flex flex-col gap-2">
					<div class="flex items-center gap-2">
						<Button
							variant="outline"
							size="sm"
							onclick={() => { document.getElementById('favicon-input')?.click(); }}
						>
							<UploadIcon class="h-3.5 w-3.5 mr-1.5" />
							{faviconPreview ? 'Schimbă' : 'Încarcă'}
						</Button>
						{#if faviconPreview}
							<Button variant="ghost" size="sm" onclick={removeFavicon}>
								<TrashIcon class="h-3.5 w-3.5 mr-1.5" />
								Șterge
							</Button>
						{/if}
					</div>
					<p class="text-xs text-muted-foreground">PNG, ICO, SVG, max 512KB</p>
				</div>
				<input
					id="favicon-input"
					type="file"
					accept="image/png,image/x-icon,image/svg+xml,image/ico,image/jpeg,image/gif,image/webp"
					class="hidden"
					onchange={handleFaviconSelect}
				/>
			</div>
			{#if faviconError}
				<div class="rounded-md bg-red-50 p-3">
					<p class="text-sm text-red-800">{faviconError}</p>
				</div>
			{/if}
			{#if favicon !== (data.tenant?.favicon || null)}
				<Button size="sm" onclick={handleFaviconSave} disabled={faviconSaving}>
					{faviconSaving ? 'Se salvează...' : 'Salvează Favicon'}
				</Button>
			{/if}
		</CardContent>
	</Card>

	<div class="grid grid-cols-1 md:grid-cols-2 gap-4">
		<Card class="cursor-pointer hover:bg-muted/30 transition-colors" onclick={() => goto(`/${tenantSlug}/contract-templates`)}>
			<CardHeader>
				<div class="flex items-center justify-between">
					<div class="flex items-center gap-3">
						<FileSignatureIcon class="h-5 w-5 text-muted-foreground" />
						<div>
							<CardTitle>Template-uri Contracte</CardTitle>
							<CardDescription>Gestioneaza template-urile de contract cu clauze legale predefinite</CardDescription>
						</div>
					</div>
					<ChevronRightIcon class="h-5 w-5 text-muted-foreground" />
				</div>
			</CardHeader>
		</Card>

		<Card>
			<CardHeader>
				<CardTitle>Prefix Numar Contract</CardTitle>
				<CardDescription>Prefixul folosit la generarea numerelor de contract (ex: CTR-0001)</CardDescription>
			</CardHeader>
			<CardContent>
				<div class="flex items-center gap-3">
					<Input
						bind:value={contractPrefix}
						type="text"
						placeholder="CTR"
						maxlength={10}
						class="max-w-[120px]"
					/>
					<span class="text-sm text-muted-foreground">-0001</span>
				</div>
			</CardContent>
		</Card>

		<Card class="md:col-span-2">
			<CardHeader>
				<div class="flex items-center justify-between">
					<div>
						<CardTitle>Curs Valutar BNR</CardTitle>
						<CardDescription>
							Cursul oficial BNR — actualizat zilnic de la bnr.ro
						</CardDescription>
					</div>
					<Button variant="outline" size="sm" onclick={handleRefreshBnr} disabled={refreshingBnr}>
						<RefreshCwIcon class="h-3.5 w-3.5 mr-1.5 {refreshingBnr ? 'animate-spin' : ''}" />
						{refreshingBnr ? 'Se actualizeaza...' : 'Actualizeaza'}
					</Button>
				</div>
			</CardHeader>
			<CardContent>
				{#if mainRates.length > 0}
					<div class="grid grid-cols-2 md:grid-cols-4 gap-3">
						{#each mainRates as rate}
							<div class="rounded-lg border p-3 text-center">
								<p class="text-xs text-muted-foreground">{rate.currency}/RON</p>
								<p class="text-lg font-mono font-semibold">{rate.rate.toFixed(4)}</p>
							</div>
						{/each}
					</div>
					{#if bnrDate}
						<p class="text-xs text-muted-foreground mt-2">Data curs: {bnrDate}</p>
					{/if}
				{:else}
					<p class="text-sm text-muted-foreground">Nu sunt cursuri disponibile. Apasa Actualizeaza.</p>
				{/if}
				{#if bnrError}
					<p class="text-sm text-red-600 mt-2">{bnrError}</p>
				{/if}
			</CardContent>
		</Card>

		<Card class="cursor-pointer hover:bg-muted/30 transition-colors" onclick={() => goto(`/${tenantSlug}/settings/gmail`)}>
			<CardHeader>
				<div class="flex items-center justify-between">
					<div class="flex items-center gap-3">
						<IconGmail class="h-5 w-5" />
						<div>
							<CardTitle>Gmail Integration</CardTitle>
							<CardDescription>
								{#if gmailStatus?.connected}
									Conectat ca {gmailStatus.email}
								{:else}
									Conecteaza contul Gmail pentru import facturi furnizori
								{/if}
							</CardDescription>
						</div>
					</div>
					<div class="flex items-center gap-2">
						{#if gmailStatus?.connected}
							<Badge variant="secondary" class="bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200">Conectat</Badge>
						{:else}
							<Badge variant="outline">Deconectat</Badge>
						{/if}
						<ChevronRightIcon class="h-5 w-5 text-muted-foreground" />
					</div>
				</div>
			</CardHeader>
		</Card>

		<Card class="cursor-pointer hover:bg-muted/30 transition-colors" onclick={() => goto(`/${tenantSlug}/settings/whmcs`)}>
			<CardHeader>
				<div class="flex items-center justify-between">
					<div class="flex items-center gap-3">
						<WebhookIcon class="h-5 w-5" />
						<div>
							<CardTitle>Integrare WHMCS</CardTitle>
							<CardDescription>
								{#if whmcsStatus?.connected && whmcsStatus.integration?.isActive}
									Activă — {whmcsStatus.integration.enableKeezPush ? 'push automat la Keez' : 'mod dry-run (fără push Keez)'}
								{:else if whmcsStatus?.connected}
									Configurată dar inactivă
								{:else}
									Sincronizează facturile hosting din WHMCS către CRM
								{/if}
							</CardDescription>
						</div>
					</div>
					<div class="flex items-center gap-2">
						{#if whmcsStatus?.connected && whmcsStatus.integration?.isActive && whmcsStatus.integration?.enableKeezPush}
							<Badge variant="secondary" class="bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200">Activă (live)</Badge>
						{:else if whmcsStatus?.connected && whmcsStatus.integration?.isActive}
							<Badge variant="secondary" class="bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200">Dry-run</Badge>
						{:else if whmcsStatus?.connected}
							<Badge variant="outline">Inactivă</Badge>
						{:else}
							<Badge variant="outline">Neconfigurată</Badge>
						{/if}
						<ChevronRightIcon class="h-5 w-5 text-muted-foreground" />
					</div>
				</div>
			</CardHeader>
		</Card>

		<Card class="cursor-pointer hover:bg-muted/30 transition-colors" onclick={() => goto(`/${tenantSlug}/settings/google-ads`)}>
			<CardHeader>
				<div class="flex items-center justify-between">
					<div class="flex items-center gap-3">
						<IconGoogleAds class="h-5 w-5" />
						<div>
							<CardTitle>Google Ads</CardTitle>
							<CardDescription>
								{#if googleAdsStatus?.connected}
									Conectat ca {googleAdsStatus.email}
								{:else}
									Conecteaza Google Ads pentru descarcarea automata a facturilor
								{/if}
							</CardDescription>
						</div>
					</div>
					<div class="flex items-center gap-2">
						{#if googleAdsStatus?.connected}
							<Badge variant="secondary" class="bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200">1 Conectat</Badge>
						{:else}
							<Badge variant="outline">Deconectat</Badge>
						{/if}
						<ChevronRightIcon class="h-5 w-5 text-muted-foreground" />
					</div>
				</div>
			</CardHeader>
		</Card>

		<Card class="cursor-pointer hover:bg-muted/30 transition-colors" onclick={() => goto(`/${tenantSlug}/settings/meta-ads`)}>
			<CardHeader>
				<div class="flex items-center justify-between">
					<div class="flex items-center gap-3">
						<IconFacebook class="h-5 w-5" />
						<div>
							<CardTitle>Meta Ads</CardTitle>
							<CardDescription>
								{#if metaAdsActiveCount > 0}
									{metaAdsActiveCount} Business Manager{metaAdsActiveCount > 1 ? '-uri' : ''} conectat{metaAdsActiveCount > 1 ? 'e' : ''}
								{:else}
									Conecteaza Meta/Facebook Ads pentru descarcarea automata a facturilor
								{/if}
							</CardDescription>
						</div>
					</div>
					<div class="flex items-center gap-2">
						{#if metaAdsActiveCount > 0}
							<Badge variant="secondary" class="bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200">{metaAdsActiveCount} Conectat{metaAdsActiveCount > 1 ? 'e' : ''}</Badge>
						{:else}
							<Badge variant="outline">Deconectat</Badge>
						{/if}
						<ChevronRightIcon class="h-5 w-5 text-muted-foreground" />
					</div>
				</div>
			</CardHeader>
		</Card>

		<Card class="cursor-pointer hover:bg-muted/30 transition-colors" onclick={() => goto(`/${tenantSlug}/settings/tiktok-ads`)}>
			<CardHeader>
				<div class="flex items-center justify-between">
					<div class="flex items-center gap-3">
						<IconTiktok class="h-5 w-5" />
						<div>
							<CardTitle>TikTok Ads</CardTitle>
							<CardDescription>
								{#if tiktokAdsActiveCount > 0}
									{tiktokAdsActiveCount} integrare{tiktokAdsActiveCount > 1 ? ' conectate' : ' conectată'}
								{:else}
									Conectează TikTok Ads pentru descărcarea automată a facturilor
								{/if}
							</CardDescription>
						</div>
					</div>
					<div class="flex items-center gap-2">
						{#if tiktokAdsActiveCount > 0}
							<Badge variant="secondary" class="bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200">{tiktokAdsActiveCount} Conectat{tiktokAdsActiveCount > 1 ? 'e' : ''}</Badge>
						{:else}
							<Badge variant="outline">Deconectat</Badge>
						{/if}
						<ChevronRightIcon class="h-5 w-5 text-muted-foreground" />
					</div>
				</div>
			</CardHeader>
		</Card>

		<Card class="cursor-pointer hover:bg-muted/30 transition-colors" onclick={() => goto(`/${tenantSlug}/whatsapp`)}>
			<CardHeader>
				<div class="flex items-center justify-between">
					<div class="flex items-center gap-3">
						<IconWhatsapp class="h-5 w-5" />
						<div>
							<CardTitle>WhatsApp</CardTitle>
							<CardDescription>
								{#if whatsappConnected && whatsappStatus?.phoneE164}
									Conectat cu {whatsappStatus.phoneE164}
								{:else if whatsappNeedsReauth}
									Reautentificare necesară — scanează QR din nou
								{:else}
									Conectează WhatsApp prin scan QR pentru discuții cu clienții
								{/if}
							</CardDescription>
						</div>
					</div>
					<div class="flex items-center gap-2">
						{#if whatsappConnected}
							<Badge variant="secondary" class="bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200">Conectat</Badge>
						{:else if whatsappNeedsReauth}
							<Badge variant="destructive">Re-auth</Badge>
						{:else}
							<Badge variant="outline">Deconectat</Badge>
						{/if}
						<ChevronRightIcon class="h-5 w-5 text-muted-foreground" />
					</div>
				</div>
			</CardHeader>
		</Card>
	</div>

	{#if data.tenantUser?.role === 'owner' || data.tenantUser?.role === 'admin'}
		<Collapsible bind:open={restrictionsOpen}>
			<Card>
				<CollapsibleTrigger class="w-full text-left cursor-pointer">
					<CardHeader>
						<div class="flex items-center justify-between">
							<div class="flex items-center gap-3">
								<ShieldAlertIcon class="h-5 w-5 text-muted-foreground" />
								<div>
									<CardTitle>Restricții Acces Client Portal</CardTitle>
									<CardDescription>Gestionați accesul clienților la portalul client. Clienții cu facturi restante sunt restricționați automat.</CardDescription>
								</div>
							</div>
							<div class="flex items-center gap-2">
								{#if clientsRestriction.length > 0}
									<Badge variant="outline">{clientsRestriction.length} clienți</Badge>
								{/if}
								<ChevronDownIcon class="h-5 w-5 text-muted-foreground transition-transform duration-200 {restrictionsOpen ? 'rotate-180' : ''}" />
							</div>
						</div>
					</CardHeader>
				</CollapsibleTrigger>
				<CollapsibleContent>
					<CardContent>
						{#if clientsRestriction.length === 0}
							<p class="text-sm text-muted-foreground">Nu există clienți.</p>
						{:else}
							<div class="relative mb-4">
								<SearchIcon class="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
								<Input
									bind:value={clientSearch}
									type="text"
									placeholder="Caută client..."
									class="pl-9"
								/>
							</div>
							{#if filteredClients.length === 0}
								<p class="text-sm text-muted-foreground text-center py-4">Niciun client găsit pentru „{clientSearch}"</p>
							{:else}
								<div class="space-y-2">
									{#each filteredClients as client (client.id)}
										<div class="flex items-center justify-between p-3 border rounded-lg">
											<div class="flex-1 min-w-0">
												<p class="font-medium truncate">{client.name}</p>
												<div class="flex items-center gap-2 mt-1">
													{#if client.hasOverdueInvoice}
														<Badge variant="destructive">Factură restantă</Badge>
													{/if}
													{#if client.restrictedAccess === 'forced'}
														<Badge variant="destructive">Restricționat manual</Badge>
													{:else if client.restrictedAccess === 'unrestricted'}
														<Badge variant="secondary">Deblocat manual</Badge>
													{:else}
														<Badge variant="outline">Automat</Badge>
													{/if}
												</div>
											</div>
											<Select type="single" value={client.restrictedAccess ?? 'auto'} onValueChange={(val) => handleSetRestriction(client.id, val)}>
												<SelectTrigger class="w-[160px]">
													{#if client.restrictedAccess === 'forced'}
														Restricționat
													{:else if client.restrictedAccess === 'unrestricted'}
														Deblocat
													{:else}
														Automat
													{/if}
												</SelectTrigger>
												<SelectContent>
													<SelectItem value="auto">Automat</SelectItem>
													<SelectItem value="forced">Restricționat</SelectItem>
													<SelectItem value="unrestricted">Deblocat</SelectItem>
												</SelectContent>
											</Select>
										</div>
									{/each}
								</div>
							{/if}
						{/if}
					</CardContent>
				</CollapsibleContent>
			</Card>
		</Collapsible>

		<Collapsible bind:open={invitationsOpen}>
			<Card>
				<CollapsibleTrigger class="w-full text-left cursor-pointer">
					<CardHeader>
						<div class="flex items-center justify-between">
							<div class="flex items-center gap-3">
								<UsersIcon class="h-5 w-5 text-muted-foreground" />
								<div>
									<CardTitle>Team Invitations</CardTitle>
									<CardDescription>Invite users to join your organization</CardDescription>
								</div>
							</div>
							<div class="flex items-center gap-2">
								{#if invitations.length > 0}
									<Badge variant="outline">{invitations.length} invitații</Badge>
								{/if}
								<ChevronDownIcon class="h-5 w-5 text-muted-foreground transition-transform duration-200 {invitationsOpen ? 'rotate-180' : ''}" />
							</div>
						</div>
					</CardHeader>
				</CollapsibleTrigger>
				<CollapsibleContent>
					<CardContent class="space-y-6">
						<!-- Send Invitation Form -->
						<div class="space-y-4">
							<h3 class="text-lg font-semibold">Send Invitation</h3>
							<form
								onsubmit={(e) => {
									e.preventDefault();
									handleSendInvitation();
								}}
								class="space-y-4"
							>
								<div class="grid grid-cols-1 md:grid-cols-3 gap-4">
									<div class="md:col-span-2 space-y-2">
										<Label for="invitationEmail">Email Address</Label>
										<Input
											id="invitationEmail"
											type="email"
											bind:value={invitationEmail}
											placeholder="user@example.com"
											required
										/>
									</div>
									<div class="space-y-2">
										<Label for="invitationRole">Role</Label>
										<Select type="single" bind:value={invitationRole}>
											<SelectTrigger id="invitationRole">
												{invitationRole === 'admin' ? 'Admin' : 'Member'}
											</SelectTrigger>
											<SelectContent>
												<SelectItem value="member">Member</SelectItem>
												<SelectItem value="admin">Admin</SelectItem>
											</SelectContent>
										</Select>
									</div>
								</div>

								{#if invitationError}
									<div class="rounded-md bg-red-50 p-3">
										<p class="text-sm text-red-800">{invitationError}</p>
									</div>
								{/if}

								{#if invitationSuccess}
									<div class="rounded-md bg-green-50 p-3">
										<p class="text-sm text-green-800">Invitation sent successfully!</p>
									</div>
								{/if}

								<Button type="submit" disabled={sendingInvitation}>
									{sendingInvitation ? 'Sending...' : 'Send Invitation'}
								</Button>
							</form>
						</div>

						<Separator />

						<!-- Invitations List -->
						<div class="space-y-4">
							<h3 class="text-lg font-semibold">Pending Invitations</h3>
							{#if loadingInvitations}
								<p class="text-sm text-muted-foreground">Loading invitations...</p>
							{:else if invitations.length === 0}
								<p class="text-sm text-muted-foreground">No invitations sent yet.</p>
							{:else}
								<div class="relative mb-4">
									<SearchIcon class="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
									<Input
										bind:value={invitationSearch}
										type="text"
										placeholder="Caută invitație după email..."
										class="pl-9"
									/>
								</div>
								{#if filteredInvitations.length === 0}
									<p class="text-sm text-muted-foreground text-center py-4">Nicio invitație găsită pentru „{invitationSearch}"</p>
								{:else}
									<div class="space-y-2">
										{#each filteredInvitations as invitation (invitation.id)}
											<div
												class="flex items-center justify-between p-4 border rounded-lg hover:bg-gray-50 dark:hover:bg-gray-900"
											>
												<div class="flex-1">
													<div class="flex items-center gap-2">
														<p class="font-medium">{invitation.email}</p>
														<Badge variant={getStatusBadgeVariant(invitation.status)}>
															{invitation.status}
														</Badge>
													</div>
													<div class="mt-1 text-sm text-muted-foreground">
														<p>
															Role: <span class="capitalize">{invitation.role}</span> • Invited by{' '}
															{invitation.invitedBy
																? `${invitation.invitedBy.firstName} ${invitation.invitedBy.lastName}`.trim() ||
																  invitation.invitedBy.email
																: 'Unknown'}{' '}
															•{' '}
															{formatDate(invitation.createdAt)}
														</p>
														{#if invitation.status === 'pending'}
															<p class="text-xs">
																Expires: {formatDate(invitation.expiresAt)}
															</p>
														{/if}
													</div>
												</div>
												{#if invitation.status === 'pending'}
													<Button
														variant="ghost"
														size="sm"
														onclick={() => handleCancelInvitation(invitation.id)}
													>
														<X class="h-4 w-4" />
													</Button>
												{/if}
											</div>
										{/each}
									</div>
								{/if}
							{/if}
						</div>
					</CardContent>
				</CollapsibleContent>
			</Card>
		</Collapsible>
	{/if}
</div>
