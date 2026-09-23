//go:build !windows

package win

import "github.com/wailsapp/wails/v3/pkg/application"

// ShowAndFocus shows, un-minimises and focuses the window. Off Windows the
// window manager honours the activation without extra work.
func ShowAndFocus(win application.Window) {
	if win == nil {
		return
	}
	win.Show()
	if win.IsMinimised() {
		win.UnMinimise()
	}
	win.Focus()
}
