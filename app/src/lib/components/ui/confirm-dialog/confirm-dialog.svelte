<script lang="ts">
	import * as Dialog from '$lib/components/ui/dialog';
	import { Button } from '$lib/components/ui/button';
	import { confirmState, resolveConfirm } from './confirm-store.svelte';
</script>

<Dialog.Root
	open={confirmState.open}
	onOpenChange={(o) => {
		if (!o) resolveConfirm(false);
	}}
>
	<!-- z peste modalele proprii (.psi-modal-back z-index 100, .iv-modal-backdrop 200,
	     checkout 999, FeatureHint 1100): confirmarea trebuie să fie mereu deasupra,
	     altfel butonul care o deschide pare că „nu face nimic". -->
	<Dialog.Content class="sm:max-w-md z-[2001]" overlayClass="z-[2000]">
		<Dialog.Header>
			<Dialog.Title>{confirmState.title}</Dialog.Title>
			<Dialog.Description class="whitespace-pre-line">
				{confirmState.description}
			</Dialog.Description>
		</Dialog.Header>
		<Dialog.Footer class="gap-2 sm:gap-0">
			<Button variant="outline" onclick={() => resolveConfirm(false)}>
				{confirmState.cancelLabel}
			</Button>
			<Button
				variant={confirmState.variant}
				onclick={() => resolveConfirm(true)}
			>
				{confirmState.confirmLabel}
			</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
