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

     This exhibit used to hard-code them: a month, a day, and a sentence,
     all three somebody else's. That made the payoff fire once a year on a
     date no visitor had any reason to care about, and put a real person's
     birthday on a public page.

     Now the visitor owns both. They live in localStorage, they are set
     from the two fields under the stage, and either can be absent — a
     page with nothing set has nothing to count to, which is a state this
     file has to handle rather than paper over.

     What's left here is only the fallback sentence, used when a target
     has been set but the message field was left empty, and shown as that
     field's placeholder so the default is never a surprise. */
  const DEFAULT_MESSAGE = "Time's up!";

  /* --- Storage ---------------------------------------------------------

     Reads and writes are wrapped because storage access can THROW, not
     merely come back empty: a locked-down profile or a blocked third-
     party context refuses outright. The theme bootstrap in this page's
     <head> guards the same way and for the same reason. An uncaught throw
     here would take the whole exhibit down over a preference. */
  const KEY_TARGET = "countdown:target";
  const KEY_MESSAGE = "countdown:message";

  function readStored(key) {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  }

  function writeStored(key, value) {
    try {
      if (value) localStorage.setItem(key, value);
      else localStorage.removeItem(key);
    } catch {
      /* The setting is honored for this session and simply isn't
         remembered for the next one. Nothing here is worth an error. */
    }
  }

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
  const dateInput = document.querySelector(".cd-set-date");
  const messageInput = document.querySelector(".cd-set-message");
  const nums = {};
  document.querySelectorAll(".cd-num").forEach((el) => {
    nums[el.dataset.unit] = el;
  });

  /* --- What the visitor has chosen -------------------------------------

     customTarget is a Date at local midnight, or null when nothing is
     set. Null is a real state with its own behaviour, not a stand-in for
     a default: it is what makes the page open into the handoff. */
  let customTarget = null;
  let customMessage = "";

  /* Parses the yyyy-mm-dd an <input type="date"> yields, in LOCAL time.
     `new Date("2027-01-01")` would not do: a bare date string is parsed
     as UTC, which lands the target an hour or two off local midnight and
     puts the whole count out by that much for anyone east or west of
     Greenwich. Splitting the parts and handing them to the constructor
     asks for local midnight explicitly.

     Returns null for anything that isn't a real date, so a hand-edited
     storage value or a browser that hands back something unexpected
     falls back to "nothing set" rather than an Invalid Date that would
     make every reading downstream NaN. */
  function parseDate(value) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value || "");
    if (!m) return null;
    const [, y, mo, d] = m.map(Number);
    const t = new Date(y, mo - 1, d, 0, 0, 0, 0);
    /* Rejects the overflow Date performs silently: month 13 or day 32
       would otherwise roll into the next month and quietly count to a
       day nobody asked for. */
    return t.getFullYear() === y && t.getMonth() === mo - 1 && t.getDate() === d
      ? t
      : null;
  }

  function messageText() {
    return customMessage || DEFAULT_MESSAGE;
  }

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

  /* Is there a live countdown to be at, or to go back to? Asked of the
     visitor's own target only, never of the demo — the replay button
     needs to know whether returning is a thing it can honestly offer. */
  function realIsLive() {
    return customTarget !== null && Date.now() < +customTarget;
  }

  /* Three states, in priority order.

     A rehearsal outranks everything: it is the visitor asking to see the
     handoff now, over whatever the page was otherwise doing.

     Then the visitor's own target, if they have set one.

     Then IDLE — nothing set, nothing to count to. The old version had no
     equivalent, because a hard-coded anniversary is never absent. It
     matters because it is the state a first visit is in, and the one the
     page answers by playing the handoff instead of showing a clock
     counting to nothing. */
  function state() {
    if (demoTarget !== null) {
      return Date.now() >= demoTarget
        ? { done: true }
        : { done: false, target: new Date(demoTarget), demo: true };
    }

    if (customTarget === null) return { idle: true };

    return realIsLive()
      ? { done: false, target: customTarget, demo: false }
      : { done: true };
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
    /* Written at arrival rather than once at load: the sentence is the
       visitor's now, and it can have changed since the last handoff. */
    messageEl.textContent = messageText();
    announce(messageText());
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

    /* Nothing set, so there is no count to render and no arrival to play.
       The page answers this by rehearsing — which is what makes a first
       visit open into the handoff rather than a clock pointed at nothing.

       Self-healing rather than left to the callers: this is also the
       state a visitor lands in by CLEARING their date, and having the one
       place that renders the count decide what an empty count means beats
       remembering to start a rehearsal at every site that can empty it.
       No recursion — startRehearsal() sets demoTarget, so the tick it
       makes reads as a demo, never as idle. */
    if (st.idle) {
      firstPass = false;
      if (!done) startRehearsal();
      return;
    }

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
     to. Two ways there isn't: the visitor's date has arrived, so the
     celebration IS the real state; or they never set one, so the page has
     only ever had the rehearsal. Both keep the button offering the
     replay rather than promising a countdown that doesn't exist. */
  function canReturn() {
    return done && realIsLive();
  }

  function updateReplay() {
    const label = canReturn() ? "back to the countdown" : "replay the handoff";
    if (replayEl.textContent !== label) replayEl.textContent = label;
  }

  /* Put the page into a state and start the clock again. `demo` true
     stages a rehearsal a few seconds out; false hands the page back to
     whatever state() says the real situation is.

     Shared by the replay button, the two setup fields, and the page's own
     opening move. Auto-play on load is this function, not a second
     implementation of it — the one thing that must not drift is what a
     handoff looks like. */
  function restart(demo) {
    demoTarget = demo ? Date.now() + DEMO_SECONDS * 1000 : null;

    reset();
    shownDate = null;   /* the date line has to be re-decided */
    lastAnnounced = null;
    firstPass = false;  /* a rehearsal is never a page load: it plays the
                           full choreography, which is the entire point.
                           This is the difference between the handoff
                           ANIMATING and the page simply arriving already
                           finished — see celebrate()'s fromLoad. */

    /* Only a rehearsal takes the control off screen, and only AFTER
       reset() — which clears the flag along with everything else, so
       setting it first would immediately undo it. Going back to the
       countdown is a state change, not a performance: the button stays
       put and simply relabels. */
    if (demo) body.classList.add("is-replaying");

    tick();
    scheduleTick();
  }

  function startRehearsal() {
    restart(true);
  }

  replayEl.addEventListener("click", () => {
    restart(!canReturn());
  });

  /* --- The two setup fields ---------------------------------------------

     A date and a sentence, both optional, both remembered. They sit under
     the replay button and step aside with it while a rehearsal plays. */

  /* Today in the yyyy-mm-dd the date input speaks, built from local parts
     rather than toISOString() — that converts to UTC first, so anyone far
     enough east or west gets yesterday or tomorrow as their floor. */
  function todayValue() {
    const n = new Date();
    return `${n.getFullYear()}-${pad(n.getMonth() + 1)}-${pad(n.getDate())}`;
  }

  /* A past date can only ever show the arrival, which the replay button
     already offers on demand — so the floor is today, enforced by the
     input where the browser can say so in its own words, and re-checked
     on read because `min` is a validation hint, not a guarantee. */
  function applyDateInput() {
    const picked = parseDate(dateInput.value);
    const floor = parseDate(todayValue());

    if (picked !== null && floor !== null && picked < floor) {
      /* Say why, in the browser's own voice and language, rather than
         silently discarding it. */
      dateInput.setCustomValidity("Pick a date that hasn't happened yet.");
      dateInput.reportValidity();
      return;
    }
    dateInput.setCustomValidity("");

    customTarget = picked;
    writeStored(KEY_TARGET, picked ? dateInput.value : null);

    /* Setting a date hands the page to that countdown; clearing it leaves
       nothing to count, which tick() answers by rehearsing. Either way
       the page re-decides from state() rather than being told. */
    restart(false);
  }

  function applyMessageInput() {
    customMessage = messageInput.value.trim();
    writeStored(KEY_MESSAGE, customMessage);

    /* If the message is already on screen, change it under the visitor's
       cursor — retyping it and watching nothing happen until the next
       handoff would read as the field being broken. */
    if (done) {
      messageEl.textContent = messageText();
      announce(messageText());
    }
  }

  /* `change` rather than `input` for the date: `input` fires on every
     keystroke inside the field, so typing a year turns 0002, 0020, 0202
     into three restarts before 2027 lands. The message takes `input`,
     because there is no half-typed sentence that costs anything. */
  dateInput.addEventListener("change", applyDateInput);
  messageInput.addEventListener("input", applyMessageInput);

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

  /* --- Opening move -----------------------------------------------------

     Restore what the visitor chose last time, dress the two fields in it,
     and then let the page decide what it is.

     A saved target that has since gone past is dropped rather than kept:
     it would open the page on a celebration for something that finished
     weeks ago, with a date line naming a day in the past. Clearing it
     puts the page back where a first visit starts.

     The date's floor is set here rather than in the markup because
     "today" is not a constant — a tab left open overnight would otherwise
     keep yesterday's floor. */
  function restore() {
    const saved = parseDate(readStored(KEY_TARGET));
    const floor = parseDate(todayValue());

    customTarget = saved !== null && floor !== null && saved >= floor ? saved : null;
    if (saved !== null && customTarget === null) writeStored(KEY_TARGET, null);

    customMessage = (readStored(KEY_MESSAGE) || "").trim();

    dateInput.min = todayValue();
    dateInput.value = customTarget
      ? `${customTarget.getFullYear()}-${pad(customTarget.getMonth() + 1)}-${pad(customTarget.getDate())}`
      : "";
    messageInput.value = customMessage;
    messageInput.placeholder = DEFAULT_MESSAGE;
  }

  readPalette();
  layout();
  restore();
  updateReplay();

  /* With nothing set the first tick reads idle and rehearses on its own,
     which IS the opening handoff — so there is no separate auto-play
     branch here to keep in step with the button. With a date set, the
     same call simply starts counting to it: the visitor's own countdown
     is what they came back for, and replaying the demo over it on every
     load would be noise. */
  tick();
  scheduleTick();
})();
