import {
	type EventDescriptor,
	Eventure,
	EvtChannel,
	type IEventMap,
	type Logger,
} from 'eventure'

export const silentLogger: Logger = {
	trace: () => undefined,
	debug: () => undefined,
	info: () => undefined,
	warn: () => undefined,
	error: () => undefined,
	fatal: () => undefined,
}

export function createEventure<E extends IEventMap<E>>() {
	return new Eventure<E>({ logger: silentLogger })
}

export function createChannel<D extends EventDescriptor>() {
	return new EvtChannel<D>({ logger: silentLogger })
}
