//go:build windows

package singleinstance

import (
	"fmt"
	"io"
	"os"

	"golang.org/x/sys/windows"
)

// pipePath uses a named pipe scoped to the user name, so different user
// sessions on the same machine do not interfere with each other.
func pipePath(name string) string {
	return fmt.Sprintf(`\\.\pipe\%s-%s`, name, os.Getenv("USERNAME"))
}

func Acquire(name string, onActivate func()) (io.Closer, bool, error) {
	path := pipePath(name)
	pathPtr, err := windows.UTF16PtrFromString(path)
	if err != nil {
		return nil, false, err
	}
	if notifyExisting(pathPtr) {
		return nil, false, nil
	}
	// FILE_FLAG_FIRST_PIPE_INSTANCE makes creation fail if another
	// instance created the pipe concurrently.
	handle, err := windows.CreateNamedPipe(
		pathPtr,
		windows.PIPE_ACCESS_INBOUND|windows.FILE_FLAG_FIRST_PIPE_INSTANCE,
		windows.PIPE_TYPE_BYTE|windows.PIPE_READMODE_BYTE|windows.PIPE_WAIT,
		1, 4096, 4096, 0, nil,
	)
	if err != nil {
		// Lost a start-up race against a concurrent second instance.
		if notifyExisting(pathPtr) {
			return nil, false, nil
		}
		return nil, false, err
	}
	go servePipe(handle, onActivate)
	return &pipeListener{handle: handle}, true, nil
}

func servePipe(handle windows.Handle, onActivate func()) {
	for {
		err := windows.ConnectNamedPipe(handle, nil)
		if err != nil && err != windows.ERROR_PIPE_CONNECTED {
			return
		}
		var buf [64]byte
		var read uint32
		for {
			err := windows.ReadFile(handle, buf[:], &read, nil)
			if err != nil || read == 0 {
				break
			}
		}
		_ = windows.DisconnectNamedPipe(handle)
		onActivate()
	}
}

// notifyExisting opens the pipe of a running instance and asks it to show
// its window. Reports whether a live instance accepted the request.
func notifyExisting(pathPtr *uint16) bool {
	handle, err := windows.CreateFile(
		pathPtr, windows.GENERIC_WRITE, 0, nil,
		windows.OPEN_EXISTING, 0, 0,
	)
	if err != nil {
		return false
	}
	defer windows.CloseHandle(handle)
	var written uint32
	if err := windows.WriteFile(handle, []byte("activate\n"), &written, nil); err != nil {
		return false
	}
	_ = windows.FlushFileBuffers(handle)
	return true
}

type pipeListener struct {
	handle windows.Handle
}

func (l *pipeListener) Close() error {
	_ = windows.DisconnectNamedPipe(l.handle)
	return windows.CloseHandle(l.handle)
}
