/// <reference types="vitest/config" />
import tailwindcss from '@tailwindcss/vite';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

export default defineConfig({
	plugins: [tailwindcss(), sveltekit()],
	server: {
		port: 8081,
		host: '0.0.0.0'
	},
	test: {
		include: ['tests/**/*.test.ts'],
		environment: 'jsdom',
		alias: {
			$lib: new URL('./src/lib', import.meta.url).pathname
		}
	}
});
