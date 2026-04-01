# Presentation Narrative

## 핵심 메시지

이 저장소의 데모가 보여주는 것은 단순한 명령 실행기가 아니다.
핵심은 다음 세 문장으로 요약된다.

1. 에이전트는 프로젝트를 재귀적으로 탐색하고 문맥을 수집하면서 스스로 작업 계획을 세운다.
2. 하지만 실행은 운영체제 샌드박스와 승인 정책으로 분리 통제된다.
3. 따라서 안전한 agentic workflow는 "모델의 똑똑함"이 아니라 "의도 분석 + OS 격리 + 인간 승인"의 조합으로 설계해야 한다.

## 데모를 어떻게 설명할지

`npm run demo:all -- ...` 실행 시 아래 순서로 설명하면 된다.

### 1. What Happened

- 에이전트가 어떤 명령을 시도했는지 보여준다
- policy engine이 이 명령을 `intent`, `severity`, `summary`로 분류한다
- 위험도가 높거나 경계를 넘는 경우 `awaiting_approval`로 멈춘다

예:

- `network_access`: 외부 네트워크 엔드포인트에 도달하려는 시도
- `package_installation`: 외부 의존성을 환경에 추가하려는 시도
- `external_path_access`: workspace 밖 파일 시스템 경로를 건드리려는 시도

### 2. Mechanism

이 단계에서는 "왜 막혔는가"를 운영체제 메커니즘과 연결한다.

- 정책 계층: 위험한 의도를 조기에 감지하고 승인 여부를 결정
- 런타임 계층: 승인 이후에도 OS sandbox가 실제 행위를 계속 제한
- 감사 계층: 이벤트, stdout/stderr, 마스킹된 환경 정보를 기록

## 운영체제별 샌드박스 설명

### macOS

- `sandbox-exec`와 Seatbelt 프로파일로 하위 프로세스를 실행한다
- 허용된 workspace 경로만 읽기/쓰기 가능하게 제한한다
- 네트워크나 외부 경로 접근은 정책 또는 런타임 경계에서 차단된다

### Linux

- Landlock으로 파일 시스템 접근 범위를 줄인다
- seccomp로 위험한 syscall과 네트워크 계열 syscall을 제한한다
- 더 강한 격리가 필요하면 Bubblewrap으로 namespace 기반 경계를 추가할 수 있다

### Windows

- 네이티브 경로는 AppContainer가 capability 기반으로 권한을 줄인다
- 실무적으로는 WSL2 위에서 Linux 격리 메커니즘을 재사용하는 방향이 더 현실적이다

### Docker / Cloud

- 컨테이너 경계와 마운트 범위로 파일 시스템을 제한한다
- setup phase와 agent phase를 분리해 네트워크와 secret 노출 시간을 줄인다
- agent phase는 오프라인으로 돌려도 코드 편집과 테스트 같은 로컬 작업은 계속 가능하다

## So What

발표의 결론은 이 문장으로 정리하면 된다.

"에이전트를 안전하게 만들려면 모델을 믿는 것이 아니라, 모델이 시도하는 행위를 운영체제 경계와 승인 정책 안에 가둬야 한다."

조금 더 풀면 다음과 같다.

- 낮은 위험도의 읽기/수정 작업은 자동화한다
- 네트워크, 외부 경로, 파괴적 변경은 의도 단위로 감지한다
- 승인 이후에도 런타임 샌드박스는 계속 남겨 둔다
- 이벤트 로그와 비밀값 마스킹으로 사후 추적과 거버넌스를 확보한다

즉, 이 프로젝트의 메시지는 "에이전트를 더 자유롭게 만들자"가 아니라,
"에이전트를 더 잘 가둔 상태에서 더 많이 자동화하자"에 가깝다.

## 추천 데모 순서

1. `demo:all --leave-pending`으로 approval pause를 먼저 보여준다
2. `demo:all --approve`로 승인 후 실행이 이어지는 것을 보여준다
3. `verify:docker` 또는 `verify:macos`로 runtime sandbox가 실제로 경계를 강제하는 것을 보여준다
4. 마지막에 `GET /runs`, `GET /runs/:runId/events` 또는 `demo:events`로 audit trail을 보여준다
