# Validation Checklist

## 목적

이 문서는 macOS native, Docker, Linux EC2에서 무엇을 검증해야 하는지 한 번에 볼 수 있게 정리한 체크리스트다.

## 1. Docker 검증

### 준비

- Docker daemon 실행 확인
- `RUNNER_KIND=docker`로 서버 시작 또는 Docker runner 직접 호출
- 기본 이미지: `alpine:3.20`

### 확인 항목

1. setup phase에서 파일 생성 가능
2. agent phase에서 setup 결과를 읽을 수 있음
3. agent phase에서 `API_KEY` 값이 실제 비밀이 아니라 `$API_KEY` 플레이스홀더로 보임
4. agent phase에서 `--network none`으로 외부 네트워크 접근 실패
5. `.runs/` 또는 `.runs-test/`에 이벤트와 실행 결과가 남음

### 권장 실험

1. [examples/docker-setup-agent-run.json](../examples/docker-setup-agent-run.json) 기준으로 실행
2. setup phase에서 `phase.txt` 생성 확인
3. agent phase에서 `cat phase.txt` 수행
4. agent phase에서 `wget https://example.com` 또는 `ping` 시도 후 실패 확인
5. 승인 후 성공 실행은 [examples/docker-approval-success-run.json](../examples/docker-approval-success-run.json) 기준으로 별도 검증
6. 수동 `curl` 대신 `npm run demo:*` 명령으로 동일 흐름 반복 가능
7. 자세한 CLI 절차는 [docs/cli-wrapper-testing.md](cli-wrapper-testing.md) 참고

## 2. macOS native 검증

### 준비

- Codex 내부 샌드박스가 아닌 일반 터미널에서 실행
- `sandbox-exec` 사용 가능 확인

### 확인 항목

1. 허용된 cwd에서 `pwd`, `ls`, `cat` 실행 성공
2. writable root 밖 cwd는 정책 단계에서 차단
3. 실제 샌드박스 상태에서 상위 경로 읽기 또는 쓰기 실패
4. 네트워크 가능 명령은 승인 대기로 분기

### 주의

현재 Codex 내부 환경에서는 `sandbox-exec: sandbox_apply: Operation not permitted`가 날 수 있다.
이 경우 코드 문제가 아니라 상위 실행 환경 제약일 가능성이 높다.

동일한 형식의 검증 명령은 [docs/native-runner-testing.md](native-runner-testing.md) 참고

## 3. Linux EC2 검증

### 추천 환경

- Ubuntu 24.04 EC2
- Docker 설치
- 이후 native 비교를 위해 Bubblewrap/Landlock 실험 추가

### 1차 검증 목표

1. Linux native runner로 허용된 cwd 명령 실행 확인
2. 네트워크 명령이 승인 대기로 분기하는지 확인
3. Bubblewrap 네임스페이스와 bind mount가 실제 적용되는지 확인

### 2차 확장 목표

1. seccomp/Landlock 조합 비교
2. setup/agent 2단계 native flow 확장
3. 네트워크 차단을 정책 계층이 아니라 런타임 계층에서 더 강하게 강제

## 4. Windows 검증

Windows는 우선순위를 낮춘다.

### 권장 순서

1. WSL2에서 Linux 경로 재현
2. 필요 시 AppContainer는 별도 조사/프로토타입으로 분리
