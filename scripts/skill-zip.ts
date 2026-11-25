// lede-skill.zip, the skill as Claude.ai and Claude Desktop take it (Customize, Skills, Upload a skill): every file under
// skill/lede/, stored under one top folder `lede/` (D87). semantic-release builds it in the exec plugin's `prepareCmd` and the
// github plugin attaches it to the GitHub release (.releaserc.json), so each release carries the skill of its own commit and
// https://github.com/lede-lang/lede/releases/latest/download/lede-skill.zip always names the newest one.
//   node scripts/skill-zip.ts <out.zip>      run from anywhere; reads skill/lede/ from this checkout
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { crc32 } from 'node:zlib';
import { root } from './pack.ts';

export interface ZipEntry {
  name: string;
  data: Buffer;
}

/** Every file under `dir`, named relative to it in `/` form, in code-point order. */
export function readTree(dir: string): ZipEntry[] {
  const out: ZipEntry[] = [];
  const visit = (rel: string) => {
    for (const e of readdirSync(join(dir, rel), { withFileTypes: true })) {
      const name = rel === '' ? e.name : `${rel}/${e.name}`;
      if (e.isDirectory()) visit(name);
      else if (e.isFile()) out.push({ name, data: readFileSync(join(dir, name)) });
    }
  };
  visit('');
  return out.toSorted((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}

/**
 * A zip of `files`, stored (no compression) with a fixed 1980-01-01 timestamp, so the same files give the same bytes and two
 * releases with an unchanged skill attach identical zips.
 */
export function storedZip(files: readonly ZipEntry[]): Buffer {
  const local: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const { name, data } of files) {
    const n = Buffer.from(name, 'utf8');
    const crc = crc32(data);
    const head = Buffer.alloc(30);
    head.writeUInt32LE(0x04034b50, 0);
    head.writeUInt16LE(20, 4); // version needed
    head.writeUInt16LE(0x0800, 6); // names are UTF-8
    head.writeUInt16LE(0x21, 12); // date 1980-01-01; method (8) and time (10) stay 0: stored, 00:00
    head.writeUInt32LE(crc, 14);
    head.writeUInt32LE(data.length, 18);
    head.writeUInt32LE(data.length, 22);
    head.writeUInt16LE(n.length, 26);
    local.push(head, n, data);
    const dir = Buffer.alloc(46);
    dir.writeUInt32LE(0x02014b50, 0);
    dir.writeUInt16LE(0x0314, 4); // made by: Unix, 2.0
    dir.writeUInt16LE(20, 6);
    dir.writeUInt16LE(0x0800, 8);
    dir.writeUInt16LE(0x21, 14);
    dir.writeUInt32LE(crc, 16);
    dir.writeUInt32LE(data.length, 20);
    dir.writeUInt32LE(data.length, 24);
    dir.writeUInt16LE(n.length, 28);
    dir.writeUInt32LE((0o100644 << 16) >>> 0, 38); // a regular file, rw-r--r--
    dir.writeUInt32LE(offset, 42);
    central.push(dir, n);
    offset += head.length + n.length + data.length;
  }
  const size = central.reduce((s, b) => s + b.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(size, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, ...central, end]);
}

/** The skill zip for this checkout: skill/lede/ under `lede/`. */
export function skillZip(): Buffer {
  return storedZip(readTree(join(root, 'skill', 'lede')).map(({ name, data }) => ({ name: `lede/${name}`, data })));
}

if (import.meta.main) {
  const out = process.argv[2];
  if (!out) throw new Error('usage: node scripts/skill-zip.ts <out.zip>');
  const path = resolve(out);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, skillZip());
  console.log(`wrote ${path}`);
}
