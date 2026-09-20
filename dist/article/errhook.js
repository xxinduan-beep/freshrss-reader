// Diagnostics: report renderer errors to the Go backend so blank-window
// issues can be diagnosed from /tmp log output.
(function () {
    function report(kind, detail) {
        try {
            fetch("/api/desktop/log", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ message: kind + ": " + detail }),
            });
        } catch (e) {}
    }
    window.addEventListener("error", function (ev) {
        report(
            "js-error",
            (ev.message || "unknown") +
                " @ " +
                (ev.filename || "?") +
                ":" +
                (ev.lineno || 0)
        );
    });
    window.addEventListener("unhandledrejection", function (ev) {
        report("unhandled-rejection", String(ev.reason));
    });
    window.addEventListener("DOMContentLoaded", function () {
        report("info", "renderer DOM ready, settings=" + typeof window.settings);
    });
})();
