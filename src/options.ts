/** 统一的注册选项：保持入参稳定，有利于内联与 JIT */
export interface OnOptions {
	/** 是否前插（默认尾插） */
	prepend?: boolean
	/** 绑定 AbortSignal，触发后自动退订 */
	signal?: AbortSignal
}
