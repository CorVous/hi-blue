/**
 * Build the anchor that links a save to the archived `/v/<version>/` build
 * that last shipped its format. Shared by the session and start banners and
 * by the picker's version-mismatch row note so the link contract lives once.
 */
export function buildArchivedBuildLink(
	doc: Document,
	archivedVersion: string,
): HTMLAnchorElement {
	const link = doc.createElement("a");
	link.href = `./v/${archivedVersion}/`;
	link.textContent = `v${archivedVersion} →`;
	return link;
}
