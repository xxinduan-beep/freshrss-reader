//go:build !windows

package win

// IconWndProcInterceptor returns a no-op WndProcInterceptor off Windows.
func IconWndProcInterceptor(closeToTray func() bool) func(hwnd uintptr, msg uint32, wParam, lParam uintptr) (uintptr, bool) {
	return func(hwnd uintptr, msg uint32, wParam, lParam uintptr) (uintptr, bool) {
		return 0, false
	}
}
