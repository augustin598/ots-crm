<script lang="ts">
	import type { PageData } from './$types';
	import { enhance } from '$app/forms';
	import IconFacebook from '$lib/components/marketing/icon-facebook.svelte';

	let { data }: { data: PageData } = $props();

	const STATUS_OPTIONS = [
		{ value: '', label: 'Toate' },
		{ value: 'pending_approval', label: 'În așteptare' },
		{ value: 'active', label: 'Active' },
		{ value: 'paused', label: 'Pauzate' },
		{ value: 'failed', label: 'Eșuate' },
		{ value: 'archived', label: 'Arhivate' }
	];

	function formatBudget(cents: number, currency: string): string {
		const major = (cents / 100).toLocaleString('ro-RO', { minimumFractionDigits: 2 });
		return `${major} ${currency}`;
	}

	function statusColor(status: string): string {
		switch (status) {
			case 'pending_approval':
				return 'bg-yellow-100 text-yellow-800';
			case 'active':
				return 'bg-green-100 text-green-800';
			case 'paused':
				return 'bg-gray-100 text-gray-800';
			case 'failed':
				return 'bg-red-100 text-red-800';
			case 'building':
				return 'bg-blue-100 text-blue-800';
			default:
				return 'bg-gray-100 text-gray-700';
		}
	}
</script>

<div class="p-6 space-y-4">
	<div class="flex items-center justify-between">
		<div class="flex items-center gap-3">
			<IconFacebook class="h-7 w-7" />
			<h1 class="text-2xl font-semibold">Facebook / Meta Ads</h1>
		</div>
		<form method="get" class="flex gap-2 items-center">
			<label for="status" class="text-sm text-gray-600">Filtru:</label>
			<select
				id="status"
				name="status"
				class="border rounded px-2 py-1"
				onchange={(e) => (e.currentTarget as HTMLSelectElement).form?.submit()}
			>
				{#each STATUS_OPTIONS as opt}
					<option value={opt.value} selected={data.statusFilter === opt.value}>{opt.label}</option>
				{/each}
			</select>
		</form>
	</div>

	<!-- Counts summary -->
	<div class="grid grid-cols-2 sm:grid-cols-4 gap-3">
		<div class="bg-yellow-50 border border-yellow-200 rounded p-3">
			<div class="text-xs uppercase text-yellow-800 font-semibold">În așteptare</div>
			<div class="text-2xl font-bold text-yellow-900">{data.counts['pending_approval'] ?? 0}</div>
		</div>
		<div class="bg-green-50 border border-green-200 rounded p-3">
			<div class="text-xs uppercase text-green-800 font-semibold">Active</div>
			<div class="text-2xl font-bold text-green-900">{data.counts['active'] ?? 0}</div>
		</div>
		<div class="bg-gray-50 border border-gray-200 rounded p-3">
			<div class="text-xs uppercase text-gray-700 font-semibold">Pauzate</div>
			<div class="text-2xl font-bold text-gray-800">{data.counts['paused'] ?? 0}</div>
		</div>
		<div class="bg-red-50 border border-red-200 rounded p-3">
			<div class="text-xs uppercase text-red-800 font-semibold">Eșuate</div>
			<div class="text-2xl font-bold text-red-900">{data.counts['failed'] ?? 0}</div>
		</div>
	</div>

	{#if data.campaigns.length === 0}
		<div class="bg-white border rounded p-8 text-center text-gray-500">
			Nicio campanie Meta {data.statusFilter ? `cu status "${data.statusFilter}"` : ''}.<br />
			<span class="text-xs text-gray-400">
				Workerii din PersonalOPS creează drafturi automat aici prin
				<code class="bg-gray-100 px-1 py-0.5 rounded">POST /api/external/campaigns/draft</code>.
			</span>
		</div>
	{:else}
		<div class="space-y-3">
			{#each data.campaigns as c}
				<div class="bg-white border rounded p-4 shadow-sm">
					<div class="flex items-start justify-between gap-4">
						<div class="flex-1 min-w-0">
							<div class="flex items-center gap-2 flex-wrap">
								<span class="text-xs font-mono uppercase {statusColor(c.status)} px-2 py-0.5 rounded">
									{c.status}
								</span>
								{#if c.createdByWorkerId}
									<span class="text-xs bg-blue-50 text-blue-700 px-2 py-0.5 rounded">
										worker {c.createdByWorkerId.slice(0, 8)}
									</span>
								{/if}
								{#if c.buildStep && c.buildStep !== 'done' && c.status === 'building'}
									<span class="text-xs bg-blue-100 text-blue-800 px-2 py-0.5 rounded">
										step: {c.buildStep}
									</span>
								{/if}
							</div>
							<h3 class="text-lg font-medium mt-1">{c.name}</h3>
							<p class="text-sm text-gray-600">
								<strong>{c.clientName ?? c.clientId}</strong> ·
								{c.objective} · {formatBudget(c.budgetCents, c.currencyCode)} / {c.budgetType}
							</p>
							{#if c.adAccountName || c.externalAdAccountId}
								<p class="text-xs text-gray-500 mt-1 flex items-center gap-1.5 flex-wrap">
									<svg
										class="h-3.5 w-3.5 text-gray-400 shrink-0"
										fill="currentColor"
										viewBox="0 0 20 20"
									>
										<path
											d="M4 4a2 2 0 00-2 2v8a2 2 0 002 2h12a2 2 0 002-2V6a2 2 0 00-2-2H4zm0 2h12v2H4V6zm0 4h12v4H4v-4z"
										/>
									</svg>
									<span>Ad account:</span>
									{#if c.adAccountName}
										<strong class="text-gray-700 font-medium">{c.adAccountName}</strong>
									{/if}
									{#if c.externalAdAccountId}
										<code
											class="font-mono text-[11px] bg-gray-100 px-1.5 py-0.5 rounded text-gray-600"
										>
											{c.externalAdAccountId.replace(/^act_/, '')}
										</code>
									{/if}
								</p>
							{/if}
							{#if c.lastError}
								<p class="text-sm text-red-700 mt-1">⚠ {c.lastError}</p>
							{/if}
							{#if c.brief}
								<details class="mt-2">
									<summary class="text-sm text-gray-500 cursor-pointer"
										>Brief / Audience / Creative</summary
									>
									<pre
										class="text-xs bg-gray-50 p-2 rounded overflow-x-auto mt-1">{JSON.stringify(
											{ brief: c.brief, audience: c.audience, creative: c.creative },
											null,
											2
										)}</pre>
								</details>
							{/if}
							{#if c.externalCampaignId}
								<p class="text-xs text-gray-500 mt-1 font-mono">Meta: {c.externalCampaignId}</p>
							{/if}
						</div>
						<div class="flex flex-col gap-2 shrink-0">
							{#if c.status === 'pending_approval'}
								<form method="POST" action="?/patch" use:enhance>
									<input type="hidden" name="id" value={c.id} />
									<input type="hidden" name="action" value="approve" />
									<button
										class="bg-green-600 hover:bg-green-700 text-white px-3 py-1 rounded text-sm w-full"
										>Aprobă</button
									>
								</form>
								<form
									method="POST"
									action="?/patch"
									use:enhance
									onsubmit={(e) => {
										if (
											!confirm(
												'Respinge și șterge entitățile din Meta? (campaign + adset + creative + ad). Acțiunea nu poate fi anulată.'
											)
										)
											e.preventDefault();
									}}
								>
									<input type="hidden" name="id" value={c.id} />
									<input type="hidden" name="action" value="archive" />
									<input type="hidden" name="deleteFromPlatform" value="1" />
									<button
										class="bg-red-100 hover:bg-red-200 text-red-800 px-3 py-1 rounded text-sm w-full"
										title="Marchează archived în CRM ȘI șterge entitățile din Meta">Respinge + curăță Meta</button
									>
								</form>
								<form method="POST" action="?/patch" use:enhance>
									<input type="hidden" name="id" value={c.id} />
									<input type="hidden" name="action" value="archive" />
									<button
										class="bg-gray-100 hover:bg-gray-200 px-3 py-1 rounded text-xs w-full text-gray-700"
										title="Doar archived în CRM; entitățile rămân PAUSED în Meta"
										>Respinge (păstrează în Meta)</button
									>
								</form>
							{:else if c.status === 'active'}
								<form method="POST" action="?/patch" use:enhance>
									<input type="hidden" name="id" value={c.id} />
									<input type="hidden" name="action" value="pause" />
									<button
										class="bg-yellow-500 hover:bg-yellow-600 text-white px-3 py-1 rounded text-sm w-full"
										>Pauzează</button
									>
								</form>
							{:else if c.status === 'paused'}
								<form method="POST" action="?/patch" use:enhance>
									<input type="hidden" name="id" value={c.id} />
									<input type="hidden" name="action" value="approve" />
									<button
										class="bg-green-600 hover:bg-green-700 text-white px-3 py-1 rounded text-sm w-full"
										>Reactivează</button
									>
								</form>
							{/if}
							<span class="text-xs text-gray-400 text-right">
								{new Date(c.createdAt).toLocaleString('ro-RO')}
							</span>
						</div>
					</div>
				</div>
			{/each}
		</div>
	{/if}
</div>
