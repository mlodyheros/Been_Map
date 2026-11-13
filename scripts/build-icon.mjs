// Draws public/apple-touch-icon.png (a globe with one marked patch) without any image library.
import { deflateSync } from 'node:zlib'
import { writeFileSync } from 'node:fs'

const SIZE = 180
const SS = 4 // supersampling per axis
const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16))
const INK = hex('#141833')
const SEA = hex('#2F45E0')
const LAND = hex('#F8F4EA')
const MARK = hex('#FF5A36')

const inCircle = (x, y, cx, cy, r) => (x - cx) ** 2 + (y - cy) ** 2 <= r * r
function colorAt(x, y) {
  if (!inCircle(x, y, 90, 90, 62)) return INK
  if (inCircle(x, y, 104, 74, 22)) return MARK
  if (inCircle(x, y, 70, 82, 30) || inCircle(x, y, 100, 112, 26) || inCircle(x, y, 112, 70, 30)) return LAND
  return SEA
}

const raw = Buffer.alloc(SIZE * (SIZE * 3 + 1))
for (let y = 0; y < SIZE; y++) {
  for (let x = 0; x < SIZE; x++) {
    const sum = [0, 0, 0]
    for (let i = 0; i < SS; i++)
      for (let j = 0; j < SS; j++) {
        const c = colorAt(x + (i + 0.5) / SS, y + (j + 0.5) / SS)
        for (let k = 0; k < 3; k++) sum[k] += c[k]
      }
    const at = y * (SIZE * 3 + 1) + 1 + x * 3
    for (let k = 0; k < 3; k++) raw[at + k] = Math.round(sum[k] / (SS * SS))
  }
}

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c >>> 0
})
const crc = (buf) => {
  let c = 0xffffffff
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}
const chunk = (type, data) => {
  const body = Buffer.concat([Buffer.from(type), data])
  const out = Buffer.alloc(body.length + 8)
  out.writeUInt32BE(data.length, 0)
  body.copy(out, 4)
  out.writeUInt32BE(crc(body), body.length + 4)
  return out
}

const header = Buffer.alloc(13)
header.writeUInt32BE(SIZE, 0)
header.writeUInt32BE(SIZE, 4)
header.set([8, 2, 0, 0, 0], 8) // 8-bit RGB

writeFileSync(
  new URL('../public/apple-touch-icon.png', import.meta.url),
  Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]),
)
