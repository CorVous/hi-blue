/**
 * Re-exports the chat page renderer from src/ui.ts.
 * The implementation lives in the shared src/ tree so JSDOM browser tests can import it.
 */
export { renderChatPage } from "../ui.js";
