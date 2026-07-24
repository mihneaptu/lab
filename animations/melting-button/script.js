/* Melting button

   The melt itself is CSS (buttons.css); this file only decides when a
   button is done. A click arms it once, and the button leaves on its own
   terminal animation — with a timer as the safety net for a browser that
   never fires animationend, so a specimen can never be left melting
   forever.

   The second half is the crunch captions on touch, where there is no
   hover to reveal them: tapping an effort label pins its heading open,
   and tapping anywhere else closes it.
 */

function attachMelt(button) {
  const terminalAnimation = button.dataset.terminalAnimation;
  const fallbackMs = Number(button.dataset.fallbackMs);
  let isMelting = false;
  let removalTimer;

  function removeButton() {
    window.clearTimeout(removalTimer);
    button.remove();
  }

  button.addEventListener("click", () => {
    if (isMelting) return;

    isMelting = true;
    button.setAttribute("aria-disabled", "true");
    button.classList.add("is-melting");
    removalTimer = window.setTimeout(removeButton, fallbackMs);
  });

  button.addEventListener("animationend", (event) => {
    if (
      event.target === button
      && event.animationName === terminalAnimation
    ) {
      removeButton();
    }
  });
}

document.querySelectorAll(".melt-button").forEach(attachMelt);

// The crunch captions on touch: tapping an effort label toggles its
// heading open; tapping anywhere else closes whatever is open. On
// desktop this coexists with the hover reveal (a click just pins it).
document.addEventListener("click", (event) => {
  const effort = event.target.closest(".melt-effort");

  document.querySelectorAll(".melt-heading.is-open").forEach((heading) => {
    if (!effort || !heading.contains(effort)) {
      heading.classList.remove("is-open");
    }
  });

  if (effort) {
    effort.closest(".melt-heading").classList.toggle("is-open");
  }
});