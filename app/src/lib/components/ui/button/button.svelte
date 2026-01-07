<script lang="ts" module>
	import { cn, type WithElementRef } from "$lib/utils.js";
	import type { HTMLAnchorAttributes, HTMLButtonAttributes } from "svelte/elements";
	import { type VariantProps, tv } from "tailwind-variants";

	export const buttonVariants = tv({
		base: 'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-full text-sm font-medium transition-all focus-visible:outline-none focus-visible:ring-0 focus-visible:ring-ring focus-visible:ring-offset-0 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0',
		variants: {
			variant: {
				default: 'bg-[#f40] text-white hover:bg-[#f40]/90 border border-[#f40] shadow-[0px_3px_10px_0px_rgba(255,68,0,0.2)]',
				destructive:
					'bg-destructive-foreground text-destructive hover:bg-destructive-foreground/90',
				outline: 'border border-[#e6e6e6] bg-white text-black hover:bg-gray-50 shadow-[0px_3px_5px_0px_rgba(0,0,0,0.05)]',
				outlineDark: 'border border-white bg-transparent text-white hover:bg-white/10',
				secondary: 'bg-red-600 text-white hover:bg-red-600/80  border border-red-600',
				ghost:
					'bg-transparent text-gray-400 hover:bg-transparent hover:text-black focus:text-black',
				link: 'text-primary underline-offset-4 hover:underline',
				white: 'bg-white text-black hover:bg-white/80 border border-white',
				transparent: 'bg-transparent'
			},
			size: {
				default: 'h-10 px-5 text-sm',
				sm: 'h-9 px-4 py-2 text-sm',
				md: 'h-[35px] px-[15px] text-sm',
				lg: 'h-12 px-8 py-3 text-base',
				xl: 'h-[45px] px-5 text-[15px]',
				icon: 'h-10 px-4 w-10'
			},
			rounded: {
				full: 'rounded-full',
				xl: 'rounded-xl',
				'2xl': 'rounded-2xl',
				default: 'rounded-full'
			}
		},
		defaultVariants: {
			variant: 'default',
			size: 'default',
			rounded: 'default'
		}
	});

	export type ButtonVariant = VariantProps<typeof buttonVariants>["variant"];
	export type ButtonSize = VariantProps<typeof buttonVariants>["size"];

	export type ButtonRounded = VariantProps<typeof buttonVariants>["rounded"];

	export type ButtonProps = WithElementRef<HTMLButtonAttributes> &
		WithElementRef<HTMLAnchorAttributes> & {
			variant?: ButtonVariant;
			size?: ButtonSize;
			rounded?: ButtonRounded;
		};
</script>

<script lang="ts">
	let {
		class: className,
		variant = "default",
		size = "default",
		rounded = "default",
		ref = $bindable(null),
		href = undefined,
		type = "button",
		disabled,
		children,
		...restProps
	}: ButtonProps = $props();
</script>

{#if href}
	<a
		bind:this={ref}
		data-slot="button"
		class={cn(buttonVariants({ variant, size, rounded }), className)}
		style="font-family: 'Plus Jakarta Sans', sans-serif;"
		href={disabled ? undefined : href}
		aria-disabled={disabled}
		role={disabled ? "link" : undefined}
		tabindex={disabled ? -1 : undefined}
		{...restProps}
	>
		{@render children?.()}
	</a>
{:else}
	<button
		bind:this={ref}
		data-slot="button"
		class={cn(buttonVariants({ variant, size, rounded }), className)}
		style="font-family: 'Plus Jakarta Sans', sans-serif;"
		{type}
		{disabled}
		{...restProps}
	>
		{@render children?.()}
	</button>
{/if}
