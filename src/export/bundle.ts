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
 * 계획된 파일들을 실제 바이트로 만든다.
 *
 * 계획 목록을 **그대로** 돌기 때문에 대화상자가 예고한 개수·이름과 산출물이
 * 어긋날 수 없다. 중간에 하나라도 실패하면 조용히 건너뛰지 않고 어느 파일이
 * 왜 실패했는지 담아 던진다 — 반쪽짜리 발주 묶음이 나가는 것보다 낫다.
 */
export async function buildExportEntries(
  kit: KitDocument,
  plan: { files: ExportFile[]; paper: 'A3' | 'A4' },
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
      out.push({ name: f.name, mime: mimeOf(f), data: await bodyOf(kit, f, plan.paper, pdfMod, hooks) });
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

async function bodyOf(
  kit: KitDocument,
  f: ExportFile,
  paper: 'A3' | 'A4',
  pdfMod: typeof import('./pdf') | null,
  hooks: BuildHooks,
): Promise<Uint8Array<ArrayBuffer>> {
  // 콜백 안에서도 좁혀진 타입이 유지되도록 지역 const 로 받는다
  const src = f.source;
  if (src.of === 'bomCsv') return encode(kitBomToCsv(buildKitBom(kit)));
  if (src.of === 'json') {
    const json = hooks.docJson?.();
    if (json == null) throw new Error('문서 JSON 을 얻지 못했습니다');
    return encode(json);
  }
  const h = kit.harnesses.find((x) => x.id === src.harnessId);
  if (!h) throw new Error('세트에서 하네스를 찾지 못했습니다');
  if (src.of === 'runsCsv') return encode(runListToCsv(buildRunList(h)));
  if (src.of === 'partsCsv') return encode(toCsv(buildPartList(h)));
  if (!pdfMod) throw new Error('PDF 모듈을 불러오지 못했습니다');
  return pdfMod.harnessPdfBytes(h, { paper });
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
