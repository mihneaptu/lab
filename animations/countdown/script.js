/* ==========================================================================
   Countdown — the engine

   Four numbers ticking down, and what happens when they run out: the
   digits lift away in sequence, the frame they sat in fades behind them,
   and the message they were counting to rises into the space. Then the
   confetti.

   The whole exhibit is built around one awkward fact: its payoff fires
   once a year. So every step of the handoff has to be replayable on
   demand, which means every step has to be CANCELLABLE — a visitor who
   presses replay twice in a second must not get two overlapping
   handoffs, and one who presses it mid-flight must land somewhere clean
   rather than in whatever half-state the first run had reached. The run
   token below is how that is arranged.
   ========================================================================== */

(() => {
  "use strict";

  /* --- The two facts ---------------------------------------------------

     Everything specific to THIS countdown is here. Point them somewhere
     else and the rest of the file doesn't care: it counts to a date and
     says a sentence, and has no opinion about which.

     The month is 0-indexed, the way Date takes it — 6 is July. A month
     and a day rather than a full date because this is an anniversary: it
     happens again next year, and hard-coding a year would leave the page
     counting to a moment in the past from the 27th onward. */
  const MONTH = 6;
  const DAY = 26;
  const MESSAGE = "Happy birthday!";

  /* How far out the replay button puts its target. Enough to show the
     whole arc rather than just the ending — the dimmed units and the
     pulsing seconds are both part of what this exhibit is, and a
     one-second demo would skip straight past them — but no longer than
     that, because the wait is the least interesting part and you may
     want to watch the handoff several times over.

     The real elapsed time is about a second more than this: the count
     spends a full second displaying "00" (zero is a real second, not an
     instant) before the handoff starts, and the handoff itself takes
     780ms on top. */
  const DEMO_SECONDS = 4;

  const body = document.body;
  const face = document.querySelector(".cd-face");
  const stacks = Array.from(document.querySelectorAll(".cd-stack"));
  const dateEl = document.querySelector(".cd-date");
  const messageEl = document.querySelector(".cd-message");
  const readingEl = document.querySelector(".cd-reading");
  const replayEl = document.querySelector(".cd-replay");
  const nums = {};
  document.querySelectorAll(".cd-num").forEach((el) => {
    nums[el.dataset.unit] = el;
  });

  messageEl.textContent = MESSAGE;

  /* Checked live at the moment of use rather than latched at load, so
     flipping the OS setting mid-session is honored — the same reading
     scripts/haptics.js takes of it. */
  const calm = matchMedia("(prefers-reduced-motion: reduce)");

  /* --- The run token ---------------------------------------------------

     A handoff is a handful of steps scheduled minutes apart in machine
     terms, and any of them can be made obsolete by a press of the replay
     button before it fires. Rather than collecting timer ids to clear —
     which means never forgetting to collect one, including the ones a
     recursive schedule creates while you're not looking — every step
     captures the run it belongs to and checks that it is still the
     current one before doing anything. Bumping the counter invalidates
     the entire pending timeline at a stroke, however many pieces it had
     grown into. */
  let run = 0;

  function later(fn, ms) {
    const mine = run;
    setTimeout(() => {
      if (mine === run) fn();
    }, ms);
  }

  /* --- Where the count is ---------------------------------------------- */

  /* Non-null only while a replay is running: a target a few seconds out
     that stands in for the real one. Everything downstream reads the
     state through one function, so the demo and the real thing are the
     same countdown and cannot drift apart in behaviour. */
  let demoTarget = null;

  /* The whole of the day counts as the day itself — a birthday is not
     over at 00:00:01. This is deliberately asked of the REAL calendar
     only, never of the demo, because the replay button needs to know
     whether there is a countdown to go back to. */
  function realIsDone() {
    const now = new Date();
    return now.getMonth() === MONTH && now.getDate() === DAY;
  }

  function nextAnniversary() {
    const now = new Date();
    const t = new Date(now.getFullYear(), MONTH, DAY, 0, 0, 0, 0);
    return t <= now
      ? new Date(now.getFullYear() + 1, MONTH, DAY, 0, 0, 0, 0)
      : t;
  }

  function state() {
    if (demoTarget !== null) {
      return Date.now() >= demoTarget
        ? { done: true }
        : { done: false, target: new Date(demoTarget), demo: true };
    }

    return realIsDone()
      ? { done: true }
      : { done: false, target: nextAnniversary(), demo: false };
  }

  /* --- The confetti ---------------------------------------------------- */

  const canvas = document.querySelector(".cd-fx");
  const ctx = canvas.getContext("2d");

  let parts = [];
  let rafId = null;
  let lastT = 0;
  let w = 0;
  let h = 0;

  /* Read out of the cascade rather than written here, so the one piece
     that is INK (--confetti-6) follows the theme like everything else
     does. A particle stores its palette INDEX, not the color that index
     resolved to at spawn time — so a theme flip mid-burst recolors the
     pieces already in the air instead of leaving a fistful of the old
     sky falling through the new one. */
  const SWATCHES = [
    "--confetti-1",
    "--confetti-2",
    "--confetti-3",
    "--confetti-4",
    "--confetti-5",
    "--confetti-6",
  ];
  let palette = SWATCHES.map(() => "#888");

  function readPalette() {
    const cs = getComputedStyle(document.documentElement);
    palette = SWATCHES.map((name, i) => {
      const v = cs.getPropertyValue(name).trim();
      return v || palette[i];
    });
  }

  function layout() {
    w = window.innerWidth;
    h = window.innerHeight;

    /* Cap the backing store at 2x. Past that the extra pixels cost real
       fill rate on a phone and buy nothing the eye can find on a
       5px-wide rectangle. */
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function spawn(n, o) {
    for (let i = 0; i < n; i++) {
      const a = o.angle + (Math.random() - 0.5) * o.spread;
      const v = o.velocity * (0.55 + Math.random() * 0.8);
      parts.push({
        x: o.x,
        y: o.y,
        vx: Math.cos(a) * v,
        vy: Math.sin(a) * v,
        w: 5 + Math.random() * 5,
        h: 8 + Math.random() * 6,
        hue: (Math.random() * palette.length) | 0,
        rot: Math.random() * Math.PI * 2,
        vrot: (Math.random() - 0.5) * 0.28,
        tilt: Math.random() * Math.PI * 2,
        vtilt: 0.07 + Math.random() * 0.12,
        life: 0,
        ttl: o.ttl,
      });
    }
    wake();
  }

  function wake() {
    if (rafId !== null) return;
    lastT = 0;
    rafId = requestAnimationFrame(frame);
  }

  function sleep() {
    if (rafId !== null) cancelAnimationFrame(rafId);
    rafId = null;
    lastT = 0;
  }

  function frame(now) {
    /* dt in frames rather than seconds, so the tuned constants below read
       as "per frame at 60Hz" — and clamped, because a tab that was
       backgrounded hands the first frame back an enormous gap that would
       teleport every piece off screen in one step. */
    const dt = lastT ? Math.min((now - lastT) / 16.667, 3) : 1;
    lastT = now;

    ctx.clearRect(0, 0, w, h);

    for (let i = parts.length - 1; i >= 0; i--) {
      const p = parts[i];
      p.life += dt;

      const fade = 1 - p.life / p.ttl;
      if (fade <= 0 || p.y > h + 60) {
        parts.splice(i, 1);
        continue;
      }

      p.vy += 0.21 * dt;               /* gravity */
      const drag = Math.pow(0.986, dt); /* air, framerate-independent */
      p.vx *= drag;
      p.vy *= drag;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.rot += p.vrot * dt;
      p.tilt += p.vtilt * dt;

      ctx.save();
      ctx.globalAlpha = Math.min(1, fade * 3);
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      /* The flutter. Scaling one axis by a cosine is a paper rectangle
         turning edge-on and back: it thins to nothing, then fills out
         the other way. Cheaper and more convincing than drawing the
         piece in perspective. */
      ctx.scale(1, Math.cos(p.tilt));
      ctx.fillStyle = palette[p.hue];
      ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
      ctx.restore();
    }

    if (parts.length) {
      rafId = requestAnimationFrame(frame);
    } else {
      ctx.clearRect(0, 0, w, h);
      sleep();
    }
  }

  function clearConfetti() {
    parts = [];
    sleep();
    ctx.clearRect(0, 0, w, h);
  }

  /* Two cannons firing inward from just off the left and right edges,
     angled up. Their power scales with the smaller viewport dimension so
     the arcs cross the middle on a phone as well as they do on a desk. */
  function cannons() {
    const y = h * 0.66;
    const power = Math.max(13, Math.min(w, h) / 48);
    spawn(75, { x: -12, y, angle: -Math.PI / 3.2, spread: 0.8, velocity: power, ttl: 280 });
    spawn(75, { x: w + 12, y, angle: -Math.PI + Math.PI / 3.2, spread: 0.8, velocity: power, ttl: 280 });
  }

  /* The long tail: a thin fall from above the top edge, restaged every
     240ms. Scheduled through later(), so a replay pressed halfway
     through stops it dead instead of raining into the next run. */
  function shower(left) {
    spawn(10, { x: Math.random() * w, y: -25, angle: Math.PI / 2, spread: 0.9, velocity: 2, ttl: 460 });
    if (left > 0) later(() => shower(left - 1), 240);
  }

  /* On the day itself, a click anywhere is worth a little more of it. */
  addEventListener("pointerdown", (e) => {
    if (!body.classList.contains("is-done") || calm.matches) return;
    /* The replay button is a control, not confetti — a burst thrown from
       the cursor as the page resets reads as debris from the thing that
       just left. */
    if (e.target.closest(".cd-replay")) return;
    spawn(45, {
      x: e.clientX,
      y: e.clientY,
      angle: -Math.PI / 2,
      spread: Math.PI * 1.35,
      velocity: 11,
      ttl: 220,
    });
  });

  /* --- The handoff ------------------------------------------------------ */

  let done = false;

  /* True until the first reading of the clock has been acted on. It only
     ever matters when that first reading is already past the target. */
  let firstPass = true;

  /* Every animation the handoff starts, kept by hand.

     element.getAnimations() is NOT a reliable way to find these again.
     Both animations below fill forwards — holding their end pose after
     they finish is the whole reason the digits stay gone — and a
     finished filling animation is dropped from that list as soon as a
     later run animates the same property over it. So on the second
     replay the list comes back empty while the FILL is still very much
     applied, cancel() gets nothing to cancel, and the countdown returns
     to a stage whose digits and frame are still pinned at zero opacity:
     a clock that ticks invisibly. Owning the references sidesteps the
     question of what that list chooses to report. */
  let handoffAnims = [];

  /* fromLoad: a page that opens already past its target has nothing to
     hand off FROM — the digits it would lift away never showed a count.
     So it skips the choreography and simply arrives, after a beat long
     enough for the first paint to land before the confetti does. */
  function celebrate(fromLoad) {
    if (done) return;
    done = true;
    updateReplay();

    if (calm.matches || fromLoad) {
      later(finish, fromLoad ? 420 : 0);
      return;
    }

    /* The digits leave first, one cell after another, on an ease that
       accelerates away — they are departing, not settling. */
    stacks.forEach((stack, i) => {
      handoffAnims.push(
        stack.animate(
          [
            { opacity: 1, transform: "none" },
            { opacity: 0, transform: "translateY(-12px)" },
          ],
          {
            duration: 360,
            delay: i * 70,
            easing: "cubic-bezier(0.4, 0, 1, 1)",
            fill: "forwards",
          }
        )
      );
    });

    /* Then the empty frame goes, starting as the last cell empties: the
       frame outlives its contents by a beat, so what you watch is a box
       being vacated and then dismissed, not both at once.

       Run here rather than left to the .is-done rule in the stylesheet
       because this one has to be cancellable at any point — a CSS
       transition can only be interrupted by changing the class that
       caused it, which would also commit the rest of the state. */
    handoffAnims.push(
      face.animate([{ opacity: 1 }, { opacity: 0 }], {
        duration: 320,
        delay: 420,
        easing: "ease",
        fill: "forwards",
      })
    );

    later(finish, 780);
  }

  function finish() {
    body.classList.remove("is-final");
    body.classList.add("is-done");
    announce(MESSAGE);
    /* The label is rewritten while the button is still invisible, so the
       word swap happens under cover and what fades back in is already
       offering the right thing. */
    updateReplay();

    /* The control comes back once the message has finished arriving —
       its rise runs 900ms — rather than at the same instant, so the two
       entrances don't compete for the eye. Under reduced motion there is
       no rise to wait out, so it simply returns. */
    later(() => body.classList.remove("is-replaying"), calm.matches ? 0 : 700);

    if (calm.matches) return;
    cannons();
    later(() => shower(14), 400);
  }

  /* Back to a live countdown from wherever the handoff had got to.

     The order is the point. Bumping the run token first strands every
     pending step; cancelling the animations BEFORE the class comes off
     is what keeps the frame from flashing — the stylesheet's resting
     state is "face visible", so removing .is-done while the animation
     still holds it at zero opacity would show one frame of an empty
     stage before the cancel caught up. */
  function reset() {
    run++;
    done = false;

    handoffAnims.forEach((a) => a.cancel());
    handoffAnims = [];

    body.classList.remove("is-done", "is-final", "is-replaying");
    clearConfetti();
  }

  /* --- The count -------------------------------------------------------- */

  let shownDate = null;

  function pad(n) {
    return String(n).padStart(2, "0");
  }

  /* Coarse and polite on purpose. A live region re-read once a second
     talks over everything else a visitor is doing, and "forty-one
     seconds" is not the part of a four-month countdown anyone needs
     announced — so this speaks in minutes, only when the minute
     changes. */
  let lastAnnounced = null;

  function announce(text) {
    if (text === lastAnnounced) return;
    lastAnnounced = text;
    readingEl.textContent = text;
  }

  function plural(n, word) {
    return `${n} ${word}${n === 1 ? "" : "s"}`;
  }

  function tick() {
    const st = state();

    if (st.done) {
      celebrate(firstPass);
      firstPass = false;
      return;
    }

    /* The count is live again — either the demo was sent back, or the
       page was left open across the far side of the target. */
    if (done) reset();
    firstPass = false;

    const stamp = +st.target;
    if (shownDate !== stamp) {
      shownDate = stamp;
      /* Blank during a rehearsal. The real date would be a lie under a
         seven-second count, and naming the rehearsal as one only says
         what four zeros and a single digit have already said. The line
         keeps its height in the stylesheet, so going quiet here doesn't
         drag the replay button up the page and drop it back. */
      dateEl.textContent = st.demo
        ? ""
        : st.target.toLocaleDateString(undefined, {
            weekday: "long",
            day: "numeric",
            month: "long",
            year: "numeric",
          });
    }

    const total = Math.max(0, Math.floor((stamp - Date.now()) / 1000));
    const days = Math.floor(total / 86400);
    const hours = Math.floor(total / 3600) % 24;
    const mins = Math.floor(total / 60) % 60;
    const secs = total % 60;

    nums.d.textContent = days;
    nums.h.textContent = pad(hours);
    nums.m.textContent = pad(mins);
    nums.s.textContent = pad(secs);

    announce(
      total < 60
        ? `${plural(total, "second")} remaining.`
        : `${plural(days, "day")}, ${plural(hours, "hour")} and ` +
          `${plural(mins, "minute")} remaining.`
    );

    body.classList.toggle("is-final", total <= 60);
    updateReplay();

    /* The last ten seconds: the one number still moving gets a pulse per
       tick. No fill — it returns to rest on its own, so nothing has to
       be cleaned up if the count is interrupted here. */
    if (total <= 10 && !calm.matches) {
      nums.s.animate(
        [
          { transform: "scale(1)" },
          { transform: "scale(1.14)" },
          { transform: "scale(1)" },
        ],
        { duration: 520, easing: "cubic-bezier(0.16, 1, 0.3, 1)" }
      );
    }
  }

  /* --- The clock that drives it ----------------------------------------

     Aligned to the wall clock rather than run on a plain interval. A
     1000ms interval drifts against the second it is displaying, and once
     the two are a few milliseconds out of phase the seconds digit starts
     repeating or skipping a value — on a page whose entire subject is a
     number counting down, that is the one flaw a visitor is guaranteed
     to catch. Landing a moment PAST each boundary is what guarantees the
     value has actually rolled over by the time it is read. */
  let tickTimer = null;

  function scheduleTick() {
    clearTimeout(tickTimer);
    tickTimer = setTimeout(() => {
      tick();
      scheduleTick();
    }, 1000 - (Date.now() % 1000) + 25);
  }

  /* --- The replay control ----------------------------------------------- */

  /* The button offers whichever of its two jobs makes sense from here.
     "Back to the countdown" is only honest when there IS one to go back
     to: on the day itself the real state is the celebration, so the
     button keeps offering the replay instead of pretending it can
     return somewhere that doesn't exist. */
  function canReturn() {
    return done && !realIsDone();
  }

  function updateReplay() {
    const label = canReturn() ? "back to the countdown" : "replay the handoff";
    if (replayEl.textContent !== label) replayEl.textContent = label;
  }

  replayEl.addEventListener("click", () => {
    const returning = canReturn();
    demoTarget = returning ? null : Date.now() + DEMO_SECONDS * 1000;

    reset();
    shownDate = null;   /* the date line has to be re-decided */
    lastAnnounced = null;
    firstPass = false;  /* a replay is never a page load: it plays the
                           full choreography, which is the entire point */

    /* Only a rehearsal takes the control off screen, and only AFTER
       reset() — which clears the flag along with everything else, so
       setting it first would immediately undo it. Going back to the
       countdown is a state change, not a performance: the button stays
       put and simply relabels. */
    if (!returning) body.classList.add("is-replaying");

    tick();
    scheduleTick();
  });

  /* --- The world changing under it -------------------------------------- */

  let resizeFrame = null;
  addEventListener("resize", () => {
    /* one relayout per frame, not one per resize event */
    if (resizeFrame !== null) return;
    resizeFrame = requestAnimationFrame(() => {
      resizeFrame = null;
      layout();
    });
  });

  /* A theme flip changes the palette but not the physics, so it only
     needs the colors re-read; the next frame picks them up, and if the
     canvas is parked there is nothing on it to repaint. */
  new MutationObserver(readPalette).observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["data-theme"],
  });

  /* A backgrounded tab throttles both the timer and the frame loop, so
     the count comes back stale by however long it was away. Re-read it
     on return and re-align the clock — and drop the confetti loop on the
     way out rather than leaving it to be handed an enormous first dt. */
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") {
      sleep();
      return;
    }

    tick();
    scheduleTick();
    if (parts.length) wake();
  });

  readPalette();
  layout();
  updateReplay();
  tick();
  scheduleTick();
})();
