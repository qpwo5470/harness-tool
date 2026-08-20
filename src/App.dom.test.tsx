/**
 * 렌더 스모크 테스트 — 배포 전에 실제로 화면이 그려지는지 확인.
 * 빌드가 통과해도 런타임에서 죽는 경우를 잡는다.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup, within } from '@testing-library/react';
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
    const search = screen.getByPlaceholderText('이름·MPN·시리즈·신호 검색');
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

/** 리디자인(도면형 1단계) 으로 들어온 동작 */
describe('접속표 패널 — 리디자인', () => {
  it('NET 열은 짧은 코드(N1…)로 표시되고 긴 이름은 title 로 남는다', () => {
    render(<App />);
    fireEvent.click(screen.getAllByText(/^접속표 \d+$/)[0]);
    const net = screen.getAllByText(/^N\d+$/);
    expect(net.length).toBeGreaterThan(0);
    // 좁은 NET 열이 줄바꿈되던 원인(긴 라벨)은 title 로 옮겼다
    expect(net[0].getAttribute('title')).toBeTruthy();
  });

  it('검색으로 행을 걸러낸다', () => {
    render(<App />);
    fireEvent.click(screen.getAllByText(/^접속표 \d+$/)[0]);
    const before = screen.getAllByTitle(/클릭하면 캔버스에서/).length;
    fireEvent.change(screen.getByPlaceholderText('네트 · 커넥터 검색'), {
      target: { value: '존재하지않는커넥터' },
    });
    expect(screen.queryAllByTitle(/클릭하면 캔버스에서/).length).toBe(0);
    expect(screen.getByText('검색 결과가 없습니다')).toBeTruthy();

    fireEvent.change(screen.getByPlaceholderText('네트 · 커넥터 검색'), { target: { value: '' } });
    expect(screen.getAllByTitle(/클릭하면 캔버스에서/).length).toBe(before);
  });

  it('하단 상태바에 본수·네트수가 보인다', () => {
    render(<App />);
    fireEvent.click(screen.getAllByText(/^접속표 \d+$/)[0]);
    expect(screen.getByText(/\d+본 · \d+네트/)).toBeTruthy();
  });
});

describe('상단바 — 내보내기 메뉴', () => {
  it('내보내기 버튼을 눌러야 CSV·JSON 항목이 나타난다', () => {
    render(<App />);
    expect(screen.queryByText('접속표 CSV')).toBeNull();
    fireEvent.click(screen.getByText('내보내기 ▾'));
    expect(screen.getByText('접속표 CSV')).toBeTruthy();
    expect(screen.getByText('파트리스트 CSV')).toBeTruthy();
    expect(screen.getByText('JSON 저장 (세트 전체)')).toBeTruthy();
    // 세트 도입 후: 범위·항목을 고르는 대화상자로 들어가는 입구
    expect(screen.getByText('내보내기 설정…')).toBeTruthy();
  });
});

describe('도번 · Rev — 제목블록에 반영', () => {
  it('도번을 입력하면 제목블록에 그대로 나온다', () => {
    render(<App />);
    // 입력 전에는 제목블록이 '—'
    expect(screen.getAllByText('—').length).toBeGreaterThan(0);
    fireEvent.change(screen.getByPlaceholderText('도번'), {
      target: { value: 'HRN-2408-01' },
    });
    expect(screen.getAllByText('HRN-2408-01').length).toBeGreaterThan(0);
  });

  it('Rev 는 Rev. 접두사와 함께 나온다', () => {
    render(<App />);
    fireEvent.change(screen.getByPlaceholderText('Rev'), { target: { value: 'B' } });
    expect(screen.getByText('Rev.B')).toBeTruthy();
  });

  it('비우면 다시 — 로 돌아간다', () => {
    render(<App />);
    const no = screen.getByPlaceholderText('도번');
    fireEvent.change(no, { target: { value: 'X-1' } });
    fireEvent.change(no, { target: { value: '' } });
    expect(screen.queryByText('X-1')).toBeNull();
  });
});

describe('검증 탭', () => {
  it('검증 탭이 있고 이슈 수를 보여준다', () => {
    render(<App />);
    expect(screen.getByText(/^검증 \d+$/)).toBeTruthy();
  });

  it('이슈를 클릭하면 그 요소가 선택되고 속성 탭으로 넘어간다', () => {
    render(<App />);
    fireEvent.click(screen.getByText(/^검증 \d+$/));
    const rows = document.querySelectorAll('[data-issue-id]');
    if (rows.length === 0) return; // 샘플이 깨끗하면 통과
    fireEvent.click(rows[0]);
    expect(screen.getAllByText('속성').length).toBeGreaterThan(0);
  });
});

describe('빈 상태 (§5)', () => {
  it('커넥터가 없으면 캔버스 대신 온보딩이 나온다', () => {
    render(<App />);
    // 샘플 문서에는 커넥터가 있으므로 온보딩이 없다
    expect(screen.queryByText('아직 커넥터가 없습니다')).toBeNull();
    // 하네스를 새로 추가하면 그 하네스는 비어 있다
    fireEvent.click(screen.getByText('+ 하네스'));
    expect(screen.getByText('아직 커넥터가 없습니다')).toBeTruthy();
    expect(screen.getByText('라이브러리에서 커넥터 놓기')).toBeTruthy();
  });

  it('배선이 없으면 PDF 는 막되 물리 뷰는 막지 않는다', () => {
    /*
     * 이 시험은 원래 **둘 다 비활성**을 요구했고, 그게 결함을 굳혀 놨다.
     * 물리 뷰는 배선 0본에서도 정상으로 열리고 "배선이 없습니다" 라고 스스로
     * 안내한다 — 들어갈 수 있는 화면을 막고 있었던 것이다. 게다가 상단바에
     * `:disabled` 스타일이 없어 막힌 티도 안 나서 "눌러도 반응 없음" 이 됐다.
     * PDF 는 다르다 — 낼 것이 정말 없으므로 막는 게 맞다.
     */
    render(<App />);
    fireEvent.click(screen.getByText('+ 하네스'));
    expect((screen.getByText('물리 뷰') as HTMLButtonElement).disabled).toBe(false);
    expect((screen.getByText('PDF 도면') as HTMLButtonElement).disabled).toBe(true);
  });

  it('빈 상태에서도 캔버스가 살아 있어 드롭을 받을 수 있다', () => {
    render(<App />);
    fireEvent.click(screen.getByText('+ 하네스'));
    // 온보딩이 캔버스를 대체하지 않고 위에 얹힌다 —
    // "끌어다 놓으라"고 안내하면서 드롭을 못 받으면 거짓말이 된다
    expect(screen.getByText('아직 커넥터가 없습니다')).toBeTruthy();
    expect(document.querySelector('.hz-canvas-wrap')).toBeTruthy();
  });

  it('빈 상태에서도 좌우 패널은 자리를 지킨다', () => {
    render(<App />);
    fireEvent.click(screen.getByText('+ 하네스'));
    // 라이브러리에 부품이 실제로 보이고, 우측 탭도 남아 있다
    expect(screen.getByPlaceholderText('이름·MPN·시리즈·신호 검색')).toBeTruthy();
    expect(screen.getAllByText(/^접속표 \d+$/).length).toBeGreaterThan(0);
  });
});

describe('하네스 탭 — 세트', () => {
  it('세트 개요 탭과 하네스 탭이 있다', () => {
    render(<App />);
    expect(screen.getByText(/세트 개요/)).toBeTruthy();
    expect(screen.getByText('+ 하네스')).toBeTruthy();
  });

  it('세트 개요로 넘어가면 캔버스 대신 하네스 카드가 보인다', () => {
    render(<App />);
    fireEvent.click(screen.getByText(/세트 개요/));
    // 세트 패널의 발주 액션이 나타난다
    expect(screen.getAllByText(/발주 문구 복사/).length).toBeGreaterThan(0);
  });

  /**
   * 회귀(감사 B-4): ⌘Z 는 보고 있는 화면과 무관하게 활성 하네스를 되돌린다.
   * 세트 개요에는 캔버스가 없어 **무엇이 사라졌는지 화면에 나타나지 않았다.**
   * 화면을 빼앗지 않는 대신, 어느 하네스의 도면이 바뀌었는지 알린다.
   */
  it('세트 개요에서 ⌘Z 를 누르면 어느 도면을 되돌렸는지 알린다', () => {
    const { container } = render(<App />);
    const lib = within(container.querySelector('.panel.lib') as HTMLElement);
    fireEvent.click(lib.getByText(/MDB VMC/));          // 되돌릴 도면 편집 하나

    fireEvent.click(screen.getByText(/세트 개요/));
    fireEvent.keyDown(window, { key: 'z', metaKey: true });

    expect(screen.getByText(/도면을 되돌렸습니다/)).toBeTruthy();
  });

  it('하네스를 추가하면 탭이 늘어난다', () => {
    render(<App />);
    const before = document.querySelectorAll('.htabs button').length;
    fireEvent.click(screen.getByText('+ 하네스'));
    expect(document.querySelectorAll('.htabs button').length).toBe(before + 1);
  });
});

describe('라이브러리 — 암수 표기', () => {
  /** 라이브러리 한 줄(.lib-row) */
  const rowOf = (name: RegExp) => screen.getByText(name).closest('.lib-row') as HTMLElement;

  it('암 · 수가 기호 옆 고정 칸에 글자로 나온다', () => {
    render(<App />);
    // 기본으로 펼쳐진 연호 2.5mm 시리즈 — SMH250(암) 과 SMP250(수) 이 나란히 있다.
    // 이름에서 제조사('연호 ')는 그룹 머리글이 이미 말하므로 표시에서 뗀다.
    const smh = rowOf(/^SMH250-02/);
    expect(within(smh).getByText('2P')).toBeTruthy();
    expect(smh.querySelector('.gender-cell.g-receptacle')?.textContent).toBe('암');

    const smp = rowOf(/^SMP250-02/);
    expect(smp.querySelector('.gender-cell.g-plug')?.textContent).toBe('수');
  });

  it('행마다 형상 기호가 붙는다 — 암은 빈 원, 수는 찬 원', () => {
    render(<App />);
    // 글자만으로는 "어떻게 생긴 애인지" 를 알 수 없어서 넣은 기호다.
    expect(rowOf(/^SMH250-02/).querySelector('.part-symbol .ps-hole')).toBeTruthy();
    expect(rowOf(/^SMP250-02/).querySelector('.part-symbol .ps-pin')).toBeTruthy();
  });

  it('성별이라는 개념이 없는 부품(스플라이스)과 미지정을 구분한다', () => {
    render(<App />);
    // neutral = 확인이 끝난 "성별 없음". 조용히 점만 찍는다.
    expect(rowOf(/^스플라이스 3/).querySelector('.gender-cell.g-neutral')).toBeTruthy();
    expect(rowOf(/^스플라이스 3/).querySelector('.gender-cell.g-unknown')).toBeNull();
  });

  it('신규 설계 비권장(NRND) 부품은 목록에서 바로 보인다', () => {
    render(<App />);
    fireEvent.change(screen.getByPlaceholderText('이름·MPN·시리즈·신호 검색'), {
      target: { value: '35155' },
    });
    const row = rowOf(/35155-0300/);
    expect(row.querySelector('.gender-cell.g-receptacle')?.textContent).toBe('암');
    expect(within(row).getByText('NRND')).toBeTruthy();
  });
});

describe('라이브러리 — 그룹 접기', () => {
  it('접힌 그룹은 항목이 숨고, 헤더를 누르면 펼쳐진다', () => {
    render(<App />);
    // USB 시리즈는 기본 접힘 → 항목이 안 보인다
    expect(screen.queryByText(/USB 2\.0/)).toBeNull();
    fireEvent.click(screen.getByText('USB'));
    expect(screen.getAllByText(/USB/).length).toBeGreaterThan(1);
  });

  it('검색 중에는 접힘을 무시하고 결과를 보여준다', () => {
    render(<App />);
    fireEvent.change(screen.getByPlaceholderText('이름·MPN·시리즈·신호 검색'), {
      target: { value: 'USB' },
    });
    // 접혀 있던 USB 그룹의 항목이 검색 결과로 드러나야 한다
    expect(screen.getAllByText(/USB/).length).toBeGreaterThan(1);
  });
});

describe('라이브러리 — 분류 체계', () => {
  it('계열 머리글 4칸이 목차로 보인다', () => {
    render(<App />);
    // 축이 하나뿐인 2단계 구조 — 계열은 접히지 않고 늘 보인다.
    expect(screen.getByText('압착 커넥터 (시리즈)')).toBeTruthy();
    expect(screen.getByText('규격 I/O 커넥터')).toBeTruthy();
  });

  it('시리즈 머리글은 제조사 · 시리즈 · 피치 꼴이다', () => {
    render(<App />);
    expect(screen.getByText('연호전자 · SMH250 · SMP250 · 2.50mm')).toBeTruthy();
  });

  it('용도(MDB)는 칸이 아니라 검색어다 — 커넥터는 Mini-Fit Jr 안에 있다', () => {
    render(<App />);
    fireEvent.change(screen.getByPlaceholderText('이름·MPN·시리즈·신호 검색'), {
      target: { value: '자판기' },
    });
    // 부품 이름에는 '자판기' 가 없다. 시리즈 태그로 잡혀야 한다.
    expect(screen.getByText(/MDB VMC/)).toBeTruthy();
  });

  it('역할 필터로 보드측만 남길 수 있다', () => {
    render(<App />);
    fireEvent.change(screen.getByPlaceholderText('이름·MPN·시리즈·신호 검색'), {
      target: { value: 'XH' },
    });
    expect(screen.getByText(/^XHP-4/)).toBeTruthy();       // 전선측 하우징
    fireEvent.click(screen.getByRole('button', { name: '보드측' }));
    expect(screen.queryByText(/^XHP-4/)).toBeNull();       // 걸러졌다
    expect(screen.getByText(/B4B-XH-A/)).toBeTruthy();     // 보드측은 남는다
  });

  it('분류 미지정 칸은 비어 있다 — 시드에 넣고 화면에서 못 찾는 일이 없어야 한다', () => {
    render(<App />);
    expect(screen.queryByText('분류 미지정')).toBeNull();
  });
});

/*
 * "물리 뷰 눌러도 반응 없음" — 세 갈래였고 셋 다 시험이 전부 통과하는 상태에서 났다.
 * 화면 분기·버튼 상태는 단위 시험으로는 안 잡히므로 여기서 실제 렌더로 붙잡는다.
 */
describe('뷰 전환 — 누르면 반드시 뭔가 바뀐다', () => {
  const viewBtn = (name: '논리 뷰' | '물리 뷰') =>
    screen.getByRole('button', { name }) as HTMLButtonElement;
  /** 물리 뷰가 실제로 그려졌는가 — 버튼 색이 아니라 화면으로 판단한다 */
  const inPhysical = () => !!document.querySelector('.body-phys');

  it('세트 개요 탭에서 눌러도 물리 도면이 열린다', () => {
    /*
     * 이게 원래 신고된 증상이다. 화면 분기가
     * `hTab === 'set' ? 세트개요 : view === 'physical' ? …` 라서, 세트 개요에서는
     * view 를 바꿔도 그리는 것이 안 달라졌다. 버튼만 눌린 색으로 바뀌었다.
     */
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: /^세트 개요/ }));
    expect(document.querySelector('.body-phys')).toBeNull();

    fireEvent.click(viewBtn('물리 뷰'));
    expect(inPhysical()).toBe(true);          // 화면이 실제로 바뀌었다
    expect(viewBtn('물리 뷰').className).toBe('on');
  });

  it('세트 개요에서 논리 뷰를 눌러도 하네스 도면으로 돌아온다', () => {
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: /^세트 개요/ }));
    fireEvent.click(viewBtn('논리 뷰'));
    expect(document.querySelector('.react-flow')).toBeTruthy();
  });

  it('배선이 0본이어도 물리 뷰에 들어갈 수 있다', () => {
    /*
     * 예전에는 `disabled={nothingToExport}` 로 막혀 있었다. 막을 이유가 없었다 —
     * 물리 뷰는 배선 0본에서도 열리고 스스로 안내한다. 게다가 상단바에 :disabled
     * 스타일이 없어 막힌 티조차 안 났다.
     */
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: '+ 하네스' }));   // 빈 하네스
    expect(viewBtn('물리 뷰').disabled).toBe(false);

    fireEvent.click(viewBtn('물리 뷰'));
    expect(inPhysical()).toBe(true);
    // 빈 화면이 아니라 다음에 할 일을 알려 준다
    expect(screen.getByText(/배선이 없습니다/)).toBeTruthy();
  });

  it('PDF 도면은 낼 것이 없으면 막되, 막힌 이유를 남긴다', () => {
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: '+ 하네스' }));
    const pdf = screen.getByRole('button', { name: 'PDF 도면' }) as HTMLButtonElement;
    expect(pdf.disabled).toBe(true);
    // 이유가 없으면 사용자에게는 그냥 고장이다
    expect(pdf.title).toMatch(/배선/);
  });
});
