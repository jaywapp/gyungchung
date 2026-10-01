# 푸시 알림 서버 계약

- 상태: 미적용 migration과 기본 비활성 worker 초안. 운영 SQL·배포·시크릿 등록·실제 발송을 하지 않았다.
- migration: Supabase CLI 2.102.0으로 생성한 `20261001073236_push_notifications.sql`.
- 앱은 동일 Supabase 프로젝트의 로그인 JWT를 사용한다. `profiles.auth_user_id`로 회원을 연결하고 active 및 보호된 `must_change_password=false`를 확인한다.

## 계정 설정

`get_notification_settings()` 및 `save_notification_preferences(target_preferences jsonb)`, `save_notification_policy(target_policy jsonb)` 응답:

```json
{
  "preferences": {
    "enabled": false,
    "attendance_enabled": true,
    "schedule_enabled": true,
    "notices_enabled": true,
    "event_reminders_enabled": true,
    "rsvp_reminders_enabled": true,
    "participation_enabled": true,
    "feedback_enabled": true
  },
  "policy": {
    "attendance_audience": "officers_and_attendees",
    "event_reminder_hour": 18,
    "rsvp_reminder_hours": 24,
    "participation_reminder_hours": 24
  },
  "can_manage_policy": false,
  "can_send_rsvp_reminder": false
}
```

저장 RPC는 허용 키의 부분 JSON만 받는다. 전체 끄기는 종류별 값을 보존하고 계정의 모든 설치를 비활성화한다. 다시 켠 기기는 앱이 등록을 갱신해야 한다. 해제 tombstone이 없는 같은 owner+epoch 등록 갱신은 현재 master/OS 상태에 따라 다시 활성화할 수 있으며 revision과 proof는 유지한다.

정책·수동 재알림·취소 관리 권한은 기존 `private.has_permission('events.manage')`다. 참석 알림의 운영진 수신자는 active manager+officer_title 또는 active is_system_admin이다. 수신 범위는 `officers_and_attendees`(기본), `officers`, `all_active` 세 값이다. 기본 참석자는 발송 시 해당 일정의 going 회원이다. 설정 master/category, 회원 연결·활동·비밀번호·test 계정 제외 조건은 모든 수신자에게 적용된다.

경기 안내는 전날 18시 Asia/Seoul, RSVP와 투표/설문/선거 마감 안내는 24시간 전 정책을 사용한다. 시간 정책을 바꿀 수 있지만 운영 발송은 별도 승인과 활성화 전까지 중지다. RSVP 마감은 기존 `events.starts_at`이다. 자동 예약은 예정 시각부터 6시간 이내만 생성하며 source+deadline 중복을 막는다. 마감·시각 변경 후에는 현재 원본과 일치하는 예약만 보낸다.

## 기기 등록·해제

`register_push_installation` 인수:

| 인수 | 계약 |
| --- | --- |
| target_installation_id | SecureStore 지속 UUID |
| target_installation_proof | 요청 전에 저장한 난수 소문자 64hex |
| target_revocation_proof | 해당 binding에 사용할 난수 64hex, 요청 전에 지속 저장 |
| target_transition_epoch | 지속 정수, 0..9007199254740991 |
| target_binding_revision | 신규 0, 이후 마지막 서버 revision |
| target_expo_token | ExpoPushToken[...] 또는 ExponentPushToken[...] |
| target_platform | android 또는 ios |
| target_permission_state | granted/denied/undetermined |
| target_project_id | Expo 프로젝트 UUID |

응답은 `{installation_id,transition_epoch,binding_revision,revocation_expires_at,enabled,stale:false}`. 같은 owner+epoch 토큰 갱신은 revision/proof를 유지한다. 새로운 epoch는 새로운 해제 proof를 요구하고 revision을 증가시킨다. 오래된 epoch/revision이면 `{installation_id,transition_epoch,binding_revision,enabled:false,stale:true}`로 서버 상태만 반환하며 바인딩을 변경하지 않는다. 앱은 현재 계정·요청 세대와 맞는 응답만 사용한다. master off 또는 OS denied/undetermined 등록은 가능하나 enabled=false다.

`revoke_push_installation(target_installation_id,target_binding_revision,target_transition_epoch,target_revocation_proof)`는 JWT 없이 anon 호출도 허용한다. 무작위 proof의 해시가 현재 binding과 일치해야 하며 proof는 30일 유효하다. 신규 등록 응답을 잃었으면 revision=0으로 정확한 사전 저장 proof만 해제할 수 있다. 정상 해제는 마지막 revision과 등록 N보다 큰 epoch(N+1)를 보낸다. 이 epoch는 tombstone이 되어 같은 epoch와 더 오래된 등록이 재활성화할 수 없다. 다음 등록은 N+2 이상이다. 이전 proof는 새 binding을 해제하지 못한다.

모든 해제 응답은 `{installation_id,transition_epoch,binding_revision,enabled:false,revoked:boolean,terminal:true}`이며 숫자는 음수 없는 안전 정수다. 틀리거나 만료된 proof는 개인 정보 없이 요청의 epoch/revision을 돌려주고 revoked=false다. 최초 등록이 도착하기 전 해제는 installation UUID+정확한 proof 해시의 tombstone을 남겨 revoked=true로 반환한다. 같은 proof의 늦은 최초 등록을 막지만 관계없는 proof는 차단하지 않는다. terminal=true를 검증한 앱은 현재 로컬 요청 세대를 확인하고 해당 해제 큐를 완료한다. 해제 재시도는 안전하다. 서버는 proof 원문을 저장하지 않으며 로그에도 남기지 않는다. 30일 이상 갱신하지 않은 설치와 만료 proof 설치는 전송에서 제외한다.

## 수동 다시 알리기와 취소

- `get_rsvp_reminder_preview(target_event_id uuid)` → `{eligible_count,next_allowed_at}`.
- `request_rsvp_reminder(target_event_id uuid)` → 위 값과 `notification_id`. 동일 일정 10분 제한, 일정 행 잠금으로 동시 호출을 직렬화한다.
- 대상 count는 active/linked/password 완료/test 제외 회원 중 no row 또는 undecided인 수다. 개인 수신 설정·OS·기기 조건 때문에 실제 발송 수는 이보다 적을 수 있다. 요청·발송 직전 모두 원본을 다시 확인한다.
- `cancel_event(target_event_id uuid)` → `{notification_id,source_id,cancelled:true}`. 미래 일정만 가능하며 명시 snapshot/outbox를 만든 뒤 기존 삭제 계약을 사용한다. 정기 일정은 exclusions도 같은 트랜잭션에서 남긴다. outbox source ID는 삭제 cascade FK를 갖지 않는다.
- 납부·면제 참여비(회원/용병), 현장 출석 상태·시각, 경기 이력 또는 점수/골/평점이 있으면 취소를 거부해 기록을 보존한다. 해당 일정과 관계없는 월회비는 제한에 포함하지 않는다.
- 직접 DELETE와 이전 `cancel_weekly_event`는 기존 동작을 유지하며 새 취소 알림을 만들지 않는다. 새 모바일 메뉴는 `cancel_event`를 호출한다. `canceled_at` 칼럼은 추가하지 않는다.

## payload

```json
{
  "version": 1,
  "notification_id": "event-uuid",
  "kind": "attendance_added",
  "category": "attendance",
  "source_type": "event",
  "source_id": "source-uuid",
  "recipient_user_id": "auth-user-uuid",
  "installation_id": "installation-uuid",
  "binding_revision": 1,
  "transition_epoch": 0
}
```

| kind | category | source_type |
| --- | --- | --- |
| attendance_added / attendance_declined | attendance | event |
| schedule_changed / event_cancelled | schedule | event |
| notice_created | notices | notice |
| event_reminder | event_reminders | event |
| rsvp_reminder | rsvp_reminders | event |
| participation_reminder | participation | participation_form |
| feedback_updated | feedback | feedback |

Android channelId는 category, sound는 default다. 앱은 계정·설치·revision·epoch와 허용 kind/category/source_type 조합을 확인한 뒤 사용한다. 일정 ID는 최신 날짜로 재조회한다. 취소는 원본이 삭제됐으므로 일정 목록과 취소 안내로 이동한다. feedback은 현재 author_id가 본인인지 확인한다. payload에는 URL이나 답변 원문·시크릿을 넣지 않는다.

## worker와 운영 중지

entrypoint는 `supabase/functions/push-worker/index.ts`. POST 본문은 `{"action":"dispatch"}` 또는 `{"action":"receipts"}`. `x-push-worker-secret`의 서버 전용 32자 이상 시크릿을 검증한다. 함수 배포 시 해당 함수만 verify_jwt=false로 설정해야 하며 publishable key는 이 인증을 대신하지 못한다.

실제 전송에는 `PUSH_DELIVERY_ENABLED=true`, worker secret, DB runtime enabled=true, 비어 있지 않은 테스트 auth UUID allowlist, 일치하는 Expo project UUID가 모두 필요하다. 모두 기본 비활성이다. allowlist 제한을 없애는 운영 전체 발송은 이번 계약에 없다. Supabase 서버 키와 선택적 EXPO_ACCESS_TOKEN은 Edge 환경에서만 읽는다.

DB AFTER 트리거는 네트워크를 호출하지 않는다. private outbox를 같은 업무 트랜잭션에 남기므로 rollback과 배치의 실패 행은 알림도 사라진다. worker는 lease→현재 회원/설정/원본/OS/binding→token snapshot 확인 후 Expo에 요청한다. ticket과 receipt를 구분하고 구 token의 DeviceNotRegistered로 새 token을 비활성화하지 않는다. 네트워크 수락 여부 불명확/응답 손상/발송 lease 만료는 unknown이며 자동 재발송하지 않는다. 명시적인 일시 오류는 최대 5번 제한 재시도한다. dispatch 루프는 40초 예산을 두며 다음 작업을 준비하기 전에 예산을 확인한다. 준비하지 않은 claimed 건은 2분 lease 만료 후 다시 가져온다. provider 요청은 응답 본문까지 12초 및 256KiB로 제한한다. receipt는 ticket 15분 후 확인하며 24시간 경과 ticket은 unknown으로 종료한다. 이미 공급자로 보낸 알림의 회수나 정확히 한 번 기기 표시를 보장하지 않는다.

운영 pg_cron/pg_net/Vault 설정, 시크릿 등록, 함수 배포·실제 기기 발송은 수행하지 않았다. [Supabase 예약](https://supabase.com/docs/guides/functions/schedule-functions) · [함수 인증](https://supabase.com/docs/guides/functions/auth) · [Expo 전송·영수증](https://docs.expo.dev/push-notifications/sending-notifications/)

## 검증

worker: `node --experimental-default-type=module --test supabase/functions/tests/push-worker.test.ts`.

격리 DB: `PUSH_PGLITE_MODULE`에 로컬 설치된 `@electric-sql/pglite/dist/index.js` 절대 경로를 지정한 뒤 `node scripts/verify-push-database.mjs`. 환경변수는 파일 경로이며 운영 연결 문자열이 아니다. 모듈을 일반 dev 환경에 설치했다면 경로를 생략할 수 있다. fixture는 회원/권한/참석/일정/공지/의견/참여 계약과 실제 비밀번호·출석 보호 함수 및 attendance batch RPC를 사용한다. 전체 Supabase Auth 세션/이전 모든 migration의 통합 실행을 대체하지 않는다. PostgreSQL 18.3(PGlite 0.5.8)에서 검증했으며 실제 운영 PostgreSQL 버전과 전체 migration 적용 검증은 배포 전 별도 단계다.
