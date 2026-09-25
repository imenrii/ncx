import { createRoot } from "react-dom/client";

import { HubGate } from "./hub/HubGate";
import { installPopoverDismissal } from "./app/controls/popovers";
import "./select-wheel.js";
import "./components.css";
import "./style.css";

const root = document.querySelector("#app");
if (!root) throw new Error("ncx application root is missing");

installPopoverDismissal();
createRoot(root).render(<HubGate />);
