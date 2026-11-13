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

  // Real AdMob ad unit IDs (Phase 4, 2026-11-11) - matches the App ID in
  // pazuju-app's AndroidManifest.xml.
  const NATIVE_AD_CONFIG = {
    rewardedAdUnitId: "ca-app-pub-2616129249983166/5901569996",
    interstitialAdUnitId: "ca-app-pub-2616129249983166/9217998476",
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
  //
  // Discovered 2026-11-13: a brand-new, low-traffic AdMob account/app
  // routinely gets "No fill" (AdMob error code 3 - the network simply had no
  // ad to serve) on a sizeable fraction of requests - confirmed via on-device
  // logcat, not a wiring bug. One automatic retry on a load/show failure
  // noticeably improves effective fill rate; if the retry also fails, the
  // player gets a visible toast instead of the button silently doing nothing
  // (see notifyAdUnavailable()).
  function watchRewardedAdNative() {
    const AdMob = window.Capacitor.Plugins.AdMob;
    return new Promise((resolve) => {
      let settled = false;
      let handles = [];
      let attemptsLeft = 2; // initial attempt + 1 retry on a load/show failure

      const finish = (rewarded, adUnavailable = false) => {
        if (settled) return;
        settled = true;
        handles.forEach((h) => h.remove());
        if (adUnavailable) notifyAdUnavailable();
        resolve(rewarded);
      };

      const attempt = () => {
        let attemptSettled = false;
        const onFailure = () => {
          if (attemptSettled || settled) return;
          attemptSettled = true;
          handles.forEach((h) => h.remove());
          attemptsLeft -= 1;
          if (attemptsLeft > 0) attempt();
          else finish(false, true);
        };
        Promise.all([
          AdMob.addListener("onRewardedVideoAdReward", () => finish(true)),
          AdMob.addListener("onRewardedVideoAdDismissed", () => finish(false)),
          AdMob.addListener("onRewardedVideoAdFailedToLoad", onFailure),
          AdMob.addListener("onRewardedVideoAdFailedToShow", onFailure),
        ])
          .then((h) => {
            handles = h;
            return AdMob.prepareRewardVideoAd({ adId: NATIVE_AD_CONFIG.rewardedAdUnitId, isTesting: false });
          })
          .then(() => AdMob.showRewardVideoAd())
          .catch((err) => {
            console.error("Pazuju: rewarded ad failed", err);
            onFailure();
          });
      };

      attempt();
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
  // Same one-retry-then-give-up treatment as the rewarded flow above (see
  // its comment for why) - no toast on final failure though, since nothing
  // here blocks the player or needs an explanation if it's quietly skipped.
  function showInterstitial() {
    if (!isNative()) return Promise.resolve();
    const AdMob = window.Capacitor.Plugins.AdMob;
    return new Promise((resolve) => {
      let settled = false;
      let handles = [];
      let attemptsLeft = 2; // initial attempt + 1 retry on a load/show failure

      const finish = () => {
        if (settled) return;
        settled = true;
        handles.forEach((h) => h.remove());
        resolve();
      };

      const attempt = () => {
        let attemptSettled = false;
        const onFailure = () => {
          if (attemptSettled || settled) return;
          attemptSettled = true;
          handles.forEach((h) => h.remove());
          attemptsLeft -= 1;
          if (attemptsLeft > 0) attempt();
          else finish();
        };
        Promise.all([
          AdMob.addListener("interstitialAdDismissed", finish),
          AdMob.addListener("interstitialAdFailedToLoad", onFailure),
          AdMob.addListener("interstitialAdFailedToShow", onFailure),
        ])
          .then((h) => {
            handles = h;
            return AdMob.prepareInterstitial({ adId: NATIVE_AD_CONFIG.interstitialAdUnitId, isTesting: false });
          })
          .then(() => AdMob.showInterstitial())
          .catch((err) => {
            console.error("Pazuju: interstitial failed", err);
            onFailure();
          });
      };

      attempt();
    });
  }

  // Visible feedback for when a rewarded ad truly has no fill (after the
  // retry above also fails) - without this the "check numbers"/"skip
  // assembly" button just silently re-enables with no explanation, which is
  // what looked like "doesn't work" when this was diagnosed 2026-11-13.
  // Self-contained (injects its own tiny stylesheet once) so it works
  // identically on the website and inside the Capacitor app with no changes
  // to either's own CSS.
  let toastEl = null;
  let toastHideTimer = null;
  function notifyAdUnavailable() {
    if (!toastEl) {
      ensureToastStyles();
      toastEl = document.createElement("div");
      toastEl.className = "pazuju-ad-toast";
      document.body.appendChild(toastEl);
    }
    toastEl.textContent = "No ad available right now — please try again in a moment.";
    toastEl.classList.add("visible");
    clearTimeout(toastHideTimer);
    toastHideTimer = setTimeout(() => toastEl.classList.remove("visible"), 3500);
  }
  function ensureToastStyles() {
    if (document.getElementById("pazuju-ad-toast-style")) return;
    const style = document.createElement("style");
    style.id = "pazuju-ad-toast-style";
    style.textContent = `
      .pazuju-ad-toast {
        position: fixed;
        left: 50%;
        bottom: 32px;
        transform: translate(-50%, 16px);
        background: rgba(30, 20, 12, 0.92);
        color: #f3e6d0;
        padding: 10px 18px;
        border-radius: 8px;
        font-size: 14px;
        max-width: calc(100vw - 32px);
        text-align: center;
        opacity: 0;
        pointer-events: none;
        transition: opacity 0.25s ease, transform 0.25s ease;
        z-index: 9999;
      }
      .pazuju-ad-toast.visible { opacity: 1; transform: translate(-50%, 0); }
    `;
    document.head.appendChild(style);
  }

  return { watchRewardedAd, showInterstitial };
})();
