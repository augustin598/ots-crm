<script lang="ts">
	import { enhance, applyAction } from '$app/forms';
	import { page } from '$app/state';
	import type { PageData, ActionData } from './$types';
	import SignaturePad from '$lib/components/SignaturePad.svelte';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	const pdfSrc = $derived(
		`/sign/${page.params.tenant}/${page.params.token}/pdf`
	);

	let signatureName = $state('');
	let signatureDataUrl = $state('');
	let signing = $state(false);

	const alreadySigned = $derived(!!data.contract.beneficiarSignedAt);
	const justSigned = $derived(form && 'success' in form && form.success);
	const canSubmit = $derived(signatureName.trim().length > 0 && signatureDataUrl.length > 0);

	let redirectCountdown = $state(5);

	$effect(() => {
		if (justSigned || alreadySigned) {
			const interval = setInterval(() => {
				redirectCountdown--;
				if (redirectCountdown <= 0) {
					clearInterval(interval);
					window.location.href = `/client/${page.params.tenant}/`;
				}
			}, 1000);
			return () => clearInterval(interval);
		}
	});
</script>

<svelte:head>
	<title>Semnare Contract {data.contract.contractNumber} - {data.tenant.name}</title>
</svelte:head>

<div class="min-h-screen bg-gray-50">
	<!-- Header -->
	<div class="bg-white border-b shadow-sm">
		<div class="max-w-4xl mx-auto px-4 py-4 flex items-center justify-between">
			<div>
				<p class="text-sm text-gray-500">Invitație de semnare de la</p>
				<h1 class="text-xl font-bold text-gray-900">{data.tenant.name}</h1>
			</div>
			<div class="text-right">
				<p class="text-sm text-gray-500">Contract</p>
				<p class="font-semibold text-gray-900">{data.contract.contractNumber}</p>
			</div>
		</div>
	</div>

	<div class="max-w-4xl mx-auto px-4 py-6 space-y-6">
		<!-- Contract info -->
		<div class="bg-white rounded-lg border p-4 flex justify-between items-start">
			<div>
				<p class="text-sm text-gray-500 mb-1">Titlu contract</p>
				<p class="font-semibold text-gray-900">{data.contract.contractTitle}</p>
			</div>
			<div class="text-right">
				<p class="text-sm text-gray-500 mb-1">Beneficiar</p>
				<p class="font-semibold text-gray-900">{data.client.name}</p>
			</div>
		</div>

		<!-- PDF preview — hidden after signing because token becomes invalid -->
		{#if !alreadySigned && !justSigned}
			<div class="bg-white rounded-lg border overflow-hidden">
				<div class="border-b px-4 py-3 bg-gray-50">
					<p class="text-sm font-medium text-gray-700">Previzualizare contract</p>
				</div>
				<iframe
					src={pdfSrc}
					class="w-full"
					style="height: 70vh; min-height: 500px;"
					title="Contract PDF"
				></iframe>
			</div>
		{/if}

		<!-- Signing section -->
		{#if alreadySigned || justSigned}
			<div class="bg-green-50 border border-green-200 rounded-lg p-6 text-center">
				<div class="text-4xl mb-3">✓</div>
				<h2 class="text-xl font-bold text-green-800 mb-2">Contract semnat cu succes!</h2>
				<p class="text-green-700">
					Semnătura <strong>{justSigned && 'signatureName' in form ? form.signatureName : data.contract.beneficiarSignatureName}</strong> a fost înregistrată.
				</p>
				<p class="text-sm text-green-600 mt-2">Veți primi o confirmare prin email de la {data.tenant.name}.</p>
				<p class="text-xs text-gray-500 mt-3">Redirectare automată în {redirectCountdown} secunde...</p>
			</div>
		{:else}
			<div class="bg-white rounded-lg border p-6">
				<h2 class="text-lg font-bold text-gray-900 mb-1">Semnați contractul</h2>
				<p class="text-sm text-gray-600 mb-4">
					Prin semnarea acestui contract confirmați că ați citit și acceptat toate clauzele.
				</p>

				{#if form && 'error' in form && form.error}
					<div class="bg-red-50 border border-red-200 rounded p-3 mb-4 text-sm text-red-700">
						{form.error}
					</div>
				{/if}

				<form
					method="POST"
					action="?/sign"
					use:enhance={() => {
						signing = true;
						return async ({ result }) => {
							// Use applyAction instead of update() to avoid re-running load()
							// After signing, token is marked 'used' — re-running load() would throw 400
							await applyAction(result);
							signing = false;
						};
					}}
					class="space-y-4"
				>
					<!-- Signature canvas -->
					<div>
						<label class="block text-sm font-medium text-gray-700 mb-2">
							Semnătură <span class="text-red-500">*</span>
						</label>
						<SignaturePad
							onchange={(url) => { signatureDataUrl = url; }}
						/>
						<input type="hidden" name="signatureImage" value={signatureDataUrl} />
						<p class="text-xs text-gray-500 mt-1">Desenați semnătura cu mouse-ul sau degetul</p>
					</div>

					<!-- Name input -->
					<div>
						<label for="signatureName" class="block text-sm font-medium text-gray-700 mb-1">
							Nume complet <span class="text-red-500">*</span>
						</label>
						<input
							id="signatureName"
							name="signatureName"
							type="text"
							required
							maxlength="100"
							bind:value={signatureName}
							placeholder="ex: Ion Popescu"
							class="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-900 focus:border-transparent"
						/>
						<p class="text-xs text-gray-500 mt-1">
							Introduceți numele complet ca reprezentant al {data.client.name}
						</p>
					</div>

					<button
						type="submit"
						disabled={signing || !canSubmit}
						class="w-full bg-gray-900 text-white py-3 px-4 rounded-md font-semibold text-sm hover:bg-gray-800 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
					>
						{signing ? 'Se semnează...' : 'Semnez contractul'}
					</button>

					<p class="text-xs text-gray-400 text-center">
						Prin apăsarea butonului confirmați că aveți dreptul legal de a semna în numele {data.client.name}.
					</p>
				</form>
			</div>
		{/if}
	</div>
</div>
