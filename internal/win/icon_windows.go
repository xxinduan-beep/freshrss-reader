//go:build windows

package win

import "github.com/wailsapp/wails/v3/pkg/w32"

// appIconResourceID is the RT_GROUP_ICON "#1" embedded by
// rsrc_windows_amd64.syso (generated with go-winres, see build.sh).
const appIconResourceID = 1

// IconWndProcInterceptor returns a Wails WndProcInterceptor that overrides
// the window icon. Wails v3 beta.20 registers its window class with the
// generic IDI_APPLICATION icon and ignores App.SetIcon on Windows, which
// leaves the default Windows icon in the taskbar and alt-tab. Answering
// WM_GETICON from the exe's embedded resource fixes that.
//
// It also implements minimize-to-tray: intercepting SC_MINIMIZE hides the
// window directly (the minimize never completes, so no taskbar button is
// left behind); the tray icon restores it. closeToTray reports whether the
// setting is currently enabled.
func IconWndProcInterceptor(closeToTray func() bool) func(hwnd uintptr, msg uint32, wParam, lParam uintptr) (uintptr, bool) {
	return func(hwnd uintptr, msg uint32, wParam, lParam uintptr) (uintptr, bool) {
		if msg == w32.WM_GETICON {
			if icon := w32.LoadIconWithResourceID(w32.GetApplicationHandle(), appIconResourceID); icon != 0 {
				return uintptr(icon), true
			}
		}
		if msg == w32.WM_SYSCOMMAND && wParam&0xFFF0 == w32.SC_MINIMIZE {
			if closeToTray != nil && closeToTray() {
				w32.ShowWindow(w32.HWND(hwnd), w32.SW_HIDE)
				return 0, true
			}
		}
		return 0, false
	}
}
