# Linux Runner Target Architecture

## 목적

이 문서는 이 프로젝트에서 Linux runtime isolation을 어떤 구조로 가져갈지 정리한 1페이지 설계안이다.
핵심은 Linux에서 단일 sandbox 구현을 강제하지 않고, 같은 control plane 위에 여러 runtime backend를 두는 것이다.

## 핵심 원칙

- `policy`는 항상 먼저 판단한다.
- `runtime backend`는 호스트 capability에 맞게 선택한다.
- `approval`과 `audit` 모델은 backend와 무관하게 동일하다.
- `fallback`은 개발/검증용으로만 남기고 운영 경로와 명확히 구분한다.

## Runner 종류

### 1. `linux-native-strict`

- 대상: `bwrap`, user namespace, mount namespace, net namespace, 가능하면 `seccomp`/`Landlock`까지 되는 호스트
- 성격: 가장 OS native sandbox에 가까운 경로
- 제공:
- workspace만 bind
- system dir는 ro-bind
- `/tmp` tmpfs
- 네트워크 namespace 분리
- capability drop / seccomp / Landlock 추가 가능
- 용도: 고신뢰 Linux native 실행

### 2. `linux-container-rootless`

- 대상: rootless Podman 또는 rootless Docker가 안정적으로 되는 호스트
- 성격: 실전 기본 경로로 가장 유력
- 제공:
- 이미지 기반 재현성
- 파일시스템/프로세스/네트워크 격리
- 운영성 우수
- 용도: 제품 기본 backend

### 3. `linux-container-rootful`

- 대상: rootless는 안 되지만 rootful Docker/Podman 운영이 가능한 호스트
- 성격: 실용적 fallback 운영 경로
- 제공:
- 강한 격리
- 예측 가능한 실행 환경
- 용도: self-hosted, CI, controlled infra

### 4. `linux-native-lsm`

- 대상: userns 기반 native sandbox는 안 되지만 LSM 계층은 가능한 호스트
- 성격: 부분 격리 경로
- 제공:
- Landlock 기반 파일 접근 제한
- `setpriv`, capability drop 조합
- 한계:
- mount namespace 수준의 파일시스템 재구성은 어려움
- 용도: 제한적 native enforcement

### 5. `linux-fallback`

- 대상: user namespace나 container backend를 쓸 수 없는 제약 호스트
- 성격: 개발/데모 전용
- 제공:
- policy, approval, audit 검증
- 한계:
- OS 강제 격리 없음
- 용도: 운영 기본값으로는 사용 금지

## 선택 우선순위

권장 우선순위는 아래와 같다.

1. `linux-native-strict`
2. `linux-container-rootless`
3. `linux-container-rootful`
4. `linux-native-lsm`
5. `linux-fallback`

이 순서의 이유:

- native strict가 되면 가장 깔끔한 host-native 모델을 얻는다.
- 안 되면 rootless container가 운영적으로 가장 현실적이다.
- 그것도 안 되면 rootful container가 실용적인 운영 fallback이다.
- LSM-only는 강도와 일관성이 상대적으로 애매하다.
- fallback은 검증용일 뿐이다.

실제 구현은 자동 선택과 명시 override를 함께 제공하는 편이 좋다.

- `runner=linux:auto`
- `runner=linux:native-strict`
- `runner=linux:container-rootless`
- `runner=linux:container-rootful`
- `runner=linux:native-lsm`
- `runner=linux:fallback`

## API Shape

현재 `runner: "macos" | "docker" | "linux"`만으로는 Linux 내부 backend 경로를 설명하기 부족하다.
Linux는 backend와 capability를 분리해서 드러내는 편이 맞다.

```ts
type RunnerKind =
  | "macos"
  | "docker"
  | "linux";

type LinuxBackend =
  | "auto"
  | "native_strict"
  | "container_rootless"
  | "container_rootful"
  | "native_lsm"
  | "fallback";

interface RunCommandRequest {
  command: string;
  args: string[];
  cwd: string;
  sandboxMode: SandboxMode;
  writableRoots: string[];
  env?: Record<string, string>;
  timeoutMs?: number;
  requestNetwork?: boolean;

  runner?: RunnerKind;
  linuxBackend?: LinuxBackend;

  containerImage?: string;
  setupCommands?: CommandSpec[];
}
```

그리고 내부 선택 결과는 응답에 별도로 남긴다.

```ts
interface RuntimeSelection {
  runner: "linux";
  backend: LinuxBackend;
  enforcementLevel: "strict" | "container" | "partial" | "fallback";
  reason: string;
}

interface RunRecord {
  runId?: string;
  request: RunCommandRequest;
  policyDecision: PolicyDecision;
  runtimeSelection?: RuntimeSelection;
  result?: RunResult;
}
```

이렇게 해야 요청값, 실제 선택된 backend, 선택 사유를 audit에서 설명할 수 있다.

## Audit Event 설계

Linux runner에서는 단순 실행 결과보다 runtime selection trace가 중요하다.

권장 이벤트:

```ts
type RunEventType =
  | ...
  | "runtime_probe_started"
  | "runtime_probe_completed"
  | "runtime_selected"
  | "sandbox_apply_started"
  | "sandbox_apply_failed"
  | "sandbox_fallback_used";
```

예시 payload:

`runtime_probe_started`

```json
{
  "platform": "linux",
  "requestedBackend": "auto"
}
```

`runtime_probe_completed`

```json
{
  "platform": "linux",
  "capabilities": {
    "bwrap": true,
    "userNamespace": false,
    "mountNamespace": false,
    "rootlessContainer": true,
    "rootfulContainer": true,
    "landlock": false
  }
}
```

`runtime_selected`

```json
{
  "runner": "linux",
  "backend": "container_rootless",
  "enforcementLevel": "container",
  "reason": "bwrap user namespace unavailable; rootless container available"
}
```

`sandbox_apply_failed`

```json
{
  "backend": "native_strict",
  "stage": "namespace_setup",
  "error": "setting up uid map: Permission denied"
}
```

`sandbox_fallback_used`

```json
{
  "from": "native_strict",
  "to": "fallback",
  "reason": "host restriction",
  "developmentOnly": true
}
```

## 권장 내부 구조

외부에는 `LinuxRunner` 하나만 노출하고, 내부에서 probe와 backend delegation을 수행한다.

- `LinuxCapabilityProbe`
- 호스트 capability 점검
- `bwrap`, `userns`, `rootless container`, `rootful container`, `setpriv` 가능 여부 판별
- 명령 존재 여부와 daemon usable 여부를 분리

- `LinuxRunnerResolver`
- 요청값과 probe 결과를 조합해 backend 선택

- `LinuxNativeStrictRunner`
- `LinuxContainerRunner`
- `LinuxNativeLsmRunner`
- `LinuxFallbackRunner`

- `LinuxRunner`
- facade
- `probe -> resolve -> delegate` 수행

## 구현 단위와 브랜치 역할

Linux runner 작업은 아래 구현 단위로 쪼개서 이해하는 것이 좋다.

### `task-linux-capability-probe`

- 역할: 호스트가 어떤 Linux isolation primitive를 실제로 쓸 수 있는지 측정
- 담당 범위:
- `bwrap`, `unshare`, `podman`, `docker`, `setpriv` 존재 여부
- AppArmor / unprivileged user namespace 관련 커널 플래그 확인
- runtime selection 전에 남길 capability snapshot 생성
- 이 단위가 있어야 "왜 strict native가 안 됐는지"를 설명할 수 있다

### `task-linux-runtime-selection`

- 역할: probe 결과와 요청값을 받아 어떤 backend를 쓸지 결정
- 담당 범위:
- `linux:auto` 해석
- `native_strict`, `container_rootful`, `fallback` 같은 backend 선택
- 선택 사유를 `RuntimeSelection`으로 구조화
- 이 단위가 있어야 Linux backend 선택이 임의 분기처럼 보이지 않고 정책적으로 설명 가능해진다

### `task-linux-native-runner`

- 역할: probe + resolver + 실제 backend delegation을 하나의 facade로 통합
- 담당 범위:
- `LinuxSandboxRunner`
- strict native `bwrap` 실행
- container backend delegation
- fallback 경로 처리
- 관련 audit event emit
- 이 단위가 있어야 서버와 오케스트레이터는 Linux 내부 세부구현을 몰라도 동일 인터페이스로 실행할 수 있다

## 현재 Raspberry Pi 관찰 결과

현재 홈서버 Raspberry Pi에서 확인된 상태:

- `bwrap` 설치됨
- `unshare` 존재
- `systemd-run` 존재
- `apparmor_restrict_unprivileged_userns=1`
- `bwrap --unshare-all` 실패
- `bwrap --unshare-user-try` 실패
- `unshare -m`, `unshare -Ur` 실패

해석:

- 이 호스트는 현재 rootless user namespace 기반 strict native sandbox가 막혀 있다.
- 따라서 이 호스트에서는 `linux-native-strict`를 그대로 운영 기본값으로 둘 수 없다.
- 다만 Docker daemon은 usable하므로 현재 auto selection은 `container_rootful`로 귀결된다.

추가 재실험 결과:

- `kernel.apparmor_restrict_unprivileged_userns=0`으로 임시 완화하면 같은 host에서 `nativeStrictCandidate=true`가 되고
- 프로젝트 `verify:linux`도 실제로 `backend=native_strict`를 선택해 완료된다
- 즉 이 host의 strict native blocker는 Linux runner 코드보다 AppArmor user namespace 정책에 더 직접적으로 묶여 있다

## 다음 실행 순서

1. strict-native failure reason을 더 세밀하게 분류
2. probe 결과를 발표/CLI 출력에 더 compact하게 노출
3. example scenario에 `linuxBackend` override 예시 추가
4. rootless container backend 평가
5. 필요 시 Raspberry Pi에서 AppArmor 제한 완화 후 strict native 재실험
