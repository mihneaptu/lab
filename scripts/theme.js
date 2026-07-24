/* theme.js — the light/dark switch.

   The theme is stored as a data-theme attribute on <html>, which is what
   tokens.css keys its dark override on. The attribute is already set by
   the time this script runs — a tiny inline script in each page's <head>
   does that before first paint, so the page never flashes the wrong theme.

   This file only has to do one job: make the header button flip the
   attribute and remember the choice for next visit. */

const root = document.documentElement;
const toggle = document.querySelector(".theme-toggle");
const calmMotion = matchMedia("(prefers-reduced-motion: reduce)");

/* The button carries no text — its content is the morphing sun/moon
   icon, and the icon IS the state (base.css keys the two poses off
   the data-theme attribute this script flips). If a page ever wants a
   text label again, it goes in a .tt-label span so writing it can't
   wipe out the svg. */
const label = toggle?.querySelector(".tt-label") ?? null;

/* A page may legitimately have no button: the sun-moon exhibit IS the
   switch, so a second one in the corner would be a duplicate control.
   Only the click wiring depends on the toggle. Everything below it —
   the bfcache and background-tab re-sync — is worth running anywhere
   the theme can change under the page's feet, so it stays unguarded. */

/* Storage can be unavailable, not just empty: a blocked third-party
   context or a locked-down profile throws on access rather than
   returning null. Reading the theme is a nice-to-have, so swallow it
   and fall back to whatever the document already wears. */
function readSavedTheme() {
  try {
    return localStorage.getItem("theme");
  } catch {
    return null;
  }
}

function saveTheme(theme) {
  try {
    localStorage.setItem("theme", theme);
  } catch {
    /* The flip still applies to this page; it just won't outlive it. */
  }
}

function updateLabel() {
  if (label) {
    label.textContent = root.dataset.theme === "dark" ? "light" : "dark";
  }
}

function applyTheme(theme) {
  root.dataset.theme = theme;
  saveTheme(theme);
  updateLabel();
}

/* A component color transition can keep its clock stopped if the document
   is frozen in the back/forward cache or throttled in a background tab.
   Cancel only visual-color transitions before taking a theme snapshot, so
   an old chip border or button fill cannot leak into it. Movement
   (transform) is deliberately left alone: a hover lift should not snap. */
const themedProps = new Set([
  "color",
  "background-color",
  "border-color",
  "box-shadow",
  "fill",
  "stroke",
  "-webkit-text-fill-color",
]);

function settleThemedTransitions() {
  document.getAnimations().forEach((anim) => {
    const prop = anim.transitionProperty;
    if (prop && themedProps.has(prop)) {
      anim.cancel();
    }
  });
}

/* Navigation is the one moment where movement may snap safely: the page
   is disappearing anyway. Clear every CSS transition BEFORE the browser
   freezes this document, so a hover lift or icon morph cannot be restored
   later with an old clock and contaminate the next theme fade. */
function settleAllTransitions() {
  document.getAnimations().forEach((anim) => {
    if (anim.transitionProperty) {
      anim.cancel();
    }
  });
}

/* Switch the real DOM atomically, then force pending styles to resolve and
   cancel the COLOR transitions that data-theme just started: the wipe must
   reveal a finished theme, not chips and borders still fading toward it.
   Movement is deliberately kept alive — ::view-transition-new(root) renders
   the LIVE page, not a frozen snapshot, so the chip's sun/moon morph plays
   inside the reveal exactly where the circle starts growing. Cancelling all
   transitions here (an earlier version did) snapped the icon straight to
   its final pose and the wipe emanated from a teleporting moon. */
function applyThemeAndSettle(theme) {
  applyTheme(theme);
  void toggle.offsetWidth;
  settleThemedTransitions();
}

let activeThemeTransition;

function finishThemeTransition(transition) {
  if (activeThemeTransition !== transition) return;
  activeThemeTransition = undefined;
  root.classList.remove("theme-transitioning");
  releaseMiniatureSkies();
}

/* The reveal's clock and curve live here as constants because two
   things must agree on them exactly: the clip-circle animation below,
   and the arrival math that schedules each sun/moon icon's morph to
   play under it. */
const REVEAL_MS = 500;
const REVEAL_EASE = [0.65, 0, 0.35, 1];

/* One coordinate of a cubic bezier running (0,0) → (1,1), given that
   coordinate's two control values. */
function bezierAt(a, b, s) {
  const t = 1 - s;
  return 3 * t * t * s * a + 3 * t * s * s * b + s * s * s;
}

/* When does the growing circle reach `fraction` of its final radius?
   An easing curve only answers the opposite question (progress at a
   given time), so invert it: bisect the curve's parameter until the
   progress coordinate hits `fraction`, then read the time coordinate
   at that spot. Both coordinates are monotonic for this curve, and
   24 halvings pin the answer far below a millisecond. */
function revealArrival(fraction) {
  const [x1, y1, x2, y2] = REVEAL_EASE;
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 24; i++) {
    const s = (lo + hi) / 2;
    if (bezierAt(y1, y2, s) < fraction) lo = s;
    else hi = s;
  }
  return REVEAL_MS * bezierAt(x1, x2, (lo + hi) / 2);
}

/* How far into its morph an icon should already be when the sweep
   uncovers it: roughly half its ~230-285ms choreography (the tt-
   clocks in base.css). The wind-up plays hidden under the old-theme
   snapshot, so the wipe reveals a transformation at full speed and
   the icon settles just behind the passing edge — instead of starting
   its whole journey only after the wipe has moved on without it. */
const MORPH_LEAD_MS = 120;

/* A sun/moon icon far from the toggle finishes its morph long before
   the reveal's sweep gets there — hidden under the old-theme snapshot,
   so the wipe used to uncover an already-finished moon: a teleport,
   the exact thing this reveal exists to avoid. Give every icon a
   personal hold (--tt-hold, folded into its transition delays by
   base.css): the sweep's arrival at its near edge, minus the lead
   above. Night reaches the card mid-transformation and the icon
   settles right behind the passing edge — same trick as the exhibit's
   stars, launched invisible and uncovered mid-flight. */
function holdMiniatureSkies(x, y, radius) {
  document.querySelectorAll(".tt-sky").forEach((sky) => {
    const r = sky.getBoundingClientRect();
    const d =
      Math.hypot(r.left + r.width / 2 - x, r.top + r.height / 2 - y) -
      r.width / 2;
    const arrival = revealArrival(Math.min(Math.max(d / radius, 0), 1));
    const hold = Math.max(0, arrival - MORPH_LEAD_MS);
    sky.style.setProperty("--tt-hold", `${Math.round(hold)}ms`);
  });
}

/* Holds are measured for one reveal's geometry and must not outlive
   it: the next pose change might be a plain resync (bfcache, another
   tab), where a stale quarter-second pause would read as a hang.
   Removing the property mid-flight is safe — a transition captures
   its delay when it starts. */
function releaseMiniatureSkies() {
  document.querySelectorAll(".tt-sky").forEach((sky) => {
    sky.style.removeProperty("--tt-hold");
  });
}

/* Animate the captured NEW theme as a circle growing from the sun/moon
   control. A pixel belongs to either the complete old theme or the complete
   new one; ink and paper never interpolate through the same gray.

   Pacing: revealed AREA grows with the radius squared, so a hard ease-out
   on the radius compounds into a bang — the whole screen flipped in the
   first ~120ms and the remaining time crawled over the far corner. The
   symmetric ease (the same curve the chip's disc morphs with) spends the
   quiet opening on the icon's own morph, sweeps the page through the
   middle, and settles into the corner instead of stalling there. */
function animateThemeReveal(transition, x, y, radius) {
  /* The pseudo this animates does NOT live in the page's coordinate
     space: it fills the "snapshot containing block", which on phones
     is taller than the viewport (it includes the browser's own bars)
     and in some mobile browsers isn't even at the viewport's scale.
     Pixel coordinates measured with getBoundingClientRect land wherever
     THAT box says — on a phone the circle bloomed far from the toggle.
     Fractions of the box survive any offset or scaling, so the center
     goes in as percentages, and the radius as its share of the box's
     own diagonal reference (a clip-circle % resolves against
     diagonal ÷ √2 — hence the √2 putting the pixel radius back on
     that scale). On desktop the box IS the viewport and these resolve
     to the exact same circle as the old pixel values. */
    const xp = (x / innerWidth) * 100;
    const yp = (y / innerHeight) * 100;
    const rp = (radius * Math.SQRT2 * 100) / Math.hypot(innerWidth, innerHeight);
  transition.ready.then(() => {
    root.animate(
      {
        clipPath: [
          `circle(0% at ${xp}% ${yp}%)`,
          `circle(${rp}% at ${xp}% ${yp}%)`,
        ],
      },
      {
        duration: REVEAL_MS,
        easing: `cubic-bezier(${REVEAL_EASE.join(", ")})`,
        pseudoElement: "::view-transition-new(root)",
      }
    );
  }).catch(() => {
    /* The DOM update still succeeds if the browser skips the visual layer. */
  });
}

toggle?.addEventListener("click", () => {
  const nextTheme = root.dataset.theme === "dark" ? "light" : "dark";
  settleThemedTransitions();

  /* A second click completes the previous reveal before starting a new
     one, so no stale snapshot survives to fight the new target. */
  activeThemeTransition?.skipTransition?.();

  if (!document.startViewTransition || calmMotion.matches) {
    root.classList.remove("theme-transitioning");
    releaseMiniatureSkies(); /* no sweep to wait for — morph at once */
    applyThemeAndSettle(nextTheme);
    return;
  }

  const rect = toggle.getBoundingClientRect();
  const x = rect.left + rect.width / 2;
  const y = rect.top + rect.height / 2;
  const radius = Math.hypot(
    Math.max(x, innerWidth - x),
    Math.max(y, innerHeight - y)
  );

  /* Before the theme flips (which is what starts the transitions):
     each icon's morph gets scheduled for the sweep's arrival there. */
  holdMiniatureSkies(x, y, radius);

  root.classList.add("theme-transitioning");
  const transition = document.startViewTransition(() => {
    applyThemeAndSettle(nextTheme);
  });

  activeThemeTransition = transition;
  animateThemeReveal(transition, x, y, radius);
  transition.finished.then(
    () => finishThemeTransition(transition),
    () => finishThemeTransition(transition)
  );
});

function prepareForSuspension() {
  activeThemeTransition?.skipTransition?.();
  activeThemeTransition = undefined;
  root.classList.remove("theme-transitioning");
  releaseMiniatureSkies();
  settleAllTransitions();
}

/* pagehide runs while the old page is still live, just before it can be
   placed in the back/forward cache. Cleaning here is more reliable than
   trying to repair already-frozen transitions after the page returns. */
window.addEventListener("pagehide", prepareForSuspension);

/* Coming back through the back/forward cache revives the page exactly as
   it was left, while the theme may have changed on another page meanwhile
   (the sun-moon exhibit is a theme switch too). Re-sync without animating:
   a page you ARRIVE on should already be dressed, not getting dressed. */
window.addEventListener("pageshow", () => {
  activeThemeTransition = undefined;
  root.classList.remove("theme-transitioning");
  const saved = readSavedTheme();
  if (saved && saved !== root.dataset.theme) {
    root.dataset.theme = saved;
  }
  updateLabel();
  /* Updating data-theme can itself create the icon's transform
     transitions. Cancel after the sync so restoration lands directly on
     the real pose instead of starting another half-visible animation. */
  settleAllTransitions();
});

/* Tabs also get frozen WITHOUT a navigation (Opera GX snoozes background
   tabs). Settle on the way out, before the animation clock is paused; the
   visible-side sweep remains as a safety net for browsers that skip the
   hidden notification. */
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") {
    prepareForSuspension();
    return;
  }

  settleThemedTransitions();
});

updateLabel();
