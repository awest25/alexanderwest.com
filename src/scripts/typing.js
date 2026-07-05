// Typing-text animation. Picks up any <span id="typing" data-words='[...]'>
// element and cycles through the array: type, hold, delete, advance.
// Approximates the shadcn/io TypingText component the Next.js version
// used; ~40 LOC, no deps.
(function () {
  var el = document.getElementById("typing");
  if (!el) return;
  var words;
  try { words = JSON.parse(el.dataset.words || "[]"); } catch (e) { words = []; }
  if (!words.length) return;

  var typeSpeed = 60;     // ms per character on the way in
  var deleteSpeed = 40;   // ms per character on the way out
  var holdMs = 4000;      // pause once a word is fully typed
  var minJitter = 50;     // ±jitter so the cadence feels human
  var maxJitter = 80;

  var idx = 0;
  var charIdx = 0;
  var deleting = false;

  function tick() {
    var word = words[idx];
    if (deleting) {
      charIdx--;
      el.textContent = word.slice(0, charIdx);
      if (charIdx <= 0) {
        deleting = false;
        idx = (idx + 1) % words.length;
        setTimeout(tick, 300);
        return;
      }
      setTimeout(tick, deleteSpeed);
    } else {
      charIdx++;
      el.textContent = word.slice(0, charIdx);
      if (charIdx >= word.length) {
        deleting = true;
        setTimeout(tick, holdMs);
        return;
      }
      var delay = minJitter + Math.random() * (maxJitter - minJitter);
      setTimeout(tick, delay);
    }
  }

  // Small initial delay so the hero entrance animation lands first.
  setTimeout(tick, 600);
})();
