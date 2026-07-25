/* haptics.js — touch feedback, choreographed to the animations.

   Android phones expose navigator.vibrate; iPhones never got it. The
   web-haptics library (github.com/lochie/web-haptics) papers over the
   gap: on Android it drives navigator.vibrate with our pattern as-is,
   and on iOS it clicks a hidden switch control — the system toggle
   haptic is the one tick Safari will produce, so that's what plays.
   If the library fails to load (offline, CDN down), the plain
   navigator.vibrate fallback below keeps Android working like before.

   Only the exhibits speak. Ordinary navigation — cards, links, the
   effort labels — stays silent, the same rule the visuals follow:
   choreography belongs to the exhibits, everything else keeps quiet.
   A buzz plays only when the hand causes something physical on
   screen: the theme morph committing, a melt starting, a countdown
   sent back to replay its handoff. (A uniform
   whisper on every tap target was tried and rolled back — it made
   this the one website that buzzes on every link, without exhibiting
   any craft in return.)

   A pattern is [buzz, pause, buzz, pause, …] in ms. Strength can't
   be set at all — vibrate() is an on/off switch with a timer, always
   at full drive; the amplitude control native apps use never made it
   to the web. And the motor needs ~10–20ms just to spin up, so
   durations a few ms apart (6 vs 12) collapse into the same faint
   tick in the hand. Perceived weight comes from BIG duration steps
   between tiers — but the ceiling is low: Android's own haptics
   guidance keeps crisp impulses at ~20ms, and past ~25ms a hit
   smears into a buzz (a 40ms beat field-tested as "too heavy").
   The usable range is narrow, so the tiers have to spend it well.
   (On iOS every buzz collapses into the one system tick; the rhythm
   survives even though the weights don't.)

   Everything is delegated from document, so one script serves every
   page: it only acts on elements that exist. */

(function () {
  /* Loaded eagerly, not on first tap: iOS only plays its tick inside
     a user gesture, and a network fetch on the first tap would land
     the haptic seconds late, outside the gesture and out of sync
     with the animation it belongs to. */
  let haptics = null;
  import("https://esm.sh/web-haptics@0.0.6")
    .then(({ WebHaptics }) => {
      haptics = new WebHaptics();
    })
    .catch(() => {
      /* stay null — buzz() falls back to navigator.vibrate */
    });

  /* Reduced motion is treated as reduced SENSATION: someone who asked
     the OS to calm the screen down shouldn't get buzzed instead.
     Checked live at tap time, not once at load, so flipping the OS
     setting mid-session is honored. */
  const calm = matchMedia("(prefers-reduced-motion: reduce)");

  function buzz(pattern) {
    if (calm.matches) return;

    if (haptics) {
      /* intensity 1 skips the library's on/off modulation, so Android
         gets the exact navigator.vibrate pattern we tuned — the
         library's only job here is the iOS fallback. */
      haptics.trigger(pattern, { intensity: 1 });
    } else if ("vibrate" in navigator) {
      navigator.vibrate(pattern);
    }
  }

  /* Only real fingers get haptics. Modern Chrome fires click as a
     PointerEvent, so the input type that caused it rides along —
     mouse and keyboard activations fall through silently. */
  function fromTouch(event) {
    return event.pointerType === "touch";
  }

  /* --- The patterns ----------------------------------------------------

     Three weights, doubling (6 / 12 / 25), the whole ladder low in
     the crisp zone: a 10/20/40 ladder field-tested as too heavy,
     its top beat smeared past "hit" into "buzz".

     theme morph (header chip / sun-moon exhibit):
       a faint press tick, then the site's one heavy hit lands
       ~125ms in, right as the mask's bite carves the crescent: the
       moment the morph "commits". Same shape both directions; at
       this scale the carve and the heal weigh the same in the hand.

     melting buttons: the whole melt rides one pattern, scheduled at
       the press (vibrate() takes the full timeline up front, so no
       timers run during the animation): a firm press tick, quiet
       while the shell only sags, a faint beat as each drop lets go,
       then a soft flutter that thins out as the body dissolves —
       the sensation shrinks with the mass still on screen and dies
       just before the visual does. Smoothness is faked with rhythm,
       since the motor has no volume knob. Timed against the
       keyframes in animations/melting-button/index.html — retime
       those, retime these. Fable and Sol melt on different clocks,
       so each gets its own timeline, keyed by the button's
       data-melt. */

  const patterns = {
    theme: [6, 119, 25], /* press … carve */
    melt: {
      /* press ………… drip1 (1.7s) … drip2 (2.0s) ………… body fades (2.6–3.4s) */
      fable: [12, 1688, 5, 295, 5, 645, 6, 90, 5, 120, 4, 150, 3],
      /* press … drop1 (~0.75s) … drop2 (~0.9s) … collapse flutter (1.3–1.9s) */
      sol:   [12, 738, 5, 138, 5, 420, 6, 60, 7, 50, 8, 60, 6, 90, 4, 120, 3],
    },
  };

  document.addEventListener("click", (event) => {
    if (!fromTouch(event)) return;

    const melt = event.target.closest(".melt-button");
    if (melt) {
      /* The page's own click handler runs first (it's on the button,
         this one is on document), so on the tap that STARTS a melt,
         is-melting is already set by the time we look. Requiring it
         means the pattern only plays for a tap that actually melted
         something; the played flag keeps it to exactly once even if a
         stray tap slips in before pointer-events: none takes hold. */
      if (melt.classList.contains("is-melting") &&
          !melt.dataset.hapticsPlayed) {
        melt.dataset.hapticsPlayed = "true";
        /* Unknown variants degrade to a bare press tick rather than
           silence, so a future button is never mute by accident. */
        buzz(patterns.melt[melt.dataset.melt] || 12);
      }
      return;
    }

    if (event.target.closest(".theme-toggle, .sky-toggle")) {
      buzz(patterns.theme);
      return;
    }

    /* The countdown's replay button: a press tick and nothing more.
       The handoff it starts is the physical event worth feeling, but
       that lands seven seconds later — and the rule above is that a
       pattern is handed over whole at the press, so nothing has to run
       timers while an animation is playing. A seven-second pattern of
       mostly silence to reach it would be exactly the timer that rule
       exists to avoid. So the press gets the firm tick that says the
       button took, and the confetti speaks for itself. */
    if (event.target.closest(".cd-replay")) {
      buzz(12);
    }
  });

  /* Some exhibits commit on moments no click can hear — the segmented
     control's flung thumb picks its segment at pointerup, and a grab
     has no click at all. Those call this hook from their own scripts;
     the reduced-motion check and the iOS fallback above still govern
     what comes out, and callers stay on the same 6/12/25 tiers. */
  window.labBuzz = buzz;
})();
