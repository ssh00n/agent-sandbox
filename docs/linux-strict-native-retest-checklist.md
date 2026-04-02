# Linux Strict Native Retest Checklist

## 목적

이 문서는 Raspberry Pi 같은 Linux host에서 `linux-native-strict`를 다시 실험하기 전에 확인해야 할 host 변경 항목을 정리한다.
목표는 보안 설정을 영구 완화하는 것이 아니라, strict native sandbox가 실제로 가능한 조건을 짧게 검증하고 원복하는 것이다.

## 1. 사전 확인

- 현재 host에서 `bwrap`가 설치되어 있는지 확인
- 현재 host에서 `unshare`가 설치되어 있는지 확인
- 현재 host에서 Docker 또는 Podman 같은 대체 backend가 이미 동작하는지 확인
- 현재 host가 운영 중인 홈서버라면 변경 시간대를 짧게 잡고 원복 계획을 먼저 준비

권장 점검 명령:

```bash
command -v bwrap
command -v unshare
sysctl kernel.unprivileged_userns_clone
cat /proc/sys/kernel/apparmor_restrict_unprivileged_userns
```

## 2. 핵심 blocker 점검

현재 Raspberry Pi에서 확인된 주요 blocker는 아래 두 축이다.

- `AppArmor restricts unprivileged user namespaces`
- `uid_map` / `unshare` 관련 `Operation not permitted`

즉, strict native 재실험 전에는 최소한 아래 두 가지를 확인해야 한다.

1. unprivileged user namespace가 실제로 열리는지
2. `bwrap --unshare-all` 또는 유사 최소 조합이 성공하는지

## 3. 임시 변경 후보

아래 항목은 host 정책과 배포 환경에 따라 다르므로, 반드시 임시 변경 후 바로 원복하는 전제로만 다룬다.

### AppArmor userns 제한

현재 값:

```bash
cat /proc/sys/kernel/apparmor_restrict_unprivileged_userns
```

strict native 재실험 시 임시로 완화할 수 있는 대표 후보:

```bash
sudo sysctl -w kernel.apparmor_restrict_unprivileged_userns=0
```

주의:

- Ubuntu/AppArmor 정책에 따라 다른 연계 제한이 남아 있을 수 있다
- 이 값만 바꿔도 `uid_map` 문제가 완전히 해결된다는 보장은 없다

### user namespace clone 허용

현재 값:

```bash
sysctl kernel.unprivileged_userns_clone
```

필요 시 확인:

```bash
sudo sysctl -w kernel.unprivileged_userns_clone=1
```

### Bubblewrap setuid 여부

현재 `/usr/bin/bwrap`가 setuid helper가 아닌 경우 rootless namespace 제약을 직접 받는다.

확인:

```bash
ls -l /usr/bin/bwrap
```

주의:

- setuid 부여는 보안 영향이 커서 가장 마지막 후보로만 검토
- 홈서버 운영 환경에서는 임시 실험 후 원복 계획이 없으면 권장하지 않음

## 4. 재실험 순서

1. 현재 capability snapshot 저장

```bash
curl http://127.0.0.1:4000/runtime/linux/capabilities
```

2. 최소 커널 플래그만 임시 변경

3. 저수준 probe 재실행

```bash
unshare -Ur /bin/sh -lc 'id'
npm run probe:linux-native
```

4. 프로젝트 검증 재실행

```bash
npm run verify:linux
```

5. `linuxBackend=native_strict` 강제 시나리오 실행

```bash
npm run demo:create -- examples/linux-native-strict-run.json
npm run demo:run -- <RUN_ID>
npm run demo:events -- <RUN_ID>
```

6. 결과 확인 후 host 설정 원복

## 5. 성공 기준

strict native 재실험이 성공했다고 볼 수 있는 기준:

- `unshare -Ur ...`가 더 이상 `uid_map` 에러 없이 동작
- `npm run probe:linux-native`에서 `bwrap` probe가 host path layout 문제 없이 실행
- `verify:linux`에서 `backend=native_strict`가 선택됨
- run detail과 events에서 `sandbox_apply_started` 이후 fallback 없이 완료됨

## 6. 실패 시 해석

- `container_rootful`로 계속 간다면:
  - strict native blocker가 여전히 남아 있음
  - 대신 Docker daemon은 usable 하다는 의미

- `fallback`으로 계속 간다면:
  - strict native도 안 되고 usable container backend도 없음
  - 개발/검증용 경로만 가능한 상태

- `sandbox_apply_failed`가 남는다면:
  - native strict는 선택됐지만 실제 namespace/mount 적용 단계에서 host 제약으로 실패한 것

## 7. 원복 원칙

- 임시로 바꾼 sysctl 값은 실험 직후 원복
- 실험 전 원래 값을 먼저 기록
- 원복 후 `curl /runtime/linux/capabilities`와 `npm run verify:linux`를 다시 실행해 baseline을 확인
