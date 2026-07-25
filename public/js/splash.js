// Wirely startup animation. Purely presentational — dismisses itself and
// never blocks interaction if something goes wrong (a safety timeout below
// guarantees the splash is removed even if an animation event never fires).
(function () {
  function dismissSplash() {
    const el = document.getElementById('splashScreen');
    if (!el || el.dataset.dismissed) return;
    el.dataset.dismissed = 'true';
    el.classList.add('hidden');
    setTimeout(() => el.remove(), 450);
  }

  document.addEventListener('DOMContentLoaded', () => {
    if (!document.getElementById('splashScreen')) return;
    // Total choreography: draw (0.5s) + glow pulse (0.6s starting at 0.5s) + text in (0.4s at 0.55s)
    setTimeout(dismissSplash, 1050);
  });

  // Absolute safety net in case DOMContentLoaded already fired or timers stall.
  setTimeout(dismissSplash, 2500);
})();
