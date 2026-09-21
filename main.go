// Command freshrss-reader is the Wails v3 desktop shell replacing the
// Electron main process of FreshRSS Reader.
package main

import (
	"embed"
	"io/fs"
	"log"
	"log/slog"
	"net/http"
	"os"
	"runtime"
	"strings"
	"time"

	"github.com/wailsapp/wails/v3/pkg/application"
	"github.com/wailsapp/wails/v3/pkg/events"

	"freshrss-reader/internal/httpclient"
	"freshrss-reader/internal/server"
	"freshrss-reader/internal/settings"
	"freshrss-reader/internal/theme"
)

//go:embed all:dist
var distFiles embed.FS

func main() {
	store, err := settings.Open()
	if err != nil {
		log.Fatalf("failed to open settings: %v", err)
	}

	// Portable mode: point the XDG base directories at <exe dir>/cache so
	// WebKitGTK stores the webview's website data (IndexedDB, localStorage)
	// and HTTP cache there instead of under ~/.local/share and ~/.cache.
	// This must happen before GTK/WebKit initialize, since GLib caches the
	// XDG paths on first use.
	cacheDir, err := settings.CacheDir()
	if err != nil {
		log.Fatalf("failed to prepare cache dir: %v", err)
	}
	os.Setenv("XDG_DATA_HOME", cacheDir)
	os.Setenv("XDG_CACHE_HOME", cacheDir)

	client := httpclient.New()

	api := &server.API{
		Store:  store,
		Client: client,
	}
	// The proxy used by API forwarding is read from settings at startup.
	api.Client.SetProxy(
		store.GetBool("pacOn", false),
		store.GetString("pac", ""),
	)

	app := application.New(application.Options{
		Name:        "FreshRSS Reader",
		Description: "FreshRSS-specific desktop RSS client",
		LogLevel:    slog.LevelError,
		Assets: application.AssetOptions{
			Handler:    assetHandler(),
			Middleware: assetMiddleware(api.Handler()),
		},
		Windows: application.WindowsOptions{
			WndProcInterceptor: iconWndProcInterceptor,
		},
	})
	api.App = app

	app.Event.OnApplicationEvent(events.Common.ThemeChanged, func(event *application.ApplicationEvent) {
		theme.Refresh()
		app.Event.Emit("theme-updated", shouldUseDark(store))
	})

	var win application.Window
	api.Window = func() application.Window { return win }
	api.ShouldUseDark = func() bool { return shouldUseDark(store) }
	win = createWindow(app, store)
	api.RestartWindow = func() {
		application.InvokeAsync(func() {
			if win != nil {
				win.Close()
			}
			time.Sleep(500 * time.Millisecond)
			win = createWindow(app, store)
		})
	}

	registerWindowHooks(app, store, win)

	if err := app.Run(); err != nil {
		log.Fatal(err)
	}
}

// assetHandler serves the embedded webpack renderer bundle.
func assetHandler() http.Handler {
	sub, err := fs.Sub(distFiles, "dist")
	if err != nil {
		log.Fatal(err)
	}
	return http.FileServer(http.FS(sub))
}

// assetMiddleware routes /api/desktop requests to the Go API and leaves
// everything else (static assets + the Wails runtime) to the asset server.
func assetMiddleware(api http.Handler) application.Middleware {
	debug := os.Getenv("FRSS_DEBUG") != ""
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if debug {
				log.Printf("asset %s %s", r.Method, r.URL.Path)
			}
			switch {
			case strings.HasPrefix(r.URL.Path, "/wails"):
				next.ServeHTTP(w, r)
			case strings.HasPrefix(r.URL.Path, "/api/desktop/"):
				api.ServeHTTP(w, r)
			default:
				next.ServeHTTP(w, r)
			}
		})
	}
}

// shouldUseDark mirrors Electron nativeTheme.themeSource + shouldUseDarkColors.
func shouldUseDark(store *settings.Store) bool {
	switch store.GetString("theme", "system") {
	case "dark":
		return true
	case "light":
		return false
	default:
		return theme.SystemDark()
	}
}

func createWindow(app *application.App, store *settings.Store) application.Window {
	width := store.GetInt("windowWidth", 1200)
	height := store.GetInt("windowHeight", 700)
	opts := application.WebviewWindowOptions{
		Name:             "main",
		Title:            "FreshRSS Reader",
		Width:            width,
		Height:           height,
		MinWidth:         992,
		MinHeight:        600,
		URL:              "/",
		BackgroundColour: backgroundColour(store),
		// The renderer draws its own window controls (nav.tsx) and drag
		// region (--wails-draggable in dist/styles/global.css), mirroring
		// the Electron frame:false behaviour.
		Frameless: os.Getenv("FRSS_NATIVE_FRAME") == "" && runtime.GOOS != "darwin",
	}
	if x := store.Get("windowX"); x != nil {
		opts.X = store.GetInt("windowX", 0)
	}
	if y := store.Get("windowY"); y != nil {
		opts.Y = store.GetInt("windowY", 0)
	}
	win := app.Window.NewWithOptions(opts)
	if store.Get("windowX") == nil {
		win.Center()
	}
	if store.GetBool("windowMaximized", false) {
		win.Maximise()
	}
	return win
}

func backgroundColour(store *settings.Store) application.RGBA {
	if shouldUseDark(store) {
		return application.NewRGB(0x28, 0x28, 0x28)
	}
	return application.NewRGB(0xfa, 0xf9, 0xf8)
}

// registerWindowHooks forwards window state changes to the renderer as Wails
// events using the original Electron channel names, and persists bounds.
func registerWindowHooks(app *application.App, store *settings.Store, win application.Window) {
	persist := func() {
		if win == nil {
			return
		}
		if win.IsMaximised() || win.IsFullscreen() {
			return
		}
		width, height := win.Size()
		x, y := win.Position()
		_ = store.Set("windowWidth", width)
		_ = store.Set("windowHeight", height)
		_ = store.Set("windowX", x)
		_ = store.Set("windowY", y)
	}
	win.RegisterHook(events.Common.WindowMaximise, func(e *application.WindowEvent) {
		_ = store.Set("windowMaximized", true)
		app.Event.Emit("maximized")
	})
	win.RegisterHook(events.Common.WindowUnMaximise, func(e *application.WindowEvent) {
		_ = store.Set("windowMaximized", false)
		app.Event.Emit("unmaximized")
	})
	win.RegisterHook(events.Common.WindowFullscreen, func(e *application.WindowEvent) {
		app.Event.Emit("enter-fullscreen")
	})
	win.RegisterHook(events.Common.WindowUnFullscreen, func(e *application.WindowEvent) {
		app.Event.Emit("leave-fullscreen")
	})
	win.RegisterHook(events.Common.WindowFocus, func(e *application.WindowEvent) {
		app.Event.Emit("window-focus")
	})
	win.RegisterHook(events.Common.WindowLostFocus, func(e *application.WindowEvent) {
		app.Event.Emit("window-blur")
	})
	win.RegisterHook(events.Common.WindowDidResize, func(e *application.WindowEvent) {
		persist()
	})
	win.RegisterHook(events.Common.WindowDidMove, func(e *application.WindowEvent) {
		persist()
	})
	win.RegisterHook(events.Common.WindowClosing, func(e *application.WindowEvent) {
		persist()
		_ = store.Set("windowMaximized", win.IsMaximised())
		app.Quit()
	})
}
