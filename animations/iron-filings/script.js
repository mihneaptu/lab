/* Iron filings

   A few hundred short strokes on a grid. Each one wants to lie along the
   line pointing at your cursor, and each gets there on its own angular
   spring — so this is not one animation, it is one input read by three
   hundred independent bodies.

   The wave is emergent, not drawn. A filing's spring is stiffer the
   closer it sits to the pointer, so the near ones snap round while the
   far ones follow lazily, and sweeping the cursor drags a ripple of
   rotation behind it. Nothing in here describes a wave; the wave is what
   a stiffness gradient looks like from outside.

   Clicking adds the second act: a ring that travels outward at a fixed
   speed and spins whatever it passes over, then leaves it to settle.
   Same field, same springs, a different way of disturbing them. */

const canvas = document.querySelector(".filings");

if (canvas && canvas.getContext) {
  const ctx = canvas.getContext("2d");
  const hint = document.querySelector(".filings-hint");
  const calm = matchMedia("(prefers-reduced-motion: reduce)");

  /* ---- the numbers ------------------------------------------------- */

  const SPACING = 34;      /* px between filings, both axes */
  const LEN = 14;          /* a filing's resting length */
  const LEN_GAIN = 0.55;   /* how much longer it gets right under the pointer */
  const WIDTH = 1.5;

  /* The stiffness gradient IS the effect. Near the pointer a filing is
     held tightly and turns almost instantly; out at the corners it is
     held loosely and takes its time. Flatten these two toward each other
     and the ripple disappears, leaving a field that just points. */
  const STIFF_NEAR = 150;
  const STIFF_FAR = 26;
  const DAMPING = 7.5;

  /* A pulse lives in the ring-down, not in the kick. At the resting
     damping the springs eat a disturbance almost as fast as it arrives,
     so the front crosses the field and leaves barely a tilt behind it.
     Slackening the springs while a ring is travelling lets the filings
     it passed keep swinging in its wake, which is the part worth
     watching — same trick the sun-moon exhibit plays after a shake. */
  const RING_DAMPING = 2.2;

  /* and a ceiling, so a filing caught square by the crest spins fast
     rather than infinitely */
  const V_MAX = 16;

  /* The front has to be narrow relative to the field or it stops being a
     front: at a third of the field's width it reaches everything at once
     and the whole grid just tilts together. Narrow and slow enough to
     watch, strong enough that a filing it crosses turns most of the way
     over before the spring hauls it back. */
  const PULSE_SPEED = 520; /* px/s the ring travels */
  const PULSE_WIDTH = 55;  /* px from crest to nothing */
  const PULSE_ACCEL = 110; /* angular kick at the crest */

  /* ---- state -------------------------------------------------------- */

  let filings = [];
  let w = 0, h = 0;          /* CSS pixels, cached: reading layout per frame
                                is the classic way to lose the frame */
  let px = 0, py = 0;
  let hasPointer = false;
  let pulses = [];
  let pulseDir = 1;
  let rafId = null;
  let lastT = 0;
  let ink = "#1a1a1a";
  let reach = 1;             /* the distance the gradient is measured against */

  /* The field draws in the theme's own ink rather than a colour of its
     own, so a flip of the switch in the corner repaints it. */
  function readInk() {
    const v = getComputedStyle(document.documentElement)
      .getPropertyValue("--ink")
      .trim();
    if (v) ink = v;
  }

  /* A filing is a line segment, so it has no head and no tail: turned
     through half a circle it is the same filing again. Measuring the
     shortest way round in HALF turns is what stops a stroke from making
     a pointless 180° journey to reach a pose it was already in. */
  function shortest(d) {
    const half = Math.PI;
    d = d % half;
    if (d > half / 2) d -= half;
    if (d < -half / 2) d += half;
    return d;
  }

  function layout() {
    const rect = canvas.getBoundingClientRect();
    w = rect.width;
    h = rect.height;

    /* Cap the backing store at 2x. Past that the extra pixels cost real
       fill rate on a phone and buy nothing the eye can find on a
       hairline stroke. */
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const cols = Math.max(2, Math.floor(w / SPACING));
    const rows = Math.max(2, Math.floor(h / SPACING));
    const ox = (w - (cols - 1) * SPACING) / 2;
    const oy = (h - (rows - 1) * SPACING) / 2;

    /* Rebuilt rather than resized: a filing's angle belongs to a position,
       and after a resize these are different positions. Starting flat and
       letting them turn back is honest, and it is also the entrance. */
    filings = [];
    for (let j = 0; j < rows; j++) {
      for (let i = 0; i < cols; i++) {
        filings.push({ x: ox + i * SPACING, y: oy + j * SPACING, a: 0, v: 0, near: 0 });
      }
    }

    reach = Math.hypot(w, h) / 2;
  }

  /* ---- the loop ------------------------------------------------------ */

  function wake() {
    if (calm.matches) {
      settle();
      return;
    }
    if (rafId === null) {
      lastT = performance.now();
      rafId = requestAnimationFrame(tick);
    }
  }

  function tick(t) {
    /* clamp dt so a throttled background tab cannot slingshot the field */
    const dt = Math.min((t - lastT) / 1000, 0.032);
    lastT = t;

    let alive = false;

    for (const p of pulses) p.r += PULSE_SPEED * dt;
    pulses = pulses.filter((p) => p.r < reach * 2 + PULSE_WIDTH);
    if (pulses.length) alive = true;

    /* loose while a ring is out, tight again once it has left the field */
    const damping = pulses.length ? RING_DAMPING : DAMPING;

    for (const f of filings) {
      let target = 0;
      let near = 0;

      /* With no pointer on the field there is no magnet, so the filings
         relax flat and parallel — the same rest they were laid out in. */
      if (hasPointer) {
        const dx = px - f.x;
        const dy = py - f.y;
        target = Math.atan2(dy, dx);
        near = 1 - Math.min(Math.hypot(dx, dy) / reach, 1);
      }
      f.near = near;

      const stiff = STIFF_FAR + (STIFF_NEAR - STIFF_FAR) * near * near;
      const diff = shortest(target - f.a);

      /* semi-implicit Euler: velocity from the forces first, then move.
         Stabler than the naive order at the stiffnesses used here. */
      f.v += (stiff * diff - damping * f.v) * dt;

      for (const p of pulses) {
        const edge = Math.abs(Math.hypot(f.x - p.x, f.y - p.y) - p.r);
        if (edge < PULSE_WIDTH) {
          /* cosine crest: the kick swells and fades as the ring crosses,
             so the wavefront has a shape instead of an edge */
          const crest = Math.cos((edge / PULSE_WIDTH) * (Math.PI / 2));
          f.v += p.dir * PULSE_ACCEL * crest * crest * dt;
        }
      }

      if (f.v > V_MAX) f.v = V_MAX;
      else if (f.v < -V_MAX) f.v = -V_MAX;

      f.a += f.v * dt;

      if (Math.abs(f.v) > 0.01 || Math.abs(diff) > 0.002) alive = true;
    }

    draw();
    rafId = alive ? requestAnimationFrame(tick) : null;
  }

  /* Under reduced motion there is no spring and no ring: the field still
     answers the pointer, it just arrives already turned. The preference
     is checked live, so flipping it mid-visit is honoured. */
  function settle() {
    if (rafId !== null) {
      cancelAnimationFrame(rafId);
      rafId = null;
    }
    pulses = [];
    for (const f of filings) {
      if (hasPointer) {
        const dx = px - f.x;
        const dy = py - f.y;
        f.a = Math.atan2(dy, dx);
        f.near = 1 - Math.min(Math.hypot(dx, dy) / reach, 1);
      } else {
        f.a = 0;
        f.near = 0;
      }
      f.v = 0;
    }
    draw();
  }

  function draw() {
    ctx.clearRect(0, 0, w, h);
    ctx.strokeStyle = ink;
    ctx.lineWidth = WIDTH;
    ctx.lineCap = "round";

    /* One path for the whole field, one stroke call. Per-filing strokes
       would be three hundred state changes a frame for a picture that is
       all the same colour. */
    ctx.beginPath();
    for (const f of filings) {
      const half = (LEN * (1 + LEN_GAIN * f.near * f.near)) / 2;
      const cx = Math.cos(f.a) * half;
      const cy = Math.sin(f.a) * half;
      ctx.moveTo(f.x - cx, f.y - cy);
      ctx.lineTo(f.x + cx, f.y + cy);
    }
    ctx.stroke();
  }

  /* ---- input --------------------------------------------------------- */

  /* offsetX/offsetY are already relative to the canvas's own box, which
     saves measuring it on every move. */
  canvas.addEventListener("pointermove", (e) => {
    px = e.offsetX;
    py = e.offsetY;
    hasPointer = true;
    wake();
  });

  canvas.addEventListener("pointerleave", () => {
    hasPointer = false;
    wake();
  });

  function pulseAt(x, y) {
    pulses.push({ x, y, r: 0, dir: pulseDir });
    pulseDir *= -1; /* the next one turns the other way, so a second click
                       reads as a new event rather than a repeat */
  }

  canvas.addEventListener("pointerdown", (e) => {
    px = e.offsetX;
    py = e.offsetY;
    hasPointer = true;

    if (calm.matches) {
      settle();
      return;
    }

    pulseAt(px, py);
    /* one firm beat, and only for a real finger — the middle rung of the
       ladder in haptics.js, which stays silent under reduced motion */
    if (e.pointerType === "touch") window.labBuzz?.(12);
    wake();
  });

  /* ---- the world changing under it ----------------------------------- */

  let resizeFrame = null;
  window.addEventListener("resize", () => {
    /* one relayout per frame, not one per resize event */
    if (resizeFrame !== null) return;
    resizeFrame = requestAnimationFrame(() => {
      resizeFrame = null;
      layout();
      calm.matches ? settle() : wake();
    });
  });

  /* A theme flip changes the ink but not the physics, so it only needs a
     repaint — and it needs one even when the loop has parked. */
  new MutationObserver(() => {
    readInk();
    if (rafId === null) draw();
  }).observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["data-theme"],
  });

  /* A parked loop restarts from a stale timestamp, which would hand the
     first frame back a huge dt. Drop the clock on the way out instead —
     and pick the motion back up on the way in, because a field parked
     mid-swing would otherwise stay frozen half-turned until something
     else happened to wake it. wake() reseeds the clock, so the restart
     costs nothing. */
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") {
      if (rafId !== null) {
        cancelAnimationFrame(rafId);
        rafId = null;
      }
      return;
    }

    calm.matches ? settle() : wake();
  });

  /* wake() guards the way in; this guards the way out. Turning the
     preference on mid-visit should stop what is already moving, not
     wait for the springs to park on their own. */
  calm.addEventListener("change", () => {
    calm.matches ? settle() : wake();
  });

  /* ---- opening ------------------------------------------------------- */

  readInk();
  layout();

  if (matchMedia("(pointer: coarse)").matches && hint) {
    hint.textContent = "drag to comb the field · tap to send a pulse";
  }

  if (calm.matches) {
    settle();
  } else {
    /* The field arrives flat, then one pulse crosses it from the middle.
       A visitor who never moves the pointer still gets told, in the
       exhibit's own language, what the exhibit does. */
    pulseAt(w / 2, h / 2);
    wake();
  }
}
