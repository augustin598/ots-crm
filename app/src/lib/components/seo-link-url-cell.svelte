<script lang="ts">
	import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '$lib/components/ui/tooltip';
	import LinkIcon from '@lucide/svelte/icons/link';
	import CopyIcon from '@lucide/svelte/icons/copy';
	import CheckIcon from '@lucide/svelte/icons/check';

	interface Props {
		url: string;
		maxChars?: number;
	}

	let { url, maxChars = 40 }: Props = $props();
	let copied = $state(false);

	const fullUrl = $derived(url.startsWith('http') ? url : `https://${url}`);
	const displayText = $derived(url.replace(/^https?:\/\//, ''));
	const truncated = $derived(displayText.length > maxChars ? `${displayText.slice(0, maxChars)}…` : displayText);

	async function copyUrl(e: MouseEvent) {
		e.preventDefault();
		e.stopPropagation();
		try {
			await navigator.clipboard.writeText(fullUrl);
			copied = true;
			setTimeout(() => (copied = false), 1500);
		} catch {
			window.open(fullUrl, '_blank');
		}
	}
</script>

<TooltipProvider>
	<Tooltip>
		<TooltipTrigger>
			<a
				href={fullUrl}
				target="_blank"
				rel="noopener noreferrer"
				class="group inline-flex items-center gap-1.5 rounded-full px-2 py-1 text-[13px] text-muted-foreground transition-colors hover:text-primary hover:bg-muted/50"
			>
				<span class="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-muted/50 text-muted-foreground group-hover:bg-muted/80 group-hover:text-foreground">
					<LinkIcon class="h-3 w-3" />
				</span>
				<span class="max-w-[160px] truncate">{truncated}</span>
				<span class="hidden shrink-0 group-hover:inline">
					<button
						type="button"
						onclick={copyUrl}
						class="rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
						aria-label="Copiază URL"
					>
						{#if copied}
							<CheckIcon class="h-3.5 w-3 text-green-600 dark:text-green-400" />
						{:else}
							<CopyIcon class="h-3.5 w-3" />
						{/if}
					</button>
				</span>
			</a>
		</TooltipTrigger>
		<TooltipContent side="top" class="max-w-[320px] !bg-popover !text-popover-foreground border border-border shadow-lg p-3 rounded-lg">
			<p class="break-all text-xs">{fullUrl}</p>
			<p class="mt-1 text-xs text-muted-foreground">Click = deschide · Icon = copiază</p>
		</TooltipContent>
	</Tooltip>
</TooltipProvider>
