//go:build !windows

package singleinstance

import (
	"fmt"
	"io"
	"net"
	"os"
	"path/filepath"
	"time"
)

// socketPath places the socket in the XDG runtime directory (per-user,
// tmpfs-backed) with a uid suffix as a fallback for setups without it.
func socketPath(name string) string {
	dir := os.Getenv("XDG_RUNTIME_DIR")
	if dir == "" {
		dir = os.TempDir()
	}
	return filepath.Join(dir, fmt.Sprintf("%s-%d.sock", name, os.Getuid()))
}

func Acquire(name string, onActivate func()) (io.Closer, bool, error) {
	path := socketPath(name)
	if notifyExisting(path) {
		return nil, false, nil
	}
	// A leftover socket from a crashed instance: drop it and rebind.
	_ = os.Remove(path)
	lis, err := net.Listen("unix", path)
	if err != nil {
		// Lost a start-up race against a concurrent second instance.
		if notifyExisting(path) {
			return nil, false, nil
		}
		return nil, false, err
	}
	go serve(lis, onActivate)
	return &unixListener{lis: lis, path: path}, true, nil
}

func serve(lis net.Listener, onActivate func()) {
	for {
		conn, err := lis.Accept()
		if err != nil {
			return
		}
		go func(c net.Conn) {
			// Drain until the client closes, then activate.
			_, _ = io.Copy(io.Discard, c)
			_ = c.Close()
			onActivate()
		}(conn)
	}
}

// notifyExisting dials the socket of a running instance and asks it to
// show its window. Reports whether a live instance accepted the request.
func notifyExisting(path string) bool {
	conn, err := net.DialTimeout("unix", path, time.Second)
	if err != nil {
		return false
	}
	_, err = conn.Write([]byte("activate\n"))
	_ = conn.Close()
	return err == nil
}

type unixListener struct {
	lis  net.Listener
	path string
}

func (l *unixListener) Close() error {
	err := l.lis.Close()
	_ = os.Remove(l.path)
	return err
}
