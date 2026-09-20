// Package platforminfo provides platform metadata and the system font list,
// replacing the font-list npm package used by the Electron main process.
package platforminfo

import (
	"os/exec"
	"runtime"
	"sort"
	"strings"
)

// Platform returns the platform identifier used by the renderer
// (equivalent of process.platform).
func Platform() string {
	switch runtime.GOOS {
	case "darwin":
		return "darwin"
	case "windows":
		return "win32"
	default:
		return runtime.GOOS
	}
}

// Fonts returns the installed system font family names, best-effort.
func Fonts() []string {
	var out []string
	switch runtime.GOOS {
	case "linux":
		out = fontsFromFcList()
	case "darwin":
		out = fontsFromSystemProfiler()
	case "windows":
		out = fontsFromRegistry()
	}
	sort.Strings(out)
	return out
}

func fontsFromFcList() []string {
	outRaw, err := exec.Command("fc-list", "--format", "%{family}\n").Output()
	if err != nil {
		return nil
	}
	seen := map[string]bool{}
	var fonts []string
	for _, line := range strings.Split(string(outRaw), "\n") {
		if line == "" {
			continue
		}
		// Keep the first family of a comma-separated list.
		family := strings.TrimSpace(strings.SplitN(line, ",", 2)[0])
		if family == "" || seen[family] {
			continue
		}
		seen[family] = true
		fonts = append(fonts, family)
	}
	return fonts
}

func fontsFromSystemProfiler() []string {
	// Best-effort; returning nil falls back to the renderer default.
	return nil
}

func fontsFromRegistry() []string {
	outRaw, err := exec.Command(
		"reg", "query",
		`HKLM\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Fonts`,
	).Output()
	if err != nil {
		return nil
	}
	seen := map[string]bool{}
	var fonts []string
	for _, line := range strings.Split(string(outRaw), "\n") {
		line = strings.TrimSpace(line)
		if !strings.Contains(line, "REG_SZ") {
			continue
		}
		name := strings.TrimSpace(strings.SplitN(line, "REG_SZ", 2)[0])
		// Strip trailing style suffixes like " (TrueType)" already excluded,
		// but names end with e.g. " (TrueType)" variants — trim decoration.
		name = strings.TrimSuffix(name, " (TrueType)")
		if i := strings.LastIndex(name, " ("); i > 0 {
			name = name[:i]
		}
		if name == "" || seen[name] {
			continue
		}
		seen[name] = true
		fonts = append(fonts, name)
	}
	return fonts
}
