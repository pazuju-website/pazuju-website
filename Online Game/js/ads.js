// Placeholder rewarded-ad provider. No real ad network is wired up yet - this
// just simulates watching a rewarded ad with a timed modal, so the reward-
// gated features (extra "check numbers", "skip assembly") are fully usable
// today. When a real ad account/SDK exists, only watchRewardedAd()'s
// internals need to change - callers just await a Promise<boolean> for
// "was the reward earned", same as they would with a real SDK.
const PazujuAds = (() => {
  let overlay = null;

  function buildOverlay() {
    const el = document.createElement("div");
    el.className = "ad-overlay";
    el.innerHTML = `
      <div class="ad-modal">
        <div class="ad-modal-label">Advertisement</div>
        <button type="button" class="ad-modal-close" aria-label="Close ad">&times;</button>
        <div class="ad-modal-placeholder">Simulated ad &mdash; no ad network connected yet</div>
        <div class="ad-modal-bar"><div class="ad-modal-bar-fill"></div></div>
        <div class="ad-modal-countdown"></div>
      </div>
    `;
    document.body.appendChild(el);
    return el;
  }

  // Resolves true if the simulated ad "completed" (reward earned), false if
  // the player closed it early (no reward) - mirrors how real rewarded-ad
  // SDKs report back.
  function watchRewardedAd({ seconds = 5 } = {}) {
    return new Promise((resolve) => {
      if (!overlay) overlay = buildOverlay();
      overlay.style.display = "flex";

      const fill = overlay.querySelector(".ad-modal-bar-fill");
      const countdownEl = overlay.querySelector(".ad-modal-countdown");
      const closeBtn = overlay.querySelector(".ad-modal-close");

      fill.style.transition = "none";
      fill.style.width = "0%";
      let remaining = seconds;
      countdownEl.textContent = `${remaining}s`;

      requestAnimationFrame(() => {
        fill.style.transition = `width ${seconds}s linear`;
        fill.style.width = "100%";
      });

      let settled = false;
      const finish = (rewarded) => {
        if (settled) return;
        settled = true;
        clearInterval(timer);
        overlay.style.display = "none";
        closeBtn.removeEventListener("click", onClose);
        resolve(rewarded);
      };
      const onClose = () => finish(false);
      closeBtn.addEventListener("click", onClose);

      const timer = setInterval(() => {
        remaining -= 1;
        countdownEl.textContent = `${Math.max(remaining, 0)}s`;
        if (remaining <= 0) finish(true);
      }, 1000);
    });
  }

  return { watchRewardedAd };
})();
