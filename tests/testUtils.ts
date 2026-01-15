import type { Logger } from '../src'

export const silentLogger: Logger = {
	trace: () => undefined,
	debug: () => undefined,
	info: () => undefined,
	warn: () => undefined,
	error: () => undefined,
	fatal: () => undefined,
}
