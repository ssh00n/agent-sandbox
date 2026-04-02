declare module "node:path" {
  const sep: string;

  function join(...paths: string[]): string;
  function resolve(...paths: string[]): string;

  export { join, resolve, sep };
  export default {
    join,
    resolve,
    sep
  };
}

declare module "node:http" {
  interface IncomingMessage {
    method?: string;
    url?: string;
    on(event: "data", listener: (chunk: Buffer | string) => void): this;
    on(event: "end", listener: () => void): this;
    on(event: "error", listener: (error: Error) => void): this;
  }

  interface ServerResponse {
    statusCode: number;
    setHeader(name: string, value: string): void;
    writeHead(statusCode: number, headers?: Record<string, string>): this;
    end(chunk?: string): void;
  }

  interface Server {
    listen(port: number, host: string, callback?: () => void): void;
  }

  function createServer(
    handler: (request: IncomingMessage, response: ServerResponse) => void | Promise<void>
  ): Server;

  const http: {
    createServer: typeof createServer;
  };

  export { createServer, IncomingMessage, ServerResponse };
  export default http;
}

declare module "node:fs/promises" {
  function access(path: string): Promise<void>;
  function appendFile(path: string, data: string): Promise<void>;
  function mkdir(path: string, options?: { recursive?: boolean }): Promise<void>;
  function mkdtemp(prefix: string): Promise<string>;
  function readdir(path: string): Promise<string[]>;
  function readFile(path: string, encoding: string): Promise<string>;
  function rm(
    path: string,
    options?: { force?: boolean; recursive?: boolean }
  ): Promise<void>;
  function writeFile(path: string, data: string): Promise<void>;

  export { access, appendFile, mkdir, mkdtemp, readFile, readdir, rm, writeFile };
}

declare module "node:child_process" {
  interface SpawnOptions {
    cwd?: string;
    env?: Record<string, string | undefined>;
  }

  interface ReadableStreamLike {
    on(event: "data", listener: (chunk: Buffer | string) => void): this;
  }

  interface ChildProcess {
    stdout?: ReadableStreamLike;
    stderr?: ReadableStreamLike;
    on(event: "error", listener: (error: Error) => void): this;
    on(event: "close", listener: (code: number | null) => void): this;
    kill(signal?: string): boolean;
  }

  function spawn(
    command: string,
    args?: string[],
    options?: SpawnOptions
  ): ChildProcess;

  export { spawn };
}

declare module "node:os" {
  function tmpdir(): string;

  export { tmpdir };
}

declare const console: {
  log(message?: unknown, ...optionalParams: unknown[]): void;
};

declare const process: {
  cwd(): string;
  env: Record<string, string | undefined>;
  platform: string;
};

declare function setTimeout(
  callback: () => void,
  delay: number
): number;

declare function clearTimeout(timeoutId: number): void;

declare class Buffer {
  toString(encoding?: string): string;
}
