/**
 * 내보내기 — 미리보기와 실제 산출물이 같은지 못 박는 회귀 시험.
 *
 * 실사용에서 두 가지가 터졌다.
 *  1) 세트 전체 27개 중 **1개만** 받아졌다. 브라우저가 연속 다운로드를 막는데
 *     툴은 모른 채 조용히 넘어갔다.
 *  2) 대화상자 목록은 `..._접속표_RevA.csv`, 실제 파일은 `..._접속표.csv` 였다.
 *     미리보기가 거짓말을 했다.
 *
 * 그래서 여기서는 **대화상자에 실제로 그려진 파일명**을 읽어, 그 계획으로 만든
 * 바이트를 ZIP 으로 접은 뒤 **ZIP 을 다시 파싱해** 이름·개수를 맞춰 본다.
 * 중간의 어느 한쪽만 고쳐도 이 시험이 깨진다.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup, within } from '@testing-library/react';
import type { HarnessDocument, KitDocument, PartLibraryItem } from '../types';
import { ExportDialog, type ExportPlan } from './ExportDialog';
import { buildExportEntries, packForDownload } from './bundle';
import { zipFileName } from './exportPlan';
import { crc32 } from './zip';

/** jspdf 를 태우지 않는다 — 여기서 볼 것은 도면 내용이 아니라 봉투와 이름이다 */
vi.mock('./pdf', () => ({
  harnessPdfBytes: (doc: HarnessDocument) =>
    new TextEncoder().encode(`%PDF-1.4 ${doc.id}`),
}));

afterEach(cleanup);

const housing: PartLibraryItem = {
  id: 'h4', category: 'housing', name: '테스트 하우징 4P', pinCount: 4, spec: { 터미널: 'TST-T' },
};

function makeHarness(id: string, letter: string, wireCount: number): HarnessDocument {
  const pins = [1, 2, 3, 4].map((i) => ({ id: `${id}-p${i}`, index: i, label: String(i) }));
  return {
    schemaVersion: 1,
    id,
    name: `하네스 ${letter}`,
    createdAt: '2026-08-12T00:00:00Z',
    updatedAt: '2026-08-12T00:00:00Z',
    letter,
    connectors: [{
      id: `${id}-c1`, kind: 'connector', housingId: 'h4', orientation: 0,
      positions: { logical: { x: 0, y: 0 } }, pins,
    }],
    devices: [{
      id: `${id}-d1`, name: '장치', terminals: ['T1', 'T2', 'T3', 'T4'],
      positions: { logical: { x: 200, y: 0 } },
    }],
    wires: Array.from({ length: wireCount }, (_, i) => ({
      id: `${id}-w${i + 1}`,
      from: { type: 'pin' as const, connectorId: `${id}-c1`, pinId: `${id}-p${(i % 4) + 1}` },
      to: { type: 'device' as const, deviceId: `${id}-d1`, terminal: `T${(i % 4) + 1}` },
      color: { base: 'black' },
      gauge: { system: 'awg' as const, value: 22 },
      lengthMm: 100 + i,
    })),
    usedParts: [housing],
  };
}

/** 실사용과 같은 규모 — 하네스 9종 */
function makeKit(): KitDocument {
  const harnesses = Array.from({ length: 9 }, (_, i) =>
    makeHarness(`h${i}`, String.fromCharCode(65 + i), 2 + i));
  return {
    schemaVersion: 2,
    id: 'kit-1',
    name: 'EV 충전기 하네스 세트',
    createdAt: '2026-08-12T00:00:00Z',
    updatedAt: '2026-08-12T00:00:00Z',
    harnesses,
    set: {
      id: 'set-1', pn: 'EW-EVC-KIT-01', name: 'EV 충전기 하네스 세트', rev: 'A',
      items: harnesses.map((h) => ({ harnessId: h.id, perSet: 1 })),
      orderQty: 3,
    },
  };
}

// ── ZIP 되읽기 (쓰기 코드와 독립적인 파서) ────────────────────────────────
type ReadEntry = { name: string; flags: number; method: number; crc: number; data: Uint8Array };

function readZip(buf: Uint8Array): ReadEntry[] {
  const v = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  // EOCD 를 뒤에서 찾는다
  let eo = -1;
  for (let i = buf.length - 22; i >= 0; i -= 1) {
    if (v.getUint32(i, true) === 0x06054b50) { eo = i; break; }
  }
  if (eo < 0) throw new Error('EOCD 없음');
  const count = v.getUint16(eo + 10, true);
  let p = v.getUint32(eo + 16, true);

  const dec = new TextDecoder('utf-8', { fatal: true });
  const out: ReadEntry[] = [];
  for (let i = 0; i < count; i += 1) {
    if (v.getUint32(p, true) !== 0x02014b50) throw new Error('중앙 디렉터리 서명 불일치');
    const flags = v.getUint16(p + 8, true);
    const method = v.getUint16(p + 10, true);
    const crc = v.getUint32(p + 16, true);
    const size = v.getUint32(p + 24, true);
    const nameLen = v.getUint16(p + 28, true);
    const extraLen = v.getUint16(p + 30, true);
    const cmtLen = v.getUint16(p + 32, true);
    const local = v.getUint32(p + 42, true);
    const name = dec.decode(buf.subarray(p + 46, p + 46 + nameLen));

    // 로컬 헤더에서 실제 바이트를 꺼낸다
    if (v.getUint32(local, true) !== 0x04034b50) throw new Error('로컬 헤더 서명 불일치');
    const lNameLen = v.getUint16(local + 26, true);
    const lExtraLen = v.getUint16(local + 28, true);
    const start = local + 30 + lNameLen + lExtraLen;
    out.push({ name, flags, method, crc, data: buf.subarray(start, start + size) });
    p += 46 + nameLen + extraLen + cmtLen;
  }
  return out;
}

/** 대화상자에 그려진 파일명들 (kind 칩을 뺀 순수 이름) */
const previewNames = () =>
  within(screen.getByLabelText('나올 파일'))
    .getAllByRole('listitem')
    .map((li) => li.querySelector('.ex-file-name')?.textContent ?? '');

/** 대화상자를 열고 세트 전체를 골라 내보내기를 누른 뒤 넘어온 plan */
function planForWholeSet(kit: KitDocument): { plan: ExportPlan; preview: string[] } {
  const onExport = vi.fn();
  render(
    <ExportDialog kit={kit} activeHarnessId="h0" onCancel={vi.fn()} onExport={onExport} />,
  );
  fireEvent.click(screen.getByRole('button', { name: /^세트 전체/ }));
  const preview = previewNames();
  fireEvent.click(screen.getByRole('button', { name: '내보내기' }));
  return { plan: onExport.mock.calls[0][0] as ExportPlan, preview };
}

describe('세트 내보내기 — 봉투 하나로', () => {
  it('세트 9종은 27개 파일을 예고하고, 그 27개가 ZIP 하나에 그대로 들어간다', async () => {
    const kit = makeKit();
    const { plan, preview } = planForWholeSet(kit);
    expect(preview).toHaveLength(27);            // 도면 9 + 접속표 9 + 파트리스트 9

    const entries = await buildExportEntries(kit, plan);
    const one = packForDownload(entries, zipFileName(kit));

    // 내려받는 실물은 **하나**다 — 연속 다운로드 차단을 만나지 않는다
    expect(one.name).toBe('EW-EVC-KIT-01_RevA.zip');
    expect(one.mime).toBe('application/zip');

    const inZip = readZip(one.data);
    expect(inZip).toHaveLength(preview.length);
    // 이것이 이번 결함이다: 미리보기 이름과 실제 파일명이 **완전히** 같아야 한다
    expect(inZip.map((e) => e.name)).toEqual(preview);
  });

  it('미리보기 이름에는 Rev 가 들어 있고 실제 항목 이름도 같다', async () => {
    const kit = makeKit();
    const { plan, preview } = planForWholeSet(kit);
    expect(preview[0]).toBe('EW-EVC-KIT-01_A_도면_RevA.pdf');
    expect(preview[1]).toBe('EW-EVC-KIT-01_A_접속표_RevA.csv');
    expect(preview[2]).toBe('EW-EVC-KIT-01_A_파트리스트_RevA.csv');

    const inZip = readZip(packForDownload(await buildExportEntries(kit, plan), zipFileName(kit)).data);
    expect(inZip[1].name).toBe('EW-EVC-KIT-01_A_접속표_RevA.csv');
    // Rev 가 빠진 옛 이름은 더 이상 나오지 않는다
    expect(inZip.some((e) => e.name === 'EW-EVC-KIT-01_A_접속표.csv')).toBe(false);
  });

  it('한글 이름은 UTF-8 로 들어가고 EFS(bit 11) 가 서 있다', async () => {
    const kit = makeKit();
    const { plan } = planForWholeSet(kit);
    const inZip = readZip(packForDownload(await buildExportEntries(kit, plan), zipFileName(kit)).data);
    for (const e of inZip) {
      expect(e.flags & 0x0800).toBe(0x0800);   // 없으면 Windows 에서 이름이 깨진다
      expect(e.method).toBe(0);                // 무압축(store)
    }
    expect(inZip.map((e) => e.name)).toContain('EW-EVC-KIT-01_C_파트리스트_RevA.csv');
  });

  it('항목 CRC 와 바이트가 원본과 맞는다', async () => {
    const kit = makeKit();
    const { plan } = planForWholeSet(kit);
    const entries = await buildExportEntries(kit, plan);
    const inZip = readZip(packForDownload(entries, zipFileName(kit)).data);
    entries.forEach((src, i) => {
      expect(inZip[i].crc).toBe(crc32(src.data));
      expect(Array.from(inZip[i].data)).toEqual(Array.from(src.data));
    });
  });

  it('파일이 하나뿐이면 ZIP 을 만들지 않는다', async () => {
    const kit = makeKit();
    const onExport = vi.fn();
    render(
      <ExportDialog kit={kit} activeHarnessId="h0" onCancel={vi.fn()} onExport={onExport} />,
    );
    // 하네스 A · 접속표 CSV 하나만 남긴다
    fireEvent.click(screen.getByRole('checkbox', { name: '도면 PDF' }));
    fireEvent.click(screen.getByRole('checkbox', { name: '파트리스트 CSV' }));
    const preview = previewNames();
    expect(preview).toEqual(['EW-EVC-KIT-01_A_접속표_RevA.csv']);
    fireEvent.click(screen.getByRole('button', { name: '내보내기' }));

    const plan = onExport.mock.calls[0][0] as ExportPlan;
    const one = packForDownload(await buildExportEntries(kit, plan), zipFileName(kit));
    expect(one.name).toBe('EW-EVC-KIT-01_A_접속표_RevA.csv');
    expect(one.mime).toBe('text/csv;charset=utf-8;');
    expect(one.name.endsWith('.zip')).toBe(false);
  });

  it('미리보기에 있는 BOM · 문서 JSON 도 실제로 만들어진다', async () => {
    const kit = makeKit();
    const onExport = vi.fn();
    render(
      <ExportDialog kit={kit} activeHarnessId="h0" onCancel={vi.fn()} onExport={onExport} />,
    );
    for (const n of ['도면 PDF', '접속표 CSV', '파트리스트 CSV', '하네스 BOM CSV', '문서 JSON']) {
      fireEvent.click(screen.getByRole('checkbox', { name: n }));
    }
    const preview = previewNames();
    expect(preview).toEqual([
      'EW-EVC-KIT-01_하네스BOM_RevA.csv',
      'EW-EVC-KIT-01_문서_RevA.json',
    ]);
    fireEvent.click(screen.getByRole('button', { name: '내보내기' }));

    const plan = onExport.mock.calls[0][0] as ExportPlan;
    const entries = await buildExportEntries(kit, plan, { docJson: () => '{"ok":true}' });
    expect(entries.map((e) => e.name)).toEqual(preview);
    const bom = new TextDecoder().decode(entries[0].data);
    expect(bom.split('\n')[0]).toBe('letter,drawing_no,name,per_set,order_qty,total_qty');
    expect(bom.split('\n')).toHaveLength(10);   // 머리글 + 9종
    expect(bom).toContain(',1,3,3');            // 세트당 1 × 3세트 = 3
  });

  it('실패하면 조용히 넘어가지 않고 어느 파일인지 밝힌다', async () => {
    const kit = makeKit();
    const { plan } = planForWholeSet(kit);
    // 문서 JSON 을 요구해 놓고 본문을 주지 않은 상황
    const broken: ExportPlan = {
      ...plan,
      files: [{ kind: 'JSON', name: 'X_문서_RevA.json', source: { of: 'json' } }],
    };
    await expect(buildExportEntries(kit, broken)).rejects.toThrow(/X_문서_RevA\.json/);
  });
});
