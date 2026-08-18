/**
 * 설계 검증 규칙 — 도면 단계에서 잡을 수 있는 실수를 전부 잡는다.
 *
 * 하네스는 잘못 만들면 **현장에서 다시 만들어야 하는** 물건이다. 압착이 끝난 뒤에는
 * 핀 하나를 못 바꾼다. 그래서 발주 버튼을 누르기 전에 문서만 보고 판정할 수 있는 것은
 * 여기서 전부 판정한다.
 *
 * 규칙 세 가지:
 *
 * 1) **순수 함수다.** 스토어·DOM·시간·난수에 손대지 않는다. 문서를 넣으면 언제나 같은
 *    이슈 목록이 나온다. 그래야 테스트가 되고, PDF·발주 화면 어디서 불러도 같은 답이 나온다.
 * 2) **같은 판정을 두 번 만들지 않는다.** "터미널 미지정 몇 핀 / 길이 미입력 몇 본"의
 *    기준은 `statsOf()` 하나뿐이다. 여기서는 그 숫자를 다시 세지 않고, statsOf 가 문제가
 *    있다고 한 경우에만 **어디인지 짚어준다**. 두 곳에서 따로 세면 언젠가 화면끼리 숫자가
 *    갈리고, 그 순간부터 아무도 경고를 믿지 않는다.
 * 3) **detail 에는 "왜 문제인지"를 쓴다.** "규칙 위반"이라고만 적힌 경고는 무시된다.
 *
 * 레벨 기준:
 *  - error  물리적으로 만들 수 없거나, 발주 수량·문서가 틀어지는 것 → 발주를 막는다
 *  - warn   만들 수는 있으나 사람이 의도를 확인해야 하는 것
 *  - info   틀리지 않았지만 알고 있어야 하는 것
 *
 * 성능: 배선 200본 규모에서 전수 비교(O(n²))가 없도록 전부 Map/Set 색인으로 돈다.
 */
import type {
  Connector, Endpoint, Gauge, HarnessDocument, Id, PartLibraryItem, Pin, PinSlot, Wire,
} from '../types';
import { statsOf } from './kit';
import { lengthResolver } from './wireLength';
import { computeNets, endpointKey } from './netlist';
import { describeEndpoint } from '../export/exporters';
// 도면 레퍼런스(J1 · SP1 · D1)는 캔버스와 같은 규칙을 써야 한다.
// 여기서 따로 매기면 패널이 가리키는 J2 와 도면의 J2 가 달라진다.
import { refLabels, nodeBoxes } from '../canvas/docToFlow';
// 배선이 부품을 지나는지는 **실제로 그려지는 경로**로 판정해야 한다.
// 화면(OrthogonalEdge)·PDF(pdfDraw)와 같은 함수를 부른다.
import { planWires } from '../canvas/wirePlan';
// 구간(다발)은 배선에서 유도된다. 입력한 구간 길이를 검사하려면 화면과 **같은**
// 산출을 봐야 한다 — 여기서 따로 세면 도면의 S3 와 경고의 S3 가 달라진다.
import { buildPhysicalModel } from '../physical/segments';

export type IssueLevel = 'error' | 'warn' | 'info';

export type Issue = {
  /** 규칙 id (예: 'pin-overflow'). 같은 규칙의 이슈는 id 를 공유한다. */
  id: string;
  level: IssueLevel;
  /** 한 줄 요약 — 목록에 뜬다 */
  title: string;
  /** 왜 문제인지 / 어떻게 고치는지. 한 문장. */
  detail: string;
  /** 클릭 시 선택할 대상 (커넥터·와이어·장치 id) */
  targetId?: string;
  /** 어디서 났는지 사람이 읽는 위치 (예: 'J1 MDB VMC #3') */
  where: string;
};

/** 목록 정렬 순서 — 패널도 이 순서로 묶는다 */
export const LEVEL_ORDER: IssueLevel[] = ['error', 'warn', 'info'];

// ================================================================
// 소도구
// ================================================================

function push<K, V>(m: Map<K, V[]>, k: K, v: V) {
  const a = m.get(k);
  if (a) a.push(v);
  else m.set(k, [v]);
}

/** 게이지 표기 — 속성 패널과 같은 형식 */
function gaugeLabel(g: Gauge): string {
  return g.system === 'awg' ? `AWG${g.value}` : `${g.value}mm²`;
}

function colorLabel(c: { base: string; stripe?: string }): string {
  return c.stripe ? `${c.base}/${c.stripe}` : c.base;
}

/** 색 이름 비교용 정규화 — 'White/Orange ' 와 'white/orange' 는 같은 색이다 */
function normColor(v: string): string {
  return v.trim().toLowerCase().replace(/\s+/g, '');
}

/**
 * 축 정렬 선분이 사각형 **속**을 지나는가 (규칙 17 전용).
 *
 * 라우터가 "나는 다 피했다" 고 말해 주게 하지 않고 **최종 경로를 여기서 다시
 * 잰다.** 라우터는 자기가 아는 상자만 아는데, 우리가 알고 싶은 것은 "화면에서
 * 선이 가려지는가" 이지 "라우터가 시도했는가" 가 아니다. 회피 되풀이가 상한에
 * 걸린 경우든, 라우터가 애초에 손대지 않는 배치(부품끼리 겹쳐 놓은 경우)든
 * 똑같이 잡힌다.
 *
 * 변에 닿기만 하는 건 겹침이 아니다 — 패드 핸들은 상자 변 위에 있으므로
 * 모든 배선의 첫 점·끝 점이 어느 변엔가 걸린다.
 */
function segHitsBox(
  p: { x: number; y: number }, q: { x: number; y: number },
  b: { x: number; y: number; w: number; h: number },
): boolean {
  const eps = 1e-6;
  const x0 = Math.min(p.x, q.x), x1 = Math.max(p.x, q.x);
  const y0 = Math.min(p.y, q.y), y1 = Math.max(p.y, q.y);
  return x1 > b.x + eps && x0 < b.x + b.w - eps
    && y1 > b.y + eps && y0 < b.y + b.h - eps;
}

/**
 * 같은 단위 안에서 "가장 얇은" 게이지.
 * AWG 는 숫자가 클수록 얇고, mm² 는 작을수록 얇다. 단위가 섞이면 판단하지 않는다
 * (환산은 속성 패널의 몫이고, 여기서 어림 환산을 하면 경고가 거짓말을 한다).
 */
function thinnest(gs: Gauge[]): Gauge | undefined {
  const sys = gs[0]?.system;
  if (!sys || gs.some((g) => g.system !== sys)) return undefined;
  return gs.reduce((a, b) => {
    if (sys === 'awg') return b.value > a.value ? b : a;
    return b.value < a.value ? b : a;
  });
}

// ================================================================
// 검증
// ================================================================

export function validateHarness(doc: HarnessDocument): Issue[] {
  const out: Issue[] = [];

  // ---- 색인 ------------------------------------------------------
  const partById = new Map<Id, PartLibraryItem>(doc.usedParts.map((p) => [p.id, p]));
  const connById = new Map<Id, Connector>(doc.connectors.map((c) => [c.id, c]));
  const refs = refLabels(doc);
  const wireNo = new Map<Id, string>(doc.wires.map((w, i) => [w.id, `W${i + 1}`]));
  const wireById = new Map<Id, Wire>(doc.wires.map((w) => [w.id, w]));

  /** `${connectorId}:${pinId}` → Pin */
  const pinOf = new Map<string, Pin>();
  for (const c of doc.connectors) for (const p of c.pins) pinOf.set(`${c.id}:${p.id}`, p);

  /** `${housingId}:${index}` → PinSlot (규격 색·신호명) */
  const slotOf = new Map<string, PinSlot>();
  for (const part of doc.usedParts) {
    for (const s of part.pinLayout ?? []) slotOf.set(`${part.id}:${s.index}`, s);
  }

  /** `${connectorId}:${pinId}` → 그 핀에 붙은 와이어들 */
  const wiresAtPin = new Map<string, Wire[]>();
  /** 배선이 하나라도 붙은 커넥터·장치 id */
  const wired = new Set<Id>();
  /** 커넥터별로 붙은 가닥 수 (스플라이스 결선 수 판정용) */
  const strandsAt = new Map<Id, number>();

  for (const w of doc.wires) {
    for (const e of [w.from, w.to]) {
      if (e.type === 'pin') {
        push(wiresAtPin, `${e.connectorId}:${e.pinId}`, w);
        wired.add(e.connectorId);
        strandsAt.set(e.connectorId, (strandsAt.get(e.connectorId) ?? 0) + 1);
      } else {
        wired.add(e.deviceId);
      }
    }
  }

  // ---- 위치 문구 -------------------------------------------------
  const housingName = (c: Connector) => partById.get(c.housingId)?.name ?? c.housingId;
  const whereConn = (c: Connector) => `${refs.get(c.id) ?? '?'} ${housingName(c)}`;
  const whereEnd = (e: Endpoint) => {
    const ref = refs.get(e.type === 'pin' ? e.connectorId : e.deviceId) ?? '?';
    return `${ref} ${describeEndpoint(doc, e)}`;
  };
  const shortEnd = (e: Endpoint) => {
    if (e.type === 'device') {
      return `${refs.get(e.deviceId) ?? 'D?'}${e.terminal ? `.${e.terminal}` : ''}`;
    }
    const p = pinOf.get(`${e.connectorId}:${e.pinId}`);
    return `${refs.get(e.connectorId) ?? 'J?'}#${p?.label ?? p?.index ?? '?'}`;
  };
  const whereWire = (w: Wire) =>
    `${wireNo.get(w.id) ?? 'W?'} ${shortEnd(w.from)}→${shortEnd(w.to)}`;

  // ================================================================
  // 12. 같은 id 를 두 개가 쓴다
  //     id 는 배선이 커넥터를 가리키는 유일한 손잡이다. 겹치면 접속표·도면·
  //     삭제가 전부 "첫 번째 것"만 보고 돌아 화면과 발주가 갈린다.
  //     고쳐 줄 수 없다 — 어느 쪽이 진짜인지는 사람만 안다.
  // ================================================================
  {
    const seen = new Map<Id, string>();   // id → 무엇으로 처음 쓰였는지
    const dup = new Map<Id, string[]>();
    const claim = (id: Id, what: string) => {
      const first = seen.get(id);
      if (first == null) { seen.set(id, what); return; }
      push(dup, id, what);
    };
    for (const c of doc.connectors) claim(c.id, '커넥터');
    for (const d of doc.devices) claim(d.id, '장치');
    for (const w of doc.wires) claim(w.id, '배선');
    for (const cb of doc.cables ?? []) claim(cb.id, '케이블');
    for (const [id, kinds] of dup) {
      out.push({
        id: 'duplicate-id',
        level: 'error',
        title: `id 중복 — ${id}`,
        detail: `${seen.get(id)}·${kinds.join('·')} 가 같은 id 를 쓴다 — 배선이 어느 쪽을 가리키는지 정할 수 없어 접속표와 도면이 서로 다른 것을 보게 되고, 하나를 지우면 둘 다 사라진다.`,
        targetId: id,
        where: `${refs.get(id) ?? '?'} ${id}`,
      });
    }
  }

  // ================================================================
  // 13. 끊어진 참조 — 배선이 문서에 없는 커넥터·핀·장치를 가리킨다
  //     남이 보낸 파일이나 손으로 고친 JSON 에서 나온다. 화면에는 선이 아예
  //     그려지지 않고 접속표에는 raw id 가 찍혀, 아무 경고 없이 한 본이 증발한다.
  // ================================================================
  const deviceIds = new Set<Id>(doc.devices.map((d) => d.id));
  for (const w of doc.wires) {
    for (const e of [w.from, w.to]) {
      if (e.type === 'device') {
        if (deviceIds.has(e.deviceId)) continue;
        out.push({
          id: 'endpoint-missing',
          level: 'error',
          title: `없는 장치에 연결 — ${e.deviceId}`,
          detail: '이 배선이 가리키는 장치가 문서에 없다 — 도면에는 선이 그려지지 않고 접속표에는 이름 대신 내부 id 가 찍히므로, 장치를 다시 만들거나 이 배선을 지워야 한다.',
          targetId: w.id,
          where: whereWire(w),
        });
        continue;
      }
      const c = connById.get(e.connectorId);
      if (!c) {
        out.push({
          id: 'endpoint-missing',
          level: 'error',
          title: `없는 커넥터에 연결 — ${e.connectorId}`,
          detail: '이 배선이 가리키는 커넥터가 문서에 없다 — 도면에 선이 그려지지 않고 파트리스트에서도 빠지므로, 커넥터를 다시 놓거나 이 배선을 지워야 한다.',
          targetId: w.id,
          where: whereWire(w),
        });
        continue;
      }
      if (pinOf.has(`${e.connectorId}:${e.pinId}`)) continue;
      out.push({
        id: 'endpoint-missing',
        level: 'error',
        title: `없는 핀에 연결 — ${housingName(c)} (${e.pinId})`,
        detail: '커넥터는 있지만 그 핀이 없다 — 핀 수가 더 적은 하우징으로 바꿨을 때 남는 흔적이다. 배선을 남아 있는 핀으로 옮기거나 지워야 한다.',
        targetId: w.id,
        where: whereWire(w),
      });
    }
  }

  // ================================================================
  // 18. 케이블 참조·구성이 어긋난다
  //
  //  (a) 없는 케이블을 가리키는 배선 — 케이블을 지우고 심선을 그대로 둔 파일,
  //      손으로 고친 JSON 에서 나온다. 300mm 로 재단되던 심선이 조용히 '길이
  //      미상' 이 되는데, 예전에는 "길이 미입력" 이라고만 말해 **왜** 미입력이
  //      됐는지가 어디에도 나오지 않았다. 자동으로 지우지 않는다 —
  //      단선으로 둘지 다른 케이블에 넣을지는 사람만 안다.
  //  (b) 심선이 하나도 없는 케이블 — 자재표는 그래도 1개를 발주한다.
  //      커넥터에는 '배선 없음' warn 이 있는데 케이블에만 없었다.
  //  (c) 코어 수와 실제 심선 수가 어긋난다 — 심선이 더 많으면 물리적으로
  //      들어가지 않고(error), 적으면 예비심이라 정상일 수 있다(info).
  // ================================================================
  {
    const cables = doc.cables ?? [];
    const cableById = new Map(cables.map((c) => [c.id, c]));
    const coresOf = new Map<Id, Wire[]>();
    for (const w of doc.wires) {
      if (!w.cableId) continue;
      if (!cableById.has(w.cableId)) {
        // 제 길이가 있으면 재단은 되므로 만들 수는 있다 → warn.
        // 길이까지 없으면 몇 mm 로 자를지 아무도 모른다 → error.
        const lost = w.lengthMm == null;
        out.push({
          id: 'cable-missing',
          level: lost ? 'error' : 'warn',
          title: `없는 케이블에 속함 — ${w.cableId}`,
          detail: lost
            ? '이 배선이 소속으로 적은 케이블이 문서에 없다 — 따라올 길이가 없어 몇 mm 로 자를지 알 수 없다. 케이블을 다시 만들어 넣거나, 단선으로 돌리고 길이를 직접 입력해야 한다.'
            : '이 배선이 소속으로 적은 케이블이 문서에 없다 — 재단 길이는 배선에 적힌 값으로 나오지만, 자재표에는 딸려 올 케이블이 없어 소속 표기만 헛돈다. 단선으로 돌리거나 케이블을 다시 골라야 한다.',
          targetId: w.id,
          where: whereWire(w),
        });
        continue;
      }
      push(coresOf, w.cableId, w);
    }
    for (const cb of cables) {
      const name = cb.name ?? `${cb.coreCount}C 케이블`;
      const cores = coresOf.get(cb.id) ?? [];
      if (cores.length === 0) {
        out.push({
          id: 'cable-empty',
          level: 'warn',
          title: `심선 없음 — ${name}`,
          detail: '이 케이블에 속한 배선이 하나도 없는데 자재표에는 1개로 잡혀 발주된다 — 쓰지 않을 케이블이면 지우고, 쓸 것이라면 심선의 케이블 소속을 지정해야 한다.',
          targetId: cb.id,
          where: `${doc.name} ${name}`,
        });
        continue;
      }
      /**
       * 케이블 길이 미입력.
       *
       * 심선마다 길이를 넣어 뒀어도 **자켓을 몇 mm 사야 하는지**는 여전히 모른다 —
       * 발주에서 케이블 행 하나가 통째로 수량 없이 나간다.
       * 심선 중 하나라도 제 길이가 없으면 규칙 4 가 이미 "케이블에도 길이가
       * 없다" 고 말하므로 여기서는 잠자코 있는다 (같은 판정을 두 번 만들지 않는다).
       */
      if (cb.lengthMm == null && cores.every((w) => w.lengthMm != null)) {
        out.push({
          id: 'cable-length-missing',
          level: 'error',
          title: `케이블 길이 미입력 — ${name}`,
          detail: '심선마다 재단 길이가 있어도 케이블 자체를 몇 mm 사야 할지는 알 수 없다 — 자재표의 케이블 행이 수량 없이 나가므로 케이블 길이를 넣어야 한다.',
          targetId: cores[0].id,
          where: `${doc.name} ${name}`,
        });
      }
      if (!Number.isFinite(cb.coreCount) || cb.coreCount < cores.length) {
        out.push({
          id: 'cable-core-mismatch',
          level: 'error',
          title: `코어 수 부족 — ${name} ${cb.coreCount}코어에 심선 ${cores.length}본`,
          detail: `${cores.length}가닥을 ${cb.coreCount}코어 케이블에 넣을 수는 없다 — 코어 수를 올리거나, 넘치는 심선을 다른 케이블·단선으로 빼야 한다.`,
          targetId: cores[0].id,
          where: `${doc.name} ${name}`,
        });
      }
      /**
       * 19. 케이블 규격 게이지와 심선 게이지가 어긋난다.
       *
       * `Cable.gauge` 는 "이 케이블의 심선은 몇 SQ 짜리인가" 라는 **품목 규격**이고
       * 자재표의 케이블 행에 그대로 실린다(export/exporters.ts). 심선이 그와 다른
       * 굵기로 적혀 있으면 같은 도면이 두 굵기를 말하는 셈이라, 발주는 케이블
       * 규격대로 오는데 접속표·허용전류 계산은 심선 값을 쓴다.
       *
       * **단위가 다르면 판정하지 않는다** — 규칙 10(`thinnest`)과 같은 태도다.
       * 여기서 어림 환산을 하면 경고가 거짓말을 한다(AWG22 ↔ 0.34/0.3/0.5 는
       * 제조사마다 다르게 잡는다). 단위를 통일하는 것은 사람의 판단이다.
       *
       * 케이블을 targetId 로 삼는다 — 고칠 칸(케이블 게이지)이 케이블 카드에 있다.
       */
      if (cb.gauge) {
        const off = cores.filter(
          (w) => w.gauge.system === cb.gauge!.system && w.gauge.value !== cb.gauge!.value,
        );
        if (off.length > 0) {
          const kinds = [...new Set(off.map((w) => gaugeLabel(w.gauge)))].join(' · ');
          out.push({
            id: 'cable-gauge-mismatch',
            level: 'warn',
            title: `케이블 규격과 심선 굵기가 다름 — 케이블 ${gaugeLabel(cb.gauge)} · 심선 ${kinds}`,
            detail: `자재표에는 ${gaugeLabel(cb.gauge)} 케이블이 실리는데 심선 ${off.length}본은 ${kinds} 로 적혀 있다 — 들어오는 물건과 접속표의 굵기가 갈리므로, 케이블 규격이 맞으면 심선을, 심선이 맞으면 케이블 게이지를 고쳐야 한다.`,
            targetId: cb.id,
            where: `${doc.name} ${name}`,
          });
        }
      }
      if (cb.coreCount > cores.length) {
        out.push({
          id: 'cable-core-spare',
          level: 'info',
          title: `예비심 ${cb.coreCount - cores.length}심 — ${name}`,
          detail: `${cb.coreCount}코어 중 ${cores.length}심만 쓴다 — 여유를 두고 고른 것이면 그대로 두면 되고, 코어 수를 잘못 적은 것이면 줄여야 자재표의 케이블 규격이 맞는다.`,
          targetId: cores[0].id,
          where: `${doc.name} ${name}`,
        });
      }
    }
  }

  // ================================================================
  // 14. 브리지가 없는 핀을 묶는다 — 스플라이스 내부 결선이 헛돈다
  // ================================================================
  for (const c of doc.connectors) {
    const own = new Set(c.pins.map((p) => p.id));
    const ghosts = (c.bridges ?? []).flat().filter((pid) => !own.has(pid));
    if (ghosts.length === 0) continue;
    out.push({
      id: 'bridge-missing-pin',
      level: 'error',
      title: `내부 결선이 없는 핀을 가리킴 — ${ghosts.slice(0, 3).join(' ')}`,
      detail: '내부 결선(브리지)에 적힌 핀이 이 커넥터에 없다 — 네트가 실제보다 잘게 쪼개져 접속표의 네트 번호가 도면과 어긋난다.',
      targetId: c.id,
      where: whereConn(c),
    });
  }

  // ================================================================
  // 11. 하우징 스냅샷 없음 — 하우징을 모르면 핀 범위도 규격 색도 못 따진다.
  // ================================================================
  for (const c of doc.connectors) {
    if (partById.has(c.housingId)) continue;
    out.push({
      id: 'housing-missing',
      level: 'error',
      title: `하우징 스냅샷 없음 — ${c.housingId}`,
      detail: '문서에 부품 정보가 같이 저장되지 않아, 다른 사람이 이 파일을 열면 핀 수·규격·품번이 비어 도면이 재현되지 않는다.',
      targetId: c.id,
      where: `${refs.get(c.id) ?? '?'} ${c.kind}`,
    });
  }

  // ================================================================
  // 1. 핀 수 초과 — 하우징에 없는 자리에 배선했다
  // ================================================================
  for (const c of doc.connectors) {
    const housing = partById.get(c.housingId);
    if (!housing) continue;                     // 위에서 이미 error 로 잡았다
    const layout = housing.pinLayout;
    const max = housing.pinCount ?? layout?.length;
    if (layout == null && max == null) continue; // 핀 수를 모르는 부품은 판정하지 않는다

    const valid = layout
      ? new Set(layout.map((s) => s.index))
      : new Set(Array.from({ length: max ?? 0 }, (_, i) => i + 1));

    const over = c.pins.filter(
      (p) => wiresAtPin.has(`${c.id}:${p.id}`) && !valid.has(p.index),
    );
    if (over.length === 0) continue;

    out.push({
      id: 'pin-overflow',
      level: 'error',
      title: `핀 수 초과 — ${over.map((p) => `#${p.label ?? p.index}`).join(' ')}`,
      detail: `${housing.name} 은 ${max ?? valid.size}핀이라 그 자리가 물리적으로 없다 — 배선을 하우징 안의 핀으로 옮기거나 핀 수가 더 많은 하우징으로 바꿔야 한다.`,
      targetId: c.id,
      where: whereConn(c),
    });
  }

  // ================================================================
  // 2. 한 핀에 여러 배선 — 의도적일 수 있으므로 warn
  //    스플라이스는 원래 여러 가닥이 모이는 자리라 제외한다(규칙 6이 따로 본다).
  // ================================================================
  for (const c of doc.connectors) {
    if (c.kind === 'splice') continue;
    for (const p of c.pins) {
      const ws = wiresAtPin.get(`${c.id}:${p.id}`);
      if (!ws || ws.length < 2) continue;
      out.push({
        id: 'pin-multi-wire',
        level: 'warn',
        title: `한 핀에 ${ws.length}가닥 — #${p.label ?? p.index}`,
        detail: `핀 하나에는 보통 단자 하나만 압착한다 — ${ws.length}가닥을 겹압착할 생각이 아니라면 스플라이스로 모으거나 다른 핀으로 나눠야 한다.`,
        targetId: c.id,
        where: whereConn(c),
      });
    }
  }

  // ================================================================
  // 3. 터미널 미지정 (statsOf 가 센 값을 그대로 쓴다 — 여기서 다시 세지 않는다)
  // ================================================================
  const stats = statsOf(doc);
  if (stats.missingTerminal > 0) {
    for (const c of doc.connectors) {
      if (c.kind === 'splice') continue;         // 꼬임 접속은 단자가 없다
      const bare = c.pins.filter(
        (p) => wiresAtPin.has(`${c.id}:${p.id}`) && !p.terminalId,
      );
      if (bare.length === 0) continue;
      out.push({
        id: 'terminal-missing',
        level: 'error',
        title: `터미널 미지정 ${bare.length}핀 — ${bare.map((p) => `#${p.label ?? p.index}`).join(' ')}`,
        detail: '압착 단자는 하우징과 따로 사는 부품이라, 지정하지 않으면 파트리스트에서 빠지고 현장에 하우징만 도착한다.',
        targetId: c.id,
        where: whereConn(c),
      });
    }
  }

  // ================================================================
  // 4. 길이 미입력
  //    케이블에 속한 심선은 케이블 길이를 따르므로(store/wireLength.ts) 만들 수는
  //    있다 → info. 그건 "미입력"이 아니라 **다른 곳에 입력된 것**이므로
  //    `statsOf().missingLength` 에도 세지 않는다. 그래서 여기서 비교할 것은
  //    "error 등급 건수 === statsOf().missingLength" 다.
  //    길이 해석은 공용 함수 하나만 쓴다 — 물리 뷰·자재표와 판정이 갈리면 안 된다.
  // ================================================================
  const lengthOf = lengthResolver(doc);
  for (const w of doc.wires) {
    if (w.lengthMm != null) continue;
    const { mm, cable } = lengthOf(w);
    if (mm != null && cable) {
      out.push({
        id: 'length-missing',
        level: 'info',
        title: '길이 미입력 — 케이블 길이를 따름',
        detail: `${cable.name ?? '케이블'} 의 ${mm}mm 로 재단되므로 개별 입력은 필요 없다 — 다른 길이로 잘라야 한다면 이 심선에 길이를 직접 넣어야 한다.`,
        targetId: w.id,
        where: whereWire(w),
      });
      continue;
    }
    out.push({
      id: 'length-missing',
      level: 'error',
      title: cable ? '길이 미입력 — 케이블에도 길이가 없다' : '길이 미입력',
      detail: cable
        ? `${cable.name ?? '케이블'} 에도 길이가 없어 이 심선을 몇 mm 로 자를지 알 수 없다 — 케이블이나 심선 중 한쪽에 길이를 넣어야 한다.`
        : '길이가 없으면 전선을 재단할 수도, 견적을 낼 수도 없다 — 도면의 길이가 그대로 발주 수량이 된다.',
      targetId: w.id,
      where: whereWire(w),
    });
  }

  // ================================================================
  // 5. 떠 있는 커넥터 / 장치
  //    커넥터는 배선 없이도 파트리스트에 실려 발주된다 → warn.
  //    장치는 발주 대상이 아니라 참고 블록이다 → info.
  // ================================================================
  for (const c of doc.connectors) {
    if (wired.has(c.id)) continue;
    out.push({
      id: 'floating',
      level: 'warn',
      title: `배선 없음 — ${housingName(c)}`,
      detail: '배선이 하나도 붙지 않았는데 파트리스트에는 수량으로 잡힌다 — 쓰지 않을 커넥터라면 지우고, 쓸 것이라면 배선을 이어야 한다.',
      targetId: c.id,
      where: whereConn(c),
    });
  }
  for (const d of doc.devices) {
    if (wired.has(d.id)) continue;
    out.push({
      id: 'floating',
      level: 'info',
      title: `배선 없음 — ${d.name}`,
      detail: '어떤 배선도 이 장치에 닿지 않아 도면에서 아무 역할을 하지 않는다 — 참고 표기가 아니라면 연결하거나 지우는 편이 낫다.',
      targetId: d.id,
      where: `${refs.get(d.id) ?? 'D?'} ${d.name}`,
    });
  }

  // ================================================================
  // 6. 스플라이스 결선 부족 — 3가닥부터 "모으는" 의미가 생긴다
  // ================================================================
  for (const c of doc.connectors) {
    if (c.kind !== 'splice') continue;
    const n = strandsAt.get(c.id) ?? 0;
    if (n === 0 || n >= 3) continue;             // 0가닥은 위의 '배선 없음'이 잡는다
    out.push({
      id: 'splice-underused',
      level: n === 1 ? 'warn' : 'info',
      title: `스플라이스 ${n}가닥`,
      detail: n === 1
        ? '한 가닥만 물린 스플라이스는 끝이 열려 있다 — 나머지 가닥을 잇거나 스플라이스를 지워야 한다.'
        : '두 가닥이면 갈래가 없는 단순 연장이라, 스플라이스 대신 전선을 통으로 뽑거나 중간결선 커넥터를 쓰는 편이 접점이 하나 줄어 안전하다.',
      targetId: c.id,
      where: whereConn(c),
    });
  }

  // ================================================================
  // 7. 규격 색 불일치 — RJ45 T568B 처럼 색이 곧 규격인 커넥터에서 중요하다
  // ================================================================
  for (const w of doc.wires) {
    const actual = normColor(colorLabel(w.color));
    for (const e of [w.from, w.to]) {
      if (e.type !== 'pin') continue;
      const c = connById.get(e.connectorId);
      if (!c) continue;
      const p = pinOf.get(`${c.id}:${e.pinId}`);
      if (!p) continue;
      const slot = slotOf.get(`${c.housingId}:${p.index}`);
      const std = slot?.stdColor;
      if (!std || normColor(std) === actual) continue;
      out.push({
        id: 'std-color-mismatch',
        level: 'warn',
        title: `규격 색 불일치 — ${colorLabel(w.color)} (규격 ${std})`,
        detail: `${slot?.signal ? `${slot.signal} 은 ` : ''}규격상 ${std} 이다 — 색이 다르면 나중에 이 하네스를 고치는 사람이 도면 없이 핀을 짚을 수 없고, 규격품과 섞였을 때 오결선이 난다.`,
        targetId: w.id,
        where: whereEnd(e),
      });
    }
  }

  // ================================================================
  // 8. 자기 자신에 연결 — 같은 커넥터의 핀끼리. 스플라이스는 정상이라 제외.
  //    루프백·점퍼로 일부러 하는 경우가 있어 error 가 아니라 warn 이다.
  // ================================================================
  for (const w of doc.wires) {
    if (w.from.type !== 'pin' || w.to.type !== 'pin') continue;
    if (w.from.connectorId !== w.to.connectorId) continue;
    if (connById.get(w.from.connectorId)?.kind === 'splice') continue;
    out.push({
      id: 'self-loop',
      level: 'warn',
      title: '같은 커넥터의 핀끼리 연결',
      detail: '한 커넥터 안에서 되돌아오는 배선은 루프백·점퍼가 아니라면 대개 반대편 커넥터를 잘못 고른 것이다 — 의도한 점퍼라면 그대로 두면 된다.',
      targetId: w.id,
      where: whereWire(w),
    });
  }

  // ================================================================
  // 9. 중복 배선 — 완전히 같은 두 끝점
  // ================================================================
  const byPair = new Map<string, Wire[]>();
  for (const w of doc.wires) {
    const [a, b] = [endpointKey(w.from), endpointKey(w.to)].sort();
    push(byPair, `${a}|${b}`, w);
  }
  for (const ws of byPair.values()) {
    if (ws.length < 2) continue;
    const dup = ws.slice(1);
    out.push({
      id: 'duplicate-wire',
      level: 'error',
      title: `중복 배선 ${ws.length}본 — ${ws.map((w) => wireNo.get(w.id)).join(' ')}`,
      detail: '같은 두 끝점을 잇는 배선이 여러 개면 파트리스트의 전선 길이와 압착 개소가 그만큼 부풀고, 현장에서는 한 핀에 몇 가닥을 넣어야 하는지 알 수 없다.',
      targetId: dup[0].id,
      where: whereWire(ws[0]),
    });
  }

  // ================================================================
  // 10. 게이지 불일치 — 같은 네트인데 굵기가 다르다
  // ================================================================
  for (const net of computeNets(doc)) {
    const gs = net.wireIds
      .map((id) => wireById.get(id)?.gauge)
      .filter((g): g is Gauge => g != null);
    const uniq = [...new Map(gs.map((g) => [gaugeLabel(g), g])).values()];
    if (uniq.length < 2) continue;
    const thin = thinnest(uniq);
    out.push({
      id: 'gauge-mismatch',
      level: 'warn',
      title: `네트 ${net.code} 게이지 혼재 — ${uniq.map(gaugeLabel).join(' · ')}`,
      detail: thin
        ? `전기적으로 한 줄인데 굵기가 다르면 허용 전류는 가장 얇은 ${gaugeLabel(thin)} 에 맞춰 잡히고, 굵은 쪽만 보고 정격을 판단하면 얇은 구간이 먼저 탄다.`
        : '한 네트 안에 AWG 와 mm² 가 섞여 있어 어느 쪽이 얇은지 도면만으로는 알 수 없다 — 단위를 하나로 통일해야 한다.',
      targetId: net.wireIds[0],
      where: `${net.code} ${net.label}`,
    });
  }

  // ================================================================
  // 15. 입력한 구간 길이가 배선에서 나온 값과 다르다
  //     구간 길이는 근거가 없을 때 사람이 넣는 값이다(대부분의 분기 구간이 그렇다).
  //     그런데 **근거가 있는데도** 다른 값이 들어와 있으면 둘 중 하나는 틀렸다:
  //     도면 치수는 입력값을 따르고 전선은 배선 길이대로 재단되므로, 그대로 두면
  //     자른 전선이 도면 치수에 맞지 않는다.
  //     자동으로 고치지 않는다 — 실측이 맞는지 배선 입력이 맞는지는 사람만 안다.
  //
  // 16. 어느 구간에도 붙지 않는 입력 길이
  //     배선을 고치면 구간이 갈라지거나 합쳐진다. 그때 옛 키에 남은 값은 화면
  //     어디에도 나오지 않은 채 파일에만 남아, 다음에 여는 사람이 "분명히 넣었는데"
  //     하고 헤매게 만든다. 지우는 것은 사람 몫이라 알리기만 한다.
  // ================================================================
  {
    const entered = doc.segmentLengths;
    // 쓴 적 없는 문서에서는 구간 산출 자체를 돌리지 않는다
    if (entered && Object.keys(entered).length > 0) {
      const model = buildPhysicalModel(doc);
      const segByKey = new Map(model.segments.map((s) => [s.key, s]));
      const orphans: string[] = [];

      for (const [key, mm] of Object.entries(entered)) {
        const seg = segByKey.get(key);
        if (!seg) { orphans.push(key); continue; }
        if (seg.derivedMm == null || seg.derivedMm === mm) continue;
        const codes = seg.directWireIds.map((id) => wireNo.get(id) ?? 'W?').join(' ');
        out.push({
          id: 'segment-length-conflict',
          level: 'warn',
          title: `구간 길이 불일치 — 입력 ${mm}mm · 배선 ${seg.derivedMm}mm`,
          detail: `${seg.code} 은 ${codes} 한 본이 통째로 지나는 구간이라 배선 길이가 곧 구간 길이다 — 입력값이 다르면 도면 치수와 실제로 잘리는 전선이 어긋나므로, 실측이 맞으면 배선 길이를, 배선이 맞으면 입력값을 고쳐야 한다.`,
          targetId: seg.directWireIds[0],
          where: `${seg.code} ${seg.fromRef} → ${seg.toRef}`,
        });
      }

      if (orphans.length > 0) {
        out.push({
          id: 'segment-length-orphan',
          level: 'info',
          title: `쓰이지 않는 구간 길이 ${orphans.length}건`,
          detail: '배선이 바뀌어 그 구간이 더는 없다 — 입력해 둔 길이가 도면에 나오지 않고 파일에만 남아 있으므로, 지금 구간표에서 다시 넣거나 그대로 두면 된다.',
          where: `${doc.name} 구간 길이`,
        });
      }
    }
  }

  // ================================================================
  // 17. 배선이 부품을 지난다 — 도면에서 그 구간이 가려진다
  //
  //     배선은 노드보다 아래층에 그려지고 하우징은 흰색으로 채워진다. 그래서
  //     경로가 커넥터 상자를 지나면 **그 구간만 선이 사라진다** — 화면에서도,
  //     공장에 나가는 PDF 에서도. 도면을 읽는 사람은 선이 거기서 끝난 줄 안다.
  //
  //     라우터가 상자를 비켜 가지만(canvas/route.ts) 항상 되는 것은 아니다:
  //       · 회피 되풀이가 상한(MAX_AVOID_PASSES)에 걸린 배치
  //       · 부품을 서로 겹쳐 놓아 애초에 비킬 자리가 없는 배치
  //     그때 라우터는 **그리기는 그린다** — 선을 지우는 것보다 낫기 때문이다.
  //     대신 그 사실이 조용히 묻히면 안 되므로 여기서 알린다.
  //
  //     왜 warn 인가: 만들 수는 있고 접속표·자재표도 멀쩡하다(error 아님).
  //     하지만 산출물인 도면이 실제로 잘못 보이고, 자동으로 고칠 수 없다 —
  //     부품을 조금 옮기는 것은 사람의 판단이다. "알고만 있으면 되는 것"(info)
  //     보다는 한 칸 위다.
  //
  //     왜 라우터에게 물어보지 않나: `segHitsBox` 머리말 참고. 최종 경로를
  //     직접 다시 잰다.
  // ================================================================
  if (doc.wires.length > 0) {
    // 노드 상자·경로는 문서당 한 번만 만든다(배선 N × 노드 M 이라 되풀이가 비싸다)
    const boxes = nodeBoxes(doc, 'logical');
    planWires(doc, 'logical').forEach((plan, i) => {
      const w = doc.wires[i];
      if (!w) return;
      // 제 끝 노드는 제외한다 — 핸들이 그 상자 변에 붙어 있어 판정 기준이 다르다
      const ends = new Set(
        [w.from, w.to].map((e) => (e.type === 'pin' ? e.connectorId : e.deviceId)),
      );
      const hit: string[] = [];
      for (const n of boxes) {
        if (ends.has(n.id)) continue;
        const crossed = plan.points.some(
          (p, k) => k > 0 && segHitsBox(plan.points[k - 1], p, n.box),
        );
        if (crossed) hit.push(refs.get(n.id) ?? n.id);
      }
      if (hit.length === 0) return;
      out.push({
        id: 'wire-crosses-part',
        level: 'warn',
        title: `배선이 부품을 지남 — ${hit.join(' ')}`,
        detail: `도면에서 ${hit.join('·')} 블록이 이 배선 위를 덮으므로 그 구간의 선이 화면에도 PDF 에도 보이지 않는다 — 선이 거기서 끊긴 것처럼 읽힌다. 가운데 부품을 위아래로 조금 옮기거나 사이를 벌리면 배선이 비켜 간다.`,
        targetId: w.id,
        where: whereWire(w),
      });
    });
  }

  return sortIssues(out);
}

/** error → warn → info. 같은 레벨 안에서는 문서 순서를 유지한다(안정 정렬). */
export function sortIssues(issues: Issue[]): Issue[] {
  return [...issues].sort(
    (a, b) => LEVEL_ORDER.indexOf(a.level) - LEVEL_ORDER.indexOf(b.level),
  );
}
