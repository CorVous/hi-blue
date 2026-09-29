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

export function setHidden(
	doc: Document,
	selectors: readonly string[],
	hidden: boolean,
): void {
	for (const selector of selectors) {
		const el = doc.querySelector<HTMLElement>(selector);
		if (el) el.hidden = hidden;
	}
}
