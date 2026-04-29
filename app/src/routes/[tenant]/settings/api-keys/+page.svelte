<script lang="ts">
	import type { PageData, ActionData } from './$types';
	import { enhance } from '$app/forms';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	let showCreate = $state(false);
	let copiedJustNow = $state(false);

	function copy(text: string) {
		navigator.clipboard.writeText(text).then(() => {
			copiedJustNow = true;
			setTimeout(() => (copiedJustNow = false), 2000);
		});
	}

	function formatDate(d: string | Date | null) {
		if (!d) return '—';
		return new Date(d).toLocaleString('ro-RO');
	}
</script>

<div class="p-6 space-y-4">
	<div class="flex items-center justify-between">
		<h1 class="text-2xl font-semibold">API Keys</h1>
		<button
			class="bg-blue-600 hover:bg-blue-700 text-white px-3 py-1.5 rounded text-sm"
			onclick={() => (showCreate = !showCreate)}
		>
			{showCreate ? 'Anulează' : 'Cheie nouă'}
		</button>
	</div>

	<p class="text-sm text-gray-600">
		Cheile API sunt folosite de servicii externe (ex: <strong>PersonalOPS</strong>) pentru a apela endpoint-urile
		<code class="font-mono text-xs bg-gray-100 px-1 py-0.5 rounded">/api/external/*</code>. Plaintext-ul este afișat
		<strong>o singură dată</strong> la creare — copiază-l imediat.
	</p>

	{#if showCreate}
		<form method="POST" action="?/create" use:enhance class="bg-white border rounded p-4 space-y-3">
			<div>
				<label class="block text-sm font-medium" for="name">Nume</label>
				<input
					id="name"
					name="name"
					type="text"
					required
					placeholder="ex: PersonalOPS worker — laptop Augustin"
					class="border rounded w-full px-2 py-1.5 text-sm"
				/>
			</div>
			<div>
				<span class="block text-sm font-medium mb-1">Scopes</span>
				<div class="space-y-1">
					{#each data.allScopes as scope}
						<label class="flex items-center gap-2 text-sm">
							<input type="checkbox" name="scopes" value={scope} />
							<code class="font-mono text-xs">{scope}</code>
						</label>
					{/each}
				</div>
			</div>
			<div>
				<label class="block text-sm font-medium" for="expiresInDays">Expiră (zile, opțional)</label>
				<input
					id="expiresInDays"
					name="expiresInDays"
					type="number"
					min="1"
					placeholder="ex: 365"
					class="border rounded w-full px-2 py-1.5 text-sm"
				/>
			</div>
			<button
				type="submit"
				class="bg-blue-600 hover:bg-blue-700 text-white px-3 py-1.5 rounded text-sm"
			>
				Generează cheia
			</button>
		</form>
	{/if}

	{#if form?.created && form?.plaintext}
		<div class="bg-yellow-50 border border-yellow-300 rounded p-4 space-y-2">
			<p class="text-sm font-medium text-yellow-900">
				⚠ Salvează această cheie acum — nu va mai fi afișată.
			</p>
			<div class="flex gap-2 items-center">
				<code class="font-mono text-xs bg-white border rounded px-2 py-1.5 flex-1 break-all">
					{form.plaintext}
				</code>
				<button
					onclick={() => copy(form.plaintext as string)}
					class="bg-gray-200 hover:bg-gray-300 px-3 py-1.5 rounded text-sm"
				>
					{copiedJustNow ? 'Copiat ✓' : 'Copiază'}
				</button>
			</div>
		</div>
	{/if}

	<div class="bg-white border rounded">
		<table class="w-full text-sm">
			<thead class="bg-gray-50">
				<tr class="text-left">
					<th class="px-3 py-2">Nume</th>
					<th class="px-3 py-2">Prefix</th>
					<th class="px-3 py-2">Scopes</th>
					<th class="px-3 py-2">Ultima utilizare</th>
					<th class="px-3 py-2">Stare</th>
					<th class="px-3 py-2"></th>
				</tr>
			</thead>
			<tbody>
				{#each data.keys as k}
					<tr class="border-t {k.revokedAt ? 'opacity-50' : ''}">
						<td class="px-3 py-2">{k.name}</td>
						<td class="px-3 py-2 font-mono text-xs">{k.keyPrefix}…</td>
						<td class="px-3 py-2 font-mono text-xs">{k.scopes.join(', ')}</td>
						<td class="px-3 py-2 text-xs text-gray-600">{formatDate(k.lastUsedAt)}</td>
						<td class="px-3 py-2 text-xs">
							{#if k.revokedAt}
								<span class="text-red-700">Revocată {formatDate(k.revokedAt)}</span>
							{:else if k.expiresAt && new Date(k.expiresAt) < new Date()}
								<span class="text-red-700">Expirată</span>
							{:else}
								<span class="text-green-700">Activă</span>
							{/if}
						</td>
						<td class="px-3 py-2">
							{#if !k.revokedAt}
								<form method="POST" action="?/revoke" use:enhance>
									<input type="hidden" name="id" value={k.id} />
									<button class="text-red-600 hover:text-red-800 text-xs">Revocă</button>
								</form>
							{/if}
						</td>
					</tr>
				{/each}
			</tbody>
		</table>
	</div>
</div>
