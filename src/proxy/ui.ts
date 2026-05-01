/**
 * Re-exports the page renderers from src/ui.ts.
 * The implementations live in the shared src/ tree so JSDOM browser tests
 * can import them.
 */
export {
	renderChatPage,
	renderEndgameScreen,
	renderPhaseCompleteOverlay,
	renderThreePanelPage,
} from "../ui.js";
