<script lang="ts">
	import {
		getClient,
		updateClient,
		getClients,
		getClientPartnerInfo,
		setClientPartnerStatus
	} from '$lib/remotes/clients.remote';
	import {
		getClientWebsites,
		createClientWebsite,
		updateClientWebsite,
		deleteClientWebsite,
		setDefaultClientWebsite
	} from '$lib/remotes/client-websites.remote';
	import {
		getClientSecondaryEmails,
		createClientSecondaryEmail,
		deleteClientSecondaryEmail,
		updateClientSecondaryEmailNotifications
	} from '$lib/remotes/client-secondary-emails.remote';
	import { getCompanyData } from '$lib/remotes/anaf.remote';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '$lib/components/ui/card';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import { Separator } from '$lib/components/ui/separator';
	import { Textarea } from '$lib/components/ui/textarea';
	import { Switch } from '$lib/components/ui/switch';
	import { Badge } from '$lib/components/ui/badge';
	import { toast } from 'svelte-sonner';
	import { untrack } from 'svelte';
	import StarIcon from '@lucide/svelte/icons/star';
	import PlusIcon from '@lucide/svelte/icons/plus';
	import TrashIcon from '@lucide/svelte/icons/trash-2';
	import EditIcon from '@lucide/svelte/icons/edit';
	import CheckIcon from '@lucide/svelte/icons/check';
	import XIcon from '@lucide/svelte/icons/x';
	import GlobeIcon from '@lucide/svelte/icons/globe';
	import RefreshCwIcon from '@lucide/svelte/icons/refresh-cw';
	import { getFaviconUrl } from '$lib/utils';

	const tenantSlug = $derived(page.params.tenant);
	const clientId = $derived(page.params.clientId);

	const clientQuery = getClient(clientId);
	const client = $derived(clientQuery.current);
	const loading = $derived(clientQuery.loading);

	const partnerInfoQuery = $derived(getClientPartnerInfo(clientId));
	const partnerInfo = $derived(partnerInfoQuery.current);

	// Websites
	const websitesQuery = $derived(getClientWebsites(clientId));
	const websites = $derived(websitesQuery?.current || []);

	// Website add form
	let newWebsiteName = $state('');
	let newWebsiteUrl = $state('');
	let showAddWebsite = $state(false);
	let addingWebsite = $state(false);
	let addWebsiteError = $state<string | null>(null);

	// Website inline edit
	let editingWebsiteId = $state<string | null>(null);
	let editWebsiteName = $state('');
	let editWebsiteUrl = $state('');
	let savingWebsite = $state(false);

	// Favicon refresh keys: websiteId → counter (forces img re-creation)
	let faviconKeys = $state<Record<string, number>>({});

	function handleRefreshLogo(websiteId: string) {
		faviconKeys = { ...faviconKeys, [websiteId]: (faviconKeys[websiteId] ?? 0) + 1 };
	}

	// Secondary emails
	const secondaryEmailsQuery = $derived(getClientSecondaryEmails(clientId));
	const secondaryEmails = $derived(secondaryEmailsQuery?.current || []);
	let newSecondaryEmail = $state('');
	let newSecondaryLabel = $state('');
	let showAddSecondaryEmail = $state(false);
	let addingSecondaryEmail = $state(false);
	let addSecondaryEmailError = $state<string | null>(null);

	async function handleAddSecondaryEmail() {
		if (!newSecondaryEmail.trim()) {
			addSecondaryEmailError = 'Emailul este obligatoriu';
			return;
		}
		addingSecondaryEmail = true;
		addSecondaryEmailError = null;
		try {
			await createClientSecondaryEmail({
				clientId,
				email: newSecondaryEmail.trim(),
				label: newSecondaryLabel.trim() || undefined
			}).updates(secondaryEmailsQuery);
			newSecondaryEmail = '';
			newSecondaryLabel = '';
			showAddSecondaryEmail = false;
			toast.success('Email secundar adăugat');
		} catch (e) {
			addSecondaryEmailError = e instanceof Error ? e.message : 'Eroare la adăugare';
		} finally {
			addingSecondaryEmail = false;
		}
	}

	async function handleDeleteSecondaryEmail(id: string) {
		if (!confirm('Sigur vrei să ștergi acest email secundar?')) return;
		try {
			await deleteClientSecondaryEmail({ secondaryEmailId: id }).updates(secondaryEmailsQuery);
			toast.success('Email secundar șters');
		} catch (e) {
			toast.error(e instanceof Error ? e.message : 'Eroare la ștergere');
		}
	}

	async function handleToggleNotification(
		secondaryEmailId: string,
		field: 'notifyInvoices' | 'notifyTasks' | 'notifyContracts',
		value: boolean
	) {
		const se = secondaryEmails.find((s: any) => s.id === secondaryEmailId);
		if (!se) return;
		try {
			await updateClientSecondaryEmailNotifications({
				secondaryEmailId,
				notifyInvoices: field === 'notifyInvoices' ? value : (se.notifyInvoices ?? false),
				notifyTasks: field === 'notifyTasks' ? value : (se.notifyTasks ?? false),
				notifyContracts: field === 'notifyContracts' ? value : (se.notifyContracts ?? false)
			}).updates(secondaryEmailsQuery);
		} catch (e) {
			toast.error(e instanceof Error ? e.message : 'Eroare la actualizare notificări');
		}
	}

	let name = $state('');
	let businessName = $state('');
	let email = $state('');
	let phone = $state('');
	let saving = $state(false);
	let loadingAnaf = $state(false);
	let error = $state<string | null>(null);

	let isPartner = $state(false);

	// Romanian legal data
	let companyType = $state('');
	let cui = $state('');
	let registrationNumber = $state('');
	let tradeRegister = $state('');
	let vatNumber = $state('');
	let legalRepresentative = $state('');
	let iban = $state('');
	let bankName = $state('');
	let address = $state('');
	let city = $state('');
	let county = $state('');
	let postalCode = $state('');
	let country = $state('România');
	let notes = $state('');

	$effect(() => {
		if (client) {
			name = client.name || '';
			businessName = client.businessName || '';
			email = client.email || '';
			phone = client.phone || '';
			companyType = client.companyType || '';
			cui = client.cui || '';
			registrationNumber = client.registrationNumber || '';
			tradeRegister = client.tradeRegister || '';
			vatNumber = client.vatNumber || '';
			legalRepresentative = client.legalRepresentative || '';
			iban = client.iban || '';
			bankName = client.bankName || '';
			address = client.address || '';
			city = client.city || '';
			county = client.county || '';
			postalCode = client.postalCode || '';
			country = client.country || 'România';
			notes = client.notes || '';
		}
	});

	$effect(() => {
		if (partnerInfo) {
			untrack(() => {
			isPartner = partnerInfo.isPartner;
			});
		}
	});

	function normalizeUrl(url: string): string {
		const u = url.trim();
		if (!u) return '';
		if (u.startsWith('http://') || u.startsWith('https://')) return u;
		return `https://${u}`;
	}

	async function handleAddWebsite() {
		if (!newWebsiteUrl.trim()) {
			addWebsiteError = 'URL-ul este obligatoriu';
			return;
		}
		addingWebsite = true;
		addWebsiteError = null;
		try {
			await createClientWebsite({
				clientId,
				name: newWebsiteName.trim() || undefined,
				url: normalizeUrl(newWebsiteUrl)
			}).updates(websitesQuery, clientQuery, getClients());
			newWebsiteName = '';
			newWebsiteUrl = '';
			showAddWebsite = false;
			toast.success('Website adăugat');
		} catch (e) {
			addWebsiteError = e instanceof Error ? e.message : 'Eroare la adăugare';
		} finally {
			addingWebsite = false;
		}
	}

	function startEditWebsite(w: (typeof websites)[0]) {
		editingWebsiteId = w.id;
		editWebsiteName = w.name || '';
		editWebsiteUrl = w.url;
	}

	function cancelEditWebsite() {
		editingWebsiteId = null;
		editWebsiteName = '';
		editWebsiteUrl = '';
	}

	async function handleSaveWebsite(id: string) {
		if (!editWebsiteUrl.trim()) return;
		savingWebsite = true;
		try {
			await updateClientWebsite({
				websiteId: id,
				name: editWebsiteName.trim() || undefined,
				url: normalizeUrl(editWebsiteUrl)
			}).updates(websitesQuery, clientQuery, getClients());
			cancelEditWebsite();
			toast.success('Website actualizat');
		} catch (e) {
			toast.error(e instanceof Error ? e.message : 'Eroare la salvare');
		} finally {
			savingWebsite = false;
		}
	}

	async function handleSetDefault(id: string) {
		try {
			await setDefaultClientWebsite({ websiteId: id })
				.updates(websitesQuery, clientQuery, getClients());
			toast.success('Website implicit setat');
		} catch (e) {
			toast.error(e instanceof Error ? e.message : 'Eroare');
		}
	}

	async function handleDeleteWebsite(id: string) {
		if (!confirm('Sigur vrei să ștergi acest website?')) return;
		try {
			await deleteClientWebsite({ websiteId: id })
				.updates(websitesQuery, clientQuery, getClients());
			toast.success('Website șters');
		} catch (e) {
			toast.error(e instanceof Error ? e.message : 'Eroare la ștergere');
		}
	}

	async function handleAnafLookup() {
		if (!cui) {
			error = 'Please enter a CUI first';
			return;
		}

		loadingAnaf = true;
		error = null;

		try {
			const data = await getCompanyData(cui);
			businessName = data.denumire || businessName;
			if (!name) name = data.denumire || name;
			registrationNumber = data.nrRegCom || registrationNumber;
			iban = data.iban || iban;
			companyType = data.forma_juridica || companyType;
			phone = data.telefon || phone;

			if (data.adresa_sediu_social) {
				const addr = data.adresa_sediu_social;
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

	async function handleSubmit() {
		if (!clientId) return;

		saving = true;
		error = null;

		try {
			// Sync client.website with the default website URL
			const defaultWebsite = websites.find((w) => w.isDefault);

			await updateClient({
				clientId,
				name: name || businessName,
				businessName: businessName || undefined,
				email: email || undefined,
				phone: phone || undefined,
				website: defaultWebsite?.url || undefined,
				companyType: companyType || undefined,
				cui: cui || undefined,
				registrationNumber: registrationNumber || undefined,
				tradeRegister: tradeRegister || undefined,
				vatNumber: vatNumber || undefined,
				legalRepresentative: legalRepresentative || undefined,
				iban: iban || undefined,
				bankName: bankName || undefined,
				address: address || undefined,
				city: city || undefined,
				county: county || undefined,
				postalCode: postalCode || undefined,
				country: country || undefined,
				notes: notes || undefined
			}).updates(clientQuery, getClient(clientId), getClients());

			await setClientPartnerStatus({
				clientId,
				isPartner
			});

			goto(`/${tenantSlug}/clients/${clientId}`);
		} catch (e) {
			error = e instanceof Error ? e.message : 'Failed to update client';
		} finally {
			saving = false;
		}
	}
</script>

<svelte:head>
	<title>Edit Client - CRM</title>
</svelte:head>

<div class="space-y-6">
	{#if loading}
		<p>Loading client...</p>
	{:else if client}
		<h1 class="text-3xl font-bold">Edit Client</h1>

		<Card>
			<CardHeader>
				<CardTitle>Client Information</CardTitle>
				<CardDescription>Update client details</CardDescription>
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
						<h3 class="text-lg font-semibold">Basic Information</h3>
						<div class="space-y-2">
							<Label for="businessName">Organization Name *</Label>
							<Input id="businessName" bind:value={businessName} type="text" required placeholder="Ex: Meduza Agency S.R.L." />
						</div>
						<div class="space-y-2">
							<Label for="name">Display name (alias)</Label>
							<Input id="name" bind:value={name} type="text" placeholder="Ex: Meduza Agency" />
						</div>
						<div class="grid grid-cols-2 gap-4">
							<div class="space-y-2">
								<Label for="email">Email</Label>
								<Input id="email" bind:value={email} type="email" />
							</div>
							<div class="space-y-2">
								<Label for="phone">Phone</Label>
								<Input id="phone" bind:value={phone} type="tel" />
							</div>
						</div>

						<!-- Emailuri Secundare -->
						<div class="space-y-2">
							<div class="flex items-center justify-between">
								<Label>Emailuri Secundare (acces portal)</Label>
								{#if !showAddSecondaryEmail}
									<Button type="button" variant="outline" size="sm" onclick={() => { showAddSecondaryEmail = true; }}>
										<PlusIcon class="h-3.5 w-3.5 mr-1" />
										Adaugă
									</Button>
								{/if}
							</div>

							{#if secondaryEmails.length > 0}
								<div class="space-y-2">
									{#each secondaryEmails as se (se.id)}
										<div class="rounded-lg border bg-card px-3 py-2.5 group hover:bg-muted/30 transition-colors">
											<div class="flex items-center gap-2">
												<div class="flex-1 min-w-0">
													<p class="text-sm font-medium">{se.email}</p>
													{#if se.label}
														<p class="text-xs text-muted-foreground">{se.label}</p>
													{/if}
												</div>
												<Button
													type="button"
													variant="ghost"
													size="sm"
													class="h-7 w-7 p-0 text-destructive hover:text-destructive opacity-0 group-hover:opacity-100 transition-opacity"
													onclick={() => handleDeleteSecondaryEmail(se.id)}
												>
													<TrashIcon class="h-3.5 w-3.5" />
												</Button>
											</div>
											<div class="flex items-center gap-1.5 mt-2">
												<span class="text-[10px] text-muted-foreground mr-0.5">Notificări:</span>
												<button
													type="button"
													class="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium border transition-all cursor-pointer {se.notifyInvoices ? 'bg-primary text-primary-foreground border-primary' : 'bg-transparent text-muted-foreground border-muted-foreground/30 hover:border-muted-foreground/50'}"
													onclick={() => handleToggleNotification(se.id, 'notifyInvoices', !se.notifyInvoices)}
												>
													{#if se.notifyInvoices}<CheckIcon class="h-3 w-3" />{/if}
													Facturi
												</button>
												<button
													type="button"
													class="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium border transition-all cursor-pointer {se.notifyTasks ? 'bg-primary text-primary-foreground border-primary' : 'bg-transparent text-muted-foreground border-muted-foreground/30 hover:border-muted-foreground/50'}"
													onclick={() => handleToggleNotification(se.id, 'notifyTasks', !se.notifyTasks)}
												>
													{#if se.notifyTasks}<CheckIcon class="h-3 w-3" />{/if}
													Taskuri
												</button>
												<button
													type="button"
													class="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium border transition-all cursor-pointer {se.notifyContracts ? 'bg-primary text-primary-foreground border-primary' : 'bg-transparent text-muted-foreground border-muted-foreground/30 hover:border-muted-foreground/50'}"
													onclick={() => handleToggleNotification(se.id, 'notifyContracts', !se.notifyContracts)}
												>
													{#if se.notifyContracts}<CheckIcon class="h-3 w-3" />{/if}
													Contracte
												</button>
											</div>
										</div>
									{/each}
								</div>
							{/if}

							{#if showAddSecondaryEmail}
								<div class="rounded-lg border border-dashed border-primary/40 bg-muted/20 p-3 space-y-2">
									<p class="text-xs font-medium text-muted-foreground">Email secundar nou</p>
									<div class="grid grid-cols-2 gap-2">
										<div class="space-y-1">
											<p class="text-xs text-muted-foreground">Email *</p>
											<Input
												bind:value={newSecondaryEmail}
												type="email"
												placeholder="contact@firma.ro"
												class="h-8 text-sm"
												onkeydown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleAddSecondaryEmail(); } }}
											/>
										</div>
										<div class="space-y-1">
											<p class="text-xs text-muted-foreground">Etichetă (opțional)</p>
											<Input
												bind:value={newSecondaryLabel}
												placeholder="ex: Contabilitate"
												class="h-8 text-sm"
											/>
										</div>
									</div>
									{#if addSecondaryEmailError}
										<p class="text-xs text-destructive">{addSecondaryEmailError}</p>
									{/if}
									<div class="flex justify-end gap-2">
										<Button type="button" variant="ghost" size="sm" onclick={() => { showAddSecondaryEmail = false; addSecondaryEmailError = null; newSecondaryEmail = ''; newSecondaryLabel = ''; }} disabled={addingSecondaryEmail}>
											<XIcon class="h-3.5 w-3.5 mr-1" />
											Anulare
										</Button>
										<Button type="button" size="sm" onclick={handleAddSecondaryEmail} disabled={addingSecondaryEmail || !newSecondaryEmail.trim()}>
											<PlusIcon class="h-3.5 w-3.5 mr-1" />
											{addingSecondaryEmail ? 'Se adaugă...' : 'Adaugă'}
										</Button>
									</div>
								</div>
							{/if}

							<p class="text-xs text-muted-foreground">
								Emailul principal primește toate notificările. Bifați categoriile dorite pentru emailurile secundare.
							</p>
						</div>

						<!-- Website-uri -->
						<div class="space-y-2">
							<div class="flex items-center justify-between">
								<Label>Website-uri</Label>
								{#if !showAddWebsite}
									<Button type="button" variant="outline" size="sm" onclick={() => { showAddWebsite = true; }}>
										<PlusIcon class="h-3.5 w-3.5 mr-1" />
										Adaugă
									</Button>
								{/if}
							</div>

							{#if websites.length === 0 && !showAddWebsite}
								<div class="rounded-lg border border-dashed border-border p-4 text-center">
									<GlobeIcon class="h-8 w-8 mx-auto mb-2 text-muted-foreground/40" />
									<p class="text-sm text-muted-foreground">Niciun website adăugat</p>
									<Button type="button" variant="ghost" size="sm" class="mt-1" onclick={() => { showAddWebsite = true; }}>
										<PlusIcon class="h-3.5 w-3.5 mr-1" />
										Adaugă primul website
									</Button>
								</div>
							{:else}
								<div class="space-y-2">
									{#each websites as w (w.id)}
										{#if editingWebsiteId === w.id}
											<!-- Inline edit -->
											<div class="rounded-lg border border-primary/30 bg-muted/30 p-3 space-y-2">
												<div class="grid grid-cols-2 gap-2">
													<div class="space-y-1">
														<p class="text-xs text-muted-foreground">Nume (opțional)</p>
														<Input
															bind:value={editWebsiteName}
															placeholder="ex: Site principal, Blog..."
															class="h-8 text-sm"
														/>
													</div>
													<div class="space-y-1">
														<p class="text-xs text-muted-foreground">URL *</p>
														<Input
															bind:value={editWebsiteUrl}
															placeholder="https://..."
															class="h-8 text-sm font-mono"
														/>
													</div>
												</div>
												<div class="flex justify-end gap-2">
													<Button type="button" variant="ghost" size="sm" onclick={cancelEditWebsite} disabled={savingWebsite}>
														<XIcon class="h-3.5 w-3.5" />
													</Button>
													<Button type="button" size="sm" onclick={() => handleSaveWebsite(w.id)} disabled={savingWebsite || !editWebsiteUrl.trim()}>
														<CheckIcon class="h-3.5 w-3.5 mr-1" />
														{savingWebsite ? 'Se salvează...' : 'Salvează'}
													</Button>
												</div>
											</div>
										{:else}
											<!-- Website row -->
											<div class="flex items-center gap-2 rounded-lg border bg-card px-3 py-2.5 group hover:bg-muted/30 transition-colors">
												<!-- Star default -->
												<button
													type="button"
													onclick={() => handleSetDefault(w.id)}
													class="shrink-0 transition-colors {w.isDefault ? 'text-yellow-500' : 'text-muted-foreground/30 hover:text-yellow-400'}"
													title={w.isDefault ? 'Website implicit' : 'Setează ca implicit'}
												>
													<StarIcon class="h-4 w-4 {w.isDefault ? 'fill-yellow-500' : ''}" />
												</button>

												<!-- Favicon -->
												{#key (faviconKeys[w.id] ?? 0)}
													<img
														src={getFaviconUrl(w.url) + (faviconKeys[w.id] ? '&t=' + faviconKeys[w.id] : '')}
														alt=""
														class="h-5 w-5 shrink-0 rounded-sm object-contain bg-muted/40"
														loading="lazy"
														onerror={(e) => (e.currentTarget.style.display = 'none')}
													/>
												{/key}

											<!-- Info -->
												<div class="flex-1 min-w-0">
													<div class="flex items-center gap-2">
														{#if w.name}
															<span class="text-sm font-medium text-foreground truncate">{w.name}</span>
														{/if}
														{#if w.isDefault}
															<Badge variant="outline" class="text-[10px] h-4 px-1.5 border-yellow-400/60 text-yellow-600 dark:text-yellow-400 shrink-0">
																implicit
															</Badge>
														{/if}
													</div>
													<a
														href={w.url.startsWith('http') ? w.url : `https://${w.url}`}
														target="_blank"
														rel="noopener noreferrer"
														class="text-xs text-muted-foreground hover:text-primary hover:underline truncate block font-mono"
														onclick={(e) => e.stopPropagation()}
													>
														{w.url.replace(/^https?:\/\//, '').replace(/\/$/, '')}
													</a>
												</div>

												<!-- Actions (visible on hover) -->
												<div class="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
													<Button
														type="button"
														variant="ghost"
														size="sm"
														class="h-7 w-7 p-0"
														title="Reîmprospătează logo"
														onclick={() => handleRefreshLogo(w.id)}
													>
														<RefreshCwIcon class="h-3.5 w-3.5" />
													</Button>
													<Button
														type="button"
														variant="ghost"
														size="sm"
														class="h-7 w-7 p-0"
														onclick={() => startEditWebsite(w)}
													>
														<EditIcon class="h-3.5 w-3.5" />
													</Button>
													<Button
														type="button"
														variant="ghost"
														size="sm"
														class="h-7 w-7 p-0 text-destructive hover:text-destructive"
														onclick={() => handleDeleteWebsite(w.id)}
													>
														<TrashIcon class="h-3.5 w-3.5" />
													</Button>
												</div>
											</div>
										{/if}
									{/each}
								</div>
							{/if}

							<!-- Add website form -->
							{#if showAddWebsite}
								<div class="rounded-lg border border-dashed border-primary/40 bg-muted/20 p-3 space-y-2">
									<p class="text-xs font-medium text-muted-foreground">Website nou</p>
									<div class="grid grid-cols-2 gap-2">
										<div class="space-y-1">
											<p class="text-xs text-muted-foreground">Nume (opțional)</p>
											<Input
												bind:value={newWebsiteName}
												placeholder="ex: Site principal, Blog..."
												class="h-8 text-sm"
											/>
										</div>
										<div class="space-y-1">
											<p class="text-xs text-muted-foreground">URL *</p>
											<Input
												bind:value={newWebsiteUrl}
												placeholder="https://..."
												class="h-8 text-sm font-mono"
												onkeydown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleAddWebsite(); } }}
											/>
										</div>
									</div>
									{#if addWebsiteError}
										<p class="text-xs text-destructive">{addWebsiteError}</p>
									{/if}
									<div class="flex justify-end gap-2">
										<Button type="button" variant="ghost" size="sm" onclick={() => { showAddWebsite = false; addWebsiteError = null; newWebsiteName = ''; newWebsiteUrl = ''; }} disabled={addingWebsite}>
											<XIcon class="h-3.5 w-3.5 mr-1" />
											Anulare
										</Button>
										<Button type="button" size="sm" onclick={handleAddWebsite} disabled={addingWebsite || !newWebsiteUrl.trim()}>
											<PlusIcon class="h-3.5 w-3.5 mr-1" />
											{addingWebsite ? 'Se adaugă...' : 'Adaugă'}
										</Button>
									</div>
								</div>
							{/if}

							<p class="text-xs text-muted-foreground">
								⭐ Website-ul implicit este folosit pentru extragerea URL țintă din linkurile SEO
							</p>
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
								<Label for="iban">IBAN</Label>
								<Input id="iban" bind:value={iban} type="text" />
							</div>
							<div class="space-y-2">
								<Label for="bankName">Bank Name</Label>
								<Input id="bankName" bind:value={bankName} type="text" />
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

						<div class="flex items-center justify-between pt-2">
							<div class="space-y-0.5">
								<Label for="isPartner">Partner</Label>
								<p class="text-xs text-muted-foreground">
									{#if partnerInfo?.canBePartner}
										Share this client with tenant {partnerInfo.partnerTenantName}
									{:else}
										Set VAT number to match another tenant to enable partner sharing.
									{/if}
								</p>
							</div>
							<Switch
								id="isPartner"
								bind:checked={isPartner}
								disabled={!partnerInfo?.canBePartner}
							/>
						</div>
					</div>

					<Separator />

					<div class="space-y-2">
						<Label for="notes">Notes</Label>
						<Textarea id="notes" bind:value={notes} />
					</div>

					{#if error}
						<div class="rounded-md bg-red-50 p-3">
							<p class="text-sm text-red-800">{error}</p>
						</div>
					{/if}

					<div class="flex items-center justify-end gap-4">
						<Button type="button" variant="outline" onclick={() => goto(`/${tenantSlug}/clients/${clientId}`)}>
							Cancel
						</Button>
						<Button type="submit" disabled={saving}>
							{saving ? 'Saving...' : 'Save Changes'}
						</Button>
					</div>
				</form>
			</CardContent>
		</Card>
	{/if}
</div>
