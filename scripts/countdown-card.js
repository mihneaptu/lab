/* The homepage countdown card's numbers.

   The card is a live miniature, like the sun-moon card's sky and the
   segmented control's thumb — but those two are live in the sense that
   they are the real markup wearing the real styles, which CSS can do
   alone. A countdown is only itself if it says how long is actually
   left, and no stylesheet knows the date. So this writes four numbers
   into the card, once a second.

   Everything the card DOES on hover — the digits lifting away, the
   message rising behind them — is CSS, in index.html's own style block.
   This file has no opinion about any of it.

   What it counts to is the visitor's own target, the one the exhibit
   saves under this key. The exhibit owns the setting; this only reads it,
   so there is no second copy of a date to keep in step — which the old
   version of this file had, as a duplicated month and day.

   With nothing set — a first visit, or a cleared field — there is no
   target to read, and the card still has to be a live miniature rather
   than four frozen dashes sitting next to two siblings that move. So it
   counts to the next midnight: always real, always ticking, and honest in
   a way an invented date wouldn't be. The exhibit itself answers the same
   empty state by playing the handoff, which is what the card's hover
   already shows. */
(() => {
  const clock = document.querySelector(".cd-mini-clock");
  if (!clock) return; /* every page but the homepage */

  /* The exhibit's storage key. Reads are wrapped because storage access
     can throw outright in a locked-down profile, not merely come back
     empty — and a card is nobody's reason to take the homepage down. */
  const KEY_TARGET = "countdown:target";

  function storedTarget() {
    let raw = null;
    try {
      raw = localStorage.getItem(KEY_TARGET);
    } catch {
      return null;
    }

    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw || "");
    if (!m) return null;
    const [, y, mo, d] = m.map(Number);
    /* Local midnight, built from parts. `new Date("2027-01-01")` parses
       as UTC and would put the card an hour or two out of step with the
       exhibit it links to, for anyone not on Greenwich. */
    const t = new Date(y, mo - 1, d, 0, 0, 0, 0);
    return t.getFullYear() === y && t.getMonth() === mo - 1 && t.getDate() === d
      ? t
      : null;
  }

  function nextMidnight() {
    const n = new Date();
    return new Date(n.getFullYear(), n.getMonth(), n.getDate() + 1, 0, 0, 0, 0);
  }

  const nums = {};
  clock.querySelectorAll("[data-unit]").forEach((el) => {
    nums[el.dataset.unit] = el;
  });

  const pad = (n) => String(n).padStart(2, "0");

  function write(d, h, m, s) {
    nums.d.textContent = d;
    nums.h.textContent = pad(h);
    nums.m.textContent = pad(m);
    nums.s.textContent = pad(s);
  }

  function tick() {
    const now = new Date();
    const saved = storedTarget();

    /* A target that has arrived sits at zero rather than rolling on to
       something else, exactly as the exhibit has it — so the card and the
       page it links to never quietly disagree about whether the moment
       has come. */
    if (saved !== null && saved <= now) {
      write(0, 0, 0, 0);
      return;
    }

    const target = saved !== null ? saved : nextMidnight();
    const total = Math.max(0, Math.floor((target - now) / 1000));
    write(
      Math.floor(total / 86400),
      Math.floor(total / 3600) % 24,
      Math.floor(total / 60) % 60,
      total % 60
    );
  }

  /* Aligned to the wall clock rather than run on a plain interval, for
     the same reason the exhibit is: a 1000ms interval drifts against the
     second it is displaying, and the seconds digit starts repeating or
     skipping values. Landing a moment past each boundary guarantees the
     value has rolled over by the time it is read. */
  let timer = null;

  function schedule() {
    clearTimeout(timer);
    timer = setTimeout(() => {
      tick();
      schedule();
    }, 1000 - (Date.now() % 1000) + 25);
  }

  /* Nothing to count while nobody is looking. A hidden tab would have
     its timer throttled to a crawl anyway and come back showing a stale
     number, so the card stops and re-reads the clock on return. */
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") {
      clearTimeout(timer);
      return;
    }
    tick();
    schedule();
  });

  tick();
  schedule();
})();
