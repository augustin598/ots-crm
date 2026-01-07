<script lang="ts" module>
	import type { WithElementRef } from 'bits-ui';
	import type { HTMLAnchorAttributes, HTMLInputAttributes } from 'svelte/elements';
	import { type VariantProps, tv } from 'tailwind-variants';

	export const inputsVariants = tv({
		base: 'flex h-10 w-full border border-[#e6e6e6] bg-background px-4 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-[rgba(0,0,0,0.4)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#f40] focus-visible:border-[#f40] disabled:cursor-not-allowed disabled:opacity-50 transition-colors',
		variants: {
			variant: {
				default: 'bg-white border-[#e6e6e6] text-black',
				primary: 'bg-background border-[#f40] text-black focus-visible:ring-[#f40]',
				outline: 'border-[#e6e6e6] bg-white text-black',
				error: 'border-red-500 focus-visible:ring-red-500',
				success: 'border-green-500 focus-visible:ring-green-500',
				transparent: 'bg-transparent border-transparent',
				search: 'pl-10 pr-4'
			},
			size: {
				default: 'h-10 px-4 py-2 text-sm',
				sm: 'h-8 px-3 py-1 text-xs',
				lg: 'h-12 px-6 py-3 text-base'
			},
			rounded: {
				full: 'rounded-full',
				default: 'rounded-md'
			}
		},
		defaultVariants: {
			variant: 'default',
			size: 'default',
			rounded: 'default'
		}
	});

	export type InputVariant = VariantProps<typeof inputsVariants>['variant'];
	export type InputSize = VariantProps<typeof inputsVariants>['size'];

	export type InputProps = WithElementRef<HTMLInputAttributes> &
		WithElementRef<HTMLAnchorAttributes> & {
			variant?: InputVariant;
			size?: InputSize;
		};
</script>

<script lang="ts">
	import { cn } from '$lib/utils.js';

	let {
		ref = $bindable(null),
		value = $bindable(),
		variant = 'default',
		size = 'default',
		rounded = 'default',
		class: className,
		...restProps
	}: InputProps = $props();
</script>

<input
	bind:this={ref}
	class={cn(inputsVariants({ variant, size, rounded }), className)}
	style="font-family: 'Plus Jakarta Sans', sans-serif;"
	bind:value
	{...restProps}
/>
