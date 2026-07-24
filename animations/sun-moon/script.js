/* Sun to moon

   The icon is the state: clicking it flips the document's theme, and CSS
   keys every pose off <html data-theme>. The rays and the stars ride
   springs the pointer can brush and a phone shake can rattle, so the
   morph is never quite the same twice.
 */

const root = document.documentElement;
const toggle = document.querySelector(".sky-toggle");
const label = document.querySelector(".sky-label");

/* One source of truth: the theme decides the pose, never the other
   way around. The icon just reads data-theme and dresses to match. */
function syncPose() {
  const isMoon = root.dataset.theme === "dark";
  toggle.classList.toggle("is-moon", isMoon);
  toggle.setAttribute("aria-pressed", String(isMoon));
  label.textContent = isMoon ? "moon" : "sun";
}

/* The icon leads, the world follows one frame later. Flipping
   data-theme restyles and repaints the WHOLE page in one go, and on
   a phone that stall is long enough that the rays' 170ms plunge —
   the only leg of the morph that starts at 0ms — lost its opening
   frames and read as a blink. So the tap only starts the icon's
   morph (cheap: one small svg), lets the browser paint that first
   frame, and flips the theme on the one after. The sky still moves
   with the sun — 16ms is far below what the eye can order — but
   the stall now lands with the plunge already visibly in motion. */
let flipFrame;
let labelTimer;
toggle.addEventListener("click", () => {
  /* localStorage, not root.dataset, is the source of truth for
     "current theme" here: with the world-flip deferred a frame, a
     fast second tap could otherwise read the OLD theme back and
     cancel itself out. */
  const next =
    (localStorage.getItem("theme") || root.dataset.theme) === "dark"
      ? "light" : "dark";
  localStorage.setItem("theme", next);

  const isMoon = next === "dark";
  toggle.classList.toggle("is-moon", isMoon);
  toggle.setAttribute("aria-pressed", String(isMoon));

  cancelAnimationFrame(flipFrame);
  flipFrame = requestAnimationFrame(() => {
    /* two rAFs, not one: the first fires BEFORE this frame paints,
       so the flip would land in the same paint as the morph's
       start; the second lands it cleanly in the frame after */
    flipFrame = requestAnimationFrame(() => {
      root.dataset.theme = next;
    });
  });

  /* The word changes when the shape does: the crescent bite lands /
     the rays return around the 150ms mark, so the caption switches
     just before that, no fade needed. */
  clearTimeout(labelTimer);
  labelTimer = setTimeout(() => {
    label.textContent = isMoon ? "moon" : "sun";
  }, 130);
});

/* If you arrive in dark mode, wake up as the moon. This runs before
   the first paint, so the pose is applied without playing the morph
   — you only see the animation when YOU flip the sky. */
syncPose();

function settleSkyTransitions() {
  document.getAnimations().forEach((anim) => {
    if (anim.transitionProperty) anim.cancel();
  });
}

/* Stop the morph before the document is frozen. Repairing it only
   after a back/forward-cache restore is too late in Chromium-based
   browsers: the first restored frame may still carry the old border,
   label color, or icon pose. The deferred world-flip must land too:
   rAF callbacks never fire in a hidden document, so a tap taken in
   the instant before hiding would otherwise leave the sky in the
   old theme with the icon already morphed. */
function prepareSkyForSuspension() {
  clearTimeout(labelTimer);
  cancelAnimationFrame(flipFrame);
  root.dataset.theme = localStorage.getItem("theme") || root.dataset.theme;
  settleSkyTransitions();
}

window.addEventListener("pagehide", prepareSkyForSuspension);

/* Re-sync first, then cancel. Changing the theme and .is-moon class
   can create fresh transitions of its own, and those must also land
   immediately when the page is being restored. */
window.addEventListener("pageshow", () => {
  clearTimeout(labelTimer);
  root.dataset.theme = localStorage.getItem("theme") || root.dataset.theme;
  syncPose();
  settleSkyTransitions();
});

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") {
    prepareSkyForSuspension();
    return;
  }

  root.dataset.theme = localStorage.getItem("theme") || root.dataset.theme;
  syncPose();
  settleSkyTransitions();
});

/* --- Cursor jiggle ----------------------------------------------------
   The rays and stars aren't wired to a canned hover animation —
   each one is a tiny spring-mounted body the cursor physically
   brushes. Moving the mouse near a part flicks it in the direction
   the cursor is travelling; a damped spring then pulls it home,
   overshooting a little on the way. Hold the mouse still and
   nothing moves: the jiggle IS your hand's motion, echoed.

   Everything works in viewBox units (the icon is 24 units across,
   3px each on screen) so the numbers below stay meaningful next to
   the svg coordinates. */

const icon = document.querySelector(".sky-icon");

/* One entry per springy part: the element that takes the transform,
   its rest position (where the cursor's distance is measured), and
   which sky it belongs to — rays answer by day, stars by night, so
   the swallowed rays can't shiver invisibly inside the moon.
   The stars enter through their WRAPPER group: a star's own
   transform belongs to the morph's flight, and nested transforms
   compose instead of fighting over one property. */
const parts = [];

for (const line of icon.querySelectorAll(".rays line")) {
  parts.push({
    el: line,
    cx: (+line.getAttribute("x1") + +line.getAttribute("x2")) / 2,
    cy: (+line.getAttribute("y1") + +line.getAttribute("y2")) / 2,
    moon: false,
    x: 0, y: 0, vx: 0, vy: 0,
  });
}

for (const jig of icon.querySelectorAll(".star-jig")) {
  const star = jig.querySelector(".star");
  parts.push({
    el: jig,
    cx: +star.getAttribute("cx"),
    cy: +star.getAttribute("cy"),
    moon: true,
    x: 0, y: 0, vx: 0, vy: 0,
  });
}

/* A shake is a uniform force field — identical kicks would march
   every part in lockstep, which reads as the icon sliding around,
   not parts rattling in place. A fixed per-part "mass" desyncs
   them: lighter parts fly a little further on the same jolt. */
for (const part of parts) part.gain = 0.75 + Math.random() * 0.5;

const REACH = 4;       // influence radius around a part, in units
const FLICK = 6;       // how much of the cursor's motion transfers
const STIFFNESS = 520; // spring pull toward home (1/s²)
const DAMPING = 11;    // low enough that the return overshoots (1/s)
const V_MAX = 32;      // units/s — a wild swipe can't launch a part
const SHAKE = 24;      // units/s of part speed per m/s² of phone jolt —
                       // strong enough that a real shake saturates V_MAX
                       // within a few jolts, whatever rhythm the hand
                       // picks; the cap is what actually sets the size
const SHAKE_MIN = 2;   // m/s² — below this the phone is just being held
/* You can't watch the parts rattle while your own hand is shaking
   the screen — eyes and phone move together, and the wobble only
   shows up in recordings. So the show is the RING-DOWN: while jolts
   arrive (and for a beat after) the springs run much looser, so the
   parts swing big and keep visibly trembling for a second after the
   hand stops, before the normal damping calms them again. */
const RING_DAMPING = 4; // loose springs while shaken (vs DAMPING at rest)
const RING = 1200;      // ms the looseness outlives the last jolt

let pointer = null; // last cursor spot, in viewBox units
let touchId = null; // the one finger standing in for the cursor

/* On a phone the finger IS the cursor — the same contract as the
   homepage title: pressing the button starts the trail under the
   fingertip, dragging brushes the parts exactly like cursor motion,
   lifting lets the springs settle home. A plain tap still flips the
   sky: the browser only fires click when the finger didn't really
   travel, so the two gestures never collide. Touch pointers are
   implicitly captured on pointerdown, so a drag that wanders off
   the button keeps brushing until it lifts (or the scroll takes it
   via pointercancel — pan-y above hands it only vertical swipes). */
toggle.addEventListener("pointerdown", (e) => {
  if (e.pointerType !== "touch" || touchId !== null) return;
  touchId = e.pointerId;
  const r = icon.getBoundingClientRect();
  const unit = r.width / 24;
  pointer = { x: (e.clientX - r.left) / unit, y: (e.clientY - r.top) / unit };
});

function lift(e) {
  if (e.pointerId !== touchId) return;
  touchId = null;
  pointer = null; // parts already in motion just spring home
}
toggle.addEventListener("pointerup", lift);
toggle.addEventListener("pointercancel", lift);

/* Listening on the whole button, not just the 72px icon: REACH
   extends past the icon's edge, so a ray should already stir as
   the cursor closes in on it from the surrounding paper. */
let lastZoom = devicePixelRatio;
toggle.addEventListener("pointermove", (e) => {
  /* touch brushes only while the followed finger is down; the
     cursor brushes freely — the physics below is shared */
  if (e.pointerType === "touch" && e.pointerId !== touchId) return;
  /* remeasure every move — the button itself drifts 2px upward on
     hover, so a cached rect would smear every coordinate */
  const r = icon.getBoundingClientRect();
  const unit = r.width / 24;
  const p = { x: (e.clientX - r.left) / unit, y: (e.clientY - r.top) / unit };

  /* Ctrl+scroll zoom rescales the page under a stationary cursor,
     and the browser then fires one synthetic move so hover state
     catches up. Relative to the icon that reads as the hand
     teleporting — one giant delta per wheel notch — and the kick
     slammed whatever the cursor landed next to (by night the
     stars, rattled out of their sky on every notch). Zoom is the
     only thing that changes devicePixelRatio, so when it moves,
     drop the trail — the same cure as leaving: the kick below
     skips, and the last line reseeds from the new coordinates. */
  if (devicePixelRatio !== lastZoom) {
    lastZoom = devicePixelRatio;
    pointer = null;
  }

  if (pointer) {
    const dx = p.x - pointer.x;
    const dy = p.y - pointer.y;
    const isMoon = toggle.classList.contains("is-moon");

    for (const part of parts) {
      if (part.moon !== isMoon) continue;
      const d = Math.hypot(p.x - part.cx, p.y - part.cy);
      if (d >= REACH) continue;

      /* smooth falloff: full strength on the part, zero at REACH */
      const f = 1 - (d / REACH) ** 2;
      part.vx += dx * FLICK * f;
      part.vy += dy * FLICK * f;

      const v = Math.hypot(part.vx, part.vy);
      if (v > V_MAX) {
        part.vx *= V_MAX / v;
        part.vy *= V_MAX / v;
      }
    }
    wake();
  }
  pointer = p;
});

toggle.addEventListener("pointerleave", () => {
  /* forget the trail so re-entry doesn't read as one giant delta;
     parts already in motion just spring home on their own */
  pointer = null;
});

/* Scrolling has the same teleport problem as zoom: each wheel
   notch slides the icon ~100px under a stationary cursor and the
   browser's catch-up move would land as one giant kick. The page
   only scrolls when zoomed in, which is exactly when it happens
   right next to the icon. Same cure as leaving: drop the trail.
   (Touch is unaffected — a scrolling finger already exits through
   pointercancel, which clears the trail on its own.) */
window.addEventListener("scroll", () => {
  pointer = null;
}, { passive: true });

/* --- Shaking the phone ------------------------------------------------
   The same springs answer the accelerometer: jolt the phone and the
   mounted parts lag behind it, then get pulled home — the pseudo-
   force of the phone's own acceleration, fed in as velocity kicks.
   Day picks the rays, night the stars, same rule as the cursor.
   Mapped for portrait (device x runs along screen x; device y
   points UP the screen, so it flips): this is a phone flourish,
   and phones hold the lab upright. Motion sensors only exist on
   secure origins, and iOS additionally wants a permission prompt
   we won't show for an easter egg — in practice this is Android
   over HTTPS, and anywhere else the listener never hears a thing. */
let ringUntil = 0; // while now < this, tick runs the loose springs

if (isSecureContext) {
  window.addEventListener("devicemotion", (e) => {
    const a = e.acceleration; // gravity already subtracted
    if (!a || a.x === null) return;
    if (Math.hypot(a.x, a.y) < SHAKE_MIN) return; // held, not shaken
    ringUntil = performance.now() + RING;
    /* interval is the sensor's sampling period, in MILLISECONDS */
    const dt = e.interval > 0 && e.interval < 100 ? e.interval / 1000 : 0.016;
    const isMoon = toggle.classList.contains("is-moon");
    for (const part of parts) {
      if (part.moon !== isMoon) continue;
      /* the phone jerks one way, the parts lag the other */
      part.vx += -a.x * SHAKE * part.gain * dt;
      part.vy += a.y * SHAKE * part.gain * dt;
      const v = Math.hypot(part.vx, part.vy);
      if (v > V_MAX) {
        part.vx *= V_MAX / v;
        part.vy *= V_MAX / v;
      }
    }
    wake();
  });
}

let rafId = null;
let lastT = 0;

/* The jiggle is JS, so the global reduced-motion rule in base.css
   cannot reach it: that rule zeroes transition and animation clocks,
   and this loop writes transforms itself, frame by frame. Honour the
   preference here instead.

   Every kick (a brushing pointer, a phone shake) funnels through
   wake(), so one guard covers them all. The velocity a gesture just
   handed out is dropped rather than banked, so nothing springs loose
   later if the preference flips mid-visit. */
const calm = matchMedia("(prefers-reduced-motion: reduce)");

function wake() {
  if (calm.matches) {
    for (const part of parts) {
      part.x = part.y = part.vx = part.vy = 0;
    }
    return;
  }

  if (rafId === null) {
    lastT = performance.now();
    rafId = requestAnimationFrame(tick);
  }
}

function tick(t) {
  /* clamp dt so a throttled background tab can't slingshot a part */
  const dt = Math.min((t - lastT) / 1000, 0.032);
  lastT = t;

  /* shaken springs ring loose; everything else gets the tight ones */
  const damping = t < ringUntil ? RING_DAMPING : DAMPING;

  let alive = false;
  for (const part of parts) {
    /* semi-implicit Euler: update velocity from the spring force
       and friction FIRST, then move — stabler than the naive order */
    part.vx += (-STIFFNESS * part.x - damping * part.vx) * dt;
    part.vy += (-STIFFNESS * part.y - damping * part.vy) * dt;
    part.x += part.vx * dt;
    part.y += part.vy * dt;

    if (Math.hypot(part.x, part.y) > 0.002 || Math.hypot(part.vx, part.vy) > 0.05) {
      alive = true;
      /* px inside svg = user units, so these ARE viewBox units */
      part.el.style.transform = `translate(${part.x}px, ${part.y}px)`;
    } else if (part.el.style.transform) {
      /* settled: snap off the residue and stop touching the style */
      part.x = part.y = part.vx = part.vy = 0;
      part.el.style.transform = "";
    }
  }

  rafId = alive ? requestAnimationFrame(tick) : null;
}