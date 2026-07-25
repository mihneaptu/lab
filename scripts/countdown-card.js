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

   The month and day are duplicated from animations/countdown/script.js,
   which owns them. With no build step there is nowhere shared to put six
   lines of date arithmetic, so the copy is deliberate: change the date
   there, change it here. */
(() => {
  const clock = document.querySelector(".cd-mini-clock");
  if (!clock) return; /* every page but the homepage */

  /* Keep in sync with MONTH / DAY in animations/countdown/script.js.
     The month is 0-indexed, the way Date takes it — 6 is July. */
  const MONTH = 6;
  const DAY = 26;

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

    /* The whole of the day counts as the day itself, exactly as the
       exhibit has it — so on the day, the card sits at zero rather than
       starting a fresh 364-day count and quietly disagreeing with the
       page it links to. */
    if (now.getMonth() === MONTH && now.getDate() === DAY) {
      write(0, 0, 0, 0);
      return;
    }

    let target = new Date(now.getFullYear(), MONTH, DAY, 0, 0, 0, 0);
    if (target <= now) {
      target = new Date(now.getFullYear() + 1, MONTH, DAY, 0, 0, 0, 0);
    }

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
