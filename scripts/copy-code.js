/* The "copy code" link on exhibit pages. Left alone it's a plain link
   to the exhibit's standalone snippet (code.html, sitting next to the
   exhibit); with JS it becomes a copy button: fetch the snippet, put
   its full source on the clipboard, and roll the label over to
   "copied" for a moment.

   Any failure falls through to the link's normal job — navigating to
   the snippet. That covers every environment the fetch-and-copy path
   can't: file:// (fetch refuses cross-file reads), browsers without
   the async clipboard, a denied clipboard permission. The visitor
   still gets the code, just one view-source away. */
(() => {
  /* All of them, not the first: a page showing two implementations side
     by side wants a snippet for each, and a single-element lookup would
     leave the second corner as a plain link with no explanation. */
  const links = document.querySelectorAll(".copy-code");
  if (!links.length || !navigator.clipboard || !window.fetch) return;

  /* The label swap is a visual event, and a screen reader watching the
     link would hear nothing but its name, which never changes. One
     announcer for the page, off-screen, says the part the roll says.
     role="status" is the polite one: it waits for a gap in speech
     rather than cutting the reader off mid-sentence.

     Named, because an exhibit may well have a live region of its own —
     the countdown narrates itself to the same kind of reader — and two
     anonymous off-screen paragraphs are impossible to tell apart from
     the outside. */
  const status = document.createElement("p");
  status.className = "copy-code__status visually-hidden";
  status.setAttribute("role", "status");
  document.body.appendChild(status);

  links.forEach((link) => {
    /* The resting label is whatever the page wrote, not a constant here,
       so restoring it can't rename a link that said something else. */
    const resting = link.textContent.trim();
    const href = link.getAttribute("href");

    /* Rebuild the link's insides as a two-word slot. The page ships the
       plain link and this adds the machinery, so the markup stays honest
       about what works without JS — and the four exhibit pages don't
       each have to carry a copy of this structure.

       The confirmation is aria-hidden: it's a second copy of a word the
       announcer above already handles, and left visible to the
       accessibility tree it would pad the link's name into
       "copy code copied" forever after. */
    const slot = document.createElement("span");
    slot.className = "copy-code__slot";

    const restWord = document.createElement("span");
    restWord.className = "copy-code__word copy-code__word--rest";
    restWord.textContent = resting;

    const doneWord = document.createElement("span");
    doneWord.className = "copy-code__word copy-code__word--done";
    doneWord.textContent = "copied";
    doneWord.setAttribute("aria-hidden", "true");

    slot.append(restWord, doneWord);
    link.replaceChildren(slot);

    let resetTimer;
    let snippet = null;   /* the source, once we're holding it */
    let inFlight = null;  /* the request for it, so we only ask once */

    /* Fetch the snippet ahead of the click. Pointing at the link or
       tabbing to it is a reliable tell that a click is coming, and the
       round trip costs a few kilobytes of a file the visitor was about
       to ask for anyway.

       no-cache: revalidate instead of trusting a stale cached copy —
       the snippet must match the code that's actually live. */
    const warm = () => {
      if (snippet !== null || inFlight) return inFlight;

      inFlight = fetch(href, { cache: "no-cache" })
        .then((res) => {
          if (!res.ok) throw new Error(String(res.status));
          return res.text();
        })
        .then((text) => {
          snippet = text;
        })
        .catch(() => {
          /* Swallowed on purpose: warming is speculative and must never
             surface an error for a click that hasn't happened. Dropping
             the handle lets a real click try again — and if that fails
             too, it falls back to navigation. */
          inFlight = null;
        });

      return inFlight;
    };

    /* pointerdown as well as hover, for touch: there's no hovering on a
       phone, but a finger rests on the link for tens of milliseconds
       before the click fires, which is a head start worth taking. */
    link.addEventListener("pointerenter", warm);
    link.addEventListener("pointerdown", warm);
    link.addEventListener("focus", warm);

    link.addEventListener("click", async (event) => {
      /* A modified click is a request for a new tab, a new window, or a
         download — the browser's job, not ours. Preventing the default
         here would make ctrl-click quietly copy instead, which is the
         one thing a link is expected never to do. (Middle-click never
         reaches this: it arrives as auxclick.) */
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
        return;
      }

      event.preventDefault();

      /* When warming has already landed the snippet — which is the usual
         case, since you have to reach the link to click it — the write
         goes out with no await ahead of it, still inside the click's own
         task. That isn't only about speed: Safari grants clipboard
         access to the gesture, not to whatever the page gets around to
         later, so an awaited write is one it can refuse outright. */
      if (snippet === null) await warm();
      if (snippet === null) {
        window.location.href = link.href;
        return;
      }

      try {
        await navigator.clipboard.writeText(snippet);
      } catch {
        window.location.href = link.href;
        return;
      }

      /* The confirmation is the label itself: "copy code" rolls up out
         of the slot, "copied" rolls up into it, both sit for a beat, and
         the pair rolls back. The class is the whole of it — the CSS owns
         the geometry and honours reduced motion by way of the global
         rule in base.css. */
      link.classList.add("is-copied");
      status.textContent = "copied to clipboard";

      clearTimeout(resetTimer);
      resetTimer = setTimeout(() => {
        link.classList.remove("is-copied");
        /* Cleared so the next copy is a fresh change to announce and not
           a repeat the reader is free to ignore. */
        status.textContent = "";
      }, 1600);
    });
  });
})();
