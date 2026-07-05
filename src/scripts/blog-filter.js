// Blog post filter: clicking a tag button or an inline post-card tag
// hides cards that don't carry that tag. "All Posts" clears the filter.
// Each card carries data-tags="tag1|tag2|tag3"; filter is exact match
// on the active tag (or no filter when empty).
(function () {
  var buttons = document.querySelectorAll(".tag-button");
  var inlineTags = document.querySelectorAll(".tag");
  var cards = document.querySelectorAll(".post-card");
  var emptyState = document.getElementById("no-posts");

  function setActive(active) {
    buttons.forEach(function (b) {
      // One class carries the visual state; styles live in styles.css
      // (.tag-button vs .tag-button.active, filled ink when active).
      b.classList.toggle("active", (b.dataset.tag || "") === active);
    });
  }

  function apply(active) {
    var visible = 0;
    cards.forEach(function (c) {
      var tags = (c.dataset.tags || "").split("|").filter(Boolean);
      var keep = !active || tags.indexOf(active) >= 0;
      c.style.display = keep ? "" : "none";
      if (keep) visible++;
    });
    if (emptyState) emptyState.classList.toggle("hidden", visible > 0);
    setActive(active);
  }

  buttons.forEach(function (b) {
    b.addEventListener("click", function () { apply(b.dataset.tag || ""); });
  });
  inlineTags.forEach(function (t) {
    t.addEventListener("click", function (e) {
      e.preventDefault();
      e.stopPropagation();
      apply(t.dataset.tag || "");
    });
  });
})();
