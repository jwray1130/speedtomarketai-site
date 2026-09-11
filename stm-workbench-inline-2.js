
// Apply saved theme synchronously before render to prevent flash
(function() {
    try {
        var saved = localStorage.getItem('stm-theme');
        if (saved === 'dark') {
            document.documentElement.setAttribute('data-theme', 'dark');
        } else if (!saved && window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
            document.documentElement.setAttribute('data-theme', 'dark');
        }
    } catch (e) {}
})();
