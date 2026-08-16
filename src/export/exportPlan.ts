/**
 * 내보내기 파일 목록 — **이름을 만드는 곳은 여기 하나뿐이다.**
 *
 * ## 왜 이 파일이 생겼나
 * 예전에는 대화상자(ExportDialog)가 미리보기 이름을 만들고 App 이 저장 이름을
 * 따로 만들었다. 두 규칙이 갈라져 미리보기에는 `..._접속표_RevA.csv` 라고 적히고
 * 실제로는 `..._접속표.csv` 가 떨어졌다. 발주처에 어느 Rev 인지 알 수 없는 파일이
 * 나가는 사고다. 이제 미리보기도 저장도 `planExportFiles()` 가 돌려준 **같은
 * 목록**을 쓴다 — 이름이 어긋나는 것이 구조적으로 불가능하다.
 *
 * ## 왜 Rev 를 파일명에 넣는가(미리보기 쪽이 맞다)
 * 하네스 도면은 개정될 때마다 같은 품번·같은 하네스 문자로 다시 나간다.
 * Rev 가 이름에 없으면 RevA 와 RevB 가 같은 파일명이 되어 받는 쪽 폴더에서 조용히
 * 덮어써지고, 현장은 어느 판으로 만들었는지 알 수 없다. 대화상자가 스스로
 * "파일명 규칙 [세트]_[하네스]_[종류]_[Rev]" 라고 적어 두기도 했다.
 */
import type { HarnessDocument, KitDocument } from '../types';
import { letterAt } from '../store/kit';

export type ExportScope = { kind: 'harness'; harnessId: string } | { kind: 'set' };

export type ExportItems = {
  pdf: boolean;
  runsCsv: boolean;
  partsCsv: boolean;
  bomCsv: boolean;
  json: boolean;
};

/**
 * 나올 파일 하나.
 *
 * `source` 는 이 파일의 내용을 무엇으로 채울지 가리킨다. 저장하는 쪽이 이름을
 * 다시 조립하지 않고 이 목록을 그대로 돌기 때문에, 미리보기 항목 수와 실제
 * 산출 파일 수도 언제나 같다.
 */
export type ExportFile = {
  kind: 'PDF' | 'CSV' | 'JSON';
  name: string;
  source:
    | { of: 'pdf' | 'runsCsv' | 'partsCsv'; harnessId: string }
    | { of: 'bomCsv' }
    | { of: 'json' };
};

/** 파일명에 못 쓰는 문자를 다듬는다 — 품번에 공백·슬래시가 섞여 들어온다 */
export function safeSegment(s: string): string {
  return s.trim().replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, '-');
}

/** 세트 안에서의 하네스 문자 (문서에 없으면 순번으로 매긴다) */
export function harnessLetter(kit: KitDocument, h: HarnessDocument): string {
  return h.letter ?? letterAt(Math.max(0, kit.harnesses.findIndex((x) => x.id === h.id)));
}

/** `Rev` 접두는 사람이 이미 붙여 놨을 수 있다 — 한 번만 붙인다 */
export function revTag(kit: KitDocument): string {
  const raw = (kit.set.rev ?? '').trim().replace(/^rev\.?\s*/i, '');
  return raw ? `Rev${safeSegment(raw)}` : '';
}

/** 세트 품번(없으면 SET) */
export function setTag(kit: KitDocument): string {
  return safeSegment(kit.set.pn) || 'SET';
}

/** `[세트]_[…]_[Rev]` + 확장자 */
export function exportFileName(kit: KitDocument, parts: string[], ext: string): string {
  return [setTag(kit), ...parts, revTag(kit)].filter(Boolean).join('_') + ext;
}

/** 봉투 이름 — 세트 기준이다. 예: `EW-EVC-KIT-01_RevA.zip` */
export function zipFileName(kit: KitDocument): string {
  return [setTag(kit), revTag(kit)].filter(Boolean).join('_') + '.zip';
}

/** 이번 범위가 실제로 가리키는 하네스들 */
export function targetsOf(kit: KitDocument, scope: ExportScope): HarnessDocument[] {
  if (scope.kind === 'set') return kit.harnesses;
  const h = kit.harnesses.find((x) => x.id === scope.harnessId);
  return h ? [h] : [];
}

/**
 * 나올 파일 목록. 대화상자 미리보기와 실제 저장이 **둘 다** 이 함수를 쓴다.
 *
 * 도면 PDF 는 하네스 한 종에 한 개다. 세트 전체를 한 권으로 묶으면 협력사에
 * 하네스별로 나눠 보낼 수 없고, 무엇보다 미리보기가 하네스마다 한 줄씩 세고 있다.
 * BOM 과 문서 JSON 은 세트에 한 장이라 하네스 문자를 달지 않는다.
 */
export function planExportFiles(
  kit: KitDocument,
  scope: ExportScope,
  items: ExportItems,
): ExportFile[] {
  const out: ExportFile[] = [];
  for (const h of targetsOf(kit, scope)) {
    const L = harnessLetter(kit, h);
    if (items.pdf) {
      out.push({
        kind: 'PDF',
        name: exportFileName(kit, [L, '도면'], '.pdf'),
        source: { of: 'pdf', harnessId: h.id },
      });
    }
    if (items.runsCsv) {
      out.push({
        kind: 'CSV',
        name: exportFileName(kit, [L, '접속표'], '.csv'),
        source: { of: 'runsCsv', harnessId: h.id },
      });
    }
    if (items.partsCsv) {
      out.push({
        kind: 'CSV',
        name: exportFileName(kit, [L, '파트리스트'], '.csv'),
        source: { of: 'partsCsv', harnessId: h.id },
      });
    }
  }
  if (items.bomCsv) {
    out.push({
      kind: 'CSV',
      name: exportFileName(kit, ['하네스BOM'], '.csv'),
      source: { of: 'bomCsv' },
    });
  }
  if (items.json) {
    out.push({
      kind: 'JSON',
      name: exportFileName(kit, ['문서'], '.json'),
      source: { of: 'json' },
    });
  }
  return out;
}
