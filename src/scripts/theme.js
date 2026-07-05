// Theme toggle. Reads system preference on first visit, persists user
// override to localStorage. Synchronously applied in layout.html <head>
// before paint to avoid the wrong-theme flash; this file handles the
// click handler + propagates changes to other open tabs.
(function () {
  function apply(mode) {
    if (mode === "dark") document.documentElement.classList.add("dark");
    else document.documentElement.classList.remove("dark");
  }
  function current() {
    return document.documentElement.classList.contains("dark") ? "dark" : "light";
  }
  var btn = document.getElementById("theme-toggle");

  function toggle() {
    var next = current() === "dark" ? "light" : "dark";
    try { localStorage.setItem("theme", next); } catch (e) {}

    var reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    // No View Transitions support (or reduced motion): switch instantly.
    if (!document.startViewTransition || reduce) {
      apply(next);
      return;
    }

    // Reveal the new theme with a circle wiping out from the toggle button.
    var r = btn.getBoundingClientRect();
    var x = r.left + r.width / 2;
    var y = r.top + r.height / 2;
    var end = Math.hypot(Math.max(x, window.innerWidth - x), Math.max(y, window.innerHeight - y));

    var vt = document.startViewTransition(function () { apply(next); });
    vt.ready.then(function () {
      document.documentElement.animate(
        {
          clipPath: [
            "circle(0px at " + x + "px " + y + "px)",
            "circle(" + end + "px at " + x + "px " + y + "px)",
          ],
        },
        {
          duration: 480,
          easing: "cubic-bezier(0.22, 0.7, 0.3, 1)",
          pseudoElement: "::view-transition-new(root)",
        }
      );
    });
  }

  if (btn) btn.addEventListener("click", toggle);
  // Sync across tabs: storage event fires on OTHER tabs when localStorage changes.
  window.addEventListener("storage", function (e) {
    if (e.key === "theme" && e.newValue) apply(e.newValue);
  });
})();
