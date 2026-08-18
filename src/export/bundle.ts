/**
 * 내보내기 실행 — 계획(ExportFile[]) → 실제 바이트 → 내려받을 파일 하나.
 *
 * ## 왜 여러 파일을 ZIP 하나로 묶는가
 * 예전에는 파일마다 `<a download>` 를 눌렀다. 브라우저는 사용자가 누르지 않은
 * 연속 다운로드를 막는다(Chrome 은 두 번째부터 "여러 파일 다운로드" 확인을 띄우고,
 * 무시하면 조용히 버린다). 세트 9종을 내보내면 27개 중 첫 한 개만 떨어지고
 * 오류도 나지 않았다 — 발주처에 1/27 만 보내고도 모를 수 있는 사고다.
 * 파일이 둘 이상이면 **한 개의 ZIP** 으로 접어 한 번만 내려받는다.
 *
 * ## 왜 여기가 화면을 모르는가
 * 이 파일은 DOM 을 건드리지 않는다(순수 함수 + 바이트). 그래야 시험에서 만든
 * ZIP 을 그대로 디스크에 떨궈 `unzip -l` 로 확인할 수 있다.
 */
import type { KitDocument } from '../types';
import type { ExportFile } from './exportPlan';
import {
  buildKitBom, buildPartList, buildRunList, kitBomToCsv, runListToCsv, toCsv,
} from './exporters';
import type { LengthUnit } from './units';
import { buildZip } from './zip';

/**
 * 만들어진 파일 하나.
 * `Uint8Array<ArrayBuffer>` 로 못 박는다 — Blob 에 그대로 넘기려면 버퍼가
 * SharedArrayBuffer 가 아님이 타입으로 보장돼야 한다.
 */
export type ExportEntry = { name: string; data: Uint8Array<ArrayBuffer>; mime: string };

const CSV_MIME = 'text/csv;charset=utf-8;';
const JSON_MIME = 'application/json';
const PDF_MIME = 'application/pdf';
const ZIP_MIME = 'application/zip';

const encode = (s: string): Uint8Array<ArrayBuffer> => new TextEncoder().encode(s);

export type BuildHooks = {
  /** 한 파일이 끝날 때마다. 9종 도면은 한글 래스터 때문에 수 초가 걸린다. */
  onProgress?: (done: number, total: number, name: string) => void;
  /** 문서 JSON 본문 — 스토어를 모르는 채로 받아 온다 */
  docJson?: () => string;
  /** 다음 파일로 넘어가기 전에 이벤트 루프를 양보한다(진행 표시가 그려지도록) */
  yieldToUi?: () => Promise<void>;
};

/** 기본 양보 — 매크로태스크 한 틱. 이걸 걸어야 진행 숫자가 실제로 갱신된다. */
const defaultYield = () => new Promise<void>((r) => { setTimeout(r, 0); });

/**
 * 이 묶음을 만드는 데 필요한 계획.
 *
 * 대화상자의 `ExportPlan` 이 그대로 들어맞는다(구조적으로 넓다). 옵션이
 * optional 인 이유는 시험이 파일 목록만 들고 부를 수 있게 하기 위해서이며,
 * 빠졌을 때의 기본값은 **아무 옵션도 안 건드린 사람이 받던 것과 같다**
 * (mm · 여유율 0% · 기본 7열).
 */
export type ExportBuildPlan = {
  files: ExportFile[];
  paper: 'A3' | 'A4';
  unit?: LengthUnit;
  /** 전선 여유율(%) — **파트리스트 CSV 에만** 적용된다 */
  marginPct?: number;
  /** 접속표 CSV 에 넣을 열 (고른 순서 그대로) */
  csvCols?: string[];
};

/**
 * 계획된 파일들을 실제 바이트로 만든다.
 *
 * 계획 목록을 **그대로** 돌기 때문에 대화상자가 예고한 개수·이름과 산출물이
 * 어긋날 수 없다. 중간에 하나라도 실패하면 조용히 건너뛰지 않고 어느 파일이
 * 왜 실패했는지 담아 던진다 — 반쪽짜리 발주 묶음이 나가는 것보다 낫다.
 */
export async function buildExportEntries(
  kit: KitDocument,
  plan: ExportBuildPlan,
  hooks: BuildHooks = {},
): Promise<ExportEntry[]> {
  const out: ExportEntry[] = [];
  const total = plan.files.length;
  const pause = hooks.yieldToUi ?? defaultYield;
  // PDF 모듈은 무겁다(jspdf). 도면을 고르지 않았으면 불러오지 않는다.
  const needPdf = plan.files.some((f) => f.source.of === 'pdf');
  const pdfMod = needPdf ? await import('./pdf') : null;

  for (const f of plan.files) {
    try {
      out.push({ name: f.name, mime: mimeOf(f), data: await bodyOf(kit, f, plan, pdfMod, hooks) });
    } catch (e) {
      const why = e instanceof Error ? e.message : String(e);
      throw new Error(`${f.name} 을(를) 만들지 못했습니다 — ${why}`);
    }
    hooks.onProgress?.(out.length, total, f.name);
    if (out.length < total) await pause();
  }
  return out;
}

function mimeOf(f: ExportFile): string {
  return f.kind === 'PDF' ? PDF_MIME : f.kind === 'JSON' ? JSON_MIME : CSV_MIME;
}

/**
 * 파일 하나의 본문.
 *
 * ## 여유율이 어디에 붙고 어디에 안 붙는지가 이 함수의 요점이다
 * - `runsCsv` · `pdf` → **도면 길이 그대로.** 이 둘은 현장이 전선을 자를 때
 *   보는 종이다. 여기에 여유율을 곱하면 도면보다 긴 전선이 잘려 나간다.
 * - `partsCsv` → **여유율 적용.** 전선은 여유를 두고 산다. 대신 도면값·여유율·
 *   발주값을 열로 나눠 적어 어느 숫자가 무엇인지 문서가 스스로 말하게 한다
 *   (`toCsv` 주석).
 * 치수 단위는 셋 모두에 적용된다 — 한 봉투 안의 종이가 서로 다른 단위를 쓰면
 * 그게 더 위험하다.
 */
async function bodyOf(
  kit: KitDocument,
  f: ExportFile,
  plan: ExportBuildPlan,
  pdfMod: typeof import('./pdf') | null,
  hooks: BuildHooks,
): Promise<Uint8Array<ArrayBuffer>> {
  const unit = plan.unit ?? 'mm';
  // 콜백 안에서도 좁혀진 타입이 유지되도록 지역 const 로 받는다
  const src = f.source;
  // 세트 BOM 은 종별 수량표라 길이가 없다 — 단위도 여유율도 걸리지 않는다.
  if (src.of === 'bomCsv') return encode(kitBomToCsv(buildKitBom(kit)));
  if (src.of === 'json') {
    // 문서 JSON 은 "다시 열기용" 스냅샷이다. 표시 옵션으로 값을 바꾸면 그 파일을
    // 다시 열었을 때 도면 치수가 달라진다 — 저장값은 언제나 mm 원본이다.
    const json = hooks.docJson?.();
    if (json == null) throw new Error('문서 JSON 을 얻지 못했습니다');
    return encode(json);
  }
  const h = kit.harnesses.find((x) => x.id === src.harnessId);
  if (!h) throw new Error('세트에서 하네스를 찾지 못했습니다');
  if (src.of === 'runsCsv') {
    return encode(runListToCsv(buildRunList(h), { cols: plan.csvCols, unit }));
  }
  if (src.of === 'partsCsv') {
    return encode(toCsv(buildPartList(h, { unit }), { unit, marginPct: plan.marginPct ?? 0 }));
  }
  if (!pdfMod) throw new Error('PDF 모듈을 불러오지 못했습니다');
  return pdfMod.harnessPdfBytes(h, { paper: plan.paper, unit });
}

/**
 * 내려받을 실물 하나로 접는다.
 * 파일이 하나면 그대로, 둘 이상이면 ZIP 한 개 — 브라우저의 연속 다운로드
 * 차단을 아예 만나지 않는다.
 */
export function packForDownload(entries: ExportEntry[], zipName: string): ExportEntry {
  if (entries.length === 0) throw new Error('내보낼 파일이 없습니다');
  if (entries.length === 1) return entries[0];
  return {
    name: zipName,
    mime: ZIP_MIME,
    data: buildZip(entries.map((e) => ({ name: e.name, data: e.data }))),
  };
}
