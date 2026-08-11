import { describe, it, expect, beforeEach } from 'vitest';
import { useHarnessStore } from './harnessStore';
import { sampleDoc } from '../fixtures/sampleDoc';

const S = () => useHarnessStore.getState();

beforeEach(() => S().replaceDoc(sampleDoc));

describe('harnessStore 계약', () => {
  it('초기 문서는 픽스처', () => {
    expect(S().doc.name).toBe('샘플 하네스');
    expect(S().doc.connectors).toHaveLength(3);
  });

  it('addConnector 로 커넥터가 늘어난다', () => {
    S().addConnector({
      id: 'con-x', kind: 'connector', housingId: 'lib-xh-4p',
      orientation: 0, positions: {}, pins: [{ id: 'x1', index: 1 }],
    });
    expect(S().doc.connectors).toHaveLength(4);
  });

  it('remove 는 커넥터와 그에 물린 와이어를 함께 지운다', () => {
    S().remove('con-a'); // w1(from con-a)도 삭제되어야 함
    expect(S().doc.connectors.find((c) => c.id === 'con-a')).toBeUndefined();
    expect(S().doc.wires.find((w) => w.id === 'w1')).toBeUndefined();
  });

  it('exportJson → importJson 라운드트립', () => {
    const json = S().exportJson();
    S().replaceDoc({ ...sampleDoc, connectors: [] }); // 상태 흔들기
    S().importJson(json);
    expect(S().doc.connectors).toHaveLength(3);
  });
});
