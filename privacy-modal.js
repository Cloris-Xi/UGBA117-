// -----------------------------------------------------------------------
// Privacy modal — shared by index.html and app.html.
// -----------------------------------------------------------------------
(function () {
  "use strict";

  const privacyLinkBtn = document.getElementById("privacyLinkBtn");
  const privacyOverlay = document.getElementById("privacyOverlay");
  const privacyCloseBtn = document.getElementById("privacyCloseBtn");
  if (!privacyOverlay) return; // page doesn't include the modal

  let privacyLastFocused = null;

  function openPrivacyModal() {
    privacyLastFocused = document.activeElement;
    privacyOverlay.hidden = false;
    privacyCloseBtn.focus();
    document.addEventListener("keydown", onPrivacyKeydown);
  }

  function closePrivacyModal() {
    privacyOverlay.hidden = true;
    document.removeEventListener("keydown", onPrivacyKeydown);
    if (privacyLastFocused) privacyLastFocused.focus();
  }

  function onPrivacyKeydown(e) {
    if (e.key === "Escape") closePrivacyModal();
  }

  if (privacyLinkBtn) privacyLinkBtn.addEventListener("click", openPrivacyModal);
  if (privacyCloseBtn) privacyCloseBtn.addEventListener("click", closePrivacyModal);
  if (privacyOverlay) {
    privacyOverlay.addEventListener("click", (e) => {
      if (e.target === privacyOverlay) closePrivacyModal();
    });
  }
})();
