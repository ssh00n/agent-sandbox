# Native Runner Testing Guide

## 목적

이 문서는 Docker와 macOS native runner를 같은 방식으로 검증하는 절차를 정리한다.

## 1. 준비

먼저 빌드한다.

```bash
npm run build
```

## 2. Docker 검증

```bash
npm run verify:docker
```

확인 항목:

1. 네트워크 명령이 먼저 `awaiting_approval`로 들어가는지
2. 승인 후 실제 네트워크 요청이 성공하는지
3. agent 기본 네트워크 차단 상태에서는 요청이 실패하는지

주의:

- Docker daemon 접근이 가능해야 한다
- 현재 Codex 내부와 달리 일반 터미널에서는 별도 제한이 없으면 그대로 동작해야 한다

## 3. macOS native 검증

```bash
npm run verify:macos
```

확인 항목:

1. 허용된 cwd에서 로컬 명령이 실행되는지
2. writable root 밖 cwd는 `blocked`로 떨어지는지
3. 네트워크 명령은 `awaiting_approval`로 분기하는지

주의:

- 일반 터미널에서 돌리는 것을 권장한다
- Codex 내부 샌드박스에서는 `sandbox_apply: Operation not permitted`가 날 수 있다
- 상위 제약 때문에 native sandbox 적용이 어렵다면 아래처럼 fallback을 켤 수 있다

```bash
ALLOW_UNSANDBOXED_FALLBACK=1 npm run verify:macos
```

이 fallback은 정책/흐름 검증용이고, 실제 OS-level sandbox 보장은 아니다.

## 4. 출력 해석

각 항목은 다음 세 줄로 출력된다.

- `expected`: 기대 상태
- `actual`: 실제 상태
- `detail`: exit code, stderr 첫 줄, stdout 첫 줄 요약

즉, JSON 전체를 읽지 않아도 핵심만 빠르게 볼 수 있게 한 것이다.

## 5. 관련 문서

- [README.md](../README.md)
- [docs/cli-wrapper-testing.md](cli-wrapper-testing.md)
- [docs/validation-checklist.md](validation-checklist.md)
