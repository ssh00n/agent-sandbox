# Architecture Baseline

## 목적

이 프로젝트는 샌드박스 실행과 승인 정책을 분리한 Codex 스타일 실행 환경을 구현하는 것을 목표로 한다.

## 핵심 경계

- `server`
  - HTTP 요청 수신
  - 실행 상태 응답

- `orchestrator`
  - 실행 요청 수명 주기 제어
  - 정책 판단과 러너 실행 연결

- `policy`
  - 허용, 거부, 승인 필요 여부 판단

- `runner`
  - 실제 프로세스 실행
  - 플랫폼별 샌드박스 구현 세부사항 캡슐화

- `audit`
  - 실행 이벤트 저장
  - 차단 사유 및 결과 조회

## Phase 0 설계 결정

- 요청 포맷은 `command + args[]`를 기본으로 사용한다.
- 정책 엔진은 `allow | deny | require_approval` 세 가지 결론만 반환한다.
- 감사 로그는 이벤트 기반 모델을 사용한다.
- 초기 저장소는 파일 기반을 가정하되, 인터페이스는 DB 교체 가능하도록 분리한다.
- macOS와 Docker runner는 동일한 `SandboxRunner` 인터페이스를 구현한다.
