//go:build windows

package win

import (
	"syscall"

	"github.com/wailsapp/wails/v3/pkg/application"
	"github.com/wailsapp/wails/v3/pkg/w32"
)

// Windows' foreground lock: SetForegroundWindow only succeeds for the
// process that received the last input event. Clicks on a tray icon do not
// reliably grant that right, so a plain SetForegroundWindow — what Wails'
// Focus() does — is sometimes rejected and Windows merely flashes the
// taskbar button. Attaching our thread to the current foreground thread's
// input queue lifts the restriction, making the activation stick.
var procAttachThreadInput = syscall.NewLazyDLL("user32.dll").NewProc("AttachThreadInput")

func attachThreadInput(thread, other w32.HANDLE, attach bool) bool {
	on := uintptr(0)
	if attach {
		on = 1
	}
	ret, _, _ := procAttachThreadInput.Call(
		uintptr(thread),
		uintptr(other),
		on,
	)
	return ret != 0
}

// ShowAndFocus makes the window visible, restored and foreground. Used for
// tray restore clicks and second-instance activation requests.
func ShowAndFocus(win application.Window) {
	if win == nil {
		return
	}
	ww, ok := win.(*application.WebviewWindow)
	if !ok || ww == nil {
		showAndFocusPortable(win)
		return
	}
	hwnd := w32.HWND(ww.NativeWindow())
	if hwnd == 0 {
		showAndFocusPortable(win)
		return
	}
	// SW_RESTORE covers the minimised state; SW_SHOW suffices for a window
	// hidden to the tray.
	if win.IsMinimised() {
		w32.ShowWindow(hwnd, w32.SW_RESTORE)
	} else {
		w32.ShowWindow(hwnd, w32.SW_SHOW)
	}
	forceForeground(hwnd)
}

// forceForeground brings hwnd to the foreground and gives it keyboard
// focus, working around the foreground lock via AttachThreadInput.
func forceForeground(hwnd w32.HWND) {
	fg := w32.GetForegroundWindow()
	if fg == hwnd {
		return
	}
	cur := w32.GetCurrentThreadId()
	var fgThread w32.HANDLE
	if fg != 0 {
		fgThread, _ = w32.GetWindowThreadProcessId(fg)
	}
	attached := fgThread != 0 && w32.HANDLE(cur) != fgThread &&
		attachThreadInput(cur, fgThread, true)
	w32.BringWindowToTop(hwnd)
	w32.SetForegroundWindow(hwnd)
	if attached {
		attachThreadInput(cur, fgThread, false)
	}
}

// showAndFocusPortable is the fallback using Wails' window methods only.
func showAndFocusPortable(win application.Window) {
	win.Show()
	if win.IsMinimised() {
		win.UnMinimise()
	}
	win.Focus()
}
