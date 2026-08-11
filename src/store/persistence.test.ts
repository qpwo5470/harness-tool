import { describe, it, expect, beforeEach, vi } from 'vitest';
import { loadSaved, saveDoc, clearSaved, emptyDoc } from './persistence';
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
