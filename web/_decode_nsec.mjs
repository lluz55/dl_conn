// Standalone bech32 decode to inspect the nsec payload (no external deps).
const CHARSET = "qpyzrcgf398debflvkx0a6smt4ueh2jmnbvcxk";
const NSEC = "nsec1gccfk4suf25m4aarcgrl6uwf902whqkcuy85hdtdy264khr2rlnsrfn7kv";

function bech32Polymod(values) {
  const GEN = [0x3b6a37e, 0x274d616, 0x2b2f13a, 0x344b601, 0x33a3955, 0x2c9e2ce];
  let chk = 1;
  for (let v of values) {
    const b = chk >> 25;
    chk = ((chk & 0x1ffffff) << 5) ^ (v >>> 0);
    for (let i = 0; i < 6; ++i) {
      chk ^= GEN[i] * ((b >> (5 - i)) & 1 ? 1 : 0);
    }
  }
  return chk >>> 0;
}

function bech32HrpExpand(hrp) {
  const ret = [];
  for (let i = 0; i < hrp.length; ++i) ret.push(hrp.charCodeAt(i) >> 5);
  ret.push(0);
  for (let i = 0; i < hrp.length; ++i) ret.push(hrp.charCodeAt(i) & 31);
  return ret;
}

function bech32Decode(bech) {
  const pos = bech.lastIndexOf("1");
  const hrp = bech.slice(0, pos).toLowerCase();
  const data = bech.slice(pos + 1).toLowerCase();
  const values = [];
  for (const c of data) {
    const i = CHARSET.indexOf(c);
    if (i === -1) throw new Error("bad char " + c);
    values.push(i);
  }
  const spec = bech32Polymod([...bech32HrpExpand(hrp), ...values]);
  if (spec !== 1) throw new Error("checksum FAIL (spec=" + spec + ")");
  return { hrp, dataChars: data, dataBits: values.slice(0, values.length - 6) };
}

const dec = bech32Decode(NSEC);
const bits = dec.dataBits;
// Convert 5-bit groups -> 8-bit bytes
const bytes = [];
let acc = 0, bitsLeft = 0;
for (const v of bits) {
  acc = (acc << 5) | v;
  bitsLeft += 5;
  if (bitsLeft >= 8) {
    bitsLeft -= 8;
    bytes.push((acc >> bitsLeft) & 0xff);
  }
}
const hex = bytes.map(b => b.toString(16).padStart(2, "0")).join("");
console.log("hrp        :", dec.hrp);
console.log("data chars :", dec.dataChars.length, "=>", dec.dataChars);
console.log("decoded bytes:", bytes.length);
console.log("hex len     :", hex.length);
console.log("hex         :", hex);
console.log("is 32 bytes :", bytes.length === 32);
