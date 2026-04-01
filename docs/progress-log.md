# Progress Log

## 2026-04-01

### Step 1

- 목표: approval request / approve / deny API 추가
- 현재 상태: 기존 오케스트레이터와 파일 기반 감사 로그 구조 검토 완료
- 다음 작업: 승인 대기 상태를 파일에 저장하고 조회/승인/거절할 수 있는 저장소 인터페이스 추가

### Step 2

- 변경: `AuditStore`에 `getRecord`, `listPendingApprovals` 추가
- 변경: `FileAuditStore`가 run별 JSON 파일을 읽어 승인 대기 목록을 조회할 수 있게 확장
- 변경: `RunEventType`에 `approval_granted`, `approval_denied` 추가

### Step 3

- 변경: `Orchestrator`에 `approve(runId)`, `deny(runId)` 추가
- 동작: 승인 시 저장된 요청을 같은 runner로 재실행
- 동작: 거절 시 run 상태를 `blocked`로 갱신하고 관련 이벤트 저장

### Step 4

- 변경: HTTP API에 `GET /approvals`, `POST /approvals/:runId/approve`, `POST /approvals/:runId/deny` 추가
- 다음 작업: 타입체크 후 승인 플로우를 직접 실행해서 저장/조회/승인/거절 흐름 확인

### Step 5

- 검증: `tsc --noEmit -p tsconfig.json` 통과
- 검증: `npm run build` 통과
- 검증: Docker runner 기준으로 승인 요청 생성 후 `listPendingApprovals()`에 노출되는 것 확인

### Step 6

- 검증: 승인 요청 `run_1775020921083_vcv234`에 대해 `approve()` 실행
- 결과: 승인 대기 상태에서 실제 runner 실행으로 넘어감
- 결과: 컨테이너 안에 `curl`이 없어 `failed(exitCode=127)`로 종료됐지만, 승인 후 재실행 경로 자체는 정상 동작

### Step 7

- 검증: 별도 승인 요청 생성 후 `deny()` 실행
- 결과: run 상태가 `blocked`로 갱신되고 `approval_denied`, `blocked` 이벤트 저장 확인
- 검증: 최종적으로 `listPendingApprovals()` 결과가 빈 배열인 것 확인

### Step 8

- 변경: `AuditStore`에 `listRuns()` 추가
- 변경: `GET /runs`, `GET /runs/:runId` 조회 API 추가
- 목적: 서버를 통해 개별 실행 상세와 전체 실행 목록을 HTTP로 조회 가능하게 정리

### Step 9

- 변경: Docker 승인 후 성공 실행을 위한 예시 파일 [examples/docker-approval-success-run.json](../examples/docker-approval-success-run.json) 추가
- 변경: README와 검증 체크리스트에 성공 실행 시나리오 링크 추가
- 다음 작업: 빌드 확인 후 run 조회와 Docker 성공/차단 시나리오를 실제로 다시 검증

### Step 10

- 검증: `tsc --noEmit -p tsconfig.json` 재통과
- 검증: `npm run build` 재통과
- 검증: 저장소 기준 `listRuns()`와 `getRecord(runId)`가 실제 run 목록과 상세를 반환하는 것 확인

### Step 11

- 검증: `curlimages/curl:8.12.1` 이미지로 승인 대기 -> 승인 후 실제 네트워크 성공 실행 확인
- 결과: 승인 후 `curl -I https://example.com`가 `completed(exitCode=0)`로 종료
- 결과: `listRuns()`에도 같은 run이 `completed` 상태로 반영됨

### Step 12

- 검증: 같은 이미지에서 agent 단계 기본 네트워크 차단 상태로 `sh -lc "curl -I https://example.com"` 실행
- 결과: `curl: (6) Could not resolve host: example.com`으로 실패
- 해석: 컨테이너 내부 네트워크는 차단됐고, 이미지 pull은 Docker daemon 측 동작이라 별도 계층임

### Step 13

- 변경: `AuditStore`에 `getEvents(runId)` 추가
- 변경: HTTP API에 `GET /runs/:runId/events` 추가
- 목적: 승인 요청부터 완료까지의 이벤트 타임라인을 서버 경유로 바로 확인할 수 있게 정리

### Step 14

- 변경: `scripts/demo.mjs` 추가
- 지원 명령: `health`, `create`, `runs`, `run`, `events`, `approvals`, `approve`, `deny`
- 목적: 수동 `curl` 대신 동일 API를 반복 검증용 CLI로 감싸기

### Step 15

- 변경: `scripts/demo-all.mjs` 추가
- 동작: 시나리오 생성 -> 승인 필요 시 승인 -> 이벤트 조회를 한 번에 수행
- 변경: `package.json`에 `demo:*` npm scripts 추가
- 다음 작업: 빌드 후 CLI 기반 실제 호출 검증

### Step 16

- 검증: `npm run build` 통과
- 검증: `npm run demo:help`로 CLI 사용법 출력 확인
- 보완: `scripts/demo.mjs`의 fetch 실패 메시지를 서버 미실행/접속 불가 맥락이 드러나도록 수정

### Step 17

- 검증: 현재 Codex 내부에서는 localhost 접근 제한으로 `npm run demo:health`가 실패
- 결과: 실패 메시지가 `Request to http://127.0.0.1:4000/health failed...` 형태로 개선된 것 확인
- 해석: 실제 서버 바인딩 검증은 사용자가 일반 터미널에서 실행하는 흐름과 맞물려 사용하면 됨

### Step 18

- 변경: [docs/cli-wrapper-testing.md](cli-wrapper-testing.md) 추가
- 내용: 서버 실행, `demo:*` 명령 설명, 추천 테스트 순서, 실패 해석까지 포함한 래퍼 기반 테스트 절차 문서화
- 변경: README와 validation checklist에 새 문서 링크 추가

### Step 19

- 변경: `scripts/demo.mjs` 기본 출력을 JSON 중심에서 TUI 스타일 요약 출력으로 개선
- 보완: `--json` 또는 `DEMO_JSON=1`일 때는 원시 JSON 출력 유지
- 변경: `demo-all`은 내부적으로 `--json`을 사용하도록 조정

### Step 20

- 변경: `scripts/verify-runner.mjs <macos|docker>` 추가
- 변경: `npm run verify:docker`, `npm run verify:macos` 추가
- 목적: Docker와 macOS native를 같은 형식의 검증 스크립트로 점검

### Step 21

- 변경: [docs/native-runner-testing.md](native-runner-testing.md) 추가
- 내용: `verify:docker`, `verify:macos` 실행법과 출력 해석, fallback 주의사항 문서화

### Step 22

- 검증: `npm run build` 통과
- 검증: `npm run verify:macos` 출력 확인
- 결과: macOS에서는 정책 차단과 approval 분기는 정상, 실제 native sandbox 적용은 현재 환경에서 `sandbox_apply: Operation not permitted`

### Step 23

- 검증: `npm run verify:docker` 출력 확인
- 결과: approval 대기, 승인 후 성공 실행, agent 런타임 네트워크 차단이 같은 TUI 형식으로 출력됨
- 의미: Docker와 macOS를 동일한 검증 UX로 비교할 수 있는 상태가 됨

### Step 24

- 저장소 정리: Git 초기화 후 `main` 브랜치에 첫 커밋 생성
- 커밋: `4c2ae16 Build sandbox orchestrator MVP`
- remote: `origin -> git@github-personal:ssh00n/agent-sandbox.git`

### Step 25

- 배포: `git push -u origin main` 완료
- 결과: 로컬 `main`이 `origin/main`을 추적하도록 설정됨
- 의미: 이제 이후 작업은 같은 저장소에서 main 기준으로 계속 진행 가능

### Step 26

- 우선순위 재조정: 최종 goal 기준으로 `2단계 런타임 가시화`, `감사 로그 품질`, `비밀값 마스킹`을 최우선으로 재선정
- 이유: 발표/데모 관점에서 가장 부족했던 핵심 경로를 먼저 강화하는 편이 효과가 큼

### Step 27

- 변경: runner 인터페이스에 이벤트 훅 추가
- 변경: Docker runner가 `setup_started`, `setup_completed`, `setup_failed`를 직접 emit
- 변경: orchestrator가 runner 이벤트를 감사 로그로 연결

### Step 28

- 변경: 파일 기반 감사 저장소에 비밀값 마스킹 추가
- 동작: `request.env` 실제 값이 저장 시 `$KEY` 형태로 치환됨
- 동작: setup phase preview 같이 이벤트 payload 안의 문자열도 같은 방식으로 치환됨

### Step 29

- 검증: Docker approval + setup + agent 흐름 재실행
- 결과: 이벤트 타임라인에 `setup_started`와 `setup_completed`가 기록됨
- 결과: 저장된 record와 events의 `env.API_KEY`는 `$API_KEY`로 마스킹됨
- 결과: setup stdout preview의 `setup-real-secret-stage`도 `setup-$API_KEY`로 마스킹됨

### Step 30

- 변경: policy decision에 `category`, `code`를 활용한 세분화 규칙 확장
- 추가 규칙: `danger_full_access_requested`, `package_install_command`, `absolute_path_target_outside_writable_roots`
- 목적: approval/deny 이유를 발표와 데모에서 더 명확하게 설명할 수 있게 정리

### Step 31

- 변경: CLI/TUI approval 목록에 `category`, `code` 추가
- 변경: run 상세에 정책 category/code와 stage summary를 더 분명하게 표시
- 변경: events 출력에서 `setup:start`, `setup:done`, `approval:requested` 같은 읽기 쉬운 라벨 사용

### Step 32

- 검증: `danger_full_access`, `npm install`, `/etc/hosts` absolute path target 케이스를 재평가
- 결과: 각각 `danger_full_access_requested`, `package_install_command`, `absolute_path_target_outside_writable_roots`로 분류되는 것 확인

### Step 33

- 변경: policy decision에 `intent` 필드 추가
- 예시 intent: `network_access`, `package_installation`, `environment_escalation`, `external_path_access`
- 목적: 명령 이름보다 상위 수준의 행동 의도로 approval 사유를 설명할 수 있게 정리

### Step 34

- 변경: CLI에 `--present` 모드 추가
- 동작: 발표용으로 `status | intent(code) | flow` 중심의 더 짧은 출력 제공
- 변경: approval 목록에도 `intent` 표시

### Step 35

- 검증: `npm install` 케이스가 `intent=package_installation`으로 기록되는 것 확인
- 검증: build/check 재통과

### Step 36

- 변경: `scripts/demo-all.mjs`를 발표용 단계 실행 흐름으로 재구성
- 변경: 시나리오 개요, 단계별 진행, 최종 상태 요약을 한 화면에서 따라갈 수 있게 출력 정리
- 추가 옵션: `--approve`, `--deny`, `--leave-pending`

### Step 37

- 변경: [docs/cli-wrapper-testing.md](cli-wrapper-testing.md)에 `demo:all` 발표형 사용법 추가
- 내용: 자동 승인 기본값, 거절/대기 유지 옵션, 단계별 출력 구조와 추천 시나리오 반영
- 다음 작업: build 확인 후 remote에 반영

### Step 38

- 변경: policy decision에 `severity`, `summary` 추가
- 목적: intent를 사람이 바로 읽을 수 있는 위험도와 한 줄 설명으로 확장
- 변경: approval summary에도 같은 정책 메타데이터 저장

### Step 39

- 변경: `demo.mjs`, `demo-all.mjs`가 `severity`, `summary`를 기본 출력에 포함하도록 보강
- 검증: build 통과 후 `curl`, `npm install`, `rm`, `cat` 케이스에서 intent 분류가 유지되는 것 확인
- 변경: README와 CLI 테스트 문서에 새 정책 메타데이터 설명 추가
