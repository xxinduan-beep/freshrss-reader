//go:build windows

package main

import "github.com/wailsapp/wails/v3/pkg/w32"

// appIconResourceID is the RT_GROUP_ICON "#1" embedded by
// rsrc_windows_amd64.syso (generated with go-winres, see build.sh).
const appIconResourceID = 1

// iconWndProcInterceptor overrides the window icon. Wails v3 beta.20
// registers its window class with the generic IDI_APPLICATION icon and
// ignores App.SetIcon on Windows, which leaves the default Windows icon in
// the taskbar and alt-tab. Answering WM_GETICON from the exe's embedded
// resource fixes that.
func iconWndProcInterceptor(hwnd uintptr, msg uint32, wParam, lParam uintptr) (uintptr, bool) {
	if msg == w32.WM_GETICON {
		if icon := w32.LoadIconWithResourceID(w32.GetApplicationHandle(), appIconResourceID); icon != 0 {
			return uintptr(icon), true
		}
	}
	return 0, false
}
