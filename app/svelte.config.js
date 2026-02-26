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
		}
	},
	compilerOptions: {
		experimental: {
			async: true
		}
	}
};

export default config;
