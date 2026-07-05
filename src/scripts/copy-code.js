// Adds a copy button to every code block in a post. The build wraps each
// Shiki block in a .code-block div (which also carries the language label);
// this script only appends the clipboard affordance. Progressive
// enhancement: the code is fully readable without JS. Kept deliberately
// tiny (see CLAUDE.md JS budget).
(function () {
  const wrappers = document.querySelectorAll("article .code-block");

  for (const wrapper of wrappers) {
    const block = wrapper.querySelector(".shiki");
    if (!block) continue;

    const button = document.createElement("button");
    button.type = "button";
    button.className = "copy-code";
    button.setAttribute("aria-label", "Copy code");
    button.textContent = "Copy";
    wrapper.appendChild(button);

    button.addEventListener("click", async () => {
      const code = block.textContent ?? "";
      try {
        await navigator.clipboard.writeText(code);
        button.textContent = "Copied";
        button.classList.add("copied");
        setTimeout(() => {
          button.textContent = "Copy";
          button.classList.remove("copied");
        }, 1600);
      } catch {
        button.textContent = "Failed";
        setTimeout(() => (button.textContent = "Copy"), 1600);
      }
    });
  }
})();
