/**
 * Agent D 소유 — 브라우저 출력 (PDF/PNG/CSV 다운로드).
 * 순수 로직은 exporters.ts, 여기서는 브라우저 API로 파일을 만든다.
 */
import { jsPDF } from 'jspdf';
import { toPng } from 'html-to-image';
import type { HarnessDocument } from '../types';
import { buildPartList, buildRunList, type PartRow, type RunRow } from './exporters';

/** 파트리스트를 표로 그린 간단 PDF */
function drawPartList(pdf: jsPDF, rows: PartRow[], startY: number) {
  let y = startY;
  pdf.setFontSize(11);
  pdf.text('Part List', 40, y);
  y += 18;
  pdf.setFontSize(9);
  pdf.text('Category', 40, y);
  pdf.text('Part', 130, y);
  pdf.text('Qty', 420, y);
  pdf.text('Detail', 460, y);
  y += 6;
  pdf.line(40, y, 555, y);
  y += 14;
  for (const r of rows) {
    if (y > 780) { pdf.addPage(); y = 40; }
    pdf.text(String(r.category), 40, y);
    pdf.text(String(r.part), 130, y);
    pdf.text(String(r.qty), 420, y);
    pdf.text(String(r.detail ?? ''), 460, y);
    y += 14;
  }
}

/** 접속표(From-To) 표 그리기 */
function drawRunList(pdf: jsPDF, rows: RunRow[], startY: number) {
  let y = startY;
  pdf.setFontSize(11);
  pdf.text('Connection List (From-To)', 40, y);
  y += 18;
  pdf.setFontSize(8);
  const cols: [string, number][] = [
    ['NET', 40], ['FROM', 150], ['TO', 300], ['COLOR', 450], ['AWG', 530], ['mm', 580],
  ];
  for (const [t, x] of cols) pdf.text(t, x, y);
  y += 6;
  pdf.line(40, y, 800, y);
  y += 12;
  for (const r of rows) {
    if (y > 540) { pdf.addPage(); y = 40; }
    pdf.text(String(r.net).slice(0, 22), 40, y);
    pdf.text(String(r.from).slice(0, 30), 150, y);
    pdf.text(String(r.to).slice(0, 30), 300, y);
    pdf.text(String(r.color).slice(0, 14), 450, y);
    pdf.text(String(r.gauge), 530, y);
    pdf.text(String(r.lengthMm), 580, y);
    y += 12;
  }
}

/**
 * 배선도(캔버스 스냅샷) + 접속표 + 파트리스트 PDF.
 * flowEl: React Flow 뷰포트를 담는 DOM 요소.
 */
export async function downloadPdf(doc: HarnessDocument, flowEl: HTMLElement | null) {
  const pdf = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4' });
  const pageW = pdf.internal.pageSize.getWidth();

  // 1p: 배선도 스냅샷
  if (flowEl) {
    try {
      const dataUrl = await toPng(flowEl, { backgroundColor: '#ffffff', pixelRatio: 2 });
      const img = new Image();
      await new Promise((res) => { img.onload = res; img.src = dataUrl; });
      const maxW = pageW - 80;
      const ratio = img.height / img.width;
      const w = Math.min(maxW, img.width);
      const h = w * ratio;
      pdf.setFontSize(13);
      pdf.text(doc.name || 'Harness', 40, 34);
      pdf.addImage(dataUrl, 'PNG', 40, 48, w, h);
    } catch {
      pdf.text('(배선도 스냅샷 실패)', 40, 60);
    }
  }

  // 2p: 접속표 (현장 제작용)
  pdf.addPage();
  drawRunList(pdf, buildRunList(doc), 48);

  // 3p: 파트리스트
  pdf.addPage();
  drawPartList(pdf, buildPartList(doc), 48);

  pdf.save(`${doc.name || 'harness'}.pdf`);
}
