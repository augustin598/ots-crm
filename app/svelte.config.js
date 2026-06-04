import adapter from './adapter/index.ts';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

/** @type {import('@sveltejs/kit').Config} */
const config = {
	// Consult https://svelte.dev/docs/kit/integrations
	// for more information about preprocessors
	preprocess: [vitePreprocess()],
	kit: {
		adapter: adapter({ precompress: true, isr: false }),
		experimental: { remoteFunctions: true },
		csrf: {
			trustedOrigins: ['https://crm.navitech.cloud', 'https://localhost:3000']
		},
		// Content-Security-Policy. mode:'hash' → SvelteKit appends sha256 of its own
		// inline hydration <script> to script-src (deterministic, cache-safe with the
		// precompress adapter). style-src keeps 'unsafe-inline' on purpose: Svelte emits
		// dynamic `style="..."` attributes that nonce/hash cannot cover — and because
		// 'unsafe-inline' is present, SvelteKit leaves style-src untouched (csp.js:142).
		// Allowlist matches what the BROWSER loads: Stripe PaymentElement, Google Fonts,
		// arbitrary client logos over https. Server→server API calls (Keez, Meta, ANAF,
		// banks…) are not browser fetches and need no CSP entry.
		csp: {
			mode: 'hash',
			directives: {
				'default-src': ['self'],
				'script-src': ['self', 'https://js.stripe.com'],
				'style-src': ['self', 'unsafe-inline', 'https://fonts.googleapis.com'],
				'font-src': ['self', 'data:', 'https://fonts.gstatic.com'],
				'img-src': ['self', 'data:', 'https:'],
				'connect-src': ['self', 'https://api.stripe.com'],
				'frame-src': ['self', 'https://js.stripe.com', 'https://hooks.stripe.com'],
				'frame-ancestors': ['self'],
				'form-action': ['self'],
				'base-uri': ['self'],
				'object-src': ['none'],
				'upgrade-insecure-requests': true
			}
		}
	},
	compilerOptions: {
		experimental: {
			async: true
		}
	}
};

export default config;
