// Package server exposes the renderer-facing HTTP API that replaces the
// Electron IPC surface (src/main/settings.ts + src/main/utils.ts).
// All routes live under /api/desktop/ and are served same-origin by the
// Wails AssetServer middleware.
package server

import (
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"

	"github.com/wailsapp/wails/v3/pkg/application"

	"freshrss-reader/internal/httpclient"
	"freshrss-reader/internal/platforminfo"
	"freshrss-reader/internal/settings"
	"freshrss-reader/internal/theme"
)

// Version must match package.json.
const Version = "1.0.0"

// API carries the dependencies shared by all handlers.
type API struct {
	Store          *settings.Store
	Client         *httpclient.Client
	App            *application.App
	Window         func() application.Window
	RestartWindow  func()
	ShouldUseDark  func() bool
	TrayNotify     func(title, body string)
	SetTrayEnabled func(on bool)
}

// Handler builds the /api/desktop mux.
func (a *API) Handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /api/desktop/boot", a.boot)
	mux.HandleFunc("GET /api/desktop/settings", a.getSettings)
	mux.HandleFunc("POST /api/desktop/settings/set", a.setSetting)
	mux.HandleFunc("POST /api/desktop/settings/import", a.importSettings)
	mux.HandleFunc("POST /api/desktop/proxy", a.setProxy)
	mux.HandleFunc("POST /api/desktop/http", a.forwardHTTP)
	mux.HandleFunc("POST /api/desktop/dialog/save", a.saveDialog)
	mux.HandleFunc("POST /api/desktop/dialog/write", a.writeFile)
	mux.HandleFunc("POST /api/desktop/dialog/open", a.openDialog)
	mux.HandleFunc("POST /api/desktop/message/box", a.messageBox)
	mux.HandleFunc("POST /api/desktop/message/error", a.errorBox)
	mux.HandleFunc("POST /api/desktop/external", a.openExternal)
	mux.HandleFunc("POST /api/desktop/clipboard", a.writeClipboard)
	mux.HandleFunc("GET /api/desktop/cache", a.cacheSize)
	mux.HandleFunc("POST /api/desktop/cache/clear", a.clearCache)
	mux.HandleFunc("POST /api/desktop/window/close", a.closeWindow)
	mux.HandleFunc("POST /api/desktop/window/minimize", a.minimizeWindow)
	mux.HandleFunc("POST /api/desktop/window/zoom", a.zoomWindow)
	mux.HandleFunc("POST /api/desktop/notify", a.notify)
	mux.HandleFunc("POST /api/desktop/window/focus", a.focusWindow)
	mux.HandleFunc("POST /api/desktop/window/attention", a.requestAttention)
	mux.HandleFunc("GET /api/desktop/window/state", a.windowState)
	mux.HandleFunc("GET /api/desktop/fonts", a.fonts)
	mux.HandleFunc("POST /api/desktop/log", a.logMessage)
	return mux
}

func (a *API) logMessage(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Message string `json:"message"`
	}
	if !readJSON(w, r, &body) {
		return
	}
	log.Printf("renderer: %s", body.Message)
	w.WriteHeader(http.StatusNoContent)
}

func (a *API) boot(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, map[string]interface{}{
		"settings":      a.Store.GetAllWithDefaults(),
		"platform":      platforminfo.Platform(),
		"version":       Version,
		"fontList":      platforminfo.Fonts(),
		"systemDark":    theme.SystemDark(),
		"resolvedLocale": resolvedLocale(),
	})
}

// resolvedLocale approximates Electron app.getLocale() from the environment.
func resolvedLocale() string {
	for _, key := range []string{"LC_ALL", "LC_MESSAGES", "LANG"} {
		lang := os.Getenv(key)
		if lang == "" {
			continue
		}
		lang = strings.SplitN(lang, ".", 2)[0]
		lang = strings.SplitN(lang, "@", 2)[0]
		lang = strings.SplitN(lang, ";", 2)[0]
		lang = strings.ReplaceAll(lang, "_", "-")
		if lang != "" && lang != "C" {
			return lang
		}
	}
	return "en-US"
}

func (a *API) getSettings(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, a.Store.GetAllWithDefaults())
}

func (a *API) setSetting(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Key   string          `json:"key"`
		Value json.RawMessage `json:"value"`
	}
	if !readJSON(w, r, &body) {
		return
	}
	var value interface{}
	if err := json.Unmarshal(body.Value, &value); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	if err := a.Store.Set(body.Key, value); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	// Mirror Electron's nativeTheme behaviour: changing the theme setting
	// re-evaluates shouldUseDarkColors and notifies the renderer.
	if body.Key == "theme" {
		a.App.Event.Emit("theme-updated", a.ShouldUseDark())
	}
	// Toggle the Windows tray icon live when close-to-tray changes.
	if body.Key == "closeToTray" && a.SetTrayEnabled != nil {
		on, _ := value.(bool)
		a.SetTrayEnabled(on)
	}
	w.WriteHeader(http.StatusNoContent)
}

func (a *API) importSettings(w http.ResponseWriter, r *http.Request) {
	var configs map[string]interface{}
	if !readJSON(w, r, &configs) {
		return
	}
	if err := a.Store.Clear(); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	for key, value := range configs {
		if err := a.Store.Set(key, value); err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
	}
	if a.RestartWindow != nil {
		go a.RestartWindow()
	}
	w.WriteHeader(http.StatusNoContent)
}

func (a *API) setProxy(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Address *string `json:"address"`
	}
	if !readJSON(w, r, &body) {
		return
	}
	if body.Address != nil {
		if err := a.Store.Set("pac", *body.Address); err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
	}
	a.applyProxy()
	w.WriteHeader(http.StatusNoContent)
}

// applyProxy reconfigures the forwarding client from stored settings.
func (a *API) applyProxy() {
	a.Client.SetProxy(
		a.Store.GetBool("pacOn", false),
		a.Store.GetString("pac", ""),
	)
}

func (a *API) forwardHTTP(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Method  string            `json:"method"`
		URL     string            `json:"url"`
		Headers map[string]string `json:"headers"`
		Body    string            `json:"body"`
	}
	if !readJSON(w, r, &body) {
		return
	}
	method := body.Method
	if method == "" {
		method = http.MethodGet
	}
	var reqBody io.Reader
	if body.Body != "" {
		reqBody = strings.NewReader(body.Body)
	}
	req, err := http.NewRequestWithContext(r.Context(), method, body.URL, reqBody)
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	for k, v := range body.Headers {
		req.Header.Set(k, v)
	}
	resp, err := a.Client.Do(req)
	if err != nil {
		writeJSON(w, map[string]interface{}{"error": err.Error()})
		return
	}
	defer resp.Body.Close()
	respBody, err := io.ReadAll(resp.Body)
	if err != nil {
		writeJSON(w, map[string]interface{}{"error": err.Error()})
		return
	}
	headers := map[string]string{}
	for k := range resp.Header {
		headers[k] = resp.Header.Get(k)
	}
	writeJSON(w, map[string]interface{}{
		"status":  resp.StatusCode,
		"body":    string(respBody),
		"headers": headers,
	})
}

func (a *API) saveDialog(w http.ResponseWriter, r *http.Request) {
	var body struct {
		DefaultPath string `json:"defaultPath"`
		Filters     []struct {
			Name       string   `json:"name"`
			Extensions []string `json:"extensions"`
		} `json:"filters"`
	}
	if !readJSON(w, r, &body) {
		return
	}
	dialog := a.App.Dialog.SaveFileWithOptions(&application.SaveFileDialogOptions{
		Title:    "Save",
		Filename: filepath.Base(strings.TrimPrefix(body.DefaultPath, "*/")),
	})
	for _, f := range body.Filters {
		patterns := make([]string, 0, len(f.Extensions))
		for _, ext := range f.Extensions {
			patterns = append(patterns, "*."+ext, "*."+strings.ToUpper(ext))
		}
		dialog.AddFilter(f.Name, strings.Join(patterns, ";"))
	}
	path, err := dialog.PromptForSingleSelection()
	if err != nil {
		writeJSON(w, map[string]interface{}{"canceled": true})
		return
	}
	writeJSON(w, map[string]interface{}{"canceled": false, "path": path})
}

func (a *API) writeFile(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Path    string `json:"path"`
		Content string `json:"content"`
		Errmsg  string `json:"errmsg"`
	}
	if !readJSON(w, r, &body) {
		return
	}
	if err := os.WriteFile(body.Path, []byte(body.Content), 0o644); err != nil {
		log.Printf("write file %s: %v", body.Path, err)
		a.errorDialog(body.Errmsg, fmt.Sprintf("%v", err), "")
	}
	w.WriteHeader(http.StatusNoContent)
}

func (a *API) openDialog(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Filters []struct {
			Name       string   `json:"name"`
			Extensions []string `json:"extensions"`
		} `json:"filters"`
	}
	if !readJSON(w, r, &body) {
		return
	}
	dialog := a.App.Dialog.OpenFileWithOptions(&application.OpenFileDialogOptions{
		Title:          "Open",
		CanChooseFiles: true,
	})
	for _, f := range body.Filters {
		patterns := make([]string, 0, len(f.Extensions))
		for _, ext := range f.Extensions {
			patterns = append(patterns, "*."+ext, "*."+strings.ToUpper(ext))
		}
		dialog.AddFilter(f.Name, strings.Join(patterns, ";"))
	}
	path, err := dialog.PromptForSingleSelection()
	if err != nil || path == "" {
		writeJSON(w, map[string]interface{}{"content": nil})
		return
	}
	raw, err := os.ReadFile(path)
	if err != nil {
		log.Printf("read file %s: %v", path, err)
		writeJSON(w, map[string]interface{}{"content": nil})
		return
	}
	writeJSON(w, map[string]interface{}{"content": string(raw)})
}

func (a *API) messageBox(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Title         string `json:"title"`
		Message       string `json:"message"`
		Confirm       string `json:"confirm"`
		Cancel        string `json:"cancel"`
		DefaultCancel bool   `json:"defaultCancel"`
		Type          string `json:"type"`
	}
	if !readJSON(w, r, &body) {
		return
	}
	dialog := a.App.Dialog.Question()
	dialog.SetTitle(body.Title).SetMessage(body.Message)
	confirmLabel := body.Confirm
	if confirmLabel == "" {
		confirmLabel = "OK"
	}
	cancelLabel := body.Cancel
	if cancelLabel == "" {
		cancelLabel = "Cancel"
	}
	confirmed := false
	done := make(chan struct{})
	confirmBtn := dialog.AddButton(confirmLabel)
	confirmBtn.OnClick(func() {
		confirmed = true
		close(done)
	})
	cancelBtn := dialog.AddButton(cancelLabel)
	cancelBtn.OnClick(func() { close(done) })
	if body.DefaultCancel {
		cancelBtn.SetAsDefault()
	} else {
		confirmBtn.SetAsDefault()
	}
	cancelBtn.SetAsCancel()
	dialog.Show()
	<-done
	writeJSON(w, map[string]interface{}{"confirmed": confirmed})
}

func (a *API) errorBox(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Title   string `json:"title"`
		Content string `json:"content"`
		Copy    string `json:"copy"`
	}
	if !readJSON(w, r, &body) {
		return
	}
	a.errorDialog(body.Title, body.Content, body.Copy)
	w.WriteHeader(http.StatusNoContent)
}

func (a *API) errorDialog(title, content, copy string) {
	dialog := a.App.Dialog.Error()
	dialog.SetTitle(title).SetMessage(content)
	okBtn := dialog.AddButton("OK")
	okBtn.SetAsDefault()
	okBtn.SetAsCancel()
	if copy != "" {
		copyBtn := dialog.AddButton(copy)
		copyBtn.OnClick(func() {
			a.App.Clipboard.SetText(fmt.Sprintf("%s: %s", title, content))
		})
	}
	dialog.Show()
}

func (a *API) openExternal(w http.ResponseWriter, r *http.Request) {
	var body struct {
		URL string `json:"url"`
	}
	if !readJSON(w, r, &body) {
		return
	}
	if strings.HasPrefix(body.URL, "https://") || strings.HasPrefix(body.URL, "http://") {
		openInBrowser(body.URL)
	}
	w.WriteHeader(http.StatusNoContent)
}

func openInBrowser(url string) {
	var cmd *exec.Cmd
	switch runtime.GOOS {
	case "darwin":
		cmd = exec.Command("open", url)
	case "windows":
		cmd = exec.Command("rundll32", "url.dll,FileProtocolHandler", url)
	default:
		cmd = exec.Command("xdg-open", url)
	}
	if err := cmd.Start(); err != nil {
		log.Printf("open external %s: %v", url, err)
	}
}

func (a *API) writeClipboard(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Text string `json:"text"`
	}
	if !readJSON(w, r, &body) {
		return
	}
	a.App.Clipboard.SetText(body.Text)
	w.WriteHeader(http.StatusNoContent)
}

func (a *API) cacheSize(w http.ResponseWriter, r *http.Request) {
	// Best-effort stub: the webview storage location is platform-specific.
	writeJSON(w, map[string]interface{}{"size": 0})
}

func (a *API) clearCache(w http.ResponseWriter, r *http.Request) {
	w.WriteHeader(http.StatusNoContent)
}

func (a *API) closeWindow(w http.ResponseWriter, r *http.Request) {
	if win := a.Window(); win != nil {
		win.Close()
	}
	w.WriteHeader(http.StatusNoContent)
}

func (a *API) minimizeWindow(w http.ResponseWriter, r *http.Request) {
	if win := a.Window(); win != nil {
		// Minimize-to-tray: hide instead of minimising so no taskbar
		// button is left behind; the tray icon restores the window.
		if runtime.GOOS == "windows" && a.Store.GetBool("closeToTray", false) {
			win.Hide()
		} else {
			win.Minimise()
		}
	}
	w.WriteHeader(http.StatusNoContent)
}

func (a *API) zoomWindow(w http.ResponseWriter, r *http.Request) {
	if win := a.Window(); win != nil {
		if win.IsMaximised() {
			win.UnMaximise()
		} else {
			win.Maximise()
		}
	}
	w.WriteHeader(http.StatusNoContent)
}

func (a *API) focusWindow(w http.ResponseWriter, r *http.Request) {
	if win := a.Window(); win != nil {
		win.Focus()
	}
	w.WriteHeader(http.StatusNoContent)
}

// requestAttention mirrors Electron's win.flashFrame(true): flash the
// taskbar button without stealing the foreground. Calling Focus() here
// makes Windows deny the foreground switch (the process is in the
// background), which leaves the window stuck behind others and breaks
// taskbar-click activation.
func (a *API) requestAttention(w http.ResponseWriter, r *http.Request) {
	if win := a.Window(); win != nil && !win.IsFocused() {
		win.Flash(true)
	}
	w.WriteHeader(http.StatusNoContent)
}

func (a *API) windowState(w http.ResponseWriter, r *http.Request) {
	state := map[string]interface{}{
		"maximized":  false,
		"fullscreen": false,
		"focused":    false,
		"hidden":     false,
	}
	if win := a.Window(); win != nil {
		state["maximized"] = win.IsMaximised()
		state["fullscreen"] = win.IsFullscreen()
		state["focused"] = win.IsFocused()
		state["hidden"] = !win.IsVisible()
	}
	writeJSON(w, state)
}

// notify shows a tray balloon notification (Windows). Used while the window
// is hidden to the tray, where the web Notification API cannot restore the
// window on click.
func (a *API) notify(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Title string `json:"title"`
		Body  string `json:"body"`
	}
	if !readJSON(w, r, &body) {
		return
	}
	if a.TrayNotify != nil {
		a.TrayNotify(body.Title, body.Body)
	}
	w.WriteHeader(http.StatusNoContent)
}

func (a *API) fonts(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, platforminfo.Fonts())
}

func writeJSON(w http.ResponseWriter, body interface{}) {
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(body)
}

func readJSON(w http.ResponseWriter, r *http.Request, into interface{}) bool {
	if err := json.NewDecoder(r.Body).Decode(into); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return false
	}
	return true
}
