import { readFileSync, writeFileSync } from 'node:fs';
import { harnessPdfBytes } from '../src/export/pdf';
const kit = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const h = kit.harnesses.find((x: any) => /결제단말기 MDB/.test(x.name)) ?? kit.harnesses[0];
console.log('하네스:', h.name, '· 배선', h.wires.length);
const bytes = harnessPdfBytes(h);
writeFileSync(process.argv[3], Buffer.from(bytes));
console.log('→', process.argv[3]);
