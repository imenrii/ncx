/* Shared by the component catalogue and applications. Delegation covers selects
   added after page load, including framework-controlled fields. */
document.addEventListener("wheel", event => {
  const select = event.target.closest?.("select");
  if (!select || select.matches(":disabled") || select.multiple || event.ctrlKey || !event.deltaY) return;
  event.preventDefault();
  const step = Math.sign(event.deltaY);
  for (let index = select.selectedIndex + step; index >= 0 && index < select.options.length; index += step) {
    const option = select.options[index];
    if (option.matches(":disabled") || option.closest("[hidden]")) continue;
    select.selectedIndex = index;
    select.dispatchEvent(new Event("input", { bubbles: true }));
    select.dispatchEvent(new Event("change", { bubbles: true }));
    break;
  }
}, { passive: false });
