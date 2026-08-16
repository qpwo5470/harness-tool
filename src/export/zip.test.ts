/**
 * 자체 ZIP 라이터 시험.
 *
 * 라이브러리를 쓰지 않고 직접 만든 구조체라, 남이 검증해 주지 않는다.
 * CRC32 는 **알려진 표준값**으로, 봉투는 바이트 오프셋으로 확인한다.
 */
import { describe, it, expect } from 'vitest';
import { buildZip, crc32, utf8 } from './zip';

const bytes = (s: string) => new TextEncoder().encode(s);
const u16 = (b: Uint8Array, i: number) => b[i] | (b[i + 1] << 8);
const u32 = (b: Uint8Array, i: number) => (b[i] | (b[i + 1] << 8) | (b[i + 2] << 16) | (b[i + 3] << 24)) >>> 0;

describe('crc32 — 표준값', () => {
  it('빈 입력은 0', () => {
    expect(crc32(new Uint8Array(0))).toBe(0);
  });
  it('"123456789" 는 0xCBF43926 (CRC-32/ISO-HDLC 검사값)', () => {
    expect(crc32(bytes('123456789'))).toBe(0xcbf43926);
  });
  it('"The quick brown fox jumps over the lazy dog" 는 0x414FA339', () => {
    expect(crc32(bytes('The quick brown fox jumps over the lazy dog'))).toBe(0x414fa339);
  });
  it('"a" 는 0xE8B7BE43', () => {
    expect(crc32(bytes('a'))).toBe(0xe8b7be43);
  });
  it('부호 없는 32비트로 돌려준다 (음수가 나오면 헤더가 깨진다)', () => {
    expect(crc32(bytes('한글'))).toBeGreaterThanOrEqual(0);
    expect(crc32(bytes('한글'))).toBeLessThanOrEqual(0xffffffff);
  });
});

describe('buildZip — 봉투 구조', () => {
  const zip = buildZip([
    { name: '가_접속표_RevA.csv', data: bytes('wire,net\nw1,N1\n') },
    { name: 'b.txt', data: bytes('hello') },
  ]);

  it('로컬 파일 헤더로 시작한다', () => {
    expect(u32(zip, 0)).toBe(0x04034b50);
  });

  it('general purpose bit 11(EFS) 이 서 있고 압축 방식은 store(0) 이다', () => {
    expect(u16(zip, 6) & 0x0800).toBe(0x0800);
    expect(u16(zip, 8)).toBe(0);
  });

  it('무압축이므로 압축 크기 = 원본 크기다', () => {
    const data = bytes('wire,net\nw1,N1\n');
    expect(u32(zip, 18)).toBe(data.length);
    expect(u32(zip, 22)).toBe(data.length);
    expect(u32(zip, 14)).toBe(crc32(data));
  });

  it('파일명은 UTF-8 바이트로 들어간다 (CP437 이 아니다)', () => {
    const nameLen = u16(zip, 26);
    const name = utf8('가_접속표_RevA.csv');
    expect(nameLen).toBe(name.length);
    expect(Array.from(zip.subarray(30, 30 + nameLen))).toEqual(Array.from(name));
  });

  it('EOCD 가 끝에 있고 항목 수가 맞는다', () => {
    const eo = zip.length - 22;
    expect(u32(zip, eo)).toBe(0x06054b50);
    expect(u16(zip, eo + 8)).toBe(2);
    expect(u16(zip, eo + 10)).toBe(2);
    // 중앙 디렉터리 오프셋(+16) + 크기(+12) = EOCD 시작
    expect(u32(zip, eo + 16) + u32(zip, eo + 12)).toBe(eo);
    // 중앙 디렉터리 첫 서명
    expect(u32(zip, u32(zip, eo + 16))).toBe(0x02014b50);
  });

  it('같은 입력이면 언제나 같은 바이트다 (시각을 넣지 않는다)', () => {
    const a = buildZip([{ name: 'x.txt', data: bytes('1') }]);
    const b = buildZip([{ name: 'x.txt', data: bytes('1') }]);
    expect(Array.from(a)).toEqual(Array.from(b));
  });

  it('빈 목록도 유효한 빈 ZIP 이다', () => {
    const empty = buildZip([]);
    expect(empty.length).toBe(22);
    expect(u32(empty, 0)).toBe(0x06054b50);
  });
});
