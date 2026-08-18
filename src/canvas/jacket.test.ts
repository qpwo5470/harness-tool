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
import { cableDoc } from '../fixtures/cableDoc';
import { fanoutDoc } from '../fixtures/fanoutDoc';
import { sampleDoc } from '../fixtures/sampleDoc';
import { JACKET_UNSPEC_COLOR, jacketPaint } from './docToFlow';
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

// ============================================================
describe('대조군 — 자켓이 없으면 케이블은 도면에서 사라진다', () => {
  it('케이블을 걷어 내도 배선 경로는 한 점도 달라지지 않는다', () => {
    const doc = cableDoc();
    // 자켓은 **덧그리는 것**이지 라우팅이 아니다. 경로가 달라지면 기존 밀도 시험이
    // 재는 겹침·관통 수치가 통째로 무의미해진다.
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

  it('한 케이블의 심선이 도면에서 벌어져 있으면 자켓을 그리지 않는다', () => {
    // 샘플 문서의 2심은 스플라이스에서 나오자마자 위·아래로 갈린다(178px).
    // 그 둘을 한 사각형으로 묶으면 도면이 "이 둘은 같은 외피 안" 이라고 거짓말한다.
    const j = jacketOf(planJackets(sampleDoc), 'cbl-1');
    expect(j.coreIds).toEqual(['w2', 'w3']);
    expect(j.runs).toEqual([]);
    expect(j.labelAt).toBeNull();
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
