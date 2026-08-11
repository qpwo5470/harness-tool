import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  loadCustomParts, saveCustomParts, upsertCustomPart, deleteCustomPart,
  isCustomPart, newCustomPartId, exportCustomParts, parseCustomParts,
} from './customParts';
import type { PartLibraryItem } from '../types';

const store = new Map<string, string>();
beforeEach(() => {
  store.clear();
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  });
});

const part = (id: string, name = '테스트'): PartLibraryItem => ({
  id, category: 'housing', name, pinCount: 2,
  pinLayout: [
    { index: 1, label: '1', offset: { x: 0, y: 0 }, signal: '+24V', stdColor: 'red' },
    { index: 2, label: '2', offset: { x: 1, y: 0 }, signal: 'GND', stdColor: 'black' },
  ],
});

describe('customParts 저장소', () => {
  it('빈 상태에서는 빈 배열', () => {
    expect(loadCustomParts()).toEqual([]);
  });

  it('upsert 로 추가되고 같은 id는 갱신된다', () => {
    upsertCustomPart(part('custom-1', '첫판'));
    expect(loadCustomParts()).toHaveLength(1);
    upsertCustomPart(part('custom-1', '수정판'));
    const all = loadCustomParts();
    expect(all).toHaveLength(1);
    expect(all[0].name).toBe('수정판');
  });

  it('핀맵(신호·색)이 보존된다', () => {
    upsertCustomPart(part('custom-2'));
    const p = loadCustomParts()[0];
    expect(p.pinLayout![0].signal).toBe('+24V');
    expect(p.pinLayout![1].stdColor).toBe('black');
  });

  it('삭제된다', () => {
    upsertCustomPart(part('custom-3'));
    expect(deleteCustomPart('custom-3')).toHaveLength(0);
  });

  it('깨진 데이터는 빈 배열로 처리', () => {
    localStorage.setItem('harness-tool:customParts:v1', '{{{');
    expect(loadCustomParts()).toEqual([]);
  });
});

describe('커스텀 id 구분', () => {
  it('newCustomPartId 는 custom- 접두사', () => {
    const id = newCustomPartId();
    expect(isCustomPart(id)).toBe(true);
  });
  it('시드 부품 id는 커스텀이 아니다', () => {
    expect(isCustomPart('lib-yh-smh250-4p')).toBe(false);
  });
  it('연속 호출 시 id가 겹치지 않는다', () => {
    expect(newCustomPartId()).not.toBe(newCustomPartId());
  });
});

describe('내보내기/가져오기', () => {
  it('내보낸 JSON을 다시 파싱할 수 있다', () => {
    const parts = [part('custom-a'), part('custom-b')];
    const json = exportCustomParts(parts);
    const back = parseCustomParts(json);
    expect(back).toHaveLength(2);
    expect(back[0].pinLayout![0].signal).toBe('+24V');
  });

  it('부품 배열만 있는 JSON도 허용', () => {
    expect(parseCustomParts(JSON.stringify([part('custom-c')]))).toHaveLength(1);
  });

  it('형식이 아니면 빈 배열', () => {
    expect(parseCustomParts('{"kind":"other"}')).toEqual([]);
    expect(parseCustomParts('nope')).toEqual([]);
  });

  it('저장소를 통째로 교체할 수 있다', () => {
    saveCustomParts([part('custom-x')]);
    expect(loadCustomParts()[0].id).toBe('custom-x');
  });
});

describe('저장소 접근 불가 상황', () => {
  it('SecurityError 가 나도 빈 목록으로 동작한다', () => {
    vi.stubGlobal('localStorage', {
      getItem() { throw new Error('localStorage is not available for opaque origins'); },
      setItem() { throw new Error('localStorage is not available for opaque origins'); },
    });
    expect(() => loadCustomParts()).not.toThrow();
    expect(loadCustomParts()).toEqual([]);
    expect(() => saveCustomParts([part('custom-z')])).not.toThrow();
  });
});
