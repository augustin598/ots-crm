<script lang="ts">
	import type { PageData } from './$types';
	import { updateTenantSettings } from '$lib/remotes/tenant-settings.remote';
	import { getCompanyData } from '$lib/remotes/anaf.remote';
	import { sendInvitation, getInvitations, cancelInvitation } from '$lib/remotes/invitations.remote';
	import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '$lib/components/ui/card';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import { Separator } from '$lib/components/ui/separator';
	import { Select, SelectContent, SelectItem, SelectTrigger } from '$lib/components/ui/select';
	import { Badge } from '$lib/components/ui/badge';
	import { X } from '@lucide/svelte';

	let { data }: { data: PageData } = $props();

	let name = $state(data.tenant?.name || '');
	let slug = $state(data.tenant?.slug || '');
	let loading = $state(false);
	let loadingAnaf = $state(false);
	let error = $state<string | null>(null);

	// Romanian legal data
	let companyType = $state(data.tenant?.companyType || '');
	let cui = $state(data.tenant?.cui || '');
	let registrationNumber = $state(data.tenant?.registrationNumber || '');
	let tradeRegister = $state(data.tenant?.tradeRegister || '');
	let vatNumber = $state(data.tenant?.vatNumber || '');
	let legalRepresentative = $state(data.tenant?.legalRepresentative || '');
	let iban = $state(data.tenant?.iban || '');
	let bankName = $state(data.tenant?.bankName || '');
	let address = $state(data.tenant?.address || '');
	let city = $state(data.tenant?.city || '');
	let county = $state(data.tenant?.county || '');
	let postalCode = $state(data.tenant?.postalCode || '');
	let country = $state(data.tenant?.country || 'România');

	// Invitation state
	let invitationEmail = $state('');
	let invitationRole = $state<'member' | 'admin'>('member');
	let sendingInvitation = $state(false);
	let invitationError = $state<string | null>(null);
	let invitationSuccess = $state(false);

	const invitationsQuery = getInvitations();
	const invitations = $derived(invitationsQuery.current || []);
	const loadingInvitations = $derived(invitationsQuery.loading);

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

	async function handleSubmit() {
		loading = true;
		error = null;

		try {
			await updateTenantSettings({
				name,
				slug,
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
				country: country || undefined
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

	{#if data.tenantUser?.role === 'owner' || data.tenantUser?.role === 'admin'}
		<Card>
			<CardHeader>
				<CardTitle>Team Invitations</CardTitle>
				<CardDescription>Invite users to join your organization</CardDescription>
			</CardHeader>
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
						<div class="space-y-2">
							{#each invitations as invitation}
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
				</div>
			</CardContent>
		</Card>
	{/if}
</div>
