/**
 * 결합 성별(암수) 표기 · 파싱 (순수 함수).
 *
 * 암수는 발주에서 틀리면 현장에서 못 쓰는 값이라 문자열 `spec.형식` 이 아니라
 * `PartLibraryItem.gender` 라는 제 자리에 산다. 여기 있는 함수들이 그 값을
 * 화면(배지·요약)·파트리스트·CSV 어디서든 **같은 말**로 옮긴다.
 *
 *  receptacle 암(리셉터클) · plug 수(플러그) · header 보드(헤더/웨이퍼) · neutral 성별 없음
 */
import type { PartGender } from '../types';

export const GENDERS: PartGender[] = ['receptacle', 'plug', 'header', 'neutral'];

/** 짧은 한글 표기 — 배지·CSV 셀에 그대로 들어간다 */
export const GENDER_LABEL: Record<PartGender, string> = {
  receptacle: '암',
  plug: '수',
  header: '보드',
  neutral: '—',
};

/** 풀어 쓴 이름 — 속성 패널·툴팁처럼 자리가 있는 곳 */
export const GENDER_LONG: Record<PartGender, string> = {
  receptacle: '리셉터클',
  plug: '플러그',
  header: '헤더 · 보드 실장',
  neutral: '성별 없음',
};

/** 한글 짧은 표기. 값이 없으면 빈 문자열(CSV 빈 칸) */
export function genderLabel(g?: PartGender): string {
  return g ? GENDER_LABEL[g] : '';
}

/**
 * 라이브러리 행에 다는 배지 글자.
 * `neutral` 과 미지정은 배지를 달지 않는다 — 달아 봐야 노이즈다.
 */
export function genderBadge(g?: PartGender): string | null {
  return g && g !== 'neutral' ? GENDER_LABEL[g] : null;
}

/** 발주 문서(파트리스트)용 한 덩어리 표기 — `암(리셉터클)` */
export function genderDetail(g?: PartGender): string | undefined {
  return g && g !== 'neutral' ? `${GENDER_LABEL[g]}(${GENDER_LONG[g]})` : undefined;
}

/** 입력 정규화 — 대소문자·공백·구분기호 무시 */
function norm(s: string): string {
  return s.replace(/^﻿/, '').trim().toLowerCase().replace(/[\s_\-.()]/g, '');
}

/**
 * 한글·영문 어느 쪽으로 적어도 받는다.
 * 엑셀 부품표는 사람이 손으로 적으므로 흔한 표현을 함께 받아준다.
 */
const ALIASES: Record<string, PartGender> = {
  // 암
  암: 'receptacle', 암커넥터: 'receptacle', 암컷: 'receptacle',
  리셉터클: 'receptacle', 소켓: 'receptacle', 하우징암: 'receptacle',
  receptacle: 'receptacle', socket: 'receptacle', female: 'receptacle', f: 'receptacle',
  // 수
  수: 'plug', 수커넥터: 'plug', 수컷: 'plug', 플러그: 'plug',
  plug: 'plug', male: 'plug', m: 'plug',
  // 보드
  보드: 'header', 보드실장: 'header', 헤더: 'header', 웨이퍼: 'header', 포스트: 'header',
  header: 'header', wafer: 'header', pcbheader: 'header', post: 'header',
  // 없음
  '—': 'neutral', '–': 'neutral',
  없음: 'neutral', 성별없음: 'neutral', 무성: 'neutral', 중성: 'neutral',
  neutral: 'neutral', none: 'neutral', na: 'neutral', genderless: 'neutral',
};

/**
 * CSV 한 칸 → 성별.
 * 빈 칸은 `undefined`(미지정) 이고, `—` 은 `neutral`(성별이 없는 부품)이다.
 * 둘은 다른 뜻이라 구분한다. 모르는 값도 `undefined` 를 돌려준다.
 */
export function parseGender(raw: string | undefined): PartGender | undefined {
  const t = (raw ?? '').trim();
  if (!t) return undefined;
  // 하이픈 한 글자도 "성별 없음"으로 본다 (엑셀에서 — 를 - 로 적는 경우)
  if (/^[-–—]+$/.test(t)) return 'neutral';
  return ALIASES[norm(t)];
}
