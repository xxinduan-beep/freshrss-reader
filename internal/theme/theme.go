// Package theme detects the system dark-mode preference, replacing Electron's
// nativeTheme.shouldUseDarkColors. Detection is best-effort per platform.
package theme

import (
	"os/exec"
	"runtime"
	"strings"
	"sync/atomic"
)

var cached atomic.Bool

func init() {
	cached.Store(detect())
}

// Refresh re-detects the system preference; called when the OS emits a
// theme-changed event.
func Refresh() {
	cached.Store(detect())
}

// SystemDark reports whether the system is currently in dark mode.
func SystemDark() bool {
	return cached.Load()
}

func detect() bool {
	switch runtime.GOOS {
	case "linux":
		return gsettingsDark()
	case "darwin":
		return defaultsDark()
	case "windows":
		return registryDark()
	}
	return false
}

func gsettingsDark() bool {
	out, err := exec.Command(
		"gsettings", "get", "org.gnome.desktop.interface", "color-scheme",
	).Output()
	if err != nil {
		return false
	}
	return strings.Contains(string(out), "prefer-dark")
}

func defaultsDark() bool {
	out, err := exec.Command(
		"defaults", "read", "-g", "AppleInterfaceStyle",
	).Output()
	return err == nil && strings.TrimSpace(string(out)) == "Dark"
}

func registryDark() bool {
	out, err := exec.Command(
		"reg", "query",
		`HKCU\Software\Microsoft\Windows\CurrentVersion\Themes\Personalize`,
		"/v", "AppsUseLightTheme",
	).Output()
	if err != nil {
		return false
	}
	return strings.Contains(strings.ToLower(string(out)), "0x0")
}
