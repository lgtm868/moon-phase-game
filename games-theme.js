(() => {
  "use strict";
  // Each game sizes itself to its own viewport, including the shared shell's iframe.
  document.documentElement.classList.toggle("is-embedded", window.self !== window.top);
  const themeColor = document.querySelector('meta[name="theme-color"]');
  if (themeColor) themeColor.content = "#151918";

  // Completions may happen before the optional ranking interface is ready.
  // This queue is local to each game document, including embedded games.
  if (!Array.isArray(window.__moonRankingQueue)) window.__moonRankingQueue = [];
  if (!window.MoonRanking) window.MoonRanking = {};
  if (typeof window.MoonRanking.complete !== "function") {
    window.MoonRanking.complete = payload => {
      try {
        window.__moonRankingQueue.push({ ...payload, metrics: { ...payload.metrics } });
        return true;
      } catch { return false; }
    };
  }
  if (window.__moonRankingBootstrapped) return;
  window.__moonRankingBootstrapped = true;
  const assetBase = document.currentScript?.src || location.href;
  const assetUrl = name => new URL(name + "?v=20260907-fun", assetBase).href;
  function loadRanking() {
    const stylesheet = document.createElement("link");
    stylesheet.rel = "stylesheet";
    stylesheet.href = assetUrl("games-ranking.css");
    document.head.append(stylesheet);
    const config = document.createElement("script");
    config.src = assetUrl("games-ranking-config.js");
    let started = false;
    function loadInterface() {
      if (started) return;
      started = true;
      const script = document.createElement("script");
      script.src = assetUrl("games-ranking.js");
      document.head.append(script);
    }
    config.onload = loadInterface;
    // The interface can explain unavailable online setup even if config fails.
    config.onerror = loadInterface;
    document.head.append(config);
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", loadRanking, { once: true });
  else loadRanking();
})();
