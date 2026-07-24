/* Segmented control

   One thumb on one spring. Click, drag, or fling it: the same body takes
   the input either way, and each segment retunes the very spring the
   thumb rides, so the control demonstrates its own physics.
 */

const calm = matchMedia("(prefers-reduced-motion: reduce)");
const seg = document.querySelector(".seg");
const thumb = document.querySelector(".seg-thumb");
const options = [...seg.querySelectorAll(".seg-option")];

/* The three presets. k is stiffness (1/s²), c is damping (1/s), and
   the character of a spring is decided by one number derived from
   them: the damping ratio ζ = c / (2√k).
     ζ ≈ 0.9  — glides home without overshoot (soft)
     ζ ≈ 0.56 — overshoots ~12%: one polite bounce (snappy)
     ζ ≈ 0.24 — overshoots ~45% and rings a while (bouncy)
   (overshoot = e^(−πζ/√(1−ζ²)), for the step response of a damped
   spring.) */
const PRESETS = [
  { k: 180, c: 24 },
  { k: 620, c: 28 },
  { k: 420, c: 10 },
];

const PAD = 4;              // px — mirrors --pad in the stylesheet
const DRAG_THRESHOLD = 8;   // px of wander that turns a press into a drag
const RUBBER = 0.35;        // past an end, travel counts only this much
const RUBBER_MAX = 26;      // px — the most the band stretches
const FLING_LOOKAHEAD = 0.12; // s of release velocity folded into the pick
const FLING_MAX = 2400;     // px/s — a wild fling still reads as a slide
const V_MAX = 5200;         // px/s — a throttled frame can't slingshot it

/* Squash-and-stretch is driven by SPEED, not direction: the thumb
   elongates along the travel axis mid-flight and counter-squeezes a
   touch vertically. The arrival overshoot (velocity spikes the other
   way) then gets its own little recoil for free. One segment on the
   snappy preset peaks around 2100 px/s, so 2600 px/s of speed maps
   to the full 14% stretch — visible, never rubbery. */
const SQUASH_REF = 2600;    // px/s for full stretch
const SQUASH_MAX = 0.14;

let index = Math.max(0, options.findIndex(
  (o) => o.getAttribute("aria-checked") === "true"
));
let segW = 0;                    // px per segment, measured
let x = 0, v = 0, target = 0;    // the spring's state, in px of travel
let rafId = null, lastT = 0;
let ringUntil = 0; // while now < this, tick runs loose springs (shake)

function measure() {
  /* The options are untransformed grid children. The thumb's own box
     can't be trusted for this — getBoundingClientRect includes the
     spring's squash. */
  segW = options[0].getBoundingClientRect().width;
}

function pose() {
  const s = Math.min(Math.abs(v) / SQUASH_REF, 1) * SQUASH_MAX;
  thumb.style.transform =
    `translateX(${x}px) scale(${1 + s}, ${1 - s * 0.5})`;
}

/* Settled, the transform carries no scale residue — just the resting
   translate. */
function park() {
  thumb.style.transform = `translateX(${x}px)`;
}

function syncAria() {
  options.forEach((o, j) => {
    o.setAttribute("aria-checked", String(j === index));
    o.tabIndex = j === index ? 0 : -1;
  });
}

/* One funnel for every way the selection can change: click, fling,
   or keys. Retargeting mid-flight is the whole point of physics over
   keyframes — the spring just chases the new target from wherever it
   is, velocity and all, instead of restarting a canned clip. */
function goTo(i) {
  const changed = i !== index;
  index = i;
  target = i * segW;
  if (changed) {
    syncAria();
    /* the commit tick — the firm tier from haptics.js, only when a
       finger caused it. Called from inside the gesture (pointerup /
       click), so the iOS switch-tick still has its activation. */
    if (gestureTouch) window.labBuzz?.(12);
  }
  if (calm.matches) {
    x = target; v = 0; park(); syncUnder();
    return;
  }
  wake();
}

/* --- Drag, fling, and the click that wasn't one -------------------------
   Pressing the thumb grabs it (even mid-flight). Pressing a label
   arms a click; wander more than a few px and the press becomes a
   drag, the thumb swimming to center itself under the finger — the
   way the iOS control behaves. Releasing folds the finger's velocity
   into the pick: the thumb lands on the segment nearest to where it
   was HEADED, not where it happened to be let go. */

let pid = null;          // the one pointer we follow; others are ignored
let held = false;        // the finger owns the thumb
let pressIndex = -1;     // the option a press started on (-1: the track)
let pressX = 0, pressY = 0;
let grabOffset = 0;      // px from the thumb's left edge to the grip
let lastPX = 0, lastPT = 0, dragV = 0; // the finger's velocity trail
let suppressClick = false; // a drag's ghost click must not re-select
let gestureTouch = false;  // did a finger start this interaction?
let underIndex = -1;       // the segment under the thumb RIGHT NOW

/* The ink's single source of truth: is-under follows the thumb's
   live position — every integrator frame and every drag move — so
   exactly the label beneath it wears the contrast color, flipping
   the moment the thumb's center crosses into its third. Kept apart
   from index on purpose: index (and with it aria-checked and the
   roving tabindex) is the committed VALUE, which changes the instant
   you act, long before the thumb physically arrives. */
function syncUnder() {
  const j = Math.max(0, Math.min(2, Math.round(x / segW)));
  if (j === underIndex) return;
  underIndex = j;
  options.forEach((o, k) => o.classList.toggle("is-under", k === j));
}

function trackX(e) {
  const r = seg.getBoundingClientRect();
  /* border (clientLeft) + track padding sit between the rect's left
     edge and the thumb's x=0 */
  return e.clientX - r.left - seg.clientLeft - PAD;
}

function rubber(raw) {
  const max = 2 * segW;
  if (raw < 0) return Math.max(raw * RUBBER, -RUBBER_MAX);
  if (raw > max) return max + Math.min((raw - max) * RUBBER, RUBBER_MAX);
  return raw;
}

seg.addEventListener("pointerdown", (e) => {
  if (pid !== null) return;
  if (e.pointerType === "mouse" && e.button !== 0) return;
  pid = e.pointerId;
  suppressClick = false;
  gestureTouch = e.pointerType === "touch";

  const px = trackX(e);
  pressX = px;
  pressY = e.clientY;
  pressIndex = options.indexOf(e.target.closest(".seg-option"));
  lastPX = px;
  lastPT = performance.now();
  dragV = 0;

  if (px >= x - 6 && px <= x + segW + 6) {
    held = true;
    grabOffset = px - x;
    /* capture routes every move and the lift back here even if the
       pointer wanders off the control mid-drag. Only DRAGS capture:
       Chromium retargets the compatibility click to the capture
       element, so a captured plain press would lose its click on
       the option — and with it, selection by tap or mouse click. */
    seg.setPointerCapture(pid);
    thumb.classList.add("is-held");
    seg.classList.add("is-dragging");
    /* the grab tick — haptics.js's faint tier, a press telling the
       hand it caught something */
    if (gestureTouch) window.labBuzz?.(6);
  }
});

seg.addEventListener("pointermove", (e) => {
  if (pid === null) {
    brush(e); // no gesture in flight: the cursor jiggle channel
    return;
  }
  if (e.pointerId !== pid) return;

  const px = trackX(e);
  const now = performance.now();

  if (!held && pressIndex !== -1 &&
      Math.hypot(px - pressX, e.clientY - pressY) > DRAG_THRESHOLD) {
    /* the press becomes a drag: the thumb swims to the finger */
    held = true;
    grabOffset = segW / 2;
    seg.setPointerCapture(pid);
    thumb.classList.add("is-held");
    seg.classList.add("is-dragging");
  }

  if (held) {
    x = rubber(px - grabOffset);
    /* the finger's velocity, smoothed: raw per-event deltas jitter
       too much to fling on, so they run through an EMA */
    const dt = (now - lastPT) / 1000;
    if (dt > 0.001) {
      dragV = dragV * 0.7 + ((px - lastPX) / dt) * 0.3;
    }
    v = dragV; // so the squash answers the finger's speed too
    pose();
    syncUnder(); // the label beneath the thumb keeps its ink true
  }

  lastPX = px;
  lastPT = now;
});

function release(e, fling) {
  if (e.pointerId !== pid) return;
  pid = null;
  thumb.classList.remove("is-held");
  seg.classList.remove("is-dragging");

  if (held) {
    held = false;
    /* the drag is handled; the click event trailing a touch drag
       (or a mouse one) must not turn around and re-select whatever
       option the press happened to start on */
    suppressClick = true;
    const vv = fling
      ? Math.max(-FLING_MAX, Math.min(FLING_MAX, dragV))
      : 0; // a cancel's velocity is unreliable across browsers
    const pick = Math.max(0, Math.min(2,
      Math.round((x + vv * FLING_LOOKAHEAD) / segW)
    ));
    v = vv; // the spring inherits the finger's speed, never a jump
    goTo(pick);
  }
  pressIndex = -1;
}
seg.addEventListener("pointerup", (e) => release(e, true));
seg.addEventListener("pointercancel", (e) => release(e, false));

/* Clicks handle only what pointerup didn't: plain taps and keyboard
   activation. (Keyboard clicks carry detail 0 — and no pointerdown
   preceded them, so the touch latch must be cleared explicitly.) */
seg.addEventListener("click", (e) => {
  if (suppressClick) {
    suppressClick = false;
    return;
  }
  const o = e.target.closest(".seg-option");
  if (!o) return;
  if (e.detail === 0) gestureTouch = false;
  goTo(options.indexOf(o));
});

/* Radiogroup keys: arrows walk one segment, Home/End jump to the
   ends, and focus follows the selection. */
seg.addEventListener("keydown", (e) => {
  let next = null;
  if (e.key === "ArrowRight") next = Math.min(index + 1, 2);
  else if (e.key === "ArrowLeft") next = Math.max(index - 1, 0);
  else if (e.key === "Home") next = 0;
  else if (e.key === "End") next = 2;
  if (next === null) return;
  e.preventDefault();
  goTo(next);
  options[next].focus();
});

/* --- The spring ----------------------------------------------------------
   One body, one axis, semi-implicit Euler — the same integrator the
   title's leaning letters and the sun-moon jiggle ride: velocity
   from the spring force FIRST, then position. The preset under the
   CURRENT selection supplies k and c, which is what makes switching
   segments tactile: retarget and the very ride over obeys the new
   constants. */

function wake() {
  if (rafId === null && !calm.matches) {
    lastT = performance.now();
    rafId = requestAnimationFrame(tick);
  }
}

function tick(t) {
  /* clamp dt so a throttled background tab can't slingshot the thumb */
  const dt = Math.min((t - lastT) / 1000, 0.032);
  lastT = t;

  if (held) { rafId = null; return; } // the finger owns x while held

  const p = PRESETS[index];
  /* shaken springs ring loose; everything else gets the preset's */
  const damping = t < ringUntil ? RING_DAMPING : p.c;

  v += (-p.k * (x - target) - damping * v) * dt;
  if (v > V_MAX) v = V_MAX;
  else if (v < -V_MAX) v = -V_MAX;
  x += v * dt;

  /* The track's end-stops: the thumb doesn't pass through the wall,
     it knocks on it — a third of the impact speed comes back. */
  const max = 2 * segW;
  if (x < 0) { x = 0; v = Math.abs(v) * 0.32; }
  else if (x > max) { x = max; v = -Math.abs(v) * 0.32; }

  if (Math.abs(x - target) < 0.05 && Math.abs(v) < 3) {
    x = target;
    v = 0;
    park(); // snap off the squash residue and stop touching the style
    syncUnder();
    rafId = null;
    return;
  }

  pose();
  syncUnder(); // the ink tracks the flight, not just drags
  rafId = requestAnimationFrame(tick);
}

/* --- Cursor brush --------------------------------------------------------
   Idle, the thumb isn't wired to a canned hover animation — it's a
   body the cursor physically brushes. Sweeping past it flicks it in
   the direction of travel; the spring pulls it home. Hold the mouse
   still and nothing moves: the wobble IS your hand's motion, echoed
   (the same contract as the sun-moon exhibit's cursor jiggle, the
   same kicks). The control is a one-axis machine, so only the
   horizontal part of the brush transfers — vertical passes go by
   unfelt. */

const REACH = 44;   // px — brush influence radius around the thumb
const FLICK = 3;    // px/s of thumb speed per px of cursor travel
const KICK_MAX = 1600; // px/s — a wild swipe can't launch the thumb

let lastJX = null; // last cursor x, for the brush's deltas
let lastZoom = devicePixelRatio; // zoom detector, see the guard below

function kick(dv) {
  if (held || calm.matches) return;
  const before = v;
  v += dv;
  /* The ceiling caps kicks, not earned speed: a fling already
     traveling faster than the cap keeps its velocity when brushed —
     only a kick that PUSHES past the ceiling gets trimmed. */
  if (Math.abs(v) > KICK_MAX && Math.abs(before) <= KICK_MAX) {
    v = Math.sign(v) * KICK_MAX;
  }
  wake();
}

function brush(e) {
  if (e.pointerType === "touch" || calm.matches) return;
  /* Ctrl+scroll zoom rescales the page under a stationary cursor,
     and the browser then fires one synthetic move so hover state
     catches up. Against the thumb that reads as the hand teleporting
     — one giant delta per wheel notch. Zoom is the only thing that
     changes devicePixelRatio, so when it moves, drop the trail — the
     same cure as leaving. */
  if (devicePixelRatio !== lastZoom) {
    lastZoom = devicePixelRatio;
    lastJX = null;
  }
  const r = thumb.getBoundingClientRect(); // scale-safe: the squash
    // grows the box around its center, so the center stays true
  const cx = r.left + r.width / 2;
  const cy = r.top + r.height / 2;
  const d = Math.hypot(e.clientX - cx, e.clientY - cy);
  if (lastJX !== null && d < REACH) {
    /* smooth falloff: full strength on the thumb, zero at REACH */
    const f = 1 - (d / REACH) ** 2;
    kick((e.clientX - lastJX) * FLICK * f);
  }
  lastJX = e.clientX;
}

seg.addEventListener("pointerleave", () => {
  /* forget the trail so re-entry doesn't read as one giant delta */
  lastJX = null;
});

/* Scrolling slides the control under a stationary cursor and the
   browser's catch-up move would brush it as one giant flick — the
   same teleport as zoom, so the same cure: drop the trail. */
window.addEventListener("scroll", () => {
  lastJX = null;
}, { passive: true });

/* --- Shaking the phone ---------------------------------------------------
   The same spring answers the accelerometer: jolt the phone and the
   thumb lags behind it, then gets pulled home — the pseudo-force of
   the phone's own acceleration, fed in as velocity kicks. Only the
   horizontal axis matters: the thumb is a one-axis machine, vertical
   shakes pass straight through, which is how it should feel.
   You can't watch the thumb rattle while your own hand is shaking
   the screen — eyes and phone move together. So the show is the
   RING-DOWN: while jolts arrive (and for a beat after) the spring
   runs much looser, so the thumb keeps visibly trembling after the
   hand stops, before the preset's damping calms it again. Motion
   sensors only exist on secure origins, and iOS additionally wants a
   permission prompt we won't show for an easter egg — in practice
   this is Android over HTTPS, and anywhere else the listener never
   hears a thing. */

const SHAKE = 320;    // px/s of thumb speed per m/s² of sideways jolt
const SHAKE_MIN = 2;  // m/s² — below this the phone is just being held
const RING_DAMPING = 5; // loose spring while shaken (vs the preset's c)
const RING = 1200;    // ms the looseness outlives the last jolt

if (isSecureContext) {
  window.addEventListener("devicemotion", (e) => {
    const a = e.acceleration; // gravity already subtracted
    if (!a || a.x === null) return;
    if (Math.abs(a.x) < SHAKE_MIN) return; // held, not shaken
    ringUntil = performance.now() + RING;
    /* interval is the sensor's sampling period, in MILLISECONDS;
       device x runs along screen x in portrait, and the phone jerks
       one way while the thumb lags the other — hence the minus */
    const dt = e.interval > 0 && e.interval < 100 ? e.interval / 1000 : 0.016;
    kick(-a.x * SHAKE * dt);
  });
}

/* --- Housekeeping -------------------------------------------------------- */

measure();
x = target = index * segW;
park();
syncUnder(); // the checked label wears the ink from the first paint

/* A resize re-does the geometry, and re-anchoring a spring nobody
   can watch mid-resize beats rescaling it: land the thumb on its
   segment in the new geometry. (Only the viewport's width moves the
   segments — the grid's equal thirds make them font-proof.) */
window.addEventListener("resize", () => {
  measure();
  x = target = index * segW;
  v = 0;
  park();
  syncUnder();
});

/* Stop the spring before the document is frozen: rAF callbacks never
   fire in a hidden document, so a mid-flight thumb would otherwise
   be cached (or restored from the back/forward cache) away from its
   segment with a dead clock. Landing it is invisible — the page is
   going away anyway. A grip simply ends: the finger is gone. */
function settleForSuspension() {
  if (rafId !== null) {
    cancelAnimationFrame(rafId);
    rafId = null;
  }
  if (pid !== null) {
    pid = null;
    held = false;
    pressIndex = -1;
    thumb.classList.remove("is-held");
    seg.classList.remove("is-dragging");
  }
  x = target;
  v = 0;
  park();
  syncUnder();
}

window.addEventListener("pagehide", settleForSuspension);
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") settleForSuspension();
});