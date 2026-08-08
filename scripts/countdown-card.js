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

   What it counts to is what the exhibit counts to: the next 1st of
   January, at local midnight. The rule is duplicated here rather than
   read out of storage, because there is nothing in storage to read — the
   exhibit counts to one fixed date now, not to a target the visitor sets.
   With no build step there is nowhere shared to put the rule, and a card
   quietly disagreeing with the page it links to is the mismatch a visitor
   would actually notice. Keep the two in step by hand; nextNewYear() in
   animations/countdown/script.js is the original. */
(() => {
  const clock = document.querySelector(".cd-mini-clock");
  if (!clock) return; /* every page but the homepage */

  /* The exhibit's one stored setting. The read is wrapped because storage
     access can throw outright in a locked-down profile, not merely come
     back empty — and a card is nobody's reason to take the homepage
     down. */
  const KEY_THEME = "countdown:theme";

  /* The exhibit's three arrival sentences, by occasion. Duplicated from
     its THEMES table for the same reason the date is, and with the same
     obligation: leaving the card asserting one sentence while the exhibit
     uses another would show, since the card's hover plays the very
     handoff the exhibit lands with. */
  const MESSAGES = {
    birthday: "Happy birthday!",
    newyear: "Happy new year!",
    launch: "It's live!",
  };

  function storedTheme() {
    let raw = null;
    try {
      raw = localStorage.getItem(KEY_THEME);
    } catch {
      return "newyear";
    }
    return MESSAGES[raw] ? raw : "newyear";
  }

  /* Local midnight on the next 1st of January — which on January 1st is
     today, not a year away. Built from parts rather than parsed from a
     string: `new Date("2027-01-01")` parses as UTC and would put the card
     an hour or two out of step with the exhibit it links to, for anyone
     not on Greenwich. */
  function nextNewYear() {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
    const jan1 = new Date(now.getFullYear(), 0, 1, 0, 0, 0, 0);
    return jan1 >= today ? jan1 : new Date(now.getFullYear() + 1, 0, 1, 0, 0, 0, 0);
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

  /* Read once, like the exhibit's, so a tab left open across the turn of
     the year runs the card down to zero rather than rolling it on to the
     January after. */
  const target = nextNewYear();

  function tick() {
    const total = Math.max(0, Math.floor((target - Date.now()) / 1000));
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

  /* Written once at load rather than every tick: the theme can only
     change on the exhibit's own page, and coming back here is a
     navigation, which re-runs this. The markup carries the default as
     its no-JS fallback, so this only ever has to correct it. */
  const messageEl = document.querySelector(".cd-mini-message");
  if (messageEl) messageEl.textContent = MESSAGES[storedTheme()];

  tick();
  schedule();
})();
