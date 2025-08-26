export type Logger = {
	trace: (...arguments_: unknown[]) => void
	debug: (...arguments_: unknown[]) => void
	info: (...arguments_: unknown[]) => void
	warn: (...arguments_: unknown[]) => void
	error: (...arguments_: unknown[]) => void
	fatal: (...arguments_: unknown[]) => void
}

export const defaultLogger: Logger = {
	info: console.info.bind(console),
	warn: console.warn.bind(console),
	error: console.error.bind(console),
	debug: console.debug?.bind(console) ?? console.log.bind(console),
	trace: console.trace?.bind(console) ?? console.log.bind(console),
	fatal: console.error.bind(console),
}
