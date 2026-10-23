// Shared builders for the coach's backend tests. They are plain functions with no Worker and no I/O (no
// "cloudflare:test"), so the plain-Node tests, the Vitest specs and the browser tests' fake AI can all import them.
//
//   jpegB64({w, h, progressive, app})   a JPEG as base64 text, the way the phone sends a key frame

const u16 = (n) => [n >> 8, n & 255];

// One JPEG segment: FF, the marker, the length (which counts its own two bytes), then the payload.
const segment = (marker, payload) => [0xff, marker, ...u16(payload.length + 2), ...payload];

const APP_MAX = 65_533; // the most one APPn segment can hold: the length field is 16 bits and counts itself

// A JPEG with a real header and a tiny scan: SOI, the APPn segments asked for, one quantisation table, the frame header
// (SOF0, or SOF2 when progressive) saying w x h, the two smallest Huffman tables, the scan header, 8 bytes of scan and
// EOI. The scan is not the whole picture, so a viewer shows grey or nothing, but every segment is well formed, which is
// all the frame check reads.
//
//   w, h         the size the frame header says (default 784 x 784, the size the phone sends)
//   progressive  SOF2 and a progressive scan header instead of SOF0
//   app          the payload size in bytes of each APPn segment, in order, put before the frame header (a phone's
//                EXIF, ICC and the like); a size is 0 to 65,533
export function jpegB64({ w = 784, h = 784, progressive = false, app = [] } = {}) {
  for (const size of app) {
    if (!Number.isInteger(size) || size < 0 || size > APP_MAX) throw new RangeError("app size " + size);
  }
  for (const side of [w, h]) {
    if (!Number.isInteger(side) || side < 1 || side > 65_535) throw new RangeError("side " + side);
  }
  const bytes = [0xff, 0xd8]; // SOI
  // One byte at a time: push(...big) would pass 65,000 arguments.
  const add = (list) => { for (const b of list) bytes.push(b); };
  app.forEach((size, i) => add(segment(0xe0 + (i % 16), new Array(size).fill(0))));
  add(segment(0xdb, [0, ...new Array(64).fill(1)])); // DQT: table 0, 8-bit, all ones
  add(segment(progressive ? 0xc2 : 0xc0, [8, ...u16(h), ...u16(w), 1, 1, 0x11, 0])); // SOF: 8-bit, one component
  add(segment(0xc4, [0x00, 1, ...new Array(15).fill(0), 0x00])); // DHT: DC table 0, one 1-bit code
  add(segment(0xc4, [0x10, 1, ...new Array(15).fill(0), 0x00])); // DHT: AC table 0, one 1-bit code
  add(segment(0xda, [1, 1, 0x00, ...(progressive ? [0, 0, 0] : [0, 63, 0])])); // SOS: DC first scan if progressive
  add([0, 0, 0, 0, 0, 0, 0, 0]); // the scan
  add([0xff, 0xd9]); // EOI
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}
