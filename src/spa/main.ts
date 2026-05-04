import "./styles.css";
import { registerRoute, start } from "./router.js";
import { renderGame } from "./routes/game.js";
import { renderHome } from "./routes/home.js";

registerRoute("#/", (root) => renderHome(root));
registerRoute("#/game", (root) => renderGame(root));

start();
