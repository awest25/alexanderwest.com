// Scramble-on-hover: the Taste micro-interaction. On hover/focus of any
// [data-scramble] element, its letters shuffle through random glyphs and
// settle back to the original left to right. Progressive enhancement: the
// text is fully readable without JS. Bails on reduced-motion. ~35 LOC.
(function () {
  var reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (reduce) return;

  var GLYPHS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789/<>*#";

  function scramble(el) {
    // Resolve the text node that actually holds the label, so we never
    // clobber child elements (icons, the brand blob, etc.).
    var node = el.querySelector("[data-scramble-text]") || el;
    if (node !== el && !node.firstChild) return;
    var target = node.textContent;
    if (node.dataset.busy === "1") return;
    node.dataset.busy = "1";

    var frame = 0;
    var settleAt = target.split("").map(function (_, i) { return 3 + i + Math.floor(Math.random() * 4); });
    var timer = setInterval(function () {
      var out = "";
      for (var i = 0; i < target.length; i++) {
        if (target[i] === " ") { out += " "; continue; }
        out += frame >= settleAt[i] ? target[i] : GLYPHS[Math.floor(Math.random() * GLYPHS.length)];
      }
      node.textContent = out;
      frame++;
      if (frame > Math.max.apply(null, settleAt)) {
        clearInterval(timer);
        node.textContent = target;
        node.dataset.busy = "0";
      }
    }, 28);
  }

  document.querySelectorAll("[data-scramble]").forEach(function (el) {
    el.addEventListener("mouseenter", function () { scramble(el); });
    el.addEventListener("focus", function () { scramble(el); });
  });
})();
