// Command hellosvc is a minimal standalone test server.
// It serves a "hello world" HTML page on 127.0.0.1:8373.
package main

import (
	"fmt"
	"log"
	"net/http"
)

const addr = "127.0.0.1:8373"

const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>hello world</title>
</head>
<body>
  <h1>hello world</h1>
</body>
</html>`

func main() {
	http.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		fmt.Fprint(w, html)
	})

	log.Printf("hello test service listening on http://%s", addr)
	if err := http.ListenAndServe(addr, nil); err != nil {
		log.Fatalf("server error: %v", err)
	}
}
