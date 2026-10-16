/**
 * CLI 가 쓰는 Node 내장 모듈의 **최소 타입**.
 *
 * 저장소는 브라우저 앱이라 @types/node 를 두지 않는다(넣으면 전역 타입이 앱 코드에
 * 섞인다 — setTimeout 의 반환형 등). CLI 는 아래 몇 함수만 쓰므로 그만큼만 적는다.
 * 실제 구현은 Node 의 것이다. @types/node 를 들이게 되면 이 파일을 지우면 된다.
 */
declare module 'node:fs' {
  export function readFileSync(path: string, enc: 'utf8'): string;
  export function readFileSync(path: string): Uint8Array;
  export function writeFileSync(path: string, data: string | Uint8Array): void;
  export function existsSync(path: string): boolean;
  export function mkdirSync(path: string, opts?: { recursive?: boolean }): void;
  export function readdirSync(path: string): string[];
  export function realpathSync(path: string): string;
  export function statSync(path: string): { size: number; isDirectory(): boolean };
}
declare module 'node:path' {
  export function join(...p: string[]): string;
  export function resolve(...p: string[]): string;
  export function dirname(p: string): string;
  export function basename(p: string, ext?: string): string;
  export function extname(p: string): string;
}
declare module 'node:url' {
  export function fileURLToPath(u: string | URL): string;
}
declare module 'node:module' {
  export function createRequire(from: string): (id: string) => unknown;
}
declare module 'node:child_process' {
  export function execSync(cmd: string, opts?: { encoding?: 'utf8'; timeout?: number; stdio?: unknown }): string;
}

declare const process: {
  argv: string[];
  env: Record<string, string | undefined>;
  cwd(): string;
  exit(code?: number): never;
  exitCode?: number;
  stdout: { write(s: string): boolean };
  stderr: { write(s: string): boolean };
  stdin: { on(ev: string, fn: (chunk: unknown) => void): void; setEncoding(enc: string): void; isTTY?: boolean };
};

/** 번들(build-cli.mjs)이 심는 데이터시트 캡처 — `{ 'datasheets/xh.png': 'data:image/png;base64,…' }` */
declare const __HARNESS_DATASHEETS__: Record<string, string> | undefined;
/** 번들 버전 문자열 */
declare const __HARNESS_CLI_VERSION__: string | undefined;
