(() => {
  "use strict";
  // Each game sizes itself to its own viewport, including the shared shell's iframe.
  document.documentElement.classList.toggle("is-embedded", window.self !== window.top);
  const themeColor = document.querySelector('meta[name="theme-color"]');
  if (themeColor) themeColor.content = "#151918";
})();
