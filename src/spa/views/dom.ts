export function tryFocus(el: HTMLElement): void {
	try {
		el.focus();
	} catch {}
}

export function trySetCaret(input: HTMLInputElement, position: number): void {
	try {
		input.setSelectionRange(position, position);
	} catch {}
}

export function dropListenersByCloning<T extends Element>(el: T): T {
	const clone = el.cloneNode(true) as T;
	el.replaceWith(clone);
	return clone;
}
