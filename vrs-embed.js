(function () {
  document.documentElement.setAttribute('data-theme', 'light');
  try {
    localStorage.setItem('veltriq_theme', 'light');
  } catch (_) {
    // Light mode still applies when storage is unavailable in an embed.
  }
})();
