<script lang="ts">
	import { getClientUserPreferences, updateClientUserPreferences } from '$lib/remotes/client-user-preferences.remote';
	import { updateClientCompanyData } from '$lib/remotes/clients.remote';
	import { updateClientUserProfile } from '$lib/remotes/client-profile.remote';
	import { page } from '$app/state';
	import { invalidateAll } from '$app/navigation';
	import { toast } from 'svelte-sonner';
	import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '$lib/components/ui/card';
	import { Button } from '$lib/components/ui/button';
	import { Label } from '$lib/components/ui/label';
	import { Input } from '$lib/components/ui/input';
	import { Switch } from '$lib/components/ui/switch';
	import { Separator } from '$lib/components/ui/separator';
	import * as Select from '$lib/components/ui/select';
	import SettingsIcon from '@lucide/svelte/icons/settings';
	import BellIcon from '@lucide/svelte/icons/bell';
	import EyeIcon from '@lucide/svelte/icons/eye';
	import ListTodoIcon from '@lucide/svelte/icons/list-todo';
	import Building2Icon from '@lucide/svelte/icons/building-2';
	import UserIcon from '@lucide/svelte/icons/user';
	import PencilIcon from '@lucide/svelte/icons/pencil';

	const client = $derived((page.data as any)?.client);
	const userData = $derived((page.data as any)?.user);

	const prefsQuery = getClientUserPreferences();
	const prefs = $derived(prefsQuery.current);
	const loading = $derived(prefsQuery.loading);

	// Notification toggles
	let notifyTaskStatusChange = $state(true);
	let notifyNewComment = $state(true);
	let notifyApproachingDeadline = $state(true);
	let notifyTaskAssigned = $state(true);
	let notifyTaskApprovedRejected = $state(true);

	// Visual preferences
	let defaultTaskView = $state('card');
	let defaultTaskSort = $state('date');
	let itemsPerPage = $state(25);

	// Task creation defaults
	let defaultPriority = $state('medium');

	let savingNotifications = $state(false);
	let savingVisual = $state(false);
	let savingDefaults = $state(false);

	// Company edit mode
	let editingCompany = $state(false);
	let savingCompany = $state(false);
	let companyForm = $state({
		businessName: '',
		name: '',
		email: '',
		phone: '',
		companyType: '',
		cui: '',
		registrationNumber: '',
		tradeRegister: '',
		vatNumber: '',
		legalRepresentative: '',
		iban: '',
		bankName: '',
		address: '',
		city: '',
		county: '',
		postalCode: '',
		country: ''
	});

	// Profile edit mode
	let editingProfile = $state(false);
	let savingProfile = $state(false);
	let profileForm = $state({ firstName: '', lastName: '' });

	// Sync local state from query
	$effect(() => {
		if (prefs) {
			notifyTaskStatusChange = prefs.notifyTaskStatusChange ?? true;
			notifyNewComment = prefs.notifyNewComment ?? true;
			notifyApproachingDeadline = prefs.notifyApproachingDeadline ?? true;
			notifyTaskAssigned = prefs.notifyTaskAssigned ?? true;
			notifyTaskApprovedRejected = prefs.notifyTaskApprovedRejected ?? true;
			defaultTaskView = prefs.defaultTaskView ?? 'card';
			defaultTaskSort = prefs.defaultTaskSort ?? 'date';
			itemsPerPage = prefs.itemsPerPage ?? 25;
			defaultPriority = prefs.defaultPriority ?? 'medium';
		}
	});

	function populateCompanyForm() {
		if (!client) return;
		companyForm = {
			businessName: client.businessName || '',
			name: client.name || '',
			email: client.email || '',
			phone: client.phone || '',
			companyType: client.companyType || '',
			cui: client.cui || '',
			registrationNumber: client.registrationNumber || '',
			tradeRegister: client.tradeRegister || '',
			vatNumber: client.vatNumber || '',
			legalRepresentative: client.legalRepresentative || '',
			iban: client.iban || '',
			bankName: client.bankName || '',
			address: client.address || '',
			city: client.city || '',
			county: client.county || '',
			postalCode: client.postalCode || '',
			country: client.country || ''
		};
	}

	function startEditCompany() {
		populateCompanyForm();
		editingCompany = true;
	}

	function cancelEditCompany() {
		editingCompany = false;
	}

	async function saveCompany() {
		savingCompany = true;
		try {
			await updateClientCompanyData(companyForm);
			await invalidateAll();
			toast.success('Datele companiei au fost salvate.');
			editingCompany = false;
		} catch (e) {
			toast.error(e instanceof Error ? e.message : 'Eroare la salvare.');
		} finally {
			savingCompany = false;
		}
	}

	function startEditProfile() {
		if (!userData) return;
		profileForm = {
			firstName: userData.firstName || '',
			lastName: userData.lastName || ''
		};
		editingProfile = true;
	}

	function cancelEditProfile() {
		editingProfile = false;
	}

	async function saveProfile() {
		savingProfile = true;
		try {
			await updateClientUserProfile(profileForm);
			await invalidateAll();
			toast.success('Datele contului au fost salvate.');
			editingProfile = false;
		} catch (e) {
			toast.error(e instanceof Error ? e.message : 'Eroare la salvare.');
		} finally {
			savingProfile = false;
		}
	}

	async function saveNotifications() {
		savingNotifications = true;
		try {
			await updateClientUserPreferences({
				notifyTaskStatusChange,
				notifyNewComment,
				notifyApproachingDeadline,
				notifyTaskAssigned,
				notifyTaskApprovedRejected
			}).updates(prefsQuery);
			toast.success('Notificările au fost salvate.');
		} catch (e) {
			toast.error(e instanceof Error ? e.message : 'Eroare la salvare.');
		} finally {
			savingNotifications = false;
		}
	}

	async function saveVisualPrefs() {
		savingVisual = true;
		try {
			await updateClientUserPreferences({
				defaultTaskView: defaultTaskView as 'list' | 'card',
				defaultTaskSort: defaultTaskSort as 'date' | 'priority' | 'status',
				itemsPerPage: Number(itemsPerPage) as 10 | 25 | 50
			}).updates(prefsQuery);
			toast.success('Preferințele vizuale au fost salvate.');
		} catch (e) {
			toast.error(e instanceof Error ? e.message : 'Eroare la salvare.');
		} finally {
			savingVisual = false;
		}
	}

	async function saveTaskDefaults() {
		savingDefaults = true;
		try {
			await updateClientUserPreferences({
				defaultPriority: defaultPriority as 'low' | 'medium' | 'high' | 'urgent'
			}).updates(prefsQuery);
			toast.success('Valorile implicite au fost salvate.');
		} catch (e) {
			toast.error(e instanceof Error ? e.message : 'Eroare la salvare.');
		} finally {
			savingDefaults = false;
		}
	}

	function formatField(value: string | null | undefined): string {
		return value || '—';
	}
</script>

<div class="space-y-6">
	<div>
		<h1 class="text-2xl font-bold flex items-center gap-2">
			<SettingsIcon class="h-6 w-6" />
			Setări
		</h1>
		<p class="text-muted-foreground mt-1">Vizualizează datele companiei și configurează preferințele tale.</p>
	</div>

	<!-- Section 1: Company Profile -->
	<Card>
		<CardHeader>
			<div class="flex items-center justify-between">
				<div>
					<CardTitle class="flex items-center gap-2">
						<Building2Icon class="h-5 w-5" />
						Datele Companiei
					</CardTitle>
					<CardDescription>Datele companiei tale.</CardDescription>
				</div>
				{#if !editingCompany && client}
					<Button variant="outline" size="sm" onclick={startEditCompany}>
						<PencilIcon class="h-4 w-4 mr-1" />
						Editează
					</Button>
				{/if}
			</div>
		</CardHeader>
		<CardContent>
			{#if client}
				{#if editingCompany}
					<form onsubmit={(e) => { e.preventDefault(); saveCompany(); }} class="space-y-4">
						<div class="grid grid-cols-1 md:grid-cols-2 gap-4">
							<div class="space-y-2">
								<Label for="businessName">Denumire comercială</Label>
								<Input id="businessName" bind:value={companyForm.businessName} />
							</div>
							<div class="space-y-2">
								<Label for="name">Alias</Label>
								<Input id="name" bind:value={companyForm.name} />
							</div>
							<div class="space-y-2">
								<Label for="cui">CUI</Label>
								<Input id="cui" bind:value={companyForm.cui} />
							</div>
							<div class="space-y-2">
								<Label for="registrationNumber">Nr. Înregistrare</Label>
								<Input id="registrationNumber" bind:value={companyForm.registrationNumber} />
							</div>
							<div class="space-y-2">
								<Label for="vatNumber">Cod TVA</Label>
								<Input id="vatNumber" bind:value={companyForm.vatNumber} />
							</div>
							<div class="space-y-2">
								<Label for="tradeRegister">Registrul Comerțului</Label>
								<Input id="tradeRegister" bind:value={companyForm.tradeRegister} />
							</div>
							<div class="space-y-2">
								<Label for="legalRepresentative">Reprezentant Legal</Label>
								<Input id="legalRepresentative" bind:value={companyForm.legalRepresentative} />
							</div>
							<div class="space-y-2">
								<Label for="companyEmail">Email</Label>
								<Input id="companyEmail" type="email" bind:value={companyForm.email} />
							</div>
							<div class="space-y-2">
								<Label for="phone">Telefon</Label>
								<Input id="phone" bind:value={companyForm.phone} />
							</div>
							<div class="space-y-2">
								<Label for="iban">IBAN</Label>
								<Input id="iban" bind:value={companyForm.iban} />
							</div>
							<div class="space-y-2">
								<Label for="bankName">Bancă</Label>
								<Input id="bankName" bind:value={companyForm.bankName} />
							</div>
							<div class="space-y-2">
								<Label for="address">Adresă</Label>
								<Input id="address" bind:value={companyForm.address} />
							</div>
							<div class="space-y-2">
								<Label for="city">Oraș</Label>
								<Input id="city" bind:value={companyForm.city} />
							</div>
							<div class="space-y-2">
								<Label for="county">Județ</Label>
								<Input id="county" bind:value={companyForm.county} />
							</div>
							<div class="space-y-2">
								<Label for="postalCode">Cod Poștal</Label>
								<Input id="postalCode" bind:value={companyForm.postalCode} />
							</div>
							<div class="space-y-2">
								<Label for="country">Țară</Label>
								<Input id="country" bind:value={companyForm.country} />
							</div>
						</div>
						<div class="flex gap-2 pt-2">
							<Button type="submit" disabled={savingCompany}>
								{savingCompany ? 'Se salvează...' : 'Salvează'}
							</Button>
							<Button type="button" variant="outline" onclick={cancelEditCompany} disabled={savingCompany}>
								Anulează
							</Button>
						</div>
					</form>
				{:else}
					<div class="grid grid-cols-1 md:grid-cols-2 gap-4">
						<div class="space-y-1">
							<p class="text-xs text-muted-foreground">Denumire comercială</p>
							<p class="text-sm font-medium">{formatField(client.businessName)}</p>
						</div>
						<div class="space-y-1">
							<p class="text-xs text-muted-foreground">Alias</p>
							<p class="text-sm font-medium">{formatField(client.name)}</p>
						</div>
						<div class="space-y-1">
							<p class="text-xs text-muted-foreground">CUI</p>
							<p class="text-sm font-medium">{formatField(client.cui)}</p>
						</div>
						<div class="space-y-1">
							<p class="text-xs text-muted-foreground">Nr. Înregistrare</p>
							<p class="text-sm font-medium">{formatField(client.registrationNumber)}</p>
						</div>
						<div class="space-y-1">
							<p class="text-xs text-muted-foreground">Cod TVA</p>
							<p class="text-sm font-medium">{formatField(client.vatNumber)}</p>
						</div>
						<div class="space-y-1">
							<p class="text-xs text-muted-foreground">Registrul Comerțului</p>
							<p class="text-sm font-medium">{formatField(client.tradeRegister)}</p>
						</div>
						<div class="space-y-1">
							<p class="text-xs text-muted-foreground">Reprezentant Legal</p>
							<p class="text-sm font-medium">{formatField(client.legalRepresentative)}</p>
						</div>
						<div class="space-y-1">
							<p class="text-xs text-muted-foreground">Email</p>
							<p class="text-sm font-medium">{formatField(client.email)}</p>
						</div>
						<div class="space-y-1">
							<p class="text-xs text-muted-foreground">Telefon</p>
							<p class="text-sm font-medium">{formatField(client.phone)}</p>
						</div>
						<div class="space-y-1">
							<p class="text-xs text-muted-foreground">IBAN</p>
							<p class="text-sm font-medium">{formatField(client.iban)}</p>
						</div>
						<div class="space-y-1">
							<p class="text-xs text-muted-foreground">Bancă</p>
							<p class="text-sm font-medium">{formatField(client.bankName)}</p>
						</div>
						<div class="space-y-1">
							<p class="text-xs text-muted-foreground">Adresă</p>
							<p class="text-sm font-medium">{formatField(client.address)}</p>
						</div>
						<div class="space-y-1">
							<p class="text-xs text-muted-foreground">Oraș</p>
							<p class="text-sm font-medium">{formatField(client.city)}</p>
						</div>
						<div class="space-y-1">
							<p class="text-xs text-muted-foreground">Județ</p>
							<p class="text-sm font-medium">{formatField(client.county)}</p>
						</div>
						<div class="space-y-1">
							<p class="text-xs text-muted-foreground">Cod Poștal</p>
							<p class="text-sm font-medium">{formatField(client.postalCode)}</p>
						</div>
						<div class="space-y-1">
							<p class="text-xs text-muted-foreground">Țară</p>
							<p class="text-sm font-medium">{formatField(client.country)}</p>
						</div>
					</div>
				{/if}
			{:else}
				<div class="animate-pulse space-y-4">
					<div class="h-4 bg-gray-200 dark:bg-gray-700 rounded w-1/3"></div>
					<div class="h-4 bg-gray-200 dark:bg-gray-700 rounded w-1/4"></div>
				</div>
			{/if}
		</CardContent>
	</Card>

	<!-- User Info Card -->
	{#if userData}
		<Card>
			<CardHeader>
				<div class="flex items-center justify-between">
					<div>
						<CardTitle class="flex items-center gap-2">
							<UserIcon class="h-5 w-5" />
							Contul Meu
						</CardTitle>
						<CardDescription>Informațiile contului tău de autentificare.</CardDescription>
					</div>
					{#if !editingProfile}
						<Button variant="outline" size="sm" onclick={startEditProfile}>
							<PencilIcon class="h-4 w-4 mr-1" />
							Editează
						</Button>
					{/if}
				</div>
			</CardHeader>
			<CardContent>
				{#if editingProfile}
					<form onsubmit={(e) => { e.preventDefault(); saveProfile(); }} class="space-y-4">
						<div class="grid grid-cols-1 md:grid-cols-3 gap-4">
							<div class="space-y-2">
								<Label for="firstName">Prenume</Label>
								<Input id="firstName" bind:value={profileForm.firstName} required />
							</div>
							<div class="space-y-2">
								<Label for="lastName">Nume</Label>
								<Input id="lastName" bind:value={profileForm.lastName} required />
							</div>
							<div class="space-y-2">
								<Label for="userEmail">Email</Label>
								<Input id="userEmail" value={userData.email} disabled />
								<p class="text-xs text-muted-foreground">Contactați administratorul pentru modificarea emailului.</p>
							</div>
						</div>
						<div class="flex gap-2 pt-2">
							<Button type="submit" disabled={savingProfile}>
								{savingProfile ? 'Se salvează...' : 'Salvează'}
							</Button>
							<Button type="button" variant="outline" onclick={cancelEditProfile} disabled={savingProfile}>
								Anulează
							</Button>
						</div>
					</form>
				{:else}
					<div class="grid grid-cols-1 md:grid-cols-3 gap-4">
						<div class="space-y-1">
							<p class="text-xs text-muted-foreground">Prenume</p>
							<p class="text-sm font-medium">{formatField(userData.firstName)}</p>
						</div>
						<div class="space-y-1">
							<p class="text-xs text-muted-foreground">Nume</p>
							<p class="text-sm font-medium">{formatField(userData.lastName)}</p>
						</div>
						<div class="space-y-1">
							<p class="text-xs text-muted-foreground">Email</p>
							<p class="text-sm font-medium">{formatField(userData.email)}</p>
						</div>
					</div>
				{/if}
			</CardContent>
		</Card>
	{/if}

	<!-- Section 2: Email Notifications -->
	<Card>
		<CardHeader>
			<CardTitle class="flex items-center gap-2">
				<BellIcon class="h-5 w-5" />
				Notificări Email
			</CardTitle>
			<CardDescription>Alege ce notificări dorești să primești pe email.</CardDescription>
		</CardHeader>
		<CardContent>
			{#if loading}
				<div class="animate-pulse space-y-4">
					<div class="h-4 bg-gray-200 dark:bg-gray-700 rounded w-1/4"></div>
					<div class="h-10 bg-gray-200 dark:bg-gray-700 rounded"></div>
				</div>
			{:else}
				<form
					onsubmit={(e) => {
						e.preventDefault();
						saveNotifications();
					}}
					class="space-y-6"
				>
					<div class="space-y-4">
						<div class="flex items-center justify-between">
							<div class="space-y-0.5">
								<Label for="notifyTaskStatusChange">Schimbare status task</Label>
								<p class="text-xs text-muted-foreground">Notificare când statusul unui task se schimbă.</p>
							</div>
							<Switch id="notifyTaskStatusChange" bind:checked={notifyTaskStatusChange} />
						</div>

						<Separator />

						<div class="flex items-center justify-between">
							<div class="space-y-0.5">
								<Label for="notifyNewComment">Comentariu nou</Label>
								<p class="text-xs text-muted-foreground">Notificare când se adaugă un comentariu la un task.</p>
							</div>
							<Switch id="notifyNewComment" bind:checked={notifyNewComment} />
						</div>

						<Separator />

						<div class="flex items-center justify-between">
							<div class="space-y-0.5">
								<Label for="notifyApproachingDeadline">Deadline aproape</Label>
								<p class="text-xs text-muted-foreground">Notificare cu 24h înainte de termenul limită.</p>
							</div>
							<Switch id="notifyApproachingDeadline" bind:checked={notifyApproachingDeadline} />
						</div>

						<Separator />

						<div class="flex items-center justify-between">
							<div class="space-y-0.5">
								<Label for="notifyTaskAssigned">Task atribuit</Label>
								<p class="text-xs text-muted-foreground">Notificare când ți se atribuie un task.</p>
							</div>
							<Switch id="notifyTaskAssigned" bind:checked={notifyTaskAssigned} />
						</div>

						<Separator />

						<div class="flex items-center justify-between">
							<div class="space-y-0.5">
								<Label for="notifyTaskApprovedRejected">Task aprobat / respins</Label>
								<p class="text-xs text-muted-foreground">Notificare când un task creat de tine este aprobat sau respins.</p>
							</div>
							<Switch id="notifyTaskApprovedRejected" bind:checked={notifyTaskApprovedRejected} />
						</div>
					</div>

					<Button type="submit" disabled={savingNotifications}>
						{savingNotifications ? 'Se salvează...' : 'Salvează notificări'}
					</Button>
				</form>
			{/if}
		</CardContent>
	</Card>

	<!-- Section 3: Visual Preferences -->
	<Card>
		<CardHeader>
			<CardTitle class="flex items-center gap-2">
				<EyeIcon class="h-5 w-5" />
				Preferințe Vizualizare Tasks
			</CardTitle>
			<CardDescription>Configurează modul implicit de afișare a task-urilor.</CardDescription>
		</CardHeader>
		<CardContent>
			{#if loading}
				<div class="animate-pulse space-y-4">
					<div class="h-4 bg-gray-200 dark:bg-gray-700 rounded w-1/4"></div>
					<div class="h-10 bg-gray-200 dark:bg-gray-700 rounded"></div>
				</div>
			{:else}
				<form
					onsubmit={(e) => {
						e.preventDefault();
						saveVisualPrefs();
					}}
					class="space-y-6"
				>
					<div class="grid grid-cols-1 md:grid-cols-3 gap-6">
						<div class="space-y-2">
							<Label>Vizualizare implicită</Label>
							<Select.Root type="single" value={defaultTaskView} onValueChange={(v) => { if (v) defaultTaskView = v; }}>
								<Select.Trigger class="w-full">
									{defaultTaskView === 'card' ? 'Carduri' : 'Listă'}
								</Select.Trigger>
								<Select.Content>
									<Select.Item value="card">Carduri</Select.Item>
									<Select.Item value="list">Listă</Select.Item>
								</Select.Content>
							</Select.Root>
						</div>

						<div class="space-y-2">
							<Label>Sortare implicită</Label>
							<Select.Root type="single" value={defaultTaskSort} onValueChange={(v) => { if (v) defaultTaskSort = v; }}>
								<Select.Trigger class="w-full">
									{defaultTaskSort === 'date' ? 'Dată' : defaultTaskSort === 'priority' ? 'Prioritate' : 'Status'}
								</Select.Trigger>
								<Select.Content>
									<Select.Item value="date">Dată</Select.Item>
									<Select.Item value="priority">Prioritate</Select.Item>
									<Select.Item value="status">Status</Select.Item>
								</Select.Content>
							</Select.Root>
						</div>

						<div class="space-y-2">
							<Label>Elemente pe pagină</Label>
							<Select.Root type="single" value={String(itemsPerPage)} onValueChange={(v) => { if (v) itemsPerPage = Number(v); }}>
								<Select.Trigger class="w-full">
									{itemsPerPage}
								</Select.Trigger>
								<Select.Content>
									<Select.Item value="10">10</Select.Item>
									<Select.Item value="25">25</Select.Item>
									<Select.Item value="50">50</Select.Item>
								</Select.Content>
							</Select.Root>
						</div>
					</div>

					<Button type="submit" disabled={savingVisual}>
						{savingVisual ? 'Se salvează...' : 'Salvează preferințe'}
					</Button>
				</form>
			{/if}
		</CardContent>
	</Card>

	<!-- Section 4: Task Creation Defaults -->
	<Card>
		<CardHeader>
			<CardTitle class="flex items-center gap-2">
				<ListTodoIcon class="h-5 w-5" />
				Valori Implicite Creare Task
			</CardTitle>
			<CardDescription>Setează valorile implicite folosite la crearea unui task nou.</CardDescription>
		</CardHeader>
		<CardContent>
			{#if loading}
				<div class="animate-pulse space-y-4">
					<div class="h-4 bg-gray-200 dark:bg-gray-700 rounded w-1/4"></div>
					<div class="h-10 bg-gray-200 dark:bg-gray-700 rounded"></div>
				</div>
			{:else}
				<form
					onsubmit={(e) => {
						e.preventDefault();
						saveTaskDefaults();
					}}
					class="space-y-6"
				>
					<div class="max-w-xs space-y-2">
						<Label>Prioritate implicită</Label>
						<Select.Root type="single" value={defaultPriority} onValueChange={(v) => { if (v) defaultPriority = v; }}>
							<Select.Trigger class="w-full">
								{defaultPriority === 'low' ? 'Low' : defaultPriority === 'medium' ? 'Medium' : defaultPriority === 'high' ? 'High' : 'Urgent'}
							</Select.Trigger>
							<Select.Content>
								<Select.Item value="low">Low</Select.Item>
								<Select.Item value="medium">Medium</Select.Item>
								<Select.Item value="high">High</Select.Item>
								<Select.Item value="urgent">Urgent</Select.Item>
							</Select.Content>
						</Select.Root>
					</div>

					<Button type="submit" disabled={savingDefaults}>
						{savingDefaults ? 'Se salvează...' : 'Salvează'}
					</Button>
				</form>
			{/if}
		</CardContent>
	</Card>
</div>
