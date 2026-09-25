export function buildArchivedBuildLink(
	doc: Document,
	archivedVersion: string,
): HTMLAnchorElement {
	const link = doc.createElement("a");
	link.href = `./v/${archivedVersion}/`;
	link.textContent = `v${archivedVersion} →`;
	return link;
}
