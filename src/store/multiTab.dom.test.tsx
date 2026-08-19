/**
 * 탭 두 개 회귀 시험 — "나중에 편집한 탭이 다른 탭 작업을 통째로 덮어쓴다".
 *
 * 실제 브라우저에서 잰 재현 절차를 그대로 옮긴다.
 *   A탭·B탭 둘 다 같은 문서를 연 상태
 *   1) A탭에서 이름 변경 → 저장본 = "A탭에서 고친 이름"
 *   2) B탭에서 이름 변경 → 저장본 = "B탭에서 고친 이름"
 *   3) A탭에서 또 편집   → 저장본 = "A탭 두번째 편집"  ← 이때 B 의 작업이 사라졌다
 *
 * ## 탭 하나를 어떻게 흉내내는가
 * `vi.resetModules()` 뒤에 다시 import 하면 persistence·harnessStore 가 **새 인스턴스**로
 * 생긴다. 탭마다 자기 메모리 상태(zustand 스토어)와 자기 추적 상태(마지막으로 쓴 원문)를
 * 갖는 것이 곧 탭 두 개다. localStorage 목은 모듈 밖에 두어 브라우저 하나를 공유한다.
 * setItem 이 storage 이벤트를 던지는 것까지 브라우저와 같게 맞춘다.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { HarnessDocument, KitDocument } from '../types';
// 타입만 가져온다 — 컴파일에서 지워지므로 이 파일이 persistence 인스턴스를 하나 더
// 만들지 않는다(탭 흉내의 전제가 깨지면 안 된다).
import type { StorageProblem } from './persistence';

const KEY_KIT = 'harness-tool:kit:v2';
const KEY_LEGACY = 'harness-tool:doc:v1';
const KEY_SUPERSEDED = 'harness-tool:kit:v2:superseded';
const KEY_STAMP = 'harness-tool:kit:v2:stamp';

/** 브라우저 한 대 = localStorage 한 벌. 탭들이 공유한다. */
const mem = new Map<string, string>();
/** 어떤 키를 몇 번 읽었는지 — "탭이 하나면 지연이 늘지 않는다"를 재는 데 쓴다 */
let reads: string[] = [];

function installSharedStorage() {
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => {
      reads.push(k);
      return mem.get(k) ?? null;
    },
    setItem: (k: string, v: string) => {
      mem.set(k, v);
      // 진짜 브라우저는 **쓴 탭 자신에게는** 이벤트를 던지지 않는다. 여기서는
      // 창이 하나라 전부에게 간다 — persistence 가 자기가 쓴 원문을 걸러내는지까지
      // 함께 시험되는 셈이라 오히려 엄격하다.
      window.dispatchEvent(new StorageEvent('storage', { key: k, newValue: v }));
    },
    removeItem: (k: string) => {
      mem.delete(k);
      window.dispatchEvent(new StorageEvent('storage', { key: k, newValue: null }));
    },
  });
}

beforeEach(() => {
  mem.clear();
  reads = [];
  installSharedStorage();
});
afterEach(() => vi.unstubAllGlobals());

function harness(over: Partial<HarnessDocument> = {}): HarnessDocument {
  return {
    schemaVersion: 1,
    id: 'hrn-1',
    name: '공용 하네스',
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    connectors: [],
    devices: [],
    wires: [],
    cables: [],
    usedParts: [],
    ...over,
  };
}

function seedKit() {
  const kit: KitDocument = {
    schemaVersion: 2,
    id: 'kit-1',
    name: '공용 세트',
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    harnesses: [harness({ letter: 'A' })],
    set: { id: 'set-1', pn: 'KIT-1', name: '공용 세트', items: [{ harnessId: 'hrn-1', perSet: 1 }], orderQty: 1 },
  };
  mem.set(KEY_KIT, JSON.stringify(kit));
}

type Tab = {
  store: (typeof import('./harnessStore'))['useHarnessStore'];
  persistence: typeof import('./persistence');
  /** 이 탭이 사용자에게 알린 것들 */
  problems: StorageProblem[];
};

/** 탭 하나를 연다 (= 새 모듈 인스턴스로 앱을 다시 띄운다) */
async function openTab(): Promise<Tab> {
  vi.resetModules();
  const persistence = await import('./persistence');
  const problems: StorageProblem[] = [];
  persistence.setStorageProblemHandler((p) => problems.push(p));
  const { useHarnessStore } = await import('./harnessStore');
  return { store: useHarnessStore, persistence, problems };
}

/** 저장본에 든 하네스 이름 */
function savedName(raw = mem.get(KEY_KIT)): string | undefined {
  if (!raw) return undefined;
  return (JSON.parse(raw) as KitDocument).harnesses[0].name;
}

// ================================================================
// 대조군 — 고치기 전 동작
// ================================================================
describe('대조군: 세대 확인 없이 덮어쓰면 (고치기 전)', () => {
  it('B 의 작업이 아무 흔적 없이 사라진다', async () => {
    seedKit();
    const base = JSON.parse(mem.get(KEY_KIT)!) as KitDocument;

    // 고치기 전 saveKit 은 이것이 전부였다: 자기 메모리 상태를 그대로 setItem.
    const oldSave = (name: string) => {
      const mine: KitDocument = {
        ...base,
        harnesses: [{ ...base.harnesses[0], name }],
      };
      mem.set(KEY_KIT, JSON.stringify(mine));
    };

    oldSave('A탭에서 고친 이름');
    expect(savedName()).toBe('A탭에서 고친 이름');
    oldSave('B탭에서 고친 이름');
    expect(savedName()).toBe('B탭에서 고친 이름');
    oldSave('A탭 두번째 편집');

    // 저장본은 A 것이고, B 가 한 일은 저장소 어디에도 없다 — 경고도 없었다
    expect(savedName()).toBe('A탭 두번째 편집');
    expect(mem.get(KEY_SUPERSEDED)).toBeUndefined();
    expect([...mem.values()].some((v) => v.includes('B탭에서 고친 이름'))).toBe(false);
  });
});

// ================================================================
// 고친 뒤
// ================================================================
describe('탭 두 개가 같은 문서를 편집할 때', () => {
  it('재현 절차 그대로 — 밀려나는 작업이 소리 없이 사라지지 않는다', async () => {
    seedKit();
    const A = await openTab();
    const B = await openTab();
    // 둘 다 같은 문서를 열었다
    expect(A.store.getState().doc.name).toBe('공용 하네스');
    expect(B.store.getState().doc.name).toBe('공용 하네스');

    // 1) A탭에서 이름 변경
    A.store.getState().rename('A탭에서 고친 이름');
    expect(savedName()).toBe('A탭에서 고친 이름');
    expect(A.problems).toEqual([]);            // 밀어낸 것이 없으니 조용하다

    // 2) B탭에서 이름 변경 — A 의 편집은 B 화면에 없다(그게 사고의 출발점이다)
    expect(B.store.getState().doc.name).toBe('공용 하네스');
    B.store.getState().rename('B탭에서 고친 이름');
    expect(savedName()).toBe('B탭에서 고친 이름');
    // 밀려난 A 의 저장본은 지워지지 않고 피신했고, B 는 그 사실을 들었다
    expect(B.problems).toEqual([{ kind: 'superseded', rescued: true }]);
    expect(savedName(mem.get(KEY_SUPERSEDED))).toBe('A탭에서 고친 이름');

    // 3) A탭에서 또 편집 — 예전에는 여기서 B 의 작업이 사라졌다
    A.store.getState().rename('A탭 두번째 편집');
    expect(savedName()).toBe('A탭 두번째 편집');
    expect(A.problems).toEqual([{ kind: 'superseded', rescued: true }]);
    // B 가 한 일은 되찾을 수 있는 자리에 있다
    expect(savedName(mem.get(KEY_SUPERSEDED))).toBe('B탭에서 고친 이름');
  });

  it('밀려난 저장본을 되찾을 수 있다', async () => {
    seedKit();
    const A = await openTab();
    const B = await openTab();
    A.store.getState().rename('A탭에서 고친 이름');
    B.store.getState().rename('B탭에서 고친 이름');

    const raw = B.persistence.readSuperseded();
    expect(raw).toBeTruthy();
    const r = B.persistence.parseDocument(raw!);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.kit.harnesses[0].name).toBe('A탭에서 고친 이름');

    B.persistence.clearSuperseded();
    expect(B.persistence.readSuperseded()).toBeNull();
  });

  it('피신에 실패하면 덮어쓰지 않고 자동저장을 멈춘다', async () => {
    // 되돌릴 길 없이 남의 작업을 지우느니, 이쪽 자동저장을 포기하는 편이 낫다.
    seedKit();
    const A = await openTab();
    const B = await openTab();
    A.store.getState().rename('A탭에서 고친 이름');
    const beforeB = mem.get(KEY_KIT);

    // 피신 자리에만 쓰기가 막힌 상태를 만든다 (용량 초과 등)
    const real = globalThis.localStorage;
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => real.getItem(k),
      setItem: (k: string, v: string) => {
        if (k === KEY_SUPERSEDED) throw new Error('quota');
        real.setItem(k, v);
      },
      removeItem: (k: string) => real.removeItem(k),
    });

    B.store.getState().rename('B탭에서 고친 이름');
    expect(mem.get(KEY_KIT)).toBe(beforeB);     // A 의 저장본이 그대로다
    expect(B.problems).toEqual([{ kind: 'superseded', rescued: false }]);

    // 다음 저장에서도 잊지 않고 다시 시도한다 — 한 번 실패했다고 조용히 덮으면 안 된다
    installSharedStorage();
    B.store.getState().rename('B탭 두번째 편집');
    expect(savedName()).toBe('B탭 두번째 편집');
    expect(savedName(mem.get(KEY_SUPERSEDED))).toBe('A탭에서 고친 이름');
    expect(B.problems).toEqual([
      { kind: 'superseded', rescued: false },
      { kind: 'superseded', rescued: true },
    ]);
  });

  it('내가 이미 아는 내용이 다시 저장돼도 거짓 경보를 내지 않는다', async () => {
    // 다른 탭이 열려만 있고 같은 내용을 다시 쓴 경우다 — 밀려나는 작업이 없으므로
    // 알릴 일도 피신시킬 일도 없다. 경보가 잦으면 진짜 경보를 안 읽게 된다.
    seedKit();
    const A = await openTab();
    const same = mem.get(KEY_KIT)!;
    window.dispatchEvent(new StorageEvent('storage', { key: KEY_KIT, newValue: same }));

    A.store.getState().rename('내 편집');
    expect(savedName()).toBe('내 편집');
    expect(A.problems).toEqual([]);
    expect(mem.get(KEY_SUPERSEDED)).toBeUndefined();
  });
});

describe('탭이 하나뿐이면 달라지는 것이 없다', () => {
  it('경고도, 피신본도 생기지 않는다', async () => {
    seedKit();
    const A = await openTab();
    A.store.getState().rename('혼자 편집 1');
    A.store.getState().rename('혼자 편집 2');
    A.store.getState().rename('혼자 편집 3');
    expect(savedName()).toBe('혼자 편집 3');
    expect(A.problems).toEqual([]);
    expect(mem.get(KEY_SUPERSEDED)).toBeUndefined();
  });

  it('저장할 때 본문을 다시 읽지 않는다 (지연이 늘지 않는다)', async () => {
    seedKit();
    const A = await openTab();
    reads = [];                                  // 여는 동안의 읽기는 빼고 센다
    A.store.getState().rename('혼자 편집');
    // 세대 표식(짧은 문자열)만 확인한다. 도면 본문(KEY_KIT)은 읽지 않는다.
    // (`__probe__` 는 저장소 접근 가능 여부를 보는 기존 확인이라 셈에서 뺀다.)
    expect(reads.filter((k) => k !== '__probe__')).toEqual([KEY_STAMP]);
  });

  it('새로고침해도 자기 저장본을 남의 것으로 오해하지 않는다', async () => {
    seedKit();
    const first = await openTab();
    first.store.getState().rename('첫 세션');

    const second = await openTab();              // 새로고침 = 새 인스턴스
    expect(second.store.getState().doc.name).toBe('첫 세션');
    second.store.getState().rename('둘째 세션');
    expect(second.problems).toEqual([]);
    expect(mem.get(KEY_SUPERSEDED)).toBeUndefined();
  });
});

describe('옛 저장본', () => {
  it('세대 표식이 없는 v2 저장본을 그대로 읽고, 첫 편집에서 거짓 경보를 내지 않는다', async () => {
    seedKit();                                   // 표식 키 없이 본문만 있는 상태
    expect(mem.has(KEY_STAMP)).toBe(false);
    const A = await openTab();
    expect(A.store.getState().doc.name).toBe('공용 하네스');
    A.store.getState().rename('옛 저장본 편집');
    expect(A.problems).toEqual([]);
    expect(savedName()).toBe('옛 저장본 편집');
    expect(mem.get(KEY_STAMP)).toBeTruthy();     // 이제부터 표식이 찍힌다
  });

  it('v1(하네스 하나) 자동저장도 그대로 열린다', async () => {
    mem.set(KEY_LEGACY, JSON.stringify(harness({ name: '옛 단일 하네스', drawingNo: 'HN-9' })));
    const A = await openTab();
    expect(A.store.getState().kit.schemaVersion).toBe(2);
    expect(A.store.getState().doc.name).toBe('옛 단일 하네스');
    expect(A.store.getState().doc.drawingNo).toBe('HN-9');
    A.store.getState().rename('올려 읽은 뒤 편집');
    expect(savedName()).toBe('올려 읽은 뒤 편집');
    expect(A.problems).toEqual([]);
  });

  it('표식을 모르는 옛 빌드가 저장해도 storage 이벤트로 잡는다', async () => {
    // 배포된 옛 빌드는 표식 키를 건드리지 않는다 — 그래도 놓치면 안 된다.
    seedKit();
    const A = await openTab();
    A.store.getState().rename('새 빌드 편집');

    const legacyWrite = JSON.stringify({
      ...(JSON.parse(mem.get(KEY_KIT)!) as KitDocument),
      harnesses: [harness({ name: '옛 빌드가 저장한 이름' })],
    });
    mem.set(KEY_KIT, legacyWrite);               // 표식은 건드리지 않는다
    window.dispatchEvent(new StorageEvent('storage', { key: KEY_KIT, newValue: legacyWrite }));

    A.store.getState().rename('새 빌드 두번째 편집');
    expect(savedName()).toBe('새 빌드 두번째 편집');
    expect(A.problems).toEqual([{ kind: 'superseded', rescued: true }]);
    expect(savedName(mem.get(KEY_SUPERSEDED))).toBe('옛 빌드가 저장한 이름');
  });

  it('storage 이벤트를 놓쳐도 세대 표식이 잡는다', async () => {
    // 브라우저가 이벤트를 흘리는 경우를 흉내낸다 — 이벤트 없이 저장소만 바뀐 상태.
    seedKit();
    const A = await openTab();
    const B = await openTab();
    A.store.getState().rename('A 편집');

    // B 가 이벤트를 못 받았다고 치고, B 의 이벤트 기록만 지운다:
    // 표식은 A 가 새로 찍어 두었으므로 B 는 그것으로 알아채야 한다.
    B.persistence.resetStorageProblems();        // 추적 상태 초기화 = 이벤트 못 받은 상태
    const problems: StorageProblem[] = [];
    B.persistence.setStorageProblemHandler((p) => problems.push(p));
    B.store.getState().rename('B 편집');

    expect(savedName()).toBe('B 편집');
    expect(problems).toEqual([{ kind: 'superseded', rescued: true }]);
    expect(savedName(mem.get(KEY_SUPERSEDED))).toBe('A 편집');
  });
});
