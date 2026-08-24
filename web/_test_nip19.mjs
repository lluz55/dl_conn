import * as nostrTools from 'https://esm.sh/nostr-tools@2.9.2';

const nsec = "nsec1gccfk4suf25m4aarcgrl6uwf902whqkcuy85hdtdy264khr2rlnsrfn7kv";
try {
  const decoded = nostrTools.nip19.decode(nsec);
  console.log("type:", decoded.type);
  console.log("data type:", typeof decoded.data, Array.isArray(decoded.data) ? "array" : "");
  console.log("data:", decoded.data);
  if (typeof decoded.data === "string") {
    console.log("hex len:", decoded.data.length);
  }
  if (decoded.data instanceof Uint8Array) {
    console.log("bytes len:", decoded.data.length);
      const hex = Array.from(decoded.data).map(b => b.toString(16).padStart(2,'0')).join('');
      console.log("hex from bytes:", hex, "len", hex.length);
  }
} catch (e) {
  console.log("decode threw:", e.message);
}
