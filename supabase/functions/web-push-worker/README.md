# 웹 푸시 서버 계약과 검증

기존 Android Expo 설치, 이벤트 트리거, 전송 큐와 설정 RPC를 유지하고 웹 설치·예약·큐·이벤트 확장 기록을 별도로 둔다. `get_notification_settings()`와 `save_notification_preferences()`는 기존 UI와 같은 계약이다. 마스터 알림 OFF는 추가 트리거로 웹 설치도 비활성화한다. 다시 ON을 선택하면 권한과 구독을 확인한 뒤 등록 RPC를 호출해야 한다.

## 브라우저 RPC

| RPC | 입력 | 응답 및 조건 |
| --- | --- | --- |
| `reserve_web_push_installation` | `target_installation_id` UUID, `target_installation_proof` 64자리 소문자 hex, `target_revocation_proof` 동일 형식, `target_transition_epoch` bigint, `target_binding_revision` bigint | `installation_id`, `transition_epoch`, `binding_revision`, `reserved`, `stale`, 성공 시 `expires_at`. 활성 회원과 최초 비밀번호 변경 완료 필요. |
| `register_web_push_installation` | 예약 입력 5개와 `target_subscription` JSON, `target_permission_state` (`granted`, `denied`, `undetermined`) | `installation_id`, `transition_epoch`, `binding_revision`, `enabled`, `stale`, 성공 시 `revocation_expires_at`. 신규 바인딩은 먼저 예약해야 한다. |
| `revoke_web_push_installation` | `target_installation_id`, `target_binding_revision`, `target_transition_epoch`, `target_revocation_proof` | `installation_id`, `transition_epoch`, `binding_revision`, `enabled:false`, `revoked`, `terminal:true`. 로그아웃 후에도 익명 호출 가능하며 유효한 제한된 해제 증명만 처리한다. |
| `request_web_push_test` | `target_installation_id`, `target_installation_proof` | `notification_id`, `queued:true`. 현재 소유자의 연결된 설치와 마스터 설정 ON, 웹 런타임/롤아웃 허용 필요. 설치별 1분에 1회. |

`target_subscription`은 `PushSubscription.toJSON()`의 `endpoint`, `keys.p256dh`, `keys.auth`, 선택적 `expirationTime`이다. 65바이트 uncompressed P256 공개키와 16바이트 auth를 검증한다. 전환마다 새 해제 증명과 증가한 epoch를 사용하고, 동일 바인딩 갱신에서는 증명과 revision을 유지한다. 응답 유실 시 revision 0으로 해제할 수 있다. tombstone은 오래된 등록의 재활성화를 막는다. 예약 응답이 도착하기 전에 등록 요청을 보내지 않는다.

설치·구독·개인 전송 큐는 private 스키마와 RLS로 보호되며 브라우저가 직접 읽거나 수정할 수 없다. 구독 endpoint, 공개키, auth, 해제 증명은 로그에 남기지 않는다. 예약은 사용자별 신규 5회/분과 미처리 20개로 제한하며 만료된다.

## 전송과 활성화

`private.web_push_runtime`의 `enabled` 기본값은 false다. 활성화에는 `activated_at`도 필요하며 그 시각 이전 이벤트를 소급 전송하지 않는다. 공통 `private.notification_runtime`의 `delivery_mode`, `test_auth_user_ids`, `disabled_categories`를 따른다. 테스트 모드에는 명시적으로 허용된 실제 회원만 포함된다. Expo 전용 project ID와 enabled는 웹 런타임을 대신하지 않는다.

워커는 POST `{"action":"dispatch"}` 요청에 기존 `PUSH_WORKER_SECRET`을 Bearer 또는 `x-push-worker-secret`으로 받는다. 두 헤더가 있으면 모두 일치해야 한다. 인증 후 VAPID 설정을 로드하고, 전역 `PUSH_DELIVERY_ENABLED` 또는 웹 DB gate가 OFF이면 전송하지 않는다. 인증된 최초 호출은 OFF 상태에서도 Vault 키 초기화를 수행할 수 있다. 응답은 `{"action":"dispatch","processed":0}`부터 최대 100까지이며 키와 구독을 포함하지 않는다. VAPID Vault 설정과 cron은 별도 운영 스크립트 및 설정 마이그레이션을 따른다.

`claim_web_notification_deliveries`, `prepare_web_notification_delivery`, `validate_web_notification_delivery`, `finish_web_notification_delivery`는 service_role 전용이다. 준비와 전송 직전 검증에서 소유자, epoch/revision, 구독 fingerprint, OS 권한, 활성 회원, 비밀번호 변경 요구, 마스터/카테고리 설정, 업무 대상 및 만료, 롤아웃 gate를 확인한다. 개인에게 보낼 제목과 본문은 기존 서버 스냅샷을 사용한다. payload는 기존 version 1 계약과 `display`를 포함하며, 테스트는 `kind:web_push_test`, `category:test`, `source_type:test`다.

전송 암호화와 VAPID는 고정된 `npm:web-push@3.6.7`의 `generateRequestDetails`를 사용한다. 직접 암호화하지 않는다. endpoint는 HTTPS Apple Push, FCM, Mozilla Push 호스트만 허용하며 사용자 정보·포트·쿼리·fragment·리디렉션을 허용하지 않는다. 전송은 `fetch`의 `redirect:error`, 12초 abort를 사용하고 provider 응답 본문을 취소한다. TTL은 업무 만료까지 남은 시간과 24시간 중 작은 값이다. 본인 테스트는 5분 만료다. provider가 이미 보관한 푸시는 취소할 수 없으므로 service worker도 현재 로그인 사용자와 바인딩을 확인해야 한다.

201/202 응답은 `accepted`이며 실제 기기 표시를 뜻하지 않는다. 404/410은 현재 구독 fingerprint와 바인딩이 일치할 때만 설치를 비활성화한다. 명확한 429/5xx 거절은 최대 5회 지수 재시도한다. 타임아웃, 리디렉션 및 응답 유실은 `unknown`으로 끝내 자동 재전송하지 않는다. 401/403은 provider 설정 오류로 현재 배치를 중단한다. 이미 terminal인 전송은 재완료하지 않는다.

## 격리 검증

앱 package를 변경하지 않고 별도 도구 위치에 PGlite와 Web Push를 설치해 검증할 수 있다.

```powershell
$env:PUSH_PGLITE_MODULE='<test-tools>\node_modules\@electric-sql\pglite\dist\index.js'
node scripts/verify-web-push-database.mjs
$env:WEB_PUSH_MODULE='<test-tools>\node_modules\web-push'
node --experimental-default-type=module --test supabase/functions/tests/web-push-worker.test.ts
```

첫 명령은 격리 PostgreSQL에 실제 마이그레이션을 실행한다. 기존 Android RPC 불변, 예약/응답 유실 해제, 오래된 증명, 계정 전환, 설정 OFF, 카테고리 OFF, 회원 정지, 런타임 OFF, 재시도 상한, 구독 갱신 이후 이전 endpoint 오류, SSRF, RLS와 서비스 권한을 확인한다. 두 번째 명령은 실제 라이브러리로 새 P256 구독과 VAPID 헤더·암호화 본문을 생성하며 네트워크 전송이나 키 출력은 하지 않는다. `WEB_PUSH_MODULE`이 없으면 이 한 가지 라이브러리 통합 검증은 skip되므로 실제 실행 결과를 별도로 확인한다.

iPhone 홈 화면 설치, iOS 16.4 이상 실제 권한 요청, APNs/Web Push 전달, 백그라운드 표시·클릭·로그아웃 후 미표시는 실기기 검증 대상이다. 로컬 테스트 통과를 이러한 검증의 완료로 기록하지 않는다.
