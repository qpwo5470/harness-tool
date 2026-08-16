/**
 * 무압축(store · method 0) ZIP 라이터 — 자체 구현.
 *
 * ## 왜 라이브러리를 쓰지 않는가
 * 이 프로젝트의 런타임 의존성은 다섯 개뿐이다(@xyflow/react · jspdf · react ·
 * react-dom · zustand). 절제를 지키는 편이 유지보수에 이롭고, 여기서 필요한 것은
 * "여러 파일을 한 봉투에 담는 것"뿐이라 압축이 필요 없다. 세트 내보내기 용량의
 * 대부분은 PDF 인데, PDF 안의 이미지·스트림은 이미 압축돼 있어 deflate 를 걸어도
 * 거의 줄지 않는다. 압축을 포기하면 사양의 절반(deflate)이 사라지고 남는 것은
 * 로컬 파일 헤더 · 중앙 디렉터리 · EOCD 세 구조체뿐이다 — 40여 줄이면 된다.
 *
 * ## 왜 UTF-8 + general purpose bit 11 인가
 * 파일명에 한글이 들어간다(`..._접속표_RevA.csv`). ZIP 원래 규격의 파일명은
 * CP437 이고, 이름 바이트를 UTF-8 로 넣으면서 플래그를 세우지 않으면 Windows
 * 탐색기가 CP437 로 읽어 깨진다. bit 11(EFS, Encoding For Storage)을 세우면
 * macOS(Archive Utility) · Windows 10 이상 · unzip 이 모두 UTF-8 로 읽는다.
 *
 * ## 한계
 * ZIP64 를 쓰지 않는다. 항목 65,535개 또는 4GB 를 넘으면 만들지 않고 던진다.
 * 하네스 세트 내보내기는 수십 개 · 수 MB 규모라 이 한계에 닿지 않는다.
 */

/** 항목 하나 — 이름은 ZIP 안에 그대로 들어간다 */
export type ZipEntry = { name: string; data: Uint8Array };

const MAX_ENTRIES = 0xffff;
const MAX_SIZE = 0xffffffff;

/** general purpose bit 11 — 파일명이 UTF-8 임을 알린다 */
const FLAG_UTF8 = 0x0800;

/**
 * 고정 타임스탬프(1980-01-01 00:00, DOS epoch).
 *
 * 만든 시각을 넣으면 같은 문서를 두 번 내보낼 때 바이트가 달라져 회귀 시험에서
 * 결과를 못 박을 수 없다. 발주 문서 묶음에서 항목의 수정 시각은 정보가 아니므로
 * 재현 가능성을 택했다.
 */
const DOS_TIME = 0;
const DOS_DATE = 0x0021;

const CRC_TABLE = /* @__PURE__ */ (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

/** 표준 CRC-32 (IEEE 802.3, ZIP 이 쓰는 그것) */
export function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i += 1) {
    c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

/** 문자열 → UTF-8 바이트 */
export function utf8(s: string): Uint8Array<ArrayBuffer> {
  return new TextEncoder().encode(s);
}

/** 리틀엔디언 기록기 — ZIP 의 모든 정수는 리틀엔디언이다 */
class Writer {
  readonly bytes: Uint8Array<ArrayBuffer>;
  private p = 0;
  private readonly view: DataView;

  constructor(size: number) {
    this.bytes = new Uint8Array(size);
    this.view = new DataView(this.bytes.buffer);
  }
  get offset(): number {
    return this.p;
  }
  u16(v: number): void {
    this.view.setUint16(this.p, v, true);
    this.p += 2;
  }
  u32(v: number): void {
    this.view.setUint32(this.p, v >>> 0, true);
    this.p += 4;
  }
  raw(b: Uint8Array): void {
    this.bytes.set(b, this.p);
    this.p += b.length;
  }
}

/**
 * 항목들을 무압축 ZIP 한 덩어리로 만든다.
 * 순서는 넘긴 순서 그대로다 — 대화상자 "나올 파일" 목록과 같은 순서로 보인다.
 */
export function buildZip(entries: ZipEntry[]): Uint8Array<ArrayBuffer> {
  if (entries.length > MAX_ENTRIES) {
    throw new Error(`ZIP 항목이 너무 많습니다 (${entries.length}개 · 한계 ${MAX_ENTRIES}개)`);
  }

  const prepared = entries.map((e) => {
    const name = utf8(e.name);
    if (name.length > 0xffff) throw new Error(`파일명이 너무 깁니다: ${e.name}`);
    return { name, data: e.data, crc: crc32(e.data) };
  });

  const total = prepared.reduce((n, e) => n + 30 + e.name.length + e.data.length + 46 + e.name.length, 22);
  if (total > MAX_SIZE) {
    throw new Error(`ZIP 이 4GB 를 넘습니다 (${total} 바이트) — 범위를 나눠 내보내세요`);
  }

  const w = new Writer(total);
  const offsets: number[] = [];

  // ── 로컬 파일 헤더 + 데이터 ────────────────────────────────────────────
  for (const e of prepared) {
    offsets.push(w.offset);
    w.u32(0x04034b50);      // 서명
    w.u16(20);              // 풀려면 필요한 버전 2.0
    w.u16(FLAG_UTF8);
    w.u16(0);               // 압축 방식 0 = store
    w.u16(DOS_TIME);
    w.u16(DOS_DATE);
    w.u32(e.crc);
    w.u32(e.data.length);   // 압축 크기 = 원본 크기 (무압축)
    w.u32(e.data.length);
    w.u16(e.name.length);
    w.u16(0);               // extra 없음
    w.raw(e.name);
    w.raw(e.data);
  }

  // ── 중앙 디렉터리 ──────────────────────────────────────────────────────
  const cdStart = w.offset;
  prepared.forEach((e, i) => {
    w.u32(0x02014b50);
    w.u16(20);              // 만든 버전
    w.u16(20);              // 풀려면 필요한 버전
    w.u16(FLAG_UTF8);
    w.u16(0);
    w.u16(DOS_TIME);
    w.u16(DOS_DATE);
    w.u32(e.crc);
    w.u32(e.data.length);
    w.u32(e.data.length);
    w.u16(e.name.length);
    w.u16(0);               // extra
    w.u16(0);               // 주석
    w.u16(0);               // 시작 디스크
    w.u16(0);               // 내부 속성
    w.u32(0);               // 외부 속성 — 0 이면 푸는 쪽 기본 권한을 따른다
    w.u32(offsets[i]);
    w.raw(e.name);
  });
  const cdSize = w.offset - cdStart;

  // ── EOCD ───────────────────────────────────────────────────────────────
  w.u32(0x06054b50);
  w.u16(0);                 // 이 디스크 번호
  w.u16(0);                 // 중앙 디렉터리가 시작하는 디스크
  w.u16(prepared.length);
  w.u16(prepared.length);
  w.u32(cdSize);
  w.u32(cdStart);
  w.u16(0);                 // 주석 길이

  return w.bytes;
}
