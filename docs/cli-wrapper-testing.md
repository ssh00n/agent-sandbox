# CLI Wrapper Testing Guide

## 목적

이 문서는 서버를 띄운 뒤 검증용 CLI 래퍼로 샌드박스 오케스트레이터를 테스트하는 절차를 정리한다.
수동 `curl` 대신 `npm run demo:*` 명령으로 동일한 확인을 반복하는 것이 목적이다.

## 1. 준비

### 빌드

```bash
npm run build
```

### 서버 실행

Docker 검증 기준:

```bash
RUNNER_KIND=docker DOCKER_IMAGE=curlimages/curl:8.12.1 node dist/server/index.js
```

기본 주소는 `http://127.0.0.1:4000`이다.

주소를 바꿨다면 CLI 실행 시 아래 환경 변수를 함께 준다.

```bash
DEMO_BASE_URL=http://127.0.0.1:4000 npm run demo:health
```

## 2. 지원 명령

### 상태 확인

```bash
npm run demo:health
```

서버가 떠 있으면 현재 runner 설정과 기본 이미지 정보를 반환한다.

Linux capability snapshot 확인:

```bash
npm run demo:linux-capabilities
```

이 출력은 Linux host에서 `bwrap`, `docker`, `podman`, AppArmor/userns 관련 상태를 한 번에 보는 용도다.

### 시나리오로 run 생성

```bash
npm run demo:create -- examples/docker-approval-success-run.json
```

입력 JSON을 그대로 `POST /runs`에 전송한다.
결과 응답에서 `runId`를 확인한다.

Linux backend override를 실험할 때는 아래 예시를 쓴다.

```bash
npm run demo:create -- examples/linux-auto-run.json
npm run demo:create -- examples/linux-fallback-run.json
npm run demo:create -- examples/linux-container-rootful-run.json
```

### 승인 대기 목록 조회

```bash
npm run demo:approvals
```

현재 `awaiting_approval` 상태인 run만 모아 보여준다.
각 항목에는 `intent`, `severity`, `code`, `summary`가 함께 표시된다.

### 전체 run 목록 조회

```bash
npm run demo:runs
```

현재 저장된 run 요약 목록을 보여준다.

### 개별 run 상세 조회

```bash
npm run demo:run -- <RUN_ID>
```

요청 원문, 정책 판단, 최종 결과까지 한 번에 볼 수 있다.
정책 판단에는 `category`, `severity`, `intent`, `code`, `summary`, `reason`이 포함된다.
Linux run이면 `requested linuxBackend`, 실제 `backend`, `enforcement`, `runtime reason`, `blockers`도 함께 볼 수 있다.

### 이벤트 타임라인 조회

```bash
npm run demo:events -- <RUN_ID>
```

`requested -> policy_checked -> approval_requested -> approval_granted -> started -> completed`
같은 이벤트 흐름을 순서대로 볼 수 있다.

### 승인/거절

```bash
npm run demo:approve -- <RUN_ID>
npm run demo:deny -- <RUN_ID>
```

승인 시 저장된 요청이 같은 runner로 실제 재실행된다.
거절 시 run 상태는 `blocked`로 갱신된다.

### 한 번에 실행

```bash
npm run demo:all -- examples/docker-approval-success-run.json
```

기본값은 `승인 필요 시 자동 승인`이다.
옵션으로 흐름을 바꿀 수 있다.

```bash
npm run demo:all -- examples/docker-approval-success-run.json --approve
npm run demo:all -- examples/docker-approval-success-run.json --deny
npm run demo:all -- examples/docker-approval-success-run.json --leave-pending
```

동작 순서는 다음과 같다.

1. 시나리오로 run 생성
2. 초기 run 상태 확인
3. 승인 필요 여부 확인
4. 선택한 액션에 따라 승인, 거절, 또는 대기 유지
5. 이벤트 타임라인 출력
6. 최종 run 상태 출력

출력은 발표용 요약 형식으로 정리된다.

- `== Scenario ==`에서 시나리오 개요 확인
- `[Step N] ...` 형식으로 단계별 진행 표시
- `policy`, `status`, `exitCode`, `stdout`, `stderr` 핵심만 요약
- `severity`, `summary`로 왜 승인/차단인지 바로 해석 가능
- 이벤트는 `approval:requested`, `setup:start`, `setup:done` 같은 짧은 라벨로 표시
- 마지막 `== Narrative ==`에서 `what / mechanism / so-what` 발표용 요약 제공

## 3. 추천 테스트 순서

### A. 성공 시나리오

```bash
npm run demo:create -- examples/docker-approval-success-run.json
npm run demo:approvals
npm run demo:approve -- <RUN_ID>
npm run demo:run -- <RUN_ID>
npm run demo:events -- <RUN_ID>
npm run demo:runs
```

기대 결과:

- 처음에는 `awaiting_approval`
- 승인 후 `completed`
- events에 `approval_granted`와 `completed`가 남음

### B. 차단 시나리오

네트워크 요청인데 `workspace_write + requestNetwork=false`인 JSON을 사용한다.

```bash
npm run demo:create -- <차단-시나리오-json>
npm run demo:approvals
npm run demo:run -- <RUN_ID>
```

기대 결과:

- 정책 단계에서 `awaiting_approval`
- 승인하지 않으면 실행되지 않음

### C. 거절 시나리오

```bash
npm run demo:all -- examples/docker-approval-success-run.json --deny
```

기대 결과:

- 상태가 `blocked`
- events에 `approval_denied`, `blocked`가 남음

### D. 발표용 대기 시나리오

```bash
npm run demo:all -- examples/docker-approval-success-run.json --leave-pending
```

기대 결과:

- approval 요청까지만 진행
- 최종 상태가 `awaiting_approval`
- events에 `approval_requested`가 남음

### E. 런타임 네트워크 차단

이 경우는 runner 자체 검증이라 `demo:create`보다 별도 예시/스크립트와 함께 보는 것이 좋다.
핵심 확인 포인트는 agent 단계에서 `Could not resolve host` 같은 네트워크 실패가 발생하는지다.

### F. Linux backend override walkthrough

서버를 Linux 기본 runner로 띄웠다고 가정한다.

```bash
RUNNER_KIND=linux node dist/server/index.js
```

자동 선택 확인:

```bash
npm run demo:create -- examples/linux-auto-run.json
npm run demo:run -- <RUN_ID>
npm run demo:events -- <RUN_ID>
```

확인 포인트:

- `backend`가 무엇으로 선택됐는지
- `runtime` 줄에 왜 그 backend가 선택됐는지
- `blockers` 줄에 strict native가 왜 제외됐는지
- events에 `runtime:probe:start`, `runtime:probe:done`, `runtime:selected`가 남는지

fallback 강제:

```bash
npm run demo:create -- examples/linux-fallback-run.json
```

container rootful 강제:

```bash
npm run demo:create -- examples/linux-container-rootful-run.json
```

이 세 예시를 비교하면 Linux backend override와 auto selection이 어떻게 다른지 바로 볼 수 있다.

## 4. 실패 시 해석

### `Request to http://127.0.0.1:4000/... failed`

- 서버가 아직 실행 중이 아님
- 포트가 다름
- 현재 실행 환경에서 localhost 접근이 막혀 있음

### `awaiting_approval`

- 정책 엔진이 승인을 요구한 정상 상태다
- 아직 실패가 아니라 대기 상태다

### `blocked`

- 정책 거절 또는 승인 거절 상태다

### `failed`

- 실제 runner 실행까지 갔지만 런타임에서 실패한 상태다
- 예: 이미지 안에 명령어가 없음, 네트워크 차단, 타임아웃

## 5. 관련 문서

- [README.md](../README.md)
- [docs/validation-checklist.md](validation-checklist.md)
- [docs/native-runner-testing.md](native-runner-testing.md)
- [docs/linux-strict-native-retest-checklist.md](linux-strict-native-retest-checklist.md)
- [docs/progress-log.md](progress-log.md)
