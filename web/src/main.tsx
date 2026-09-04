import { createRoot } from "react-dom/client";

import { HubGate } from "./HubGate";
import "./style.css";

const root = document.querySelector("#app");
if (!root) throw new Error("ncx application root is missing");

createRoot(root).render(<HubGate />);
