// Package httpclient provides the proxy-aware HTTP client used to forward
// FreshRSS API requests from the renderer, replacing direct fetch calls that
// would be blocked by CORS inside the webview.
package httpclient

import (
	"net/http"
	"net/url"
	"sync/atomic"
	"time"
)

// Client wraps an http.Client whose transport can be reconfigured at runtime
// when proxy settings change.
type Client struct {
	inner atomic.Pointer[http.Client]
}

// New creates a client with sane defaults.
func New() *Client {
	c := &Client{}
	c.SetProxy(false, "")
	return c
}

// SetProxy enables or disables a proxy. The address is treated as an
// HTTP(S) proxy URL (the legacy PAC-script semantics degrade gracefully).
func (c *Client) SetProxy(enabled bool, address string) {
	transport := &http.Transport{}
	if enabled && address != "" {
		if u, err := url.Parse(address); err == nil && u.Scheme != "" {
			transport.Proxy = http.ProxyURL(u)
		}
	} else {
		transport.Proxy = http.ProxyFromEnvironment
	}
	c.inner.Store(&http.Client{
		Transport: transport,
		Timeout:   60 * time.Second,
	})
}

// Do performs a request with the current client.
func (c *Client) Do(req *http.Request) (*http.Response, error) {
	return c.inner.Load().Do(req)
}
