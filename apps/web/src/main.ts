document.documentElement.classList.add("motion-ready");

const animatedItems = document.querySelectorAll<HTMLElement>("[data-animate]");

const revealObserver = new IntersectionObserver(
  (entries) => {
    for (const entry of entries) {
      if (entry.isIntersecting) {
        entry.target.classList.add("is-visible");
        revealObserver.unobserve(entry.target);
      }
    }
  },
  { rootMargin: "0px 0px -12% 0px", threshold: 0.16 },
);

for (const item of animatedItems) {
  revealObserver.observe(item);
}

const stage = document.querySelector<HTMLElement>(".hero-stage");
const depthItems = document.querySelectorAll<HTMLElement>("[data-depth]");

const updateDepth = () => {
  if (!stage || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    return;
  }

  const rect = stage.getBoundingClientRect();
  const viewportHeight = window.innerHeight || document.documentElement.clientHeight;
  const progress = Math.min(1, Math.max(-1, (viewportHeight / 2 - rect.top) / viewportHeight));

  for (const item of depthItems) {
    const speed = item.dataset.depth === "fast" ? 18 : 10;
    item.style.setProperty("--float-y", `${progress * speed}px`);
  }
};

updateDepth();
window.addEventListener("scroll", updateDepth, { passive: true });
window.addEventListener("resize", updateDepth);

const terminalLines = document.querySelectorAll<HTMLElement>(".terminal-body p");
terminalLines.forEach((line, index) => {
  line.style.setProperty("--delay", `${index * 110}ms`);
});
