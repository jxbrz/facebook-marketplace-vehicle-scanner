const fs = require("node:fs");
const path = require("node:path");
const zlib = require("node:zlib");

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const name = Buffer.from(type);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(Buffer.concat([name, data])));
  return Buffer.concat([length, name, data, checksum]);
}

function insideRoundedSquare(x, y, size) {
  const padding = size * 0.125;
  const radius = size * 0.2;
  const left = padding;
  const right = size - padding;
  const top = padding;
  const bottom = size - padding;
  if (x >= left + radius && x <= right - radius && y >= top && y <= bottom) return true;
  if (y >= top + radius && y <= bottom - radius && x >= left && x <= right) return true;
  const corners = [[left + radius, top + radius], [right - radius, top + radius], [left + radius, bottom - radius], [right - radius, bottom - radius]];
  return corners.some(([cx, cy]) => (x - cx) ** 2 + (y - cy) ** 2 <= radius ** 2);
}

function paintIcon(size) {
  const pixels = Buffer.alloc(size * size * 4);
  const set = (x, y, color) => {
    if (x < 0 || y < 0 || x >= size || y >= size) return;
    const offset = (Math.floor(y) * size + Math.floor(x)) * 4;
    pixels.set(color, offset);
  };
  const fillRect = (left, top, right, bottom, color) => {
    for (let y = Math.floor(top); y < Math.ceil(bottom); y += 1) for (let x = Math.floor(left); x < Math.ceil(right); x += 1) set(x, y, color);
  };
  const fillCircle = (cx, cy, radius, color) => {
    for (let y = Math.floor(cy - radius); y <= Math.ceil(cy + radius); y += 1) for (let x = Math.floor(cx - radius); x <= Math.ceil(cx + radius); x += 1) if ((x - cx) ** 2 + (y - cy) ** 2 <= radius ** 2) set(x, y, color);
  };

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      if (!insideRoundedSquare(x + 0.5, y + 0.5, size)) continue;
      const blend = y / size;
      set(x, y, [Math.round(9 + 9 * blend), Math.round(28 + 22 * blend), Math.round(52 + 35 * blend), 255]);
    }
  }

  const blue = [66, 153, 225, 255];
  const pale = [232, 241, 250, 255];
  const dark = [8, 22, 38, 255];
  const beam = [52, 211, 153, 255];
  fillRect(size * 0.16, size * 0.24, size * 0.22, size * 0.76, beam);
  fillRect(size * 0.12, size * 0.31, size * 0.26, size * 0.35, beam);
  fillRect(size * 0.12, size * 0.65, size * 0.26, size * 0.69, beam);

  fillRect(size * 0.25, size * 0.5, size * 0.86, size * 0.7, blue);
  for (let y = Math.floor(size * 0.34); y < size * 0.52; y += 1) {
    const half = (y - size * 0.34) * 0.75;
    fillRect(size * 0.42 - half, y, size * 0.7 + half, y + 1, pale);
  }
  fillRect(size * 0.31, size * 0.54, size * 0.8, size * 0.61, pale);
  fillCircle(size * 0.38, size * 0.72, size * 0.1, dark);
  fillCircle(size * 0.75, size * 0.72, size * 0.1, dark);
  fillCircle(size * 0.38, size * 0.72, size * 0.045, pale);
  fillCircle(size * 0.75, size * 0.72, size * 0.045, pale);

  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y += 1) {
    const row = y * (size * 4 + 1);
    raw[row] = 0;
    pixels.copy(raw, row + 1, y * size * 4, (y + 1) * size * 4);
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header.set([8, 6, 0, 0, 0], 8);
  return Buffer.concat([Buffer.from("89504e470d0a1a0a", "hex"), chunk("IHDR", header), chunk("IDAT", zlib.deflateSync(raw, { level: 9 })), chunk("IEND", Buffer.alloc(0))]);
}

const directory = path.resolve("icons");
fs.mkdirSync(directory, { recursive: true });
for (const size of [16, 32, 48, 128]) fs.writeFileSync(path.join(directory, `icon-${size}.png`), paintIcon(size));
console.log("Generated local extension icons: 16, 32, 48 and 128 px");
