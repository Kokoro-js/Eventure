import { defineConfig } from 'tsdown'

// biome-ignore lint/style/noDefaultExport: tsdown expects default-exported config
export default defineConfig({
	exports: {
		devExports: "source"
	},
	entry: {
		index: 'src/index.ts',
	},
	dts: {
		sourcemap: true,
	},
	format: ['esm', 'cjs'],
	clean: true,
	minify: true,
	treeshake: true,
})
