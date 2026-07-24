/* octo-stars.js — the header's star easter egg.

   Hovering the octocat (once the wordmark act has revealed it) sends
   three golden stars flying out of the logo — one pass, then the sky
   empties until the next hover. No loop.

   The CSS in base.css owns all the motion (flight, swing, fades);
   this file only decides WHEN. Each hover builds a fresh cast of
   three <span>s — fresh nodes are what let the animations restart,
   since CSS won't replay a finished animation on the same element —
   hands each one a slightly randomized flight plan through CSS custom
   properties, and presses play by adding the .playing class. Every
   flight runs exactly once and fades out at the end of its corridor,
   so the show ends on its own. Leaving early fades the whole scene
   mid-flight (the container's opacity transition), same soft exit
   either way. */

const octo = document.querySelector(".octo");
const sky = document.querySelector(".octo-stars");

if (octo && sky) {
  const COUNT = 3;
  const LANES = [0, 36, 72]; // top, middle, bottom — one star per lane

  let curtain; // timer that strikes the set after the last star lands

  octo.addEventListener("mouseenter", () => {
    clearTimeout(curtain);
    sky.replaceChildren(); // a fresh cast every show, so animations restart

    /* Pin the corridor in place for this show. The wordmark's right
       edge MOVES when the reveal act plays back ("lab" returns wider
       than the cat), and a corridor anchored there would drag the
       still-fading stars sideways with it. So anchor to the left side
       instead: the tick's spot plus the cat's open width — measured
       with offsetLeft/offsetWidth, which ignore the tick's little
       rotation. Recomputed each show, so resizes are picked up too. */
    const tick = sky.parentElement.querySelector(".tick");
    /* The cat's open width comes from --octo-open in base.css, which is
       also what the hover rule opens to. Read rather than repeated: a
       literal here would be a second copy of the number, free to drift
       the day the logo is resized. It's an em multiple, so scale it by
       the cat's own font size to get pixels. */
    const catStyle = getComputedStyle(octo);
    const catWidth =
      parseFloat(catStyle.getPropertyValue("--octo-open")) *
      parseFloat(catStyle.fontSize);
    sky.style.left = tick.offsetLeft + tick.offsetWidth + catWidth + "px";

    let lastLanding = 0;
    for (let i = 0; i < COUNT; i++) {
      const star = document.createElement("span");
      const flight = 1.2 + Math.random() * 0.4; // seconds across the corridor
      const wait = i * 0.3 + Math.random() * 0.15; // a stream, not a volley
      const size = 0.42 + Math.random() * 0.16; // em — siblings, not clones
      const swing = 0.5 + Math.random() * 0.25; // each bobs to its own beat

      star.style.setProperty("--lane", LANES[i] + Math.random() * 12 + "%");
      star.style.setProperty("--flight", flight + "s");
      star.style.setProperty("--wait", wait + "s");
      star.style.setProperty("--size", size + "em");
      star.style.setProperty("--swing", swing + "s");

      lastLanding = Math.max(lastLanding, (flight + wait) * 1000);
      sky.append(star);
    }

    sky.classList.add("playing");
    /* Each star has already faded itself out by the time it lands, so
       this cleanup is invisible — it just clears the stage. */
    curtain = setTimeout(() => {
      sky.classList.remove("playing");
      sky.replaceChildren();
    }, lastLanding + 100);
  });

  octo.addEventListener("mouseleave", () => {
    /* Dropping .playing fades the container while the flights carry
       on underneath — the stars dissolve in motion, never frozen.
       The stage is cleared only after that fade has finished. */
    sky.classList.remove("playing");
    clearTimeout(curtain);
    curtain = setTimeout(() => sky.replaceChildren(), 400);
  });
}
