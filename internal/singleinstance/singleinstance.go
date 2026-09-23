// Package singleinstance enforces a single running app instance. A second
// launch notifies the first instance — which shows/restores its main window
// — and reports that this process should exit.
package singleinstance

// Acquire tries to register this process as the single running instance.
//
// If another instance is already running, it is notified to activate
// (show/restore) its main window and (nil, false, nil) is returned; the
// caller should exit. Otherwise a non-nil Closer is returned and true; the
// caller must keep it for the lifetime of the process and close it on quit
// to release the registration.
//
// If the check itself fails (err != nil) single-instance enforcement is
// unavailable and the caller may continue unrestrained. onActivate is
// invoked from a background goroutine each time another instance requests
// activation; it must be safe for concurrent use.
