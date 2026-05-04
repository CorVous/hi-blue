import "./styles.css";
import { initByokModal } from "./byok-modal.js";
import { registerRoute, start } from "./router.js";
import { renderHome } from "./routes/home.js";

registerRoute("#/", (root) => renderHome(root));

start();
initByokModal();
