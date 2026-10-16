/**
 * CLI 번들 전용 `@xyflow/react` 대역.
 *
 * 도메인 코드(canvas/geometry·route·docToFlow)가 React Flow 에서 **값으로** 쓰는 것은
 * 문자열 enum `Position` 하나뿐이다(geometry.ts 머리말). 진짜 패키지를 묶으면 React·d3
 * 가 통째로 딸려 오므로, build-cli.mjs 가 이 파일로 별칭을 건다. 값은 원본과 같다.
 */
export enum Position {
  Left = 'left',
  Top = 'top',
  Right = 'right',
  Bottom = 'bottom',
}
export type Node = { id: string; [k: string]: unknown };
export type Edge = { id: string; [k: string]: unknown };
