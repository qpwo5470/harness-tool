import { describe, it, expect, beforeEach, vi } from 'vitest';
import { loadSaved, saveDoc, clearSaved, emptyDoc, parseDocument } from './persistence';
import { sampleDoc } from '../fixtures/sampleDoc';

// 노드 환경에 localStorage 목 주입
const store = new Map<string, string>();
beforeEach(() => {
  store.clear();
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  });
});

describe('persistence', () => {
  it('저장한 문서를 다시 불러온다', () => {
    saveDoc(sampleDoc);
    expect(loadSaved()?.name).toBe('샘플 하네스');
  });

  it('저장된 게 없으면 null', () => {
    expect(loadSaved()).toBeNull();
  });

  it('스키마 버전이 다르면 무시한다', () => {
    localStorage.setItem('harness-tool:doc:v1', JSON.stringify({ schemaVersion: 99 }));
    expect(loadSaved()).toBeNull();
  });

  it('깨진 JSON 이어도 던지지 않는다', () => {
    localStorage.setItem('harness-tool:doc:v1', '{{{');
    expect(loadSaved()).toBeNull();
  });

  it('clearSaved 후에는 없어진다', () => {
    saveDoc(sampleDoc);
    clearSaved();
    expect(loadSaved()).toBeNull();
  });

  it('emptyDoc 은 유효한 빈 문서', () => {
    const d = emptyDoc();
    expect(d.schemaVersion).toBe(1);
    expect(d.connectors).toHaveLength(0);
    expect(d.wires).toHaveLength(0);
  });
});

describe('저장소 접근 불가 상황 (file:// · 시크릿 모드)', () => {
  it('localStorage 접근이 SecurityError 를 던져도 앱이 죽지 않는다', () => {
    vi.stubGlobal('localStorage', {
      get length(): number { throw new Error('SecurityError'); },
      getItem() { throw new Error('localStorage is not available for opaque origins'); },
      setItem() { throw new Error('localStorage is not available for opaque origins'); },
      removeItem() { throw new Error('localStorage is not available for opaque origins'); },
    });
    expect(() => loadSaved()).not.toThrow();
    expect(loadSaved()).toBeNull();
    expect(() => saveDoc(sampleDoc)).not.toThrow();
    expect(() => clearSaved()).not.toThrow();
  });

  it('localStorage 자체가 없어도 동작한다', () => {
    vi.stubGlobal('localStorage', undefined);
    expect(loadSaved()).toBeNull();
    expect(() => saveDoc(sampleDoc)).not.toThrow();
  });
});


/**
 * 의도적 미사용 핀 · 절연 슬리브 (개선안 §2-10 / §2-11).
 *
 * 두 값은 도면이 말하는 **내용**이지 그림이 아니다. 왕복에서 떨어지면 다음에
 * 파일을 연 사람에게는 X 표시도 슬리브 발주 줄도 없는 다른 도면이 열린다.
 */
describe('미사용 핀 · 절연 슬리브 왕복', () => {
  const withFlags = () => ({
    ...sampleDoc,
    connectors: sampleDoc.connectors.map((c, i) =>
      (i === 0 ? { ...c, unused: [3, '+'], sleeve: true } : c)),
  });

  it('미사용 핀과 슬리브 표시가 그대로 돌아온다 — 숫자와 라벨을 둘 다 받는다', () => {
    saveDoc(withFlags());
    const c = loadSaved()!.connectors[0];
    expect(c.unused).toEqual([3, '+']);
    expect(c.sleeve).toBe(true);
  });

  it('쓴 적 없는 문서에는 키가 붙지 않는다 — 없는 변경이 파일에 보이면 안 된다', () => {
    saveDoc(sampleDoc);
    const c = loadSaved()!.connectors[0];
    expect('unused' in c).toBe(false);
    expect('sleeve' in c).toBe(false);
  });

  /*
   * 여기부터는 **불러오기(parseDocument)** 경로다. 자동저장(loadSaved)은 제가 쓴
   * JSON 을 그대로 되읽으므로 걸러 낼 것이 없고, 남이 보낸 파일·손으로 고친
   * JSON 이 들어오는 자리가 이쪽이다.
   */
  const parsed = (doc: unknown) => {
    const r = parseDocument(JSON.stringify(doc));
    if (!r.ok) throw new Error(r.reason);
    return r.kit.harnesses[0];
  };

  it('빈 배열은 남기지 않는다 — 빈 배열과 없음이 같은 뜻이다', () => {
    const doc = { ...sampleDoc, connectors: sampleDoc.connectors.map((c, i) => (i === 0 ? { ...c, unused: [] } : c)) };
    expect('unused' in parsed(doc).connectors[0]).toBe(false);
  });

  it('숫자도 문자열도 아닌 값은 버린다 — 못 쓰는 핀 번호를 조용히 받지 않는다', () => {
    const doc = {
      ...sampleDoc,
      connectors: sampleDoc.connectors.map((c, i) =>
        (i === 0 ? { ...c, unused: [3, null, { a: 1 }, '+'] } : c)),
    };
    expect(parsed(doc).connectors[0].unused).toEqual([3, '+']);
  });

  it('sleeve 는 true 일 때만 싣는다 — false 는 기본값과 같은 뜻이다', () => {
    const doc = {
      ...sampleDoc,
      connectors: sampleDoc.connectors.map((c, i) => (i === 0 ? { ...c, sleeve: false } : c)),
    };
    expect('sleeve' in parsed(doc).connectors[0]).toBe(false);
  });

  it('부품 스냅샷의 layout·view 는 그대로 보존된다 — 모르는 필드를 떨어뜨리지 않는다', () => {
    const doc = {
      ...sampleDoc,
      usedParts: sampleDoc.usedParts.map((p, i) =>
        (i === 0 ? { ...p, layout: [[2, 1]], view: '결합면 기준' } : p)),
    };
    saveDoc(doc);
    const p = loadSaved()!.usedParts[0];
    expect(p.layout).toEqual([[2, 1]]);
    expect(p.view).toBe('결합면 기준');
  });
});
