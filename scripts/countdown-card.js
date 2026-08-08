/* The homepage countdown card's arrival sentence.

   The card is a miniature of the countdown exhibit, and everything it
   DOES on hover — the digits lifting away, the message rising behind
   them — is CSS, in index.html's own style block. This file has no
   opinion about any of it.

   It used to write four live numbers into the card as well, because the
   exhibit was a real countdown and a countdown is only itself if it says
   how long is actually left. The exhibit isn't one any more: it runs a
   few seconds and hands off. So the card's clock is four zeros in the
   markup — the moment the handoff fires from, which is exactly the frame
   the hover animates out of — and no script is needed to hold it there.

   What is left is one string. The exhibit lands on a different sentence
   depending on which occasion is armed, and that choice is remembered
   between visits, so a card asserting "Happy new year!" while the page it
   links to says "Happy birthday!" would be a mismatch a visitor notices —
   the card's hover plays the very handoff the exhibit lands with.

   The three sentences are duplicated from the exhibit's THEMES table
   because with no build step there is nowhere shared to put them. Keep
   them in step by hand; animations/countdown/script.js is the original. */
(() => {
  const messageEl = document.querySelector(".cd-mini-message");
  if (!messageEl) return; /* every page but the homepage */

  const KEY_THEME = "countdown:theme";

  const MESSAGES = {
    birthday: "Happy birthday!",
    newyear: "Happy new year!",
    launch: "It's live!",
  };

  /* The read is wrapped because storage access can throw outright in a
     locked-down profile, not merely come back empty — and a card is
     nobody's reason to take the homepage down. An unrecognised value
     falls back the same way the exhibit's own does. */
  let saved = null;
  try {
    saved = localStorage.getItem(KEY_THEME);
  } catch {
    return; /* the markup's default stands */
  }

  /* Written once, at load. The occasion can only be changed on the
     exhibit's own page, and coming back here is a navigation, which runs
     this again. The markup carries the default as its no-JS fallback, so
     this only ever has to correct it. */
  if (MESSAGES[saved]) messageEl.textContent = MESSAGES[saved];
})();
