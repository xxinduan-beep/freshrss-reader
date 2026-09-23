//go:build !windows

package win

// Tray is a no-op off Windows: the close-to-tray feature is Windows-only.
type Tray struct{}

// NewTray creates the no-op tray on non-Windows platforms.
func NewTray(locale func() string, show, quit func()) *Tray {
	return &Tray{}
}

func (t *Tray) SetEnabled(on bool)        {}
func (t *Tray) Notify(title, body string) {}
func (t *Tray) Destroy()                  {}
