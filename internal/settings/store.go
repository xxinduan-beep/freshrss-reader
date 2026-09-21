// Package settings implements the JSON settings store replacing electron-store.
// Keys match the electron-store keys used by the original Electron main process.
package settings

import (
	"encoding/json"
	"os"
	"path/filepath"
	"sync"
)

// Store is a flat JSON key/value store persisted to disk.
type Store struct {
	mu   sync.RWMutex
	path string
	data map[string]interface{}
}

// DataDir returns the directory containing the executable, making the
// application portable: the settings file lives next to the binary instead
// of in ~/.config/freshrss-reader.
func DataDir() (string, error) {
	exe, err := os.Executable()
	if err != nil {
		return "", err
	}
	return filepath.Dir(exe), nil
}

// CacheDir returns <executable dir>/cache, creating it when missing. It is
// used as the XDG base directory for the webview's website data (IndexedDB,
// localStorage) and HTTP cache.
func CacheDir() (string, error) {
	dir, err := DataDir()
	if err != nil {
		return "", err
	}
	cache := filepath.Join(dir, "cache")
	if err := os.MkdirAll(cache, 0o755); err != nil {
		return "", err
	}
	return cache, nil
}

// Open loads the settings file, migrating the legacy electron-store
// config.json when present.
func Open() (*Store, error) {
	dir, err := DataDir()
	if err != nil {
		return nil, err
	}
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return nil, err
	}
	path := filepath.Join(dir, "settings.json")
	s := &Store{path: path, data: map[string]interface{}{}}
	if err := s.loadFile(path); err != nil && !os.IsNotExist(err) {
		return nil, err
	}
	if len(s.data) == 0 {
		legacy := filepath.Join(dir, "config.json")
		if err := s.loadFile(legacy); err == nil && len(s.data) > 0 {
			_ = s.save()
		}
	}
	return s, nil
}

func (s *Store) loadFile(path string) error {
	raw, err := os.ReadFile(path)
	if err != nil {
		return err
	}
	m := map[string]interface{}{}
	if err := json.Unmarshal(raw, &m); err != nil {
		return err
	}
	s.data = m
	return nil
}

func (s *Store) save() error {
	raw, err := json.MarshalIndent(s.data, "", "  ")
	if err != nil {
		return err
	}
	tmp := s.path + ".tmp"
	if err := os.WriteFile(tmp, raw, 0o644); err != nil {
		return err
	}
	return os.Rename(tmp, s.path)
}

// Get returns the raw value for key, or nil when unset.
func (s *Store) Get(key string) interface{} {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.data[key]
}

// Set stores a value and persists to disk.
func (s *Store) Set(key string, value interface{}) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.data[key] = value
	return s.save()
}

// Clear removes all entries and persists to disk.
func (s *Store) Clear() error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.data = map[string]interface{}{}
	return s.save()
}

// All returns a copy of every stored entry.
func (s *Store) All() map[string]interface{} {
	s.mu.RLock()
	defer s.mu.RUnlock()
	out := make(map[string]interface{}, len(s.data))
	for k, v := range s.data {
		out[k] = v
	}
	return out
}

// GetAllWithDefaults returns every known settings key, applying the same
// defaults as the original Electron main/settings.ts.
func (s *Store) GetAllWithDefaults() map[string]interface{} {
	out := s.All()
	defaults := map[string]interface{}{
		"sourceGroups":          []interface{}{},
		"menuOn":                false,
		"pac":                   "",
		"pacOn":                 false,
		"view":                  0, // ViewType.Cards
		"theme":                 "system",
		"locale":                "default",
		"fontSize":              16,
		"fontFamily":            "",
		"fetchInterval":         0,
		"searchEngine":          0, // SearchEngines.Google
		"serviceConfigs":        map[string]interface{}{"type": 0},
		"filterType":            nil,
		"cardsViewConfigs":      0,
		"listViewConfigs":       1, // ViewConfigs.ShowCover
		"magazineViewConfigs":   0,
		"compactViewConfigs":    0,
		"menuUnreadSourcesOnly": false,
		"scrollMarkReadOn":      false,
		"version":               "1.0.0",
		"windowX":               nil,
		"windowY":               nil,
		"windowWidth":           nil,
		"windowHeight":          nil,
		"windowMaximized":       false,
	}
	for k, v := range defaults {
		if _, ok := out[k]; !ok {
			out[k] = v
		}
	}
	return out
}

// GetString returns a string setting with a fallback.
func (s *Store) GetString(key, fallback string) string {
	if v, ok := s.Get(key).(string); ok {
		return v
	}
	return fallback
}

// GetBool returns a boolean setting with a fallback.
func (s *Store) GetBool(key string, fallback bool) bool {
	if v, ok := s.Get(key).(bool); ok {
		return v
	}
	return fallback
}

// GetInt returns an integer setting with a fallback.
func (s *Store) GetInt(key string, fallback int) int {
	switch v := s.Get(key).(type) {
	case float64:
		return int(v)
	case int:
		return v
	}
	return fallback
}
