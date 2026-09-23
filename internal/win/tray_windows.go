//go:build windows

package win

import (
	"log"
	"syscall"
	"unsafe"

	"github.com/wailsapp/wails/v3/pkg/w32"
)

// Self-managed Windows tray icon. Wails v3 beta.20's SystemTray has no
// balloon-notification support (its wndProc ignores NIN_BALLOONUSERCLICK),
// so the tray icon, the restore menu and the new-article balloons are
// handled here directly via Shell_NotifyIcon on a message-only window.
const (
	wmTrayCallback = 0x8000 + 0x11 // WM_APP range, distinct from Wails' WM_USER+1

	trayUID        = 1
	trayMenuShow   = 1
	trayMenuQuit   = 2
	ninBalloonUser = 0x0400 + 5 // NIN_BALLOONUSERCLICK (missing from w32)
)

// Tray is created on every platform but is a no-op off Windows (see
// tray_other.go).
type Tray struct {
	hwnd   w32.HWND
	icon   w32.HICON
	added  bool
	show   func()
	quit   func()
	locale func() string
	proc   uintptr
}

// NewTray creates the tray icon owner. show is invoked on left clicks and
// notification clicks, quit from the tray menu.
func NewTray(locale func() string, show, quit func()) *Tray {
	t := &Tray{show: show, quit: quit, locale: locale}
	t.proc = syscall.NewCallback(t.wndProc)

	className, _ := syscall.UTF16PtrFromString("FreshRSSReaderTray")
	t.locale = locale
	wndClass := w32.WNDCLASSEX{
		Size:      uint32(unsafe.Sizeof(w32.WNDCLASSEX{})),
		WndProc:   t.proc,
		Instance:  w32.GetApplicationHandle(),
		ClassName: className,
	}
	if w32.RegisterClassEx(&wndClass) == 0 {
		log.Printf("tray: RegisterClassEx failed: %v", syscall.GetLastError())
		return t
	}
	t.hwnd = w32.CreateWindowEx(
		0, className, nil, 0, 0, 0, 0, 0,
		w32.HWND_MESSAGE, 0, 0, nil,
	)
	if t.hwnd == 0 {
		log.Printf("tray: CreateWindowEx failed: %v", syscall.GetLastError())
	}
	t.icon = w32.LoadIconWithResourceID(
		w32.GetApplicationHandle(), appIconResourceID,
	)
	return t
}

func (t *Tray) wndProc(hwnd w32.HWND, msg uint32, wParam, lParam uintptr) uintptr {
	switch msg {
	case wmTrayCallback:
		switch lParam & 0xffff {
		case w32.WM_LBUTTONUP, uintptr(ninBalloonUser):
			if t.show != nil {
				t.show()
			}
		case w32.WM_RBUTTONUP:
			t.popupMenu()
		}
		return 0
	case w32.WM_COMMAND:
		// Menu selections from the tray popup arrive here.
		switch wParam & 0xffff {
		case trayMenuShow:
			if t.show != nil {
				t.show()
			}
		case trayMenuQuit:
			if t.quit != nil {
				t.quit()
			}
		}
		return 0
	case w32.WM_DESTROY:
		t.removeIcon()
	}
	return w32.DefWindowProc(hwnd, msg, wParam, lParam)
}

func (t *Tray) nid() w32.NOTIFYICONDATA {
	nid := w32.NOTIFYICONDATA{
		HWnd: t.hwnd,
		UID:  trayUID,
	}
	nid.CbSize = uint32(unsafe.Sizeof(nid))
	return nid
}

// SetEnabled adds or removes the tray icon. Safe to call repeatedly.
func (t *Tray) SetEnabled(on bool) {
	if t.hwnd == 0 || on == t.added {
		return
	}
	if on {
		nid := t.nid()
		nid.UFlags = w32.NIF_MESSAGE | w32.NIF_ICON | w32.NIF_TIP
		nid.UCallbackMessage = wmTrayCallback
		nid.HIcon = t.icon
		copy(nid.SzTip[:], syscall.StringToUTF16("FreshRSS Reader"))
		if w32.ShellNotifyIcon(w32.NIM_ADD, &nid) {
			t.added = true
		} else {
			log.Printf("tray: ShellNotifyIcon add failed: %v", syscall.GetLastError())
		}
	} else {
		t.removeIcon()
	}
}

func (t *Tray) removeIcon() {
	if !t.added {
		return
	}
	nid := t.nid()
	w32.ShellNotifyIcon(w32.NIM_DELETE, &nid)
	t.added = false
}

// Notify shows a tray balloon (a toast on Windows 10+). Clicking it is
// delivered as ninBalloonUser on wmTrayCallback and restores the window.
func (t *Tray) Notify(title, body string) {
	if t.hwnd == 0 || !t.added {
		return
	}
	nid := t.nid()
	nid.UFlags = w32.NIF_INFO
	nid.DwInfoFlags = w32.NIIF_INFO
	copy(nid.SzInfoTitle[:], truncateUTF16(title, 63))
	copy(nid.SzInfo[:], truncateUTF16(body, 255))
	if !w32.ShellNotifyIcon(w32.NIM_MODIFY, &nid) {
		log.Printf("tray: ShellNotifyIcon notify failed: %v", syscall.GetLastError())
	}
}

func (t *Tray) Destroy() {
	if t.hwnd != 0 {
		w32.DestroyWindow(t.hwnd)
		t.hwnd = 0
	}
}

func (t *Tray) popupMenu() {
	menu := w32.CreatePopupMenu()
	if menu == 0 {
		return
	}
	defer w32.DestroyMenu(w32.HMENU(menu))
	showLabel, quitLabel := t.menuLabels()
	w32.AppendMenu(w32.HMENU(menu), w32.MF_STRING, trayMenuShow, showLabel)
	w32.AppendMenu(w32.HMENU(menu), w32.MF_SEPARATOR, 0, nil)
	w32.AppendMenu(w32.HMENU(menu), w32.MF_STRING, trayMenuQuit, quitLabel)

	// The taskbar menu must be owned by the foreground window, otherwise it
	// does not dismiss when clicking outside of it. The selected item is
	// delivered as WM_COMMAND to t.hwnd.
	w32.SetForegroundWindow(t.hwnd)
	x, y, ok := w32.GetCursorPos()
	if !ok {
		x, y = 0, 0
	}
	w32.TrackPopupMenuEx(
		w32.HMENU(menu),
		w32.TPM_LEFTALIGN|w32.TPM_RIGHTBUTTON|w32.TPM_NONOTIFY,
		int32(x), int32(y), t.hwnd, nil,
	)
}

// menuLabels localises the two menu entries using the locale setting.
func (t *Tray) menuLabels() (show, quit *uint16) {
	showText, quitText := "Show FreshRSS Reader", "Quit"
	switch t.locale() {
	case "zh-CN":
		showText, quitText = "显示主窗口", "退出"
	case "zh-TW":
		showText, quitText = "顯示主視窗", "結束"
	case "ja":
		showText, quitText = "メインウィンドウを表示", "終了"
	}
	show, _ = syscall.UTF16PtrFromString(showText)
	quit, _ = syscall.UTF16PtrFromString(quitText)
	return show, quit
}

func truncateUTF16(s string, max int) []uint16 {
	runes := syscall.StringToUTF16(s)
	if len(runes) > max {
		runes = runes[:max]
	}
	return runes
}
