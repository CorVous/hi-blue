/**
 * Re-exports page renderers from src/ui.ts.
 * The implementation lives in the shared src/ tree so JSDOM browser tests can import it.
 */
export { renderChatPage, renderEndgamePage } from "../ui.js";
