# Codex Sandbox Orchestrator

Codex 스타일 샌드박스 실행 환경을 실험하기 위한 TypeScript 프로젝트다.  
현재 구현 범위는 다음을 포함한다.

- 명령 실행 오케스트레이터
- 정책 엔진과 approval flow
- intent / severity / summary 기반 정책 설명
- macOS / Docker runner
- 파일 기반 감사 로그와 run/event 조회
- 검증용 CLI/TUI 래퍼

## Quick Start

```bash
npm run check
npm run build
RUNNER_KIND=docker DOCKER_IMAGE=curlimages/curl:8.12.1 node dist/server/index.js
```

## Main Commands

검증 CLI:

```bash
npm run demo:health
npm run demo:create -- examples/docker-approval-success-run.json
npm run demo:approvals
npm run demo:approve -- <RUN_ID>
npm run demo:runs
npm run demo:run -- <RUN_ID>
npm run demo:events -- <RUN_ID>
npm run demo:all -- examples/docker-approval-success-run.json
```

runner 검증:

```bash
npm run verify:docker
npm run verify:macos
```

## Runtime Config

- 기본 runner: `macos`
- Docker runner: `RUNNER_KIND=docker`
- Docker 기본 이미지: `DOCKER_IMAGE=alpine:3.20`
- macOS fallback: `ALLOW_UNSANDBOXED_FALLBACK=1`
- demo CLI base URL: `DEMO_BASE_URL=http://127.0.0.1:4000`

## Important Files

- app entry: [src/server/index.ts](src/server/index.ts)
- orchestrator: [src/orchestrator/orchestrator.ts](src/orchestrator/orchestrator.ts)
- docker runner: [src/runner/docker/docker-sandbox-runner.ts](src/runner/docker/docker-sandbox-runner.ts)
- macOS runner: [src/runner/macos/macos-sandbox-runner.ts](src/runner/macos/macos-sandbox-runner.ts)
- audit store: [src/audit/file-audit-store.ts](src/audit/file-audit-store.ts)

## Docs

- validation checklist: [docs/validation-checklist.md](docs/validation-checklist.md)
- CLI wrapper testing: [docs/cli-wrapper-testing.md](docs/cli-wrapper-testing.md)
- native runner testing: [docs/native-runner-testing.md](docs/native-runner-testing.md)
- presentation narrative: [docs/presentation-narrative.md](docs/presentation-narrative.md)
- architecture notes: [docs/architecture.md](docs/architecture.md)
