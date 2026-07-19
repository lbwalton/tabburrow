/**
 * Actuation glow: a brief accent underglow pulse on the control you press,
 * confirming the tap. One delegated `pointerdown` listener (capture phase, so
 * it fires even when a handler stops propagation) finds the nearest real
 * control and plays the `.tb-actuate` animation defined in
 * assets/tailwind.css, then removes the class on `animationend` so the element
 * returns to its normal box-shadow.
 *
 * Pointer-only on purpose: keyboard activation keeps its focus ring (a
 * box-shadow the glow would otherwise clobber for a frame), and the effect is
 * a no-op under `prefers-reduced-motion: reduce`. Idempotent per document.
 */

const SELECTOR = 'button, a[href], [role="menuitem"], [role="option"]';
const CLASS = "tb-actuate";

let installed = false;

export function installActuationGlow(doc: Document = document): void {
  if (installed) return;
  const view = doc.defaultView;
  if (!view) return;
  installed = true;

  const reduce = view.matchMedia?.("(prefers-reduced-motion: reduce)");

  doc.addEventListener(
    "pointerdown",
    (event) => {
      if (reduce?.matches) return;
      const start = event.target as Element | null;
      const el = start?.closest?.(SELECTOR) as HTMLElement | null;
      if (!el) return;
      if (el.hasAttribute("disabled") || el.getAttribute("aria-disabled") === "true") return;

      // Restart cleanly on rapid re-clicks: drop the class, force a reflow so
      // the browser sees a state change, then re-add it.
      el.classList.remove(CLASS);
      void el.offsetWidth;
      el.classList.add(CLASS);

      const clear = () => {
        el.classList.remove(CLASS);
        el.removeEventListener("animationend", clear);
      };
      el.addEventListener("animationend", clear);
    },
    true,
  );
}
