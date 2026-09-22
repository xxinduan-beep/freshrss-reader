//go:build !windows

package main

// tray is a no-op off Windows: the close-to-tray feature is Windows-only.
type tray struct{}

func newTray(locale func() string, show, quit func()) *tray {
	return &tray{}
}

func (t *tray) SetEnabled(on bool)        {}
func (t *tray) Notify(title, body string) {}
func (t *tray) Destroy()                  {}
