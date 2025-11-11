import { defineConfig } from 'tsdown'

// biome-ignore lint/style/noDefaultExport: <explanation>
export default defineConfig({
	exports: true,
	entry: {
		index: 'src/index.ts',
	},
	dts: {
		sourcemap: true,
	},
	format: ['esm', 'cjs'],
	clean: true,
	minify: false,
	treeshake: true,
})
