// Elastic pull for the one-screen home page. The page can't scroll, so a
// swipe used to do nothing and the page felt frozen. Now the hero follows
// the finger with iOS-style rubber-band resistance and springs back on
// release. Each [data-elastic="rate"] layer moves at its own rate (the
// photo less than the text), which reads as depth. Touch only, off with
// reduced motion. ~60 LOC, no deps.
// DECISION: chose a scripted rubber-band over re-enabling native overscroll because native bounce is iOS-only (Android ignores a page that can't scroll) and moves the page as one flat sheet.
(function () {
  var layers = document.querySelectorAll("[data-elastic]");
  if (!layers.length || !("ontouchstart" in window)) return;
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

  var startX = 0;
  var startY = 0;
  var axis = null;
  var offset = 0;
  var frame = 0;

  // UIScrollView's rubber-band curve: the further you pull, the harder it
  // resists, and the offset never reaches `limit`.
  function rubberBand(d, limit) {
    var r = (1 - 1 / ((Math.abs(d) * 0.55) / limit + 1)) * limit;
    return d < 0 ? -r : r;
  }
  // The finger distance that produces offset `r` (inverse of the above).
  function fingerFor(r, limit) {
    var d = (1 / (1 - Math.min(Math.abs(r) / limit, 0.99)) - 1) * (limit / 0.55);
    return r < 0 ? -d : d;
  }

  function rate(el) {
    return parseFloat(el.dataset.elastic) || 1;
  }

  function render() {
    frame = 0;
    for (var i = 0; i < layers.length; i++) {
      layers[i].style.transform = offset ? "translate3d(0," + (offset * rate(layers[i])).toFixed(1) + "px,0)" : "";
    }
  }

  function springs(on) {
    for (var i = 0; i < layers.length; i++) {
      layers[i].style.transition = on ? "transform 560ms cubic-bezier(0.25, 1, 0.5, 1)" : "none";
    }
  }

  document.addEventListener("touchstart", function (e) {
    if (e.touches.length !== 1) return;
    // Catch the hero mid spring-back instead of letting it jump.
    var t = getComputedStyle(layers[0]).transform;
    offset = t && t !== "none" ? new DOMMatrixReadOnly(t).m42 / rate(layers[0]) : 0;
    springs(false);
    render();
    startX = e.touches[0].clientX;
    startY = e.touches[0].clientY - fingerFor(offset, window.innerHeight);
    axis = null;
  }, { passive: true });

  document.addEventListener("touchmove", function (e) {
    if (e.touches.length !== 1) return;
    var dx = e.touches[0].clientX - startX;
    var dy = e.touches[0].clientY - startY;
    // Decide once per gesture; sideways swipes (e.g. browser back) are left alone.
    if (!axis && Math.abs(dx) + Math.abs(dy) > 6) axis = Math.abs(dy) >= Math.abs(dx) ? "y" : "x";
    if (axis !== "y") return;
    offset = rubberBand(dy, window.innerHeight);
    if (!frame) frame = requestAnimationFrame(render);
  }, { passive: true });

  function release() {
    if (!offset) return;
    offset = 0;
    springs(true);
    if (!frame) frame = requestAnimationFrame(render);
  }
  document.addEventListener("touchend", release, { passive: true });
  document.addEventListener("touchcancel", release, { passive: true });
})();
