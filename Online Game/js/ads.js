// Rewarded-ad + interstitial provider. On the plain website (window.Capacitor
// is undefined here, so nothing below changes) this still just simulates
// watching a rewarded ad with a timed modal - no real ad network is wired up
// for the web. Inside the Capacitor Android app, both functions call the real
// AdMob SDK via @capacitor-community/admob (registered onto
// window.Capacitor.Plugins.AdMob by pazuju-app/app-src/native-bootstrap.js -
// see that file for why this plain script can reach an npm plugin package).
// Every caller (play.html's skip/check-numbers handlers, the app's own
// index.html) just awaits watchRewardedAd()'s Promise<boolean> or
// showInterstitial()'s Promise<void> - which implementation runs underneath
// is entirely this file's concern.
const PazujuAds = (() => {
  let overlay = null;

  function isNative() {
    return !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());
  }

  // Phase 3 test ad unit IDs - Google's published constants, which serve a
  // "Test Ad"-labeled creative to every device unconditionally, no AdMob
  // account or per-device registration needed. Swap these for real ad unit
  // IDs in Phase 4 once the user's own AdMob account/app/ad units exist -
  // this object is the only thing that needs to change.
  const NATIVE_AD_CONFIG = {
    rewardedAdUnitId: "ca-app-pub-3940256099942544/5224354917",
    interstitialAdUnitId: "ca-app-pub-3940256099942544/1033173712",
  };

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
  // SDKs report back. Web-only fallback - see watchRewardedAd() below.
  function watchRewardedAdSimulated({ seconds = 5 } = {}) {
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

  // Real AdMob rewarded video. Resolves true only once AdMob's own "reward
  // earned" event fires - NOT just because showRewardVideoAd()'s promise
  // settles, since closing the ad early (Dismissed, with no Rewarded event
  // having fired) must resolve false, same contract as the simulated version.
  // Any load/show failure also resolves false rather than rejecting, so a
  // flaky ad network never leaves a caller's `await` hanging or throwing.
  function watchRewardedAdNative() {
    const AdMob = window.Capacitor.Plugins.AdMob;
    return new Promise((resolve) => {
      let settled = false;
      let handles = [];
      const finish = (rewarded) => {
        if (settled) return;
        settled = true;
        handles.forEach((h) => h.remove());
        resolve(rewarded);
      };
      Promise.all([
        AdMob.addListener("onRewardedVideoAdReward", () => finish(true)),
        AdMob.addListener("onRewardedVideoAdDismissed", () => finish(false)),
        AdMob.addListener("onRewardedVideoAdFailedToLoad", () => finish(false)),
        AdMob.addListener("onRewardedVideoAdFailedToShow", () => finish(false)),
      ])
        .then((h) => {
          handles = h;
          return AdMob.prepareRewardVideoAd({ adId: NATIVE_AD_CONFIG.rewardedAdUnitId, isTesting: true });
        })
        .then(() => AdMob.showRewardVideoAd())
        .catch((err) => {
          console.error("Pazuju: rewarded ad failed", err);
          finish(false);
        });
    });
  }

  function watchRewardedAd(options) {
    return isNative() ? watchRewardedAdNative() : watchRewardedAdSimulated(options);
  }

  // Real AdMob interstitial, shown between puzzles (see the app's own
  // index.html, not play.html - this is app-only, no website call site).
  // Resolves once the ad is dismissed (or fails to load/show - never blocks
  // the player from starting their puzzle just because an ad didn't work).
  // No web fallback needed: callers should only reach this under Capacitor.
  function showInterstitial() {
    if (!isNative()) return Promise.resolve();
    const AdMob = window.Capacitor.Plugins.AdMob;
    return new Promise((resolve) => {
      let settled = false;
      let handles = [];
      const finish = () => {
        if (settled) return;
        settled = true;
        handles.forEach((h) => h.remove());
        resolve();
      };
      Promise.all([
        AdMob.addListener("interstitialAdDismissed", finish),
        AdMob.addListener("interstitialAdFailedToLoad", finish),
        AdMob.addListener("interstitialAdFailedToShow", finish),
      ])
        .then((h) => {
          handles = h;
          return AdMob.prepareInterstitial({ adId: NATIVE_AD_CONFIG.interstitialAdUnitId, isTesting: true });
        })
        .then(() => AdMob.showInterstitial())
        .catch((err) => {
          console.error("Pazuju: interstitial failed", err);
          finish();
        });
    });
  }

  return { watchRewardedAd, showInterstitial };
})();
