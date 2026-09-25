import { lookupArchiveVersion } from "../persistence/archive-map.js";

export const VERSION_MISMATCH_MESSAGE =
	"Saved game data is from an older version of hi-blue and cannot be loaded by this build. It has been kept — start a new game, or remove it from your Sessions list.";

export function buildArchivedBuildLink(
	doc: Document,
	archivedVersion: string,
): HTMLAnchorElement {
	const link = doc.createElement("a");
	link.href = `./v/${archivedVersion}/`;
	link.textContent = `v${archivedVersion} →`;
	return link;
}

function renderVersionMismatchBanner(
	doc: Document,
	bannerEl: HTMLElement,
	schemaVersion: number | undefined,
): void {
	bannerEl.textContent = "";
	const archivedVersion = lookupArchiveVersion(schemaVersion);
	if (archivedVersion === null) {
		bannerEl.textContent = VERSION_MISMATCH_MESSAGE;
		return;
	}
	bannerEl.appendChild(
		doc.createTextNode(
			"Your saved Session is from an older version of hi-blue. Continue it in ",
		),
	);
	bannerEl.appendChild(buildArchivedBuildLink(doc, archivedVersion));
	bannerEl.appendChild(doc.createTextNode(", or start a new Session below."));
}

export function renderReasonBanner(
	doc: Document,
	bannerEl: HTMLElement,
	reason: string | null,
	schemaVersion: number | undefined,
	messages: Record<string, string>,
): boolean {
	const message = reason === null ? undefined : messages[reason];
	if (!message) return false;
	if (reason === "version-mismatch") {
		renderVersionMismatchBanner(doc, bannerEl, schemaVersion);
	} else {
		bannerEl.textContent = message;
	}
	return true;
}
