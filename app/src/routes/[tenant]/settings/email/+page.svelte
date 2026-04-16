<script lang="ts">
	import { getEmailSettings, updateEmailSettings, testEmailSettings, updateEmailProvider, testGmailSending } from '$lib/remotes/email-settings.remote';
	import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '$lib/components/ui/card';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import { Separator } from '$lib/components/ui/separator';
	import { Switch } from '$lib/components/ui/switch';
	import { Mail } from '@lucide/svelte';
	import { page } from '$app/state';

	const settingsQuery = getEmailSettings();
	const settings = $derived(settingsQuery.current);
	const loading = $derived(settingsQuery.loading);
	const error = $derived(settingsQuery.error);

	let smtpHost = $state('');
	let smtpPort = $state(587);
	let smtpSecure = $state(false);
	let smtpUser = $state('');
	let smtpPassword = $state('');
	let smtpFrom = $state('');
	let isEnabled = $state(true);
	let saving = $state(false);
	let testing = $state(false);
	let saveError = $state<string | null>(null);
	let saveSuccess = $state(false);
	let testError = $state<string | null>(null);
	let testSuccess = $state(false);

	// Gmail state
	let switchingProvider = $state(false);
	let testingGmail = $state(false);
	let gmailTestError = $state<string | null>(null);
	let gmailTestSuccess = $state(false);
	let providerError = $state<string | null>(null);

	const isGmailProvider = $derived(settings?.emailProvider === 'gmail');
	const tenantSlug = $derived(page.params.tenant);

	// Update local state when settings load
	$effect(() => {
		if (settings) {
			smtpHost = settings.smtpHost || '';
			smtpPort = settings.smtpPort || 587;
			smtpSecure = settings.smtpSecure || false;
			smtpUser = settings.smtpUser || '';
			smtpFrom = settings.smtpFrom || '';
			isEnabled = settings.isEnabled ?? true;
			// Don't populate password - only clear it when saved
			if (!settings.hasPassword) {
				smtpPassword = '';
			}
		}
	});

	async function handleSubmit() {
		saving = true;
		saveError = null;
		saveSuccess = false;

		try {
			await updateEmailSettings({
				smtpHost: smtpHost || undefined,
				smtpPort: smtpPort || undefined,
				smtpSecure,
				smtpUser: smtpUser || undefined,
				smtpPassword: smtpPassword || undefined, // Only update if provided
				smtpFrom: smtpFrom || undefined,
				isEnabled
			}).updates(settingsQuery);
			saveSuccess = true;
			smtpPassword = ''; // Clear password field after save
			setTimeout(() => {
				saveSuccess = false;
			}, 3000);
		} catch (e) {
			saveError = e instanceof Error ? e.message : 'Failed to update email settings';
		} finally {
			saving = false;
		}
	}

	async function handleTestEmail() {
		testing = true;
		testError = null;
		testSuccess = false;

		// First save settings if they've changed
		if (smtpHost && smtpUser) {
			try {
				await updateEmailSettings({
					smtpHost: smtpHost || undefined,
					smtpPort: smtpPort || undefined,
					smtpSecure,
					smtpUser: smtpUser || undefined,
					smtpPassword: smtpPassword || undefined,
					smtpFrom: smtpFrom || undefined,
					isEnabled: true // Enable for test
				}).updates(settingsQuery);
			} catch (e) {
				testError = e instanceof Error ? e.message : 'Failed to save settings before test';
				testing = false;
				return;
			}
		}

		try {
			const result = await testEmailSettings();
			testSuccess = true;
			testError = null;
			setTimeout(() => {
				testSuccess = false;
			}, 5000);
		} catch (e) {
			testError = e instanceof Error ? e.message : 'Failed to send test email';
		} finally {
			testing = false;
		}
	}

	async function handleProviderToggle(useGmail: boolean) {
		switchingProvider = true;
		providerError = null;
		try {
			await updateEmailProvider({ provider: useGmail ? 'gmail' : 'smtp' }).updates(settingsQuery);
		} catch (e) {
			providerError = e instanceof Error ? e.message : 'Eroare la schimbarea providerului';
		} finally {
			switchingProvider = false;
		}
	}

	async function handleGmailTest() {
		testingGmail = true;
		gmailTestError = null;
		gmailTestSuccess = false;
		try {
			await testGmailSending();
			gmailTestSuccess = true;
			setTimeout(() => { gmailTestSuccess = false; }, 5000);
		} catch (e) {
			gmailTestError = e instanceof Error ? e.message : 'Eroare la trimiterea testului Gmail';
		} finally {
			testingGmail = false;
		}
	}
</script>

<p class="text-muted-foreground mb-6">
	Configurează modul de trimitere email. Gmail este recomandat ca metodă principală, cu SMTP ca fallback. Parolele sunt criptate și nu sunt expuse.
</p>

<Card class="mb-6">
	<CardHeader>
		<CardTitle>Trimitere Email prin Gmail</CardTitle>
		<CardDescription>
			{#if isGmailProvider}
				Metoda principală de trimitere
			{:else}
				Conectează Gmail pentru a trimite emailuri din contul tău
			{/if}
		</CardDescription>
	</CardHeader>
	<CardContent>
		{#if loading}
			<div class="animate-pulse space-y-4">
				<div class="h-4 bg-gray-200 dark:bg-gray-700 rounded w-1/3"></div>
			</div>
		{:else if !settings?.gmailConnected}
			<div class="flex items-center gap-3 p-4 rounded-lg bg-muted/50">
				<div class="flex-1">
					<p class="font-medium">Gmail nu este conectat</p>
					<p class="text-sm text-muted-foreground">Conectează-ți contul Gmail pentru a trimite emailuri direct din contul tău.</p>
				</div>
				<Button variant="outline" onclick={() => window.location.href = `/api/gmail/auth?tenant=${tenantSlug}`}>
					Conectează Gmail
				</Button>
			</div>
		{:else if settings?.gmailNeedsReauth}
			<div class="space-y-3">
				<div class="flex items-center gap-2">
					<span class="inline-flex items-center rounded-full bg-green-100 px-2.5 py-0.5 text-xs font-medium text-green-800 dark:bg-green-900/30 dark:text-green-400">Conectat</span>
					<span class="text-sm">{settings.gmailEmail}</span>
				</div>
				<div class="flex items-center gap-3 p-4 rounded-lg bg-amber-50 dark:bg-amber-900/20">
					<div class="flex-1">
						<p class="font-medium text-amber-800 dark:text-amber-200">Permisiuni insuficiente</p>
						<p class="text-sm text-amber-700 dark:text-amber-300">Gmail a fost actualizat. Reconectează pentru a adăuga permisiunea de trimitere email.</p>
					</div>
					<Button variant="outline" onclick={() => window.location.href = `/api/gmail/auth?tenant=${tenantSlug}`}>
						Actualizează Permisiuni
					</Button>
				</div>
			</div>
		{:else}
			<div class="space-y-4">
				<div class="flex items-center gap-2">
					<span class="inline-flex items-center rounded-full bg-green-100 px-2.5 py-0.5 text-xs font-medium text-green-800 dark:bg-green-900/30 dark:text-green-400">Conectat</span>
					<span class="text-sm">{settings.gmailEmail}</span>
					<span class="inline-flex items-center rounded-full bg-blue-100 px-2.5 py-0.5 text-xs font-medium text-blue-800 dark:bg-blue-900/30 dark:text-blue-400">Trimitere activă</span>
				</div>

				<div class="flex items-center justify-between">
					<div class="space-y-0.5">
						<Label>Folosește Gmail pentru trimitere</Label>
						<p class="text-xs text-muted-foreground">
							Când este activat, emailurile se trimit din contul Gmail. SMTP este folosit automat ca fallback.
						</p>
					</div>
					<Switch
						checked={isGmailProvider}
						onCheckedChange={handleProviderToggle}
						disabled={switchingProvider}
					/>
				</div>

				{#if providerError}
					<div class="rounded-md bg-red-50 dark:bg-red-900/20 p-3">
						<p class="text-sm text-red-800 dark:text-red-200">{providerError}</p>
					</div>
				{/if}

				<Separator />

				<Button
					variant="outline"
					onclick={handleGmailTest}
					disabled={testingGmail}
				>
					<Mail class="h-4 w-4 mr-2" />
					{testingGmail ? 'Se trimite...' : 'Trimite Email Test prin Gmail'}
				</Button>

				{#if gmailTestError}
					<div class="rounded-md bg-red-50 dark:bg-red-900/20 p-3">
						<p class="text-sm text-red-800 dark:text-red-200">{gmailTestError}</p>
					</div>
				{/if}

				{#if gmailTestSuccess}
					<div class="rounded-md bg-green-50 dark:bg-green-900/20 p-3">
						<p class="text-sm text-green-800 dark:text-green-200">
							Email test trimis cu succes prin Gmail! Verifică inbox-ul.
						</p>
					</div>
				{/if}
			</div>
		{/if}
	</CardContent>
</Card>

<Card>
	<CardHeader>
		<CardTitle>Setări SMTP</CardTitle>
		<CardDescription>
			{#if isGmailProvider}
				Folosit ca fallback când Gmail nu este disponibil
			{:else}
				Metoda principală de trimitere email
			{/if}
		</CardDescription>
	</CardHeader>
	<CardContent>
		{#if loading}
			<div class="space-y-4">
				<div class="animate-pulse space-y-4">
					<div class="h-4 bg-gray-200 dark:bg-gray-700 rounded w-1/4"></div>
					<div class="h-10 bg-gray-200 dark:bg-gray-700 rounded"></div>
				</div>
			</div>
		{:else}
			<form
				onsubmit={(e) => {
					e.preventDefault();
					handleSubmit();
				}}
				class="space-y-6"
			>
				<div class="space-y-4">
					<div class="flex items-center justify-between">
						<div class="space-y-0.5">
							<Label for="isEnabled">Activează SMTP</Label>
							<p class="text-xs text-muted-foreground">
								{#if isGmailProvider}
									Activează SMTP ca fallback. Când Gmail nu este disponibil, emailurile se trimit prin SMTP.
								{:else}
									Activează sau dezactivează trimiterea email prin SMTP.
								{/if}
							</p>
						</div>
						<Switch id="isEnabled" bind:checked={isEnabled} />
					</div>

					<Separator />

					<div class="grid grid-cols-2 gap-4">
						<div class="space-y-2">
							<Label for="smtpHost">SMTP Host *</Label>
							<Input
								id="smtpHost"
								bind:value={smtpHost}
								type="text"
								placeholder="smtp.example.com"
								required={isEnabled}
								disabled={!isEnabled}
							/>
							<p class="text-xs text-muted-foreground">
								Hostname-ul serverului SMTP (ex: smtp.gmail.com, smtp.sendgrid.net)
							</p>
						</div>

						<div class="space-y-2">
							<Label for="smtpPort">SMTP Port</Label>
							<Input
								id="smtpPort"
								bind:value={smtpPort}
								type="number"
								min="1"
								max="65535"
								required={isEnabled}
								disabled={!isEnabled}
								onchange={() => {
									if (smtpPort === 465) smtpSecure = true;
									else if (smtpPort === 587 || smtpPort === 25) smtpSecure = false;
								}}
							/>
							<p class="text-xs text-muted-foreground">
								Port SMTP (587 pentru TLS, 465 pentru SSL, 25 necriptat)
							</p>
						</div>
					</div>

					<div class="flex items-center justify-between">
						<div class="space-y-0.5">
							<Label for="smtpSecure">Folosește SSL/TLS</Label>
							<p class="text-xs text-muted-foreground">
								Activează dacă serverul SMTP necesită SSL (port 465) sau TLS (port 587)
							</p>
						</div>
						<Switch id="smtpSecure" bind:checked={smtpSecure} disabled={!isEnabled} />
					</div>

					<Separator />

					<div class="space-y-2">
						<Label for="smtpUser">Utilizator SMTP *</Label>
						<Input
							id="smtpUser"
							bind:value={smtpUser}
							type="text"
							placeholder="email@example.com"
							required={isEnabled}
							disabled={!isEnabled}
						/>
						<p class="text-xs text-muted-foreground">
							Numele de utilizator sau adresa de email SMTP
						</p>
					</div>

					<div class="space-y-2">
						<Label for="smtpPassword">Parolă SMTP {settings?.hasPassword ? '(lasă gol pentru a păstra parola curentă)' : '*'}</Label>
						<Input
							id="smtpPassword"
							bind:value={smtpPassword}
							type="password"
							placeholder={settings?.hasPassword ? '••••••••' : 'Introdu parola'}
							required={!settings?.hasPassword && isEnabled}
							disabled={!isEnabled}
						/>
						<p class="text-xs text-muted-foreground">
							Parola SMTP. {settings?.hasPassword ? 'Lasă gol pentru a păstra parola curentă.' : 'Obligatorie pentru configurări noi.'}
						</p>
					</div>

					<div class="space-y-2">
						<Label for="smtpFrom">Adresă expeditor (From)</Label>
						<Input
							id="smtpFrom"
							bind:value={smtpFrom}
							type="email"
							placeholder="noreply@example.com"
							disabled={!isEnabled}
						/>
						<p class="text-xs text-muted-foreground">
							Opțional. Adresa de email care va apărea ca expeditor. Dacă nu e setată, se folosește utilizatorul SMTP.
						</p>
					</div>
				</div>

				<Separator />

				{#if saveError}
					<div class="rounded-md bg-red-50 dark:bg-red-900/20 p-3">
						<p class="text-sm text-red-800 dark:text-red-200">{saveError}</p>
					</div>
				{/if}

				{#if saveSuccess}
					<div class="rounded-md bg-green-50 dark:bg-green-900/20 p-3">
						<p class="text-sm text-green-800 dark:text-green-200">Setările au fost salvate cu succes!</p>
					</div>
				{/if}

				<div class="flex gap-2">
					<Button type="submit" disabled={saving || !isEnabled || !smtpHost || !smtpUser || (!settings?.hasPassword && !smtpPassword)}>
						{saving ? 'Se salvează...' : 'Salvează Setări'}
					</Button>
					<Button
						type="button"
						variant="outline"
						onclick={handleTestEmail}
						disabled={testing || saving || !isEnabled || !smtpHost || !smtpUser || (!settings?.hasPassword && !smtpPassword)}
					>
						<Mail class="h-4 w-4 mr-2" />
						{testing ? 'Se trimite...' : 'Trimite Email Test SMTP'}
					</Button>
				</div>

				{#if testError}
					<div class="rounded-md bg-red-50 dark:bg-red-900/20 p-3">
						<p class="text-sm text-red-800 dark:text-red-200">{testError}</p>
					</div>
				{/if}

				{#if testSuccess}
					<div class="rounded-md bg-green-50 dark:bg-green-900/20 p-3">
						<p class="text-sm text-green-800 dark:text-green-200">
							Email test SMTP trimis cu succes! Verifică inbox-ul.
						</p>
					</div>
				{/if}
			</form>
		{/if}
	</CardContent>
</Card>
