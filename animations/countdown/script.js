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

     What's left here is two tables.

     CELEBRATIONS is what an arrival can LOOK like. Each one is the same
     two things — the show it throws on landing, and what a click on the
     arrived page is worth — so they are interchangeable by name, and
     adding a fourth means writing one entry rather than touching the
     themes at all. They are deliberately kept separate from the themes
     rather than inlined into them: an occasion and its animation are not
     the same idea, and more than one occasion can reasonably want paper
     thrown in the air.

     THEMES is what an arrival MEANS: the sentence it lands on, which
     celebration it points at, and — where the occasion has one — the
     date it naturally falls on.

     That last field is why this is a table rather than a switch. New
     Year has a date by definition; a birthday and a launch are whenever
     yours is, so their naturalDate is null and the field is left to the
     visitor. Anything with a naturalDate prefills the date when it's
     PICKED — never on load, for a reason spelled out at applyTheme(). */
  const CELEBRATIONS = {
    /* Paper thrown in a room: two cannons from the edges, then a long
       thin fall. */
    confetti: {
      show: () => {
        cannons();
        later(() => shower(14), 400);
      },
      at: (x, y) => spawnConfettiBurst(x, y),
    },
    /* Shells thrown at a sky: they climb from below the floor, then
       bloom into one ring each — where you pointed, if you pointed. */
    fireworks: {
      show: () => fireworksShow(),
      at: (x, y) => launchShell(x, y),
    },
    /* The one celebration that goes UP and keeps going — released from
       below the floor, swaying, and gone off the top. */
    balloons: {
      show: () => balloonsShow(),
      at: (x, y) => releaseBalloons(3, x, y),
      behind: true,
    },
  };

  /* Which side of the message the celebration passes on.

     Confetti and sparks are small, fast, and gone: in FRONT is right for
     them, and the stylesheet's note says why — behind, they'd read as
     wallpaper rather than as something being thrown.

     Balloons are the opposite object. They are large, opaque, slow, and
     they LINGER; one parked over the arrival sentence doesn't decorate
     it, it covers it up. So they pass behind, which is also where
     balloons are at a party — around the room, not in your face. */

  const THEMES = {
    birthday: {
      label: "birthday",
      message: "Happy birthday!",
      celebration: "balloons",
      naturalDate: null,
    },
    newyear: {
      label: "new year",
      message: "Happy new year!",
      celebration: "fireworks",
      /* The next January 1st — which on January 1st is TODAY, not a year
         away. Blindly adding a year would be the one day of the year this
         theme refuses to celebrate. */
      naturalDate: () => {
        const n = new Date();
        const today = new Date(n.getFullYear(), n.getMonth(), n.getDate(), 0, 0, 0, 0);
        const jan1 = new Date(n.getFullYear(), 0, 1, 0, 0, 0, 0);
        return jan1 >= today ? jan1 : new Date(n.getFullYear() + 1, 0, 1, 0, 0, 0, 0);
      },
    },
    launch: {
      label: "launch",
      message: "It's live!",
      celebration: "confetti",
      naturalDate: null,
    },
  };

  const DEFAULT_THEME = "newyear";

  /* The celebration the armed theme points at. One lookup, in one place,
     so nothing downstream has to know that a theme names its animation
     rather than owning it. */
  function celebration() {
    return CELEBRATIONS[THEMES[theme].celebration];
  }

  /* --- Storage ---------------------------------------------------------

     Reads and writes are wrapped because storage access can THROW, not
     merely come back empty: a locked-down profile or a blocked third-
     party context refuses outright. The theme bootstrap in this page's
     <head> guards the same way and for the same reason. An uncaught throw
     here would take the whole exhibit down over a preference. */
  const KEY_TARGET = "countdown:target";
  const KEY_MESSAGE = "countdown:message";
  const KEY_THEME = "countdown:theme";

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
  /* Which of the two celebrations is armed. Always a valid key: a
     hand-edited or unrecognised stored value falls back rather than
     leaving THEMES[theme] undefined and taking the arrival down. */
  let theme = DEFAULT_THEME;

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

  /* What the arrival says: whatever the visitor typed, or failing that
     the sentence belonging to the theme they picked. So clearing the
     field doesn't leave the page silent — it hands the line back to the
     theme, which is also what the field's placeholder promises. */
  function messageText() {
    return customMessage || THEMES[theme].message;
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

  /* A ceiling on what can be in the air at once.

     None of the choreography comes near it — the busiest single moment
     is the confetti's two cannons at 150 pieces. It exists for the click
     reward, which has no rate limit and no business having one: mashing
     the page on the day is a reasonable thing to want to do, and every
     click is worth 45 pieces of paper, three balloons, or a shell that
     becomes 56 sparks. A few seconds of that is thousands of particles
     and a canvas that visibly drops frames.

     Enforced by dropping the OLDEST rather than refusing the newest. A
     click that answers with nothing reads as the page being broken;
     one that answers while the tail of an older burst leaves early
     reads as nothing at all. */
  const MAX_PARTS = 900;

  function trim() {
    if (parts.length > MAX_PARTS) parts.splice(0, parts.length - MAX_PARTS);
  }

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

  /* --- The three kinds of particle --------------------------------------

     One array, one frame loop, one clearRect, one rAF. The alternative —
     a second system for the fireworks — would mean two loops fighting
     over the same canvas, two teardowns to keep in step, and a theme flip
     that recolors only half of what is in the air.

     What differs between kinds is only physics constants and how a piece
     is drawn. That is small enough to branch on inside the loop and far
     smaller than the machinery it saves.

     CONFETTI is paper: heavy, tumbling, drawn as a fluttering rectangle.
     SHELL is a firework on the way up: it carries the burst it will
     become, and detonates where it actually got to.
     SPARK is what a shell becomes: light, air-braked, drawn as a streak
     that shortens as it slows.
     BALLOON is the one that goes the other way: buoyant, swaying, and
     leaving off the top rather than falling past the bottom. */
  const CONFETTI = 0;
  const SHELL = 1;
  const SPARK = 2;
  const BALLOON = 3;

  /* Per-kind physics. Sparks fall slower and brake harder than paper, so
     a burst blooms outward and then hangs before it drops — which is the
     whole reason a firework reads as a firework and not as a scatter.

     A balloon's gravity is NEGATIVE, which is the whole trick: buoyancy
     is just gravity pointing the other way, so the one shared integrator
     handles a rising balloon and a falling piece of paper without
     knowing the difference. Drag then caps the climb at a terminal
     speed, so balloons settle into a drift instead of accelerating off
     the top like something dropped upward. */
  const PHYSICS = {
    [CONFETTI]: { gravity: 0.21, drag: 0.986 },
    [SHELL]: { gravity: 0.21, drag: 0.998 },
    [SPARK]: { gravity: 0.09, drag: 0.965 },
    [BALLOON]: { gravity: -0.055, drag: 0.985 },
  };

  function spawn(n, o) {
    for (let i = 0; i < n; i++) {
      const a = o.angle + (Math.random() - 0.5) * o.spread;
      const v = o.velocity * (0.55 + Math.random() * 0.8);
      parts.push({
        kind: CONFETTI,
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

    /* Here rather than at the spawn sites, and for a reason worth naming:
       burst() runs from INSIDE the walk below, and the walk holds a live
       index into this array. Trimming from the front there would shift
       every element under that index by one and the next splice would
       delete the wrong particle. Once a frame, before the walk starts,
       is both safe and more than often enough. */
    trim();

    ctx.clearRect(0, 0, w, h);

    for (let i = parts.length - 1; i >= 0; i--) {
      const p = parts[i];
      p.life += dt;

      const fade = 1 - p.life / p.ttl;
      /* Everything else is done when it has fallen past the floor; a
         balloon is done when it has risen past the ceiling. Same idea,
         opposite edge — so the test asks which way the piece was going
         rather than assuming down.

         Either kind is also done once it has left sideways. Without that
         test a balloon that swayed out past an edge — and they sway far
         enough to, on a narrow screen — stays a live particle: invisible,
         but keeping the frame loop awake for the twenty seconds its
         backstop takes to expire. */
      const offStage =
        p.x < -180 ||
        p.x > w + 180 ||
        (p.kind === BALLOON ? p.y < -140 : p.y > h + 60);
      if (fade <= 0 || offStage) {
        /* The fuse, which is now only a backstop — a shell normally goes
           off on arrival, further down. This catches one that somehow
           never got where it was aimed, so it becomes a burst rather
           than blinking out. A shell that left the stage instead is
           simply gone: there is nothing to celebrate off the edge. */
        if (p.kind === SHELL && fade <= 0) burst(p.x, p.y, p.hue, p.vx, p.vy);
        parts.splice(i, 1);
        continue;
      }

      const phys = PHYSICS[p.kind];
      p.vy += phys.gravity * dt;
      const drag = Math.pow(phys.drag, dt); /* air, framerate-independent */
      p.vx *= drag;
      p.vy *= drag;

      /* A balloon's sideways motion is DRIVEN, not inherited: its vx is
         assigned from its own sine each frame rather than accumulated
         and then bled off by drag. Left to drag it would drift once and
         straighten out; assigned, it sways for as long as it is on
         screen. Set here — after the drag that would otherwise eat it,
         before the position step that spends it. */
      if (p.kind === BALLOON) {
        p.swayPhase += p.swaySpeed * dt;
        p.vx = Math.sin(p.swayPhase) * p.swayAmp;
      }

      p.x += p.vx * dt;
      p.y += p.vy * dt;

      /* A shell goes off the moment it reaches the height it was aimed
         at — checked against where the physics actually carried it, so a
         dropped frame moves the burst in time rather than in space.

         Arrival rather than apex, deliberately. The apex is the one
         point on the arc where the shell is standing still, and a ring
         thrown from a dead stop looks dropped. It was launched with a
         little more than it needed to get here, so it is still climbing
         when it goes off, and the ring leaves carrying that. */
      if (p.kind === SHELL && p.y <= p.burstY) {
        burst(p.x, p.y, p.hue, p.vx, p.vy);
        parts.splice(i, 1);
        continue;
      }

      ctx.globalAlpha = Math.min(1, fade * 3);

      if (p.kind === CONFETTI) {
        p.rot += p.vrot * dt;
        p.tilt += p.vtilt * dt;

        ctx.save();
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
        continue;
      }

      if (p.kind === BALLOON) {
        /* The lean. A balloon under way tips in the direction it is
           being pushed, so the tilt is read straight off the sideways
           velocity rather than kept as its own state — the sway and the
           lean can then never fall out of phase with each other. */
        const lean = p.vx * 0.09;

        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(lean);
        ctx.fillStyle = palette[p.hue];
        ctx.strokeStyle = palette[p.hue];

        /* The string, drawn first so the body and knot cover where it
           attaches. It is a curve, not a line: the bend trails AGAINST
           the direction of travel, which is the detail that makes the
           balloon look towed rather than glued to a stick.

           Scaled off the sideways VELOCITY rather than off the lean
           angle. The lean is a fraction of a radian, so curving by it
           bent the string by about three pixels — technically a curve,
           visually a straight line. The velocity is the quantity that
           actually says how hard this balloon is being dragged. */
        ctx.beginPath();
        ctx.lineWidth = 1;
        ctx.moveTo(0, p.r * 1.3);
        ctx.quadraticCurveTo(
          -p.vx * 7, p.r * 1.3 + p.string * 0.55,
          p.vx * 4, p.r * 1.3 + p.string
        );
        ctx.stroke();

        /* The knot: a small triangle where the neck is pinched. Three
           lines are enough to stop the body reading as a plain circle. */
        ctx.beginPath();
        ctx.moveTo(-p.r * 0.17, p.r * 1.12);
        ctx.lineTo(p.r * 0.17, p.r * 1.12);
        ctx.lineTo(0, p.r * 1.36);
        ctx.closePath();
        ctx.fill();

        /* The body: taller than it is wide, the way a balloon hangs. */
        ctx.beginPath();
        ctx.ellipse(0, 0, p.r, p.r * 1.16, 0, 0, Math.PI * 2);
        ctx.fill();

        ctx.restore();
        continue;
      }

      /* Shells and sparks are drawn as a short streak laid along the
         direction of travel, which is the same line vocabulary the iron
         filings exhibit is built from.

         The length comes from the speed, so it costs nothing and does
         the work a trail would: a spark leaving the burst is a long
         stroke, and as the air brakes it the stroke shortens toward a
         point. The piece decelerating IS the piece getting shorter, with
         no history buffer to keep. */
      const speed = Math.hypot(p.vx, p.vy);
      const len = Math.min(p.streak, speed * 2.2);
      ctx.beginPath();
      ctx.strokeStyle = palette[p.hue];
      ctx.lineWidth = p.kind === SHELL ? 2 : 1.8;
      ctx.lineCap = "round";
      ctx.moveTo(p.x, p.y);
      /* Guard the zero-speed case: normalising a zero vector is NaN, and
         one NaN coordinate poisons the whole path for the frame. */
      if (speed > 0.01) {
        ctx.lineTo(p.x - (p.vx / speed) * len, p.y - (p.vy / speed) * len);
      } else {
        ctx.lineTo(p.x, p.y + 0.01);
      }
      ctx.stroke();
    }

    ctx.globalAlpha = 1;

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

  /* A confetti burst thrown from a point — the click reward, lifted out
     of the pointer handler so the themes table can name it. */
  function spawnConfettiBurst(x, y) {
    spawn(45, { x, y, angle: -Math.PI / 2, spread: Math.PI * 1.35, velocity: 11, ttl: 220 });
  }

  function clamp(v, lo, hi) {
    return v < lo ? lo : v > hi ? hi : v;
  }

  /* The indices 0..n-1 in a random order.

     Both shows below use it to hand each shell or balloon its own band of
     the width, which is the ring's "evenly spaced, then nudged" rule
     applied to a whole stage: n purely random positions clump, and a
     clump of bursts is one big burst with holes around it.

     Shuffled rather than walked in order, because stratified positions
     TAKEN in order are a left-to-right sweep — which trades one obvious
     pattern for another. */
  function shuffledBands(n) {
    const bands = Array.from({ length: n }, (_, i) => i);
    for (let i = n - 1; i > 0; i--) {
      const j = (Math.random() * (i + 1)) | 0;
      [bands[i], bands[j]] = [bands[j], bands[i]];
    }
    return bands;
  }

  /* --- Fireworks ---------------------------------------------------------

     A shell is launched from below the bottom edge, climbs under gravity,
     and bursts into one ring of sparks at the point it was AIMED at.

     Aimed, and that word is the whole of this section's design. It used
     to take a launch POINT: a click handed its coordinates over as the
     shell's origin, and the shell then flew a fixed fraction of the
     viewport upward FROM there. Clicking low on the page worked by
     accident. Clicking near the top took a shell that was already near
     the top, sent it several hundred pixels further up, and burst it well
     outside the viewport — a click answered by one frame of streak and
     then nothing at all.

     A click on a night sky means "put one THERE". So the coordinates are
     the destination now, the origin is always the ground, and the launch
     velocity is solved from the two. The top of the page went from the
     one case that was broken to the best one: the shell has the whole
     height of the stage to climb through on the way to it.

     Colour is chosen per BURST, not per spark: a real shell carries one
     charge, and a burst speckled with six hues reads as confetti thrown
     upward rather than as a firework. The choice is limited to the five
     chromatic swatches — index 5 is --confetti-6, the one that IS ink and
     flips with the theme. That is exactly right for paper, which is lit
     by the room, and wrong for a firework, which is a light source: on
     light paper an ink-coloured burst reads as a smudge rather than a
     spark. */
  const FIREWORK_HUES = 5;

  /* How much more than the bare minimum a shell is launched with. Two
     jobs at once: it puts the shell through its target still climbing
     rather than arriving spent, and it covers the drag that the textbook
     solve below ignores — which would otherwise leave every burst a few
     pixels short of the spot you clicked. */
  const SHELL_OVERSHOOT = 1.08;

  /* driftX/driftY are the shell's own velocity at the moment it goes off. */
  function burst(x, y, hue, driftX, driftY) {
    /* Enough to close the ring at the size these bursts open to, and few
       enough that five overlapping ones stay legible rather than becoming
       a wash. */
    const count = 46;
    /* Scaled to the smaller viewport dimension, so a burst fills the same
       FRACTION of a phone as it does of a desktop. */
    const power = Math.max(4.6, Math.min(w, h) / 92);

    /* What the shell was doing, carried into what it becomes. A charge
       travelling at speed does not stop dead and then explode: the sparks
       leave with everything it had, which leans the ring along the
       direction of travel and carries the whole thing a little further
       up. Damped, because a ring that inherited the climb in full would
       be a fountain rather than a ring — and the vertical is damped
       harder than the sideways, since that is the component with all the
       speed in it. */
    const dx = (driftX || 0) * 0.55;
    const dy = (driftY || 0) * 0.35;

    for (let i = 0; i < count; i++) {
      /* Evenly spaced around the circle, then nudged — a ring, not a
         blob. Pure randomness clumps and leaves gaps, which reads as a
         splatter; a perfect ring reads as a machine. The jitter is one
         gap wide, so neighbours can cross but the ring stays a ring.

         The speed variance is what gives the ring thickness. */
      const a = (i / count) * Math.PI * 2 + (Math.random() - 0.5) * ((Math.PI * 2) / count);
      const v = power * (0.72 + Math.random() * 0.56);
      parts.push({
        kind: SPARK,
        x,
        y,
        vx: Math.cos(a) * v + dx,
        vy: Math.sin(a) * v + dy,
        hue,
        streak: 13,
        life: 0,
        /* Varied so the ring dissolves raggedly instead of all at once,
           which is the difference between sparks burning out and a layer
           being switched off. */
        ttl: 78 + Math.random() * 34,
      });
    }

    /* The flash at the heart of it: ten more sparks thrown at a fraction
       of the ring's speed and burning out in a quarter of its time, so
       they stay bundled at the origin as a bright knot while the ring
       leaves it. The same particle as everything above, thrown short —
       which is a good deal cheaper than a fifth kind that exists to draw
       one dot, and it inherits the fade and the palette for free. */
    for (let i = 0; i < 10; i++) {
      const a = Math.random() * Math.PI * 2;
      const v = power * (0.12 + Math.random() * 0.45);
      parts.push({
        kind: SPARK,
        x,
        y,
        vx: Math.cos(a) * v + dx,
        vy: Math.sin(a) * v + dy,
        hue,
        streak: 6,
        life: 0,
        ttl: 22 + Math.random() * 12,
      });
    }

    wake();
  }

  /* One shell, aimed at (atX, atY). A click passes the point it wants;
     the show leaves both out and gets somewhere across the upper sky. */
  function launchShell(atX, atY) {
    const g = PHYSICS[SHELL].gravity;

    /* Where it will go off. Clamped inside a margin so the ring that
       opens there is on screen rather than half-cropped — a burst
       centred two pixels from the top edge is three-quarters wasted, and
       a visitor who clicks the very corner still deserves a firework. */
    const targetX = clamp(atX ?? w * (0.14 + Math.random() * 0.72), 56, w - 56);
    const targetY = clamp(atY ?? h * (0.1 + Math.random() * 0.28), 64, h * 0.84);

    /* Where it comes from. Below the floor, always — fireworks come from
       the ground, and a shell that appears in mid-air is just a burst
       with extra steps. */
    const fromY = h + 8;
    const rise = fromY - targetY;

    /* Off to one side of the target rather than directly beneath it, so
       the climb is an arc the eye can follow instead of a vertical rail.
       The offset scales with the rise, which keeps the LEAN — the ratio
       of sideways to upward speed, and so the angle you actually see —
       the same for a shell crossing the whole stage and one popping just
       above the floor. */
    const fromX = clamp(
      targetX + (Math.random() - 0.5) * rise * 0.34,
      12,
      w - 12
    );

    /* Under constant gravity a body launched at v rises v²/2g, so the
       velocity that reaches a given height is sqrt(2*g*rise) — solved
       rather than tuned, which is what makes the arc land where it was
       aimed on a phone and on a desk instead of shooting off the top of
       one of them. */
    const climb = Math.sqrt(2 * g * rise) * SHELL_OVERSHOOT;

    /* When it gets there: the smaller root of rise = climb*t - g*t²/2,
       i.e. the first crossing, on the way UP. Used only to spend the
       sideways distance over the same flight, so the lean delivers the
       shell to the target x rather than to somewhere near it. Floored at
       one frame because a target almost level with the floor solves to
       nearly no flight at all, and dividing by that is an infinity. */
    const flight = Math.max(
      1,
      (climb - Math.sqrt(Math.max(0, climb * climb - 2 * g * rise))) / g
    );

    parts.push({
      kind: SHELL,
      x: fromX,
      y: fromY,
      vx: (targetX - fromX) / flight,
      vy: -climb,
      hue: (Math.random() * FIREWORK_HUES) | 0,
      streak: 16,
      /* What it is aimed at. The frame loop watches for it rather than
         counting down to it — see the arrival test there. */
      burstY: targetY,
      life: 0,
      /* The fuse is a backstop now, not the trigger: generous enough that
         arrival always beats it, short enough that a shell which somehow
         never arrives is not still climbing a minute later. */
      ttl: flight * 1.5,
    });
    wake();
  }

  /* Five shells, staggered, with the gaps deliberately uneven: a burst
     every N milliseconds reads as a metronome. Scheduled through later(),
     so a replay pressed mid-show strands the rest of the sequence exactly
     as it strands the confetti's shower. */
  function fireworksShow() {
    const shells = 5;
    const bands = shuffledBands(shells);
    let at = 0;

    for (let i = 0; i < shells; i++) {
      /* One band of the width each, nudged inside it, and a height of its
         own — so five bursts fill the sky instead of piling into the
         middle of it. Read out here rather than inside the timeout: the
         width is what it is when the show is CHOREOGRAPHED, and a shell
         that read it two seconds later could be aiming at a stage that
         had been resized under it. */
      const x = w * (0.1 + 0.8 * ((bands[i] + Math.random()) / shells));
      const y = h * (0.08 + Math.random() * 0.3);
      later(() => launchShell(x, y), at);
      at += 300 + Math.random() * 260;
    }
  }

  /* --- Balloons ----------------------------------------------------------

     Released from below the floor, rising, swaying, and gone off the top.
     Unlike the fireworks these take the whole palette including the ink
     one: a balloon is an object lit by the room, the same as a piece of
     paper, so the swatch that flips to stay visible against the paper is
     exactly right here — it's only a light SOURCE that couldn't be ink. */
  function releaseBalloons(n, x, y) {
    /* The two callers want opposite vertical spreads, and using one for
       both is what made a click near the top of the page underwhelming.

       A stream coming up from under the floor is staggered DOWNWARD, out
       of sight, so its balloons don't all clear the edge on the same
       frame. A handful let go at the cursor has to be spread AROUND it:
       that point is the one thing the visitor is looking at, and pushing
       every balloon up to seventy pixels below it — which is what a
       shared one-sided offset did — starts the release somewhere they
       weren't pointing, and off the bottom of the screen entirely if
       they were pointing near it. */
    const fromFloor = y === undefined;

    for (let i = 0; i < n; i++) {
      /* Size drives speed: a bigger balloon reads as nearer, and near
         things cross the view faster. One random number spent on radius
         buys the parallax as well. */
      const r = 10 + Math.random() * 10;

      parts.push({
        kind: BALLOON,
        /* Spread across almost the full width when released as a show,
           or clustered around a click when released from one. */
        x: x === undefined ? w * (0.05 + Math.random() * 0.9) : x + (Math.random() - 0.5) * 46,
        y: fromFloor ? h + 40 + Math.random() * 70 : y + (Math.random() - 0.5) * 36,
        vx: 0,
        vy: -(0.9 + (r / 20) * 1.4),
        r,
        hue: (Math.random() * palette.length) | 0,
        /* Every balloon on its own clock, so a dozen of them never sway
           as one sheet. */
        swayPhase: Math.random() * Math.PI * 2,
        swaySpeed: 0.011 + Math.random() * 0.017,
        swayAmp: 0.45 + Math.random() * 0.85,
        string: 18 + Math.random() * 14,
        life: 0,
        /* Long enough that the top edge is what removes them, not the
           clock — a balloon fading out mid-air would read as a bug. The
           ttl is only a backstop for one that somehow never gets there. */
        ttl: 1200,
      });
    }
    wake();
  }

  /* Sixteen, let go in a ragged stream over about two seconds rather than
     all on one frame: a single release moves as one sheet, and the whole
     charm of balloons is that they are obviously separate objects. */
  function balloonsShow() {
    const count = 16;
    const bands = shuffledBands(count);
    let at = 0;

    for (let i = 0; i < count; i++) {
      /* A band of the width each, in a shuffled order, rather than
         sixteen independent random draws — which reliably leave three
         balloons overlapping on one side and a bare stretch on the
         other. Same reasoning as the fireworks show, and as the ring. */
      const x = w * (0.04 + 0.92 * ((bands[i] + Math.random()) / count));
      later(() => releaseBalloons(1, x), at);
      at += 70 + Math.random() * 90;
    }
  }

  /* On the day itself, a click anywhere is worth a little more of it —
     in whichever currency the theme deals in: a handful of paper thrown
     from the cursor, or another shell sent up from it. */
  addEventListener("pointerdown", (e) => {
    if (!body.classList.contains("is-done") || calm.matches) return;
    /* Primary button only. pointerdown fires for every button on the
       mouse, so without this a right-click to reach the context menu is
       also answered with a firework — a celebration of something the
       visitor did not ask for and is about to be covering with a menu.
       Touch and pen both report button 0, so this costs them nothing. */
    if (e.button !== 0) return;
    /* The controls are controls, not celebration — a burst thrown from
       the cursor as the page resets reads as debris from the thing that
       just left, and a click meant for a field should reach the field. */
    if (e.target.closest(".cd-replay, .cd-setup")) return;
    celebration().at(e.clientX, e.clientY);
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
    /* The one line that decides what an arrival looks like. Every
       celebration reaches the same particle system through here, so none
       can invent its own loop or its own teardown. */
    celebration().show();
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

  /* --- The theme -------------------------------------------------------- */

  const themesRow = document.querySelector(".cd-themes");
  const themeInputs = Array.from(document.querySelectorAll(".cd-theme-input"));

  /* Parks the row's rule under the chosen word.

     The three words are three different widths, and CSS cannot measure a
     word — so the rule's position is handed over as two custom
     properties and drawn by styles.css. Everything about how it LOOKS
     lives there; this only says where the word is.

     Without this the fallback under each label still marks the choice, so
     nothing here is load-bearing for the state being visible. What it
     buys is the travel: one rule sliding from "birthday" to "new year"
     rather than two fading past each other. */
  function markTheme() {
    const checked = themeInputs.find((el) => el.checked);
    /* The label is the input's next sibling — the same relationship the
       stylesheet's `+` combinator relies on. Guarded rather than assumed:
       if the markup ever changes, the fallback rule should take over
       quietly instead of this throwing on every theme change. */
    const label = checked && checked.nextElementSibling;
    if (!label) return;

    /* The word, not its touch target. The label is padded out so a thumb
       can find it, and a rule drawn across the padding would overhang the
       word at both ends. Read from the computed style rather than
       hardcoded here, so the padding stays styles.css's business. */
    const style = getComputedStyle(label);
    const padLeft = parseFloat(style.paddingLeft) || 0;
    const padRight = parseFloat(style.paddingRight) || 0;

    /* Rects rather than offsetLeft/offsetWidth, which round to whole
       pixels: half a pixel is enough to leave the rule visibly wider than
       the word it belongs to on a screen dense enough to draw the
       difference. Both are read against the row, since that is what the
       rule is positioned inside.

       --cd-mark-w is a scale, not a length, so it goes over unitless: the
       rule is a 1px seed stretched to the word's width. */
    const word = label.getBoundingClientRect();
    const row = themesRow.getBoundingClientRect();

    themesRow.style.setProperty("--cd-mark-x", `${word.left - row.left + padLeft}px`);
    themesRow.style.setProperty("--cd-mark-w", `${word.width - padLeft - padRight}`);
    themesRow.classList.add("is-marked");
  }

  /* The words change width when the mono face lands, and again if the
     window is resized under them. Both move the rule, and neither should
     be a surprise: the first happens before the rule is allowed to
     animate at all, and the second is a resize, where everything else on
     the page is moving too.

     A ResizeObserver rather than the resize listener further down: the
     row is full-width, so it hears about a narrowed window, and about any
     other reflow that changes it, without this having to guess which
     events could matter. */
  new ResizeObserver(markTheme).observe(themesRow);

  /* Writes the date field from a value, or empties it. Kept in one place
     because two callers have to agree on the format exactly, and getting
     it wrong shows up as a silently blank field. */
  function writeDateField(date) {
    dateInput.value = date
      ? `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
      : "";
  }

  function applyTheme(next, { prefill }) {
    theme = THEMES[next] ? next : DEFAULT_THEME;
    writeStored(KEY_THEME, theme);

    /* The placeholder always shows the sentence the theme would use, so
       an empty field is a promise rather than a blank. */
    messageInput.placeholder = THEMES[theme].message;

    /* Set with the theme rather than at show time, so the canvas is
       already on the right side of the text before a single piece is
       drawn — flipping it as the first frame lands would show one frame
       of balloons over the sentence. */
    body.classList.toggle("fx-behind", celebration().behind === true);

    for (const el of themeInputs) el.checked = el.value === theme;

    /* Right here, with the radios: the rule marks whichever word is
       checked, so it moves when that does and at no other time. */
    markTheme();

    /* THE PREFILL, and the one rule that matters about it: it happens
       when a theme is PICKED, never when one is restored at load.

       state() only returns idle while customTarget is null, and idle is
       what makes a first visit open into the handoff. Prefilling at load
       would give every fresh visitor a target, so the page would open
       counting to next January instead of playing the thing it exists to
       show — and the bug would look like the auto-play "just not working"
       rather than like a date being set behind it.

       Only fills an EMPTY field: silently overwriting a date the visitor
       chose, because they wanted the other animation, would be the field
       throwing their answer away. */
    const filled =
      prefill && THEMES[theme].naturalDate !== null && customTarget === null;

    if (filled) {
      const natural = THEMES[theme].naturalDate();
      customTarget = natural;
      writeDateField(natural);
      writeStored(KEY_TARGET, dateInput.value);
    }

    /* Re-decide from state() only when the pick actually moved what the
       page is counting to — which is exactly when the prefill wrote a
       date, and at no other time.

       Restarting on EVERY pick is what this used to do, and while idle
       that meant a full rewind per click: restart(false) leaves no
       target, tick() reads idle, and idle rehearses. So browsing the
       three words replayed the whole four-second count and the handoff
       each time, over a handoff you were probably still watching. The
       theme is a costume, not a cue — picking one should re-dress the
       page, not restage it. */
    if (filled) restart(false);
    else if (done) {
      /* Already arrived, so there is nothing to count and nothing to
         rewind: swap the sentence for the new theme's, then re-throw the
         celebration where it stands. That keeps the reason the old code
         restarted — you get to SEE what you picked — without sending the
         digits back to rehearse for it. */
      messageEl.textContent = messageText();

      /* Only a celebration that has LANDED gets re-thrown. Mid-handoff,
         finish() is still pending and will show the incoming theme's
         celebration itself when it fires, so there is nothing to do here
         — and the run bump below would stall it half-arrived: no
         sentence, no controls handed back. .is-replaying rules out the
         same window from the other end, the beat after finish() runs but
         before it gives the controls back. (The visitor can't reach the
         radios then either, since the setup block steps aside with the
         button — this is belt and braces around a timer, not a race a
         click can win.) */
      const landed =
        body.classList.contains("is-done") &&
        !body.classList.contains("is-replaying");

      if (landed && !calm.matches) {
        /* Strands what the OUTGOING celebration still has scheduled: the
           confetti shower restages itself through later() for three and a
           half seconds, which is comfortably longer than it takes to
           click the next word, and it would otherwise rain through the
           balloons. Safe in this branch and no other — every step
           finish() scheduled has already fired.

           Then the canvas is cleared rather than left to drain, because
           .fx-behind has already flipped to suit the incoming
           celebration: balloons still in the air from the outgoing one
           would jump in front of the sentence mid-flight. */
        run++;
        clearConfetti();
        celebration().show();
        announce(messageText());
      }
    }
  }

  for (const el of themeInputs) {
    el.addEventListener("change", () => {
      if (el.checked) applyTheme(el.value, { prefill: true });
    });
  }

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
    writeDateField(customTarget);
    messageInput.value = customMessage;

    /* prefill: false is the whole point — see the note in applyTheme.
       Restoring a theme must not put a date behind a first visit's back
       and rob it of the opening handoff. */
    applyTheme(readStored(KEY_THEME), { prefill: false });
  }

  readPalette();
  layout();
  restore();
  updateReplay();

  /* restore() has already put the rule under the chosen word. This is
     what lets it MOVE from there — held back until two things are true,
     because a rule that animates before either one is a rule the visitor
     watches settling into place on load rather than one that was simply
     there:

     the mono face has landed, since the words change width when it does;
     and a frame has passed, since a transition granted in the same breath
     as the first measurement would animate the rule in from the row's
     left edge.

     fonts.ready resolves either way — a face that fails to load has still
     finished loading — so this cannot strand the rule un-animated. */
  document.fonts.ready.then(() => {
    markTheme();
    requestAnimationFrame(() => themesRow.classList.add("mark-moves"));
  });

  /* With nothing set the first tick reads idle and rehearses on its own,
     which IS the opening handoff — so there is no separate auto-play
     branch here to keep in step with the button. With a date set, the
     same call simply starts counting to it: the visitor's own countdown
     is what they came back for, and replaying the demo over it on every
     load would be noise. */
  tick();
  scheduleTick();
})();
