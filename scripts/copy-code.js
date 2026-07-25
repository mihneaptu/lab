/* The "copy code" link on exhibit pages. Left alone it's a plain link
   to the exhibit's standalone snippet (code.html, sitting next to the
   exhibit); with JS it becomes a copy button: fetch the snippet, put
   its full source on the clipboard, and say "copied" for a moment.

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

  links.forEach((link) => {
    /* The resting label is whatever the page wrote, not a constant here,
       so restoring it can't rename a link that said something else. Each
       link keeps its own timer too: one corner settling back must not cut
       another's confirmation short. */
    const resting = link.textContent;
    let resetTimer;

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

      try {
        /* no-cache: revalidate instead of trusting a stale cached copy —
           the snippet must match the code that's actually live */
        const res = await fetch(link.getAttribute("href"), { cache: "no-cache" });
        if (!res.ok) throw new Error(String(res.status));
        await navigator.clipboard.writeText(await res.text());
      } catch {
        window.location.href = link.href;
        return;
      }

      /* The confirmation is the label itself — the word swaps, sits for a
         beat, and swaps back. Pinned to the right edge, so the shorter
         word grows from the same corner. */
      link.textContent = "copied";
      clearTimeout(resetTimer);
      resetTimer = setTimeout(() => {
        link.textContent = resting;
      }, 1600);
    });
  });
})();
