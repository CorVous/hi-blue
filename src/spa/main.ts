import "./styles.css";
import { initByokModal } from "./byok-modal.js";
import { registerRoute, start } from "./router.js";
import { renderGame } from "./routes/game.js";

registerRoute("#/", (root, params) => renderGame(root, params));
registerRoute("#/game", (root, params) => renderGame(root, params));

start();
initByokModal();
