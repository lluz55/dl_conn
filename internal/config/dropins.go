package config

import (
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"

	"gopkg.in/yaml.v3"
)

// LoadServicesDir scans dir for *.yaml and *.yml files, parses them in
// lexicographical order, and returns the validated list of drop-in services.
// If dir does not exist, it returns nil, nil.
func LoadServicesDir(dir string) ([]ServiceConfig, error) {
	if dir == "" {
		return nil, nil
	}
	info, err := os.Stat(dir)
	if err != nil {
		if os.IsNotExist(err) {
			return nil, nil
		}
		return nil, fmt.Errorf("reading services directory %q: %w", dir, err)
	}
	if !info.IsDir() {
		return nil, fmt.Errorf("services path %q is not a directory", dir)
	}

	entries, err := os.ReadDir(dir)
	if err != nil {
		return nil, fmt.Errorf("reading services directory %q: %w", dir, err)
	}

	sort.Slice(entries, func(i, j int) bool {
		return entries[i].Name() < entries[j].Name()
	})

	var dropIns []ServiceConfig
	for _, entry := range entries {
		if entry.IsDir() {
			continue
		}
		name := entry.Name()
		if strings.HasPrefix(name, ".") || strings.HasSuffix(name, "~") || strings.HasSuffix(name, ".bak") || strings.HasSuffix(name, ".tmp") {
			continue
		}
		ext := strings.ToLower(filepath.Ext(name))
		if ext != ".yaml" && ext != ".yml" {
			continue
		}

		filePath := filepath.Join(dir, name)
		svcs, err := loadDropInFile(filePath)
		if err != nil {
			return nil, fmt.Errorf("loading drop-in %q: %w", name, err)
		}
		dropIns = append(dropIns, svcs...)
	}

	return dropIns, nil
}

type dropInWrapper struct {
	Services []ServiceConfig `yaml:"services"`
}

func loadDropInFile(filePath string) ([]ServiceConfig, error) {
	data, err := os.ReadFile(filePath)
	if err != nil {
		return nil, err
	}
	if len(strings.TrimSpace(string(data))) == 0 {
		return nil, nil
	}

	// 1. Try dropInWrapper { services: [...] }
	var wrapper dropInWrapper
	if err := yaml.Unmarshal(data, &wrapper); err == nil && len(wrapper.Services) > 0 {
		for i := range wrapper.Services {
			if err := wrapper.Services[i].Validate(); err != nil {
				return nil, fmt.Errorf("service %q: %w", wrapper.Services[i].ID, err)
			}
		}
		return wrapper.Services, nil
	}

	// 2. Try top-level slice []ServiceConfig
	var list []ServiceConfig
	if err := yaml.Unmarshal(data, &list); err == nil && len(list) > 0 {
		for i := range list {
			if err := list[i].Validate(); err != nil {
				return nil, fmt.Errorf("service %q: %w", list[i].ID, err)
			}
		}
		return list, nil
	}

	// 3. Try single ServiceConfig
	var single ServiceConfig
	if err := yaml.Unmarshal(data, &single); err == nil && single.ID != "" && single.Target != "" {
		if err := single.Validate(); err != nil {
			return nil, fmt.Errorf("service %q: %w", single.ID, err)
		}
		return []ServiceConfig{single}, nil
	}

	return nil, fmt.Errorf("unrecognized format: expected 'services:' list, a list of services, or a single service object")
}

// MergeServices combines base services with drop-ins.
// If a drop-in shares an ID with an existing service, the drop-in overrides it.
// If two services have distinct IDs but identical prefixes, an error is returned.
func MergeServices(base []ServiceConfig, dropIns []ServiceConfig) ([]ServiceConfig, error) {
	if len(dropIns) == 0 {
		return base, nil
	}

	merged := make([]ServiceConfig, 0, len(base)+len(dropIns))
	idIndex := make(map[string]int, len(base)+len(dropIns))

	for _, s := range base {
		idIndex[s.ID] = len(merged)
		merged = append(merged, s)
	}

	for _, s := range dropIns {
		if idx, exists := idIndex[s.ID]; exists {
			merged[idx] = s // override existing service by ID
		} else {
			idIndex[s.ID] = len(merged)
			merged = append(merged, s)
		}
	}

	// Validate prefix uniqueness across distinct services
	seenPrefixes := make(map[string]string, len(merged))
	for _, s := range merged {
		cleanPrefix := strings.TrimRight(s.Prefix, "/")
		if existingID, conflict := seenPrefixes[cleanPrefix]; conflict && existingID != s.ID {
			return nil, fmt.Errorf("service %q: prefix %q conflicts with service %q", s.ID, s.Prefix, existingID)
		}
		seenPrefixes[cleanPrefix] = s.ID
	}

	return merged, nil
}

// ResolveServicesDir determines the services.d directory path.
// If overrideDir is non-empty, it takes precedence.
// Next, cfgServicesDir from config is considered.
// If still empty and configPath is non-empty, <configDir>/services.d is checked.
func ResolveServicesDir(configPath, cfgServicesDir, overrideDir string) string {
	if overrideDir != "" {
		return overrideDir
	}
	if cfgServicesDir != "" {
		return cfgServicesDir
	}
	if configPath != "" {
		defaultDir := filepath.Join(filepath.Dir(configPath), "services.d")
		if info, err := os.Stat(defaultDir); err == nil && info.IsDir() {
			return defaultDir
		}
	}
	return ""
}
