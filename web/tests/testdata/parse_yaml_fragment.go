//go:build ignore

// parse_yaml_fragment.go is a throwaway helper invoked via `go run` by
// web/tests/custom_services_tests.js (see runGoYamlParser there) to parse
// the exported "services:" YAML fragment with the daemon's own yaml.v3
// dependency (gopkg.in/yaml.v3, already a go.mod requirement — nothing new
// is added), instead of asserting on the fragment with substrings/regex.
// The `go:build ignore` tag keeps it out of `go build ./...`, `go vet ./...`
// and `go test ./...`; it only runs when explicitly invoked with `go run`.
package main

import (
	"encoding/json"
	"fmt"
	"os"

	"gopkg.in/yaml.v3"
)

type service struct {
	ID          string `yaml:"id"`
	Name        string `yaml:"name"`
	Icon        string `yaml:"icon"`
	Description string `yaml:"description"`
	Prefix      string `yaml:"prefix"`
	Target      string `yaml:"target"`
	StripPrefix bool   `yaml:"stripPrefix"`
	Websocket   bool   `yaml:"websocket"`
}

type document struct {
	Services []service `yaml:"services"`
}

func main() {
	if len(os.Args) != 2 {
		fmt.Fprintln(os.Stderr, "usage: go run parse_yaml_fragment.go <fragment.yaml>")
		os.Exit(2)
	}
	data, err := os.ReadFile(os.Args[1])
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	var d document
	if err := yaml.Unmarshal(data, &d); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	out, err := json.Marshal(d.Services)
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	fmt.Println(string(out))
}
