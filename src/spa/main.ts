import "./styles.css";
import { registerRoute, start } from "./router.js";
import { renderHome } from "./routes/home.js";

registerRoute("#/", (root) => renderHome(root));

start();
