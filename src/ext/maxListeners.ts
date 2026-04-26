export function normalizeMaxListeners(count: number): number {
	if (
		count !== Number.POSITIVE_INFINITY &&
		(!Number.isInteger(count) || count < 0)
	) {
		throw new RangeError(
			'maxListeners must be a non-negative integer or Infinity',
		)
	}
	return count
}

export function shouldWarnMaxListeners(count: number, maxListeners: number) {
	return maxListeners !== 0 && count > maxListeners
}
