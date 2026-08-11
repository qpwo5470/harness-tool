/**
 * 렌더 스모크 테스트 — 배포 전에 실제로 화면이 그려지는지 확인.
 * 빌드가 통과해도 런타임에서 죽는 경우를 잡는다.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import App from './App';

// jsdom에 없는 API 목
beforeEach(() => {
  const store = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  });
  // React Flow가 요구하는 API
  vi.stubGlobal('ResizeObserver', class {
    observe() {} unobserve() {} disconnect() {}
  });
  if (!window.matchMedia) {
    vi.stubGlobal('matchMedia', () => ({
      matches: false, addListener() {}, removeListener() {},
      addEventListener() {}, removeEventListener() {},
    }));
  }
  (globalThis as unknown as { DOMMatrixReadOnly: unknown }).DOMMatrixReadOnly = class {
    m22 = 1;
    constructor() {}
  };
});

afterEach(() => cleanup());

describe('앱 렌더 스모크', () => {
  it('앱이 마운트되고 상단 바가 보인다', () => {
    render(<App />);
    expect(screen.getByText('하네스 설계 툴')).toBeTruthy();
    expect(screen.getByText('논리 뷰')).toBeTruthy();
    expect(screen.getByText('물리 뷰')).toBeTruthy();
  });

  it('라이브러리에 시드 부품과 새 부품 버튼이 보인다', () => {
    render(<App />);
    expect(screen.getByText('+ 새 부품 만들기')).toBeTruthy();
    expect(screen.getByText(/MDB VMC/)).toBeTruthy();
    expect(screen.getByText(/RJ45 8P8C \(T568B\)/)).toBeTruthy();
  });

  it('우측 탭(속성/접속표/파트)이 전환된다', () => {
    render(<App />);
    // "접속표"는 탭과 CSV 버튼 둘 다 있으므로 탭(숫자 포함)을 정확히 지정
    const tab = screen.getAllByText(/^접속표 \d+$/)[0];
    fireEvent.click(tab);
    // 샘플 문서의 와이어가 접속표에 보여야 함
    expect(screen.getAllByText(/Raspberry Pi/).length).toBeGreaterThan(0);
    fireEvent.click(screen.getAllByText(/^파트 \d+$/)[0]);
    expect(screen.getAllByText(/커넥터/).length).toBeGreaterThan(0);
  });

  it('핀맵 에디터가 열린다', () => {
    render(<App />);
    fireEvent.click(screen.getByText('+ 새 부품 만들기'));
    expect(screen.getByText('새 부품 만들기')).toBeTruthy();
    expect(screen.getByText(/핀 배치/)).toBeTruthy();
  });

  it('라이브러리 검색이 동작한다', () => {
    render(<App />);
    const search = screen.getByPlaceholderText('이름·MPN·신호 검색');
    fireEvent.change(search, { target: { value: 'SMH250' } });
    expect(screen.getAllByText(/SMH250/).length).toBeGreaterThan(0);
    // 검색어와 무관한 그룹은 사라져야 함
    expect(screen.queryByText(/RJ45 8P8C \(T568B\)/)).toBeNull();
  });
});

describe('보완된 기능', () => {
  it('실행취소/다시실행 버튼이 있다', () => {
    render(<App />);
    expect(screen.getByTitle(/실행취소/)).toBeTruthy();
    expect(screen.getByTitle(/다시실행/)).toBeTruthy();
  });

  it('와이어투와이어 커넥터가 라이브러리에 있다', () => {
    render(<App />);
    expect(screen.getAllByText(/와이어투와이어/).length).toBeGreaterThan(0);
  });

  it('파트리스트에 터미널이 집계된다', () => {
    render(<App />);
    fireEvent.click(screen.getAllByText(/^파트 \d+$/)[0]);
    expect(screen.getAllByText(/터미널/).length).toBeGreaterThan(0);
  });
});

describe('핀별 터미널 지정', () => {
  it('커넥터를 선택하면 핀별 터미널 지정 UI가 보인다', () => {
    render(<App />);
    // 라이브러리에서 커넥터 추가 → 자동 선택됨
    fireEvent.click(screen.getByText(/MDB VMC/));
    expect(screen.getAllByText(/터미널 지정/).length).toBeGreaterThan(0);
    // MDB는 6핀이므로 핀 행이 6개
    expect(screen.getByText(/핀 6개/)).toBeTruthy();
  });

  it('스플라이스는 터미널이 필요 없다고 안내한다', () => {
    render(<App />);
    fireEvent.click(screen.getByText(/스플라이스 3/));
    expect(screen.getByText(/압착단자가 필요 없습니다/)).toBeTruthy();
  });
});

describe('핀맵 에디터 — 터미널 부품', () => {
  it('터미널 선택 시 핀 배치 UI가 숨겨진다', () => {
    render(<App />);
    fireEvent.click(screen.getByText('+ 새 부품 만들기'));
    // 기본은 하우징 → 핀 배치가 보임
    expect(screen.getByText(/핀 배치/)).toBeTruthy();

    // 분류를 터미널로 변경
    const sel = screen.getByDisplayValue('커넥터 하우징');
    fireEvent.change(sel, { target: { value: 'terminal' } });

    expect(screen.queryByText(/핀 배치 — 클릭해서/)).toBeNull();
    expect(screen.getAllByText(/핀 배치를 정의하지 않습니다/).length).toBeGreaterThan(0);
    expect(screen.getByPlaceholderText('SMH250 (2.5mm)')).toBeTruthy(); // 적용 하우징 필드
  });
});

describe('배선 정보 확인 경로', () => {
  it('접속표 행을 클릭하면 해당 배선이 선택된다', () => {
    render(<App />);
    fireEvent.click(screen.getAllByText(/^접속표 \d+$/)[0]);
    const rows = screen.getAllByTitle(/클릭하면 캔버스에서/);
    expect(rows.length).toBeGreaterThan(0);
    fireEvent.click(rows[0]);
    // 선택되면 속성 탭에서 와이어 편집 항목이 보여야 함
    fireEvent.click(screen.getByText('속성'));
    expect(screen.getAllByText(/게이지/).length).toBeGreaterThan(0);
  });

  it('접속표에 색·게이지가 표로 정리돼 있다 (캔버스 라벨 없이도 확인 가능)', () => {
    render(<App />);
    fireEvent.click(screen.getAllByText(/^접속표 \d+$/)[0]);
    expect(screen.getAllByText(/AWG22/).length).toBeGreaterThan(0);
  });
});
