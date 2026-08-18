/**
 * 케이블 자켓(외피) 기하 — 못박는 자리.
 *
 * 고치기 전 상태: `jacketColor` 는 표·CSV 에만 실렸고 도면에는 한 획도 나오지
 * 않았다. 그래서 **케이블이 있는 문서와 없는 문서의 그림이 완전히 같았다** —
 * 제작자는 도면만 보고 "이 세 가닥은 한 케이블" 이라는 것을 알 수 없었다.
 * 아래 첫 describe 의 대조군이 그 사실을 그대로 잰다.
 *
 * 여기서 붙잡는 것 네 가지.
 *   1) 같은 케이블 심선이 나란히 가는 구간이 **하나의 자켓**으로 나온다
 *   2) 갈라지는 자리에서 자켓이 끝난다 — 패드(각자 제 핀)는 자켓 밖이다
 *   3) 자켓이 **남의 전선을 삼키지 않는다**
 *   4) 자켓은 배선 경로를 **한 점도 바꾸지 않는다** (덧그리는 것이지 라우팅이 아니다)
 */
import { describe, it, expect } from 'vitest';
import type { HarnessDocument } from '../types';
import { cableDoc, laneSplitDoc } from '../fixtures/cableDoc';
import { fanoutDoc } from '../fixtures/fanoutDoc';
import { sampleDoc } from '../fixtures/sampleDoc';
import {
  JACKET_UNSPEC_COLOR, assignLanes, colorLanes, jacketPaint, laneOffset, LANE_Y_STEP,
} from './docToFlow';
import { planJackets, planWires, type JacketRun, type PlannedJacket } from './wirePlan';

/** 케이블만 걷어 낸 같은 문서 — "고치기 전" 그림을 만드는 데 쓴다 */
function withoutCables(doc: HarnessDocument): HarnessDocument {
  return {
    ...doc,
    cables: [],
    wires: doc.wires.map(({ cableId: _drop, ...rest }) => rest),
  };
}

const jacketOf = (list: PlannedJacket[], id: string) => list.find((j) => j.cableId === id)!;

/** 점이 사각형 **속**에 있는가 (변에 닿기만 하는 건 아니다) */
function inside(p: { x: number; y: number }, r: JacketRun, eps = 1e-6): boolean {
  return p.x > r.x + eps && p.x < r.x + r.w - eps && p.y > r.y + eps && p.y < r.y + r.h - eps;
}

/**
 * 실제로 그려질 경로에서 **포개지는 선분 쌍**. 판정은 밀도 시험(docToFlow.test ·
 * thirdNode.test)과 같은 규칙이다 — 같은 축에서 2px 안쪽이면 눈으로 구분되지 않는다.
 */
function overlapPairs(doc: HarnessDocument, tol = 2): string[] {
  type Seg = { wire: string; axis: 'h' | 'v'; at: number; a: number; b: number };
  const segs: Seg[] = [];
  for (const r of planWires(doc)) {
    for (let k = 1; k < r.points.length; k++) {
      const p = r.points[k - 1];
      const q = r.points[k];
      if (Math.abs(p.y - q.y) < 1e-6 && Math.abs(p.x - q.x) > 1e-6) {
        segs.push({ wire: r.id, axis: 'h', at: p.y, a: Math.min(p.x, q.x), b: Math.max(p.x, q.x) });
      } else if (Math.abs(p.x - q.x) < 1e-6 && Math.abs(p.y - q.y) > 1e-6) {
        segs.push({ wire: r.id, axis: 'v', at: p.x, a: Math.min(p.y, q.y), b: Math.max(p.y, q.y) });
      }
    }
  }
  const out: string[] = [];
  for (let i = 0; i < segs.length; i++) {
    for (let j = i + 1; j < segs.length; j++) {
      const x = segs[i];
      const y = segs[j];
      if (x.wire === y.wire || x.axis !== y.axis) continue;
      if (Math.abs(x.at - y.at) >= tol) continue;
      if (Math.min(x.b, y.b) - Math.max(x.a, y.a) > tol) out.push(`${x.wire}/${y.wire}@${x.axis}${x.at}`);
    }
  }
  return out;
}

// ============================================================
describe('대조군 — 자켓이 없으면 케이블은 도면에서 사라진다', () => {
  it('케이블을 걷어 내도 배선 경로는 한 점도 달라지지 않는다', () => {
    const doc = cableDoc();
    // 자켓 자체는 **덧그리는 것**이지 라우팅이 아니다 — 사각형이 경로를 밀지 않는다.
    //
    // 다만 레인 배정은 케이블을 본다(docToFlow.groupLanesByCable): 같은 케이블
    // 심선이 이웃 높이에 오도록 **레인 번호를 바꿔 달** 수 있다. 그 손질은
    // 실제로 그려 보고 **이득이 있을 때만** 들어간다(laneCost). 이 픽스처는
    // 이미 심선끼리 이웃이라 바꿀 이득이 없어 경로가 그대로다 —
    // 바뀌는 배치는 아래 `레인 갈림` describe 가 따로 잰다.
    expect(planWires(withoutCables(doc))).toEqual(planWires(doc));
  });

  it('케이블이 없으면 그릴 자켓이 하나도 없다 — 그게 고치기 전 도면이었다', () => {
    expect(planJackets(withoutCables(cableDoc()))).toEqual([]);
    // 반대로 지금은 그려진다 (아래 시험들이 그 모양을 잰다)
    expect(planJackets(cableDoc()).some((j) => j.runs.length > 0)).toBe(true);
  });
});

// ============================================================
describe('나란히 가는 구간이 하나의 자켓으로 나온다', () => {
  const doc = cableDoc();
  const jackets = planJackets(doc);

  it('3심이 끝까지 나란히 가는 케이블은 자켓 사각형 하나로 묶인다', () => {
    const cbP = jacketOf(jackets, 'cb-p');
    expect(cbP.coreIds).toEqual(['p1', 'p2', 'p3']);
    expect(cbP.runs).toHaveLength(1);
    expect(cbP.runs[0].wireIds).toEqual(['p1', 'p2', 'p3']);
    // 가로 주행 구간이고, 세 심선을 전부 담을 만큼만 두껍다
    expect(cbP.runs[0].axis).toBe('h');
    expect(cbP.runs[0].w).toBeGreaterThan(cbP.runs[0].h);
  });

  it('자켓 안에는 그 케이블 심선만 있다 — 맨선·다른 케이블은 들어오지 않는다', () => {
    const routes = new Map(planWires(doc).map((r) => [r.id, r]));
    for (const j of jackets) {
      const mine = new Set(j.coreIds);
      for (const r of j.runs) {
        expect(r.wireIds.every((id) => mine.has(id))).toBe(true);
        // 남의 전선의 꺾임점이 자켓 속에 들어와 있으면 도면이 그 가닥을 심선으로 읽힌다
        for (const w of doc.wires) {
          if (mine.has(w.id)) continue;
          const hit = routes.get(w.id)!.points.filter((p) => inside(p, r));
          expect(hit, `${w.id} 이 ${j.cableId} 자켓 속에 들어왔다`).toEqual([]);
        }
      }
    }
  });

  /**
   * ── 왜 여기는 레인을 이웃에 놓아도 안 되나 (재서 확인한 값)
   * 샘플 문서의 2심은 스플라이스에서 나오자마자 위·아래로 갈린다.
   *   · w2 는 J2(o=90)의 **위쪽** 핸들로 들어가야 하고, 스플라이스 상자를 넘는
   *     밀어내기는 언제나 바깥쪽이라(route.pushOut, dir=-1) 주행 구간이 y=68 위로
   *     **고정**된다. 레인을 아무리 키워도 더 올라갈 뿐 내려오지 못한다.
   *   · w3 는 장치(y=320)의 오른쪽 단자로 가므로 주행 구간이 y=246.25 다.
   * 두 값을 나란히 만들려면 laneY 가 **±104px** (레인 8~9칸)이 필요하다 —
   * laneY 를 −400..400 까지 4px 씩, laneX 를 0..30 까지 훑어 얻은 최솟값이다.
   * 그건 레인 순서가 아니라 **다른 길로 돌아가라는 지시**이고, 심선 한 본을 240px
   * 우회시켜 자켓을 만들어 내는 것은 도면을 위해 배선을 왜곡하는 짓이다.
   *
   * 즉 이 배치에서 자켓이 없는 것은 결함이 아니라 **사실**이다 — 두 심선은 정말로
   * 함께 가는 구간이 없다. 속성 패널의 케이블 카드가 그 사실을 그대로 말한다.
   */
  it('심선이 서로 반대쪽으로 갈라져 나가면 자켓을 그리지 않는다 (샘플 문서)', () => {
    const j = jacketOf(planJackets(sampleDoc), 'cbl-1');
    expect(j.coreIds).toEqual(['w2', 'w3']);
    expect(j.runs).toEqual([]);
    expect(j.labelAt).toBeNull();
  });
});

// ============================================================
describe('레인 갈림 — 케이블 심선을 이웃 높이에 놓는다', () => {
  const doc = laneSplitDoc();

  /**
   * 대조군. 케이블을 모르는 채색(colorLanes)이 실제로 심선을 갈라 놓는지 먼저 잰다 —
   * 이 값이 0 이면 아래 시험은 아무것도 붙잡지 못한다.
   */
  it('케이블을 모르는 채색은 심선 사이에 남의 배선을 끼워 넣는다 (대조군)', () => {
    const lanes = assignLanes(doc, 'logical');
    const plain = colorLanes(doc.wires.map((_, i) => [lanes.from[i].x, lanes.to[i].x] as [number, number]))
      .map((k) => laneOffset(k, LANE_Y_STEP));
    const cores = doc.wires.map((w, i) => (w.cableId ? i : -1)).filter((i) => i >= 0);
    expect(cores).toHaveLength(2);
    const lo = Math.min(plain[cores[0]], plain[cores[1]]);
    const hi = Math.max(plain[cores[0]], plain[cores[1]]);
    const between = plain.filter((v, i) => !cores.includes(i) && v > lo && v < hi);
    expect(between).toEqual([12]);   // w2 가 +12 로 두 심선(0, +24) 사이를 지난다
  });

  it('고친 뒤 — 심선이 한 칸 간격으로 나란히 서고 사이에 아무도 없다', () => {
    const lanes = assignLanes(doc, 'logical');
    const cores = doc.wires.map((w, i) => (w.cableId ? i : -1)).filter((i) => i >= 0);
    const lo = Math.min(lanes.laneY[cores[0]], lanes.laneY[cores[1]]);
    const hi = Math.max(lanes.laneY[cores[0]], lanes.laneY[cores[1]]);
    expect(hi - lo).toBe(LANE_Y_STEP);
    expect(lanes.laneY.filter((v, i) => !cores.includes(i) && v > lo && v < hi)).toEqual([]);
  });

  it('그래서 자켓이 한 토막으로 이어진다 (고치기 전에는 하나도 없었다)', () => {
    const j = jacketOf(planJackets(doc), 'cb-s');
    expect(j.coreIds).toEqual(['w1', 'w4']);
    expect(j.runs).toHaveLength(1);
    expect(j.runs[0].axis).toBe('h');
    expect(j.runs[0].wireIds).toEqual(['w1', 'w4']);
    // 두 커넥터 사이를 가로지르는 주행 구간 전체를 덮는다 (600px 넘는 몸통)
    expect(j.runs[0].w).toBeGreaterThan(600);
    expect(j.labelAt).not.toBeNull();
  });

  it('자켓 속에 남의 배선이 한 점도 들어오지 않는다', () => {
    const routes = new Map(planWires(doc).map((r) => [r.id, r]));
    const j = jacketOf(planJackets(doc), 'cb-s');
    for (const r of j.runs) {
      for (const w of doc.wires) {
        if (j.coreIds.includes(w.id)) continue;
        expect(routes.get(w.id)!.points.filter((p) => inside(p, r)), w.id).toEqual([]);
      }
    }
  });

  /**
   * 심선을 이웃에 놓는 것은 **레인 순서를 바꾸는 것**이지 겹치게 놓는 것이 아니다.
   * 번호를 바꿔 달아도 채색의 성질(겹치는 배선끼리 다른 레인)은 그대로이므로
   * 이 배치의 여섯 본은 여전히 한 줄도 포개지지 않아야 한다.
   */
  it('겹침 0 — 심선을 붙여 놓아도 선끼리 포개지지 않는다', () => {
    expect(overlapPairs(doc)).toEqual([]);
  });
});

// ============================================================
describe('케이블이 여럿이어도 서로를 흔들지 않는다', () => {
  // cableDoc 은 케이블 2개 + 맨선 1본이고, CB-Y 의 심선은 **서로 다른 커넥터 쌍**을
  // 잇는다(y1→J2 · y2·y3→J3). 레인을 케이블별로 몰아 놓는 손질이 다른 케이블의
  // 자켓을 뺏거나 끊지 않는지 본다.
  const doc = cableDoc();
  const jackets = planJackets(doc);

  it('두 케이블이 각자의 자켓을 갖고, 토막의 심선은 제 케이블 것뿐이다', () => {
    expect(jackets.map((j) => j.cableId)).toEqual(['cb-p', 'cb-y']);
    for (const j of jackets) {
      expect(j.runs.length).toBeGreaterThan(0);
      const mine = new Set(j.coreIds);
      for (const r of j.runs) expect(r.wireIds.every((id) => mine.has(id))).toBe(true);
    }
  });

  it('심선이 다른 커넥터로 갈라지면 갈라진 뒤 구간만 묶인다', () => {
    const cbY = jacketOf(jackets, 'cb-y');
    // y1 만 J2 로 빠지므로 셋이 다 든 토막은 없다
    expect(cbY.runs.every((r) => r.wireIds.length >= 2 && r.wireIds.length < 3)).toBe(true);
  });
});

// ============================================================
describe('갈라지는 자리에서 자켓이 끝난다', () => {
  const doc = cableDoc();
  const jackets = planJackets(doc);
  const routes = new Map(planWires(doc).map((r) => [r.id, r]));

  it('심선의 양 끝 패드는 어느 자켓에도 들어 있지 않다', () => {
    // 실제 케이블도 끝에서 자켓을 벗겨 심선을 각 단자에 압착한다.
    // 여기가 덮이면 도면이 "이 핀들이 한 외피 안에 있다" 고 말하게 된다.
    for (const j of jackets) {
      for (const id of j.coreIds) {
        const pts = routes.get(id)!.points;
        for (const p of [pts[0], pts[pts.length - 1]]) {
          for (const r of j.runs) {
            expect(inside(p, r), `${id} 패드 ${JSON.stringify(p)} 가 자켓 속에 있다`).toBe(false);
          }
        }
      }
    }
  });

  it('3심 중 한 본이 다른 커넥터로 빠지면 그 뒤 구간은 2심 자켓이 된다', () => {
    // CB-Y 는 J1 에서 셋이 함께 나갔다가 y1 만 J2 로, y2·y3 는 J3 로 간다.
    const cbY = jacketOf(jackets, 'cb-y');
    expect(cbY.coreIds).toEqual(['y1', 'y2', 'y3']);
    expect(cbY.runs.length).toBeGreaterThan(0);
    // 자켓 토막마다 "그 구간을 함께 지나는 심선" 이 적혀 있고, 셋이 다 든 토막은 없다
    // (한 본이 이미 빠져나갔으므로 — 그게 이 도면이 말해야 하는 사실이다)
    const counts = new Set(cbY.runs.map((r) => r.wireIds.length));
    expect([...counts].every((n) => n >= 2)).toBe(true);
    expect(cbY.runs.some((r) => r.wireIds.join('|') === 'y2|y3')).toBe(true);
  });
});

// ============================================================
describe('자켓색', () => {
  it('지정하면 그 색 실선 윤곽이다', () => {
    const paint = jacketPaint('black');
    expect(paint).toEqual({ color: 'black', dashed: false });
    // 도면 계획에도 원문이 그대로 실린다(색 해석은 그리는 쪽이 한다)
    expect(jacketOf(planJackets(cableDoc({ jacketColor: 'black' })), 'cb-p').jacketColor).toBe('black');
  });

  it('미지정이면 색을 지어내지 않고 중립색 **점선**으로 그린다', () => {
    // 검정을 기본값으로 깔면 도면이 "검은 자켓" 이라고 말하고, 받는 사람은 검정을 산다.
    expect(jacketOf(planJackets(cableDoc()), 'cb-p').jacketColor).toBeUndefined();
    const paint = jacketPaint(undefined);
    expect(paint.dashed).toBe(true);
    expect(paint.color).toBe(JACKET_UNSPEC_COLOR);
    // 빈 문자열·공백만 있는 값도 미지정으로 본다 (직접 입력칸을 비운 경우)
    expect(jacketPaint('   ')).toEqual({ color: JACKET_UNSPEC_COLOR, dashed: true });
  });

  it('자켓색이 있든 없든 **기하는 같다** — 색이 그림 모양을 바꾸지 않는다', () => {
    const unspec = jacketOf(planJackets(cableDoc()), 'cb-p');
    const black = jacketOf(planJackets(cableDoc({ jacketColor: 'black' })), 'cb-p');
    expect(black.runs).toEqual(unspec.runs);
    expect(black.labelAt).toEqual(unspec.labelAt);
  });
});

// ============================================================
describe('이름표', () => {
  it('자켓 몸통에 케이블 이름이 붙는다 — 윤곽만으로는 어느 케이블인지 알 수 없다', () => {
    const cbP = jacketOf(planJackets(cableDoc()), 'cb-p');
    expect(cbP.label).toBe('3C 제어');
    expect(cbP.labelAt).not.toBeNull();
    // 몸통 사각형 바로 위 (도면에서 눈이 먼저 가는 자리)
    expect(cbP.labelAt!.y).toBeLessThan(cbP.runs[0].y);
  });

  it('이름이 없으면 코어 수로 부른다 — 빈 이름표를 그리지 않는다', () => {
    const doc = cableDoc();
    doc.cables = doc.cables!.map((c) => (c.id === 'cb-p' ? { ...c, name: undefined } : c));
    expect(jacketOf(planJackets(doc), 'cb-p').label).toBe('3C 케이블');
  });
});

// ============================================================
describe('밀도 — 20본 팬아웃에서도 자켓이 남의 전선을 삼키지 않는다', () => {
  /** 팬아웃 20본 중 세 본을 한 케이블로 묶는다 */
  function densely(): HarnessDocument {
    const doc = fanoutDoc();
    const mine = new Set(['ac0', 'ac1', 'ac2']);
    return {
      ...doc,
      cables: [{ id: 'cb', name: '3C', coreCount: 3, lengthMm: 500 }],
      wires: doc.wires.map((w) => (mine.has(w.id) ? { ...w, cableId: 'cb' } : w)),
    };
  }

  it('케이블을 얹어도 배선 경로가 달라지지 않는다 (기존 밀도 시험의 전제)', () => {
    expect(planWires(densely())).toEqual(planWires(fanoutDoc()));
  });

  it('그려진 자켓 안에 다른 배선의 꺾임점이 하나도 없다', () => {
    const doc = densely();
    const routes = new Map(planWires(doc).map((r) => [r.id, r]));
    for (const j of planJackets(doc)) {
      const mine = new Set(j.coreIds);
      for (const r of j.runs) {
        for (const w of doc.wires) {
          if (mine.has(w.id)) continue;
          expect(routes.get(w.id)!.points.filter((p) => inside(p, r))).toEqual([]);
        }
      }
    }
  });
});
