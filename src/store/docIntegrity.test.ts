/**
 * 문서 왕복(export → import) · 마이그레이션 · 깨진 입력 회귀 시험.
 *
 * 여기 있는 입력은 전부 **실제로 앱을 망가뜨렸던 것**을 그대로 옮긴 것이다.
 * 백엔드가 없어 JSON 파일 하나가 유일한 원본이므로, 왕복에서 필드가 하나라도
 * 바뀌면 그건 곧 발주 도면이 바뀌는 것이다.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { useHarnessStore } from './harnessStore';
import {
  parseDocument, saveKit, loadSavedKit, emptyDoc,
  setStorageProblemHandler, resetStorageProblems, type StorageProblem,
} from './persistence';
import { validateHarness } from './validate';
import { toKit } from './kit';
import { loadCustomParts, saveCustomParts, mergeDocumentParts } from '../library/customParts';
import type { HarnessDocument, KitDocument, PartLibraryItem } from '../types';

const S = () => useHarnessStore.getState();

const mem = new Map<string, string>();
beforeEach(() => {
  mem.clear();
  resetStorageProblems();
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => mem.get(k) ?? null,
    setItem: (k: string, v: string) => void mem.set(k, v),
    removeItem: (k: string) => void mem.delete(k),
  });
});
afterEach(() => resetStorageProblems());

/** 계약의 모든 갈래가 한 번씩 들어간 문서 (커넥터·스플라이스 브리지·장치·케이블·터미널) */
function richHarness(over: Partial<HarnessDocument> = {}): HarnessDocument {
  return {
    schemaVersion: 1,
    id: 'hrn-1',
    name: '전원 하네스',
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-02T00:00:00Z',
    drawingNo: 'HN-001',
    rev: 'B',
    letter: 'A',
    connectors: [
      {
        id: 'con-a', kind: 'connector', housingId: 'lib-xh-4p', orientation: 90,
        positions: { logical: { x: 10, y: 20 }, physical: { x: 30, y: 40 } },
        pins: [
          { id: 'a1', index: 1, label: 'P1', terminalId: 'lib-term' },
          { id: 'a2', index: 2, terminalId: 'lib-term' },
        ],
        note: '커넥터 메모',
      },
      {
        id: 'sp-1', kind: 'splice', housingId: 'lib-splice', orientation: 270,
        positions: { logical: { x: 100, y: 100 } },
        pins: [{ id: 's1', index: 1 }, { id: 's2', index: 2 }, { id: 's3', index: 3 }],
        bridges: [['s1', 's2', 's3']],
      },
    ],
    devices: [{
      id: 'dev-1', name: 'PSU', terminals: ['+24V', 'GND'],
      positions: { logical: { x: 5, y: 6 }, physical: { x: 7, y: 8 } }, note: '장치 메모',
    }],
    wires: [
      {
        id: 'w1',
        from: { type: 'pin', connectorId: 'con-a', pinId: 'a1' },
        to: { type: 'pin', connectorId: 'sp-1', pinId: 's1' },
        color: { base: 'red', stripe: 'white' }, gauge: { system: 'awg', value: 22 },
        lengthMm: 300, label: 'L1',
      },
      {
        id: 'w2',
        from: { type: 'pin', connectorId: 'sp-1', pinId: 's2' },
        to: { type: 'device', deviceId: 'dev-1', terminal: '+24V' },
        color: { base: 'black' }, gauge: { system: 'mm2', value: 0.5 },
        cableId: 'cab-1',
      },
    ],
    cables: [{
      id: 'cab-1', name: '2C 케이블', coreCount: 2,
      gauge: { system: 'mm2', value: 0.5 }, jacketColor: 'gray', lengthMm: 500,
    }],
    usedParts: [
      {
        id: 'lib-xh-4p', category: 'housing', name: 'XH 4P', manufacturer: 'JST', mpn: 'XHP-4',
        gender: 'receptacle', pinCount: 4, spec: { 피치: '2.5mm' },
        pinLayout: [{ index: 1, label: '1', offset: { x: 0, y: 0 }, signal: 'V', stdColor: 'red' }],
      },
      { id: 'lib-splice', category: 'splice', name: '스플라이스', gender: 'neutral', pinCount: 3 },
      { id: 'lib-term', category: 'terminal', name: 'SXH-001T', gender: 'neutral' },
    ],
    ...over,
  };
}

function richKit(): KitDocument {
  const h1 = richHarness();
  const h2 = richHarness({ id: 'hrn-2', name: '신호 하네스', letter: 'B', drawingNo: 'HN-002' });
  return {
    schemaVersion: 2, id: 'kit-1', name: '자판기 세트',
    createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-03T00:00:00Z',
    harnesses: [h1, h2],
    set: {
      id: 'set-1', pn: 'KIT-2408', name: '자판기 세트', rev: 'C',
      items: [{ harnessId: 'hrn-1', perSet: 2 }, { harnessId: 'hrn-2', perSet: 3 }],
      orderQty: 5,
    },
  };
}

// ================================================================
// 1. 왕복 무결성
// ================================================================
describe('왕복 무결성 — export → import', () => {
  it('세트 전체가 필드 하나까지 그대로 돌아온다', () => {
    const before = richKit();
    S().replaceKit(before);
    const json = S().exportJson();

    // 상태를 흔들어 둔다 — 남아 있던 값이 통과시켜 주는 일이 없도록
    S().replaceKit(toKit(emptyDoc()));
    S().importJson(json);

    expect(S().kit).toEqual(before);
  });

  it('세트 수정시각이 활성 하네스의 시각으로 되감기지 않는다', () => {
    // kit(1/03) 이 harness(1/02) 보다 새것이다. 내보내기가 시각을 되돌리면
    // 파일 두 개를 놓고 어느 쪽이 최신인지 알 수 없어진다.
    const before = richKit();
    S().replaceKit(before);
    const out = JSON.parse(S().exportJson()) as KitDocument;
    expect(out.updatedAt).toBe('2026-01-03T00:00:00Z');
  });

  it('하네스별 수량(perSet)·주문 세트 수(orderQty)가 살아남는다', () => {
    S().replaceKit(richKit());
    S().importJson(S().exportJson());
    expect(S().kit.set.items).toEqual([
      { harnessId: 'hrn-1', perSet: 2 },
      { harnessId: 'hrn-2', perSet: 3 },
    ]);
    expect(S().kit.set.orderQty).toBe(5);
  });

  it('노드 좌표는 논리·물리가 서로 섞이지 않는다', () => {
    S().replaceKit(richKit());
    S().importJson(S().exportJson());
    const c = S().kit.harnesses[0].connectors[0];
    expect(c.positions).toEqual({ logical: { x: 10, y: 20 }, physical: { x: 30, y: 40 } });
    // 물리 좌표가 없던 스플라이스는 없는 채로 남아야 한다 (0,0 으로 채우면 도면이 겹친다)
    expect(S().kit.harnesses[0].connectors[1].positions.physical).toBeUndefined();
  });

  it('스플라이스 브리지·케이블 소속·터미널 지정이 유지된다', () => {
    S().replaceKit(richKit());
    S().importJson(S().exportJson());
    const h = S().kit.harnesses[0];
    expect(h.connectors[1].bridges).toEqual([['s1', 's2', 's3']]);
    expect(h.wires[1].cableId).toBe('cab-1');
    expect(h.connectors[0].pins[0].terminalId).toBe('lib-term');
    expect(h.cables).toHaveLength(1);
  });

  it('한 번 왕복한 뒤로는 파일이 한 글자도 바뀌지 않는다 (고정점)', () => {
    // 열 때마다 파일이 조금씩 달라지면 형상관리에서 무엇이 바뀌었는지 못 읽는다.
    S().replaceKit(richKit());
    S().importJson(S().exportJson());
    const first = S().exportJson();
    S().importJson(first);
    expect(S().exportJson()).toBe(first);
  });

  /**
   * '새 문서' 회귀.
   * replaceDoc 은 doc 자리만 바꿨고 내보내기·자동저장은 kit 만 봤다. 그래서
   * 새 문서로 시작해 한나절 작업한 내용이 JSON 저장에서 통째로 빠졌다.
   */
  it('새 문서로 바꾼 뒤 작업한 내용이 내보내기에 들어 있다', () => {
    S().replaceKit(richKit());
    S().replaceDoc(emptyDoc());
    S().rename('내가 방금 만든 하네스');

    const out = JSON.parse(S().exportJson()) as KitDocument;
    expect(out.harnesses).toHaveLength(1);
    expect(out.harnesses[0].name).toBe('내가 방금 만든 하네스');
    expect(out.set.items).toEqual([{ harnessId: out.harnesses[0].id, perSet: 1 }]);
  });

  it('새 문서로 바꾸면 자동저장에도 그 문서가 담긴다', () => {
    S().replaceKit(richKit());
    S().replaceDoc(emptyDoc());
    S().rename('자동저장 확인');
    saveKit(S().kit);
    expect(loadSavedKit()?.harnesses[0].name).toBe('자동저장 확인');
  });
});

// ================================================================
// 2. 마이그레이션
// ================================================================
describe('마이그레이션', () => {
  it('v1(단일 하네스) 문서를 열면 v2 세트로 올라간다', () => {
    const r = parseDocument(JSON.stringify(richHarness()));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.kit.schemaVersion).toBe(2);
    expect(r.kit.harnesses).toHaveLength(1);
    expect(r.kit.harnesses[0].drawingNo).toBe('HN-001');
    expect(r.kit.harnesses[0].rev).toBe('B');
    expect(r.kit.set.items).toEqual([{ harnessId: 'hrn-1', perSet: 1 }]);
    expect(r.kit.set.orderQty).toBe(1);
  });

  it('도번·Rev·gender·cableId 가 없던 옛 문서도 그대로 열린다', () => {
    const old: Record<string, unknown> = {
      schemaVersion: 1, id: 'old-1', name: '옛 하네스',
      createdAt: '2025-01-01T00:00:00Z', updatedAt: '2025-01-01T00:00:00Z',
      connectors: [{
        id: 'c1', kind: 'connector', housingId: 'lib-xh-4p',
        orientation: 0, positions: {}, pins: [{ id: 'p1', index: 1 }],
      }],
      devices: [],
      wires: [{
        id: 'w1',
        from: { type: 'pin', connectorId: 'c1', pinId: 'p1' },
        to: { type: 'device', deviceId: 'd1' },
        color: { base: 'red' }, gauge: { system: 'awg', value: 22 },
      }],
      usedParts: [{ id: 'lib-xh-4p', category: 'housing', name: 'XH 4P' }],
    };
    const r = parseDocument(JSON.stringify(old));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const h = r.kit.harnesses[0];
    // 없는 선택 필드는 **채우지 않는다** — 빈 값을 지어내면 제목블록이 거짓말을 한다
    expect(h.drawingNo).toBeUndefined();
    expect(h.rev).toBeUndefined();
    expect(h.usedParts[0].gender).toBeUndefined();
    expect(h.wires[0].cableId).toBeUndefined();
    // 세트 문자는 없으면 붙여 준다 (없으면 발주 문구가 '?' 로 나간다)
    expect(h.letter).toBe('A');
    expect(h.cables).toEqual([]);
  });

  /**
   * 미래 버전 회귀.
   * 예전에는 `isKit()` 이 schemaVersion===2 만 봐서 v3 을 v1 하네스로 오해했고,
   * 세트 안에 통째로 말아넣은 뒤 v2 로 다시 저장해 원본을 되돌릴 수 없게 만들었다.
   */
  it('더 높은 버전의 문서는 거부하고 이유를 말한다', () => {
    const future = { ...richKit(), schemaVersion: 3 };
    const r = parseDocument(JSON.stringify(future));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toContain('v3');
  });

  it('미래 버전을 importJson 에 넣어도 현재 문서를 건드리지 않는다', () => {
    S().replaceKit(richKit());
    const keep = S().kit;
    expect(() => S().importJson(JSON.stringify({ ...richKit(), schemaVersion: 9 }))).toThrow();
    expect(S().kit).toBe(keep);
  });
});

// ================================================================
// 3. 깨진 입력
// ================================================================
describe('깨진 입력', () => {
  const rejected: [string, string][] = [
    ['JSON 이 아닌 파일', 'name,category\nXH 4P,housing'],
    ['빈 파일', ''],
    ['공백만', '   \n '],
    ['null', 'null'],
    ['숫자 하나', '42'],
    ['배열', '[]'],
    ['schemaVersion 없음', '{"id":"x","name":"y"}'],
    ['하네스가 없는 세트', '{"schemaVersion":2,"id":"k","name":"n","createdAt":"","updatedAt":"","harnesses":[]}'],
    ['harnesses 가 배열이 아님', '{"schemaVersion":2,"id":"k","name":"n","createdAt":"","updatedAt":"","harnesses":{}}'],
  ];

  for (const [label, text] of rejected) {
    it(`${label} → 거부하고 이유를 남긴다`, () => {
      const r = parseDocument(text);
      expect(r.ok).toBe(false);
      if (r.ok) return;
      expect(r.reason.length).toBeGreaterThan(4);
    });
  }

  it('거부된 파일은 현재 작업을 덮어쓰지 않는다', () => {
    S().replaceKit(richKit());
    const keep = S().kit;
    for (const [, text] of rejected) {
      expect(() => S().importJson(text)).toThrow();
    }
    expect(S().kit).toBe(keep);
  });

  /**
   * 예전에는 이 문서가 **오류 없이** 통과했고 doc.connectors 가 undefined 인 채
   * 앱에 들어가 다음 렌더에서 화면이 백지가 됐다.
   */
  it('필수 목록이 빠진 문서는 빈 목록으로 채우고 무엇을 채웠는지 알린다', () => {
    const r = parseDocument(JSON.stringify({
      schemaVersion: 1, id: 'd', name: '반쪽 문서',
      createdAt: '', updatedAt: '', wires: [], devices: [],
    }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const h = r.kit.harnesses[0];
    expect(h.connectors).toEqual([]);
    expect(h.usedParts).toEqual([]);
    expect(r.warnings.join(' ')).toContain('커넥터');
    expect(r.warnings.join(' ')).toContain('부품 스냅샷');
  });

  it('색·굵기가 없는 배선은 지어내지 않고 빼면서 알린다', () => {
    const doc = richHarness();
    const broken = JSON.parse(JSON.stringify(doc)) as Record<string, unknown>;
    (broken.wires as Record<string, unknown>[])[0].color = undefined;
    delete (broken.wires as Record<string, unknown>[])[1].gauge;
    const r = parseDocument(JSON.stringify(broken));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.kit.harnesses[0].wires).toHaveLength(0);
    expect(r.warnings.join(' ')).toContain('배선 2본');
  });

  it('세트 구성이 없는 하네스를 가리키면 그 줄을 버리고 알린다', () => {
    const k = richKit();
    k.set.items = [{ harnessId: 'hrn-1', perSet: 2 }, { harnessId: '유령', perSet: 99 }];
    const r = parseDocument(JSON.stringify(k));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.kit.set.items.map((i) => i.harnessId)).toEqual(['hrn-1', 'hrn-2']);
    // 구성에서 빠져 있던 hrn-2 는 1개로 채운다 (0 이면 발주에서 조용히 사라진다)
    expect(r.kit.set.items[1].perSet).toBe(1);
    expect(r.warnings.some((w) => w.includes('없는 하네스'))).toBe(true);
  });

  it('수량이 숫자가 아니면 1 로 되돌리고 알린다', () => {
    const k = richKit();
    (k.set as unknown as Record<string, unknown>).orderQty = 'many';
    k.set.items[0].perSet = Number.NaN;
    const r = parseDocument(JSON.stringify(k));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.kit.set.orderQty).toBe(1);
    expect(r.kit.set.items[0].perSet).toBe(1);
  });
});

// ================================================================
// 4. 못 고치는 것은 검증에서 짚는다
// ================================================================
describe('참조 무결성 — 검증에서 짚어야 하는 것', () => {
  it('없는 커넥터·장치·핀을 가리키는 배선을 error 로 잡는다', () => {
    const h = richHarness();
    h.wires = [
      ...h.wires,
      {
        id: 'w-ghost-conn',
        from: { type: 'pin', connectorId: '없는커넥터', pinId: 'x' },
        to: { type: 'device', deviceId: 'dev-1' },
        color: { base: 'blue' }, gauge: { system: 'awg', value: 22 }, lengthMm: 10,
      },
      {
        id: 'w-ghost-dev',
        from: { type: 'pin', connectorId: 'con-a', pinId: 'a2' },
        to: { type: 'device', deviceId: '없는장치' },
        color: { base: 'blue' }, gauge: { system: 'awg', value: 22 }, lengthMm: 10,
      },
      {
        id: 'w-ghost-pin',
        from: { type: 'pin', connectorId: 'con-a', pinId: '없는핀' },
        to: { type: 'device', deviceId: 'dev-1', terminal: 'GND' },
        color: { base: 'blue' }, gauge: { system: 'awg', value: 22 }, lengthMm: 10,
      },
    ];
    const found = validateHarness(h).filter((i) => i.id === 'endpoint-missing');
    expect(found).toHaveLength(3);
    expect(found.every((i) => i.level === 'error')).toBe(true);
    expect(found.map((i) => i.targetId).sort())
      .toEqual(['w-ghost-conn', 'w-ghost-dev', 'w-ghost-pin']);
  });

  it('멀쩡한 문서에서는 끊어진 참조를 만들어 내지 않는다', () => {
    expect(validateHarness(richHarness()).filter((i) => i.id === 'endpoint-missing')).toHaveLength(0);
  });

  it('같은 id 를 둘이 쓰면 error 로 잡는다 (자동으로 고치지 않는다)', () => {
    const h = richHarness();
    h.connectors = [...h.connectors, { ...h.connectors[0] }];
    h.devices = [...h.devices, { ...h.devices[0], name: '이름만 다른 장치' }];
    const found = validateHarness(h).filter((i) => i.id === 'duplicate-id');
    expect(found.map((i) => i.targetId).sort()).toEqual(['con-a', 'dev-1']);
    expect(found.every((i) => i.level === 'error')).toBe(true);
  });

  it('내부 결선이 없는 핀을 가리키면 error 로 잡는다', () => {
    const h = richHarness();
    h.connectors[1] = { ...h.connectors[1], bridges: [['s1', 's9']] };
    const found = validateHarness(h).filter((i) => i.id === 'bridge-missing-pin');
    expect(found).toHaveLength(1);
    expect(found[0].targetId).toBe('sp-1');
  });

  it('끊어진 참조가 있어도 검증이 터지지 않는다', () => {
    const h = richHarness();
    h.wires = [{
      id: 'w-self',
      from: { type: 'pin', connectorId: '유령', pinId: 'p' },
      to: { type: 'pin', connectorId: '유령', pinId: 'p' },
      color: { base: 'red' }, gauge: { system: 'awg', value: 22 }, lengthMm: 1,
    }];
    expect(() => validateHarness(h)).not.toThrow();
  });
});

// ================================================================
// 5. 자동저장
// ================================================================
describe('자동저장', () => {
  it('저장한 세트를 그대로 되읽는다', () => {
    const k = richKit();
    expect(saveKit(k)).toBe(true);
    expect(loadSavedKit()).toEqual(k);
  });

  it('저장 용량이 넘치면 조용히 넘기지 않고 알린다', () => {
    const seen: StorageProblem[] = [];
    setStorageProblemHandler((p) => seen.push(p));
    vi.stubGlobal('localStorage', {
      getItem: () => null,
      setItem: () => {
        const e = new Error('quota'); e.name = 'QuotaExceededError'; throw e;
      },
      removeItem: () => {},
    });
    expect(saveKit(richKit())).toBe(false);
    expect(seen).toEqual([{ kind: 'quota' }]);
  });

  it('핸들러가 붙기 전에 난 문제도 나중에 전달된다', () => {
    // 자동저장 읽기는 App 마운트보다 먼저 돈다 — 그때 난 사고가 사라지면 안 된다
    mem.set('harness-tool:kit:v2', '{{{');
    expect(loadSavedKit()).toBeNull();
    const seen: StorageProblem[] = [];
    setStorageProblemHandler((p) => seen.push(p));
    expect(seen).toHaveLength(1);
    expect(seen[0].kind).toBe('unreadable');
  });

  /**
   * 회귀: 예전에는 못 읽으면 조용히 null 을 돌려 샘플 문서로 시작했고,
   * 사용자가 한 번만 손대면 그 위에 덮어써져 작업이 영영 사라졌다.
   */
  it('읽지 못한 자동저장은 지우지 않고 백업 자리로 옮긴다', () => {
    const raw = JSON.stringify({ ...richKit(), schemaVersion: 7 });
    mem.set('harness-tool:kit:v2', raw);
    expect(loadSavedKit()).toBeNull();
    expect(mem.get('harness-tool:kit:v2:broken')).toBe(raw);
    expect(mem.get('harness-tool:kit:v2')).toBeUndefined();
  });

  it('저장된 v1 문서는 v2 세트로 올려 읽는다', () => {
    mem.set('harness-tool:doc:v1', JSON.stringify(richHarness()));
    const kit = loadSavedKit();
    expect(kit?.schemaVersion).toBe(2);
    expect(kit?.harnesses[0].drawingNo).toBe('HN-001');
  });

  it('저장소에 접근할 수 없어도 던지지 않는다', () => {
    vi.stubGlobal('localStorage', {
      getItem() { throw new Error('SecurityError'); },
      setItem() { throw new Error('SecurityError'); },
      removeItem() { throw new Error('SecurityError'); },
    });
    expect(() => saveKit(richKit())).not.toThrow();
    expect(loadSavedKit()).toBeNull();
  });
});

// ================================================================
// 6. 커스텀 부품
// ================================================================
describe('사용자 정의 부품', () => {
  const mine = (over: Partial<PartLibraryItem> = {}): PartLibraryItem => ({
    id: 'custom-1', category: 'housing', name: '내가 만든 4P', pinCount: 4, ...over,
  });

  it('캔버스에 놓은 커스텀 부품은 문서와 함께 나간다', () => {
    S().replaceDoc(emptyDoc());
    S().addUsedPart(mine());
    S().addConnector({
      id: 'c1', kind: 'connector', housingId: 'custom-1',
      orientation: 0, positions: {}, pins: [{ id: 'p1', index: 1 }],
    });
    const out = JSON.parse(S().exportJson()) as KitDocument;
    expect(out.harnesses[0].usedParts[0]).toEqual(mine());
  });

  it('문서만 받은 기기에서도 열면 내 라이브러리에 부품이 들어온다', () => {
    saveCustomParts([]);
    const added = mergeDocumentParts([mine(), { id: 'lib-xh-4p', category: 'housing', name: '시드' }]);
    expect(added.map((p) => p.id)).toEqual(['custom-1']);          // 시드는 넣지 않는다
    expect(loadCustomParts().map((p) => p.id)).toEqual(['custom-1']);
  });

  it('내가 고쳐 둔 같은 id 의 부품을 남의 문서가 덮어쓰지 않는다', () => {
    saveCustomParts([mine({ name: '내가 고친 이름', pinCount: 6 })]);
    expect(mergeDocumentParts([mine({ name: '남의 이름' })])).toEqual([]);
    expect(loadCustomParts()[0].name).toBe('내가 고친 이름');
  });

  it('부품 스냅샷이 빠진 문서는 검증이 error 로 짚는다', () => {
    const h = richHarness({ usedParts: [] });
    const found = validateHarness(h).filter((i) => i.id === 'housing-missing');
    expect(found.length).toBeGreaterThan(0);
    expect(found[0].level).toBe('error');
  });
});
