package main

import (
	"fmt"
	"github.com/nbd-wtf/go-nostr/nip19"
)

func main() {
	in := "nsec1gccfk4suf25m4aarcgrl6uwf902whqkcuy85hdtdy264khr2rlnsrfn7kv"
	_, data, err := nip19.Decode(in)
	if err != nil {
		fmt.Println("decode error:", err)
		return
	}
	fmt.Printf("type: %T\n", data)
	switch v := data.(type) {
	case string:
		fmt.Printf("string len=%d\n", len(v))
		fmt.Printf("hex    = %s\n", v)
	case []byte:
		fmt.Printf("bytes len=%d\n", len(v))
		fmt.Printf("hex    = %x\n", v)
	}
}
