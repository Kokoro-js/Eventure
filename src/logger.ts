export type Logger = {
	trace: (message: string, ...arguments_: unknown[]) => void
	debug: (message: string, ...arguments_: unknown[]) => void
	info: (message: string, ...arguments_: unknown[]) => void
	warn: (message: string, ...arguments_: unknown[]) => void
	error: (message: string, ...arguments_: unknown[]) => void
	fatal: (message: string, ...arguments_: unknown[]) => void
}

export const defaultLogger: Logger = {
	info: console.info.bind(console),
	warn: console.warn.bind(console),
	error: console.error.bind(console),
	debug: console.debug?.bind(console) ?? console.log.bind(console),
	trace: console.trace?.bind(console) ?? console.log.bind(console),
	fatal: console.error.bind(console),
}
