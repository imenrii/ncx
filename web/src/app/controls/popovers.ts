/**
 * `details.pop` dismissal, as in Style/Web/components/components.js: a press
 * outside closes a popover, and Escape closes the innermost open one and
 * returns focus to its key.
 */
let installed = false;

export function installPopoverDismissal(): void {
  if (installed || typeof document === "undefined") return;
  installed = true;
  document.addEventListener("pointerdown", event => {
    for (const pop of document.querySelectorAll<HTMLDetailsElement>("details.pop[open]")) {
      if (!pop.contains(event.target as Node)) pop.open = false;
    }
  });
  document.addEventListener("keydown", event => {
    if (event.key !== "Escape" || event.defaultPrevented) return;
    const open = [...document.querySelectorAll<HTMLDetailsElement>("details.pop[open]")];
    const innermost = open.filter(pop => !pop.querySelector("details.pop[open]")).at(-1);
    if (!innermost) return;
    event.preventDefault();
    innermost.open = false;
    innermost.querySelector<HTMLElement>(":scope > summary")?.focus();
  });
}
