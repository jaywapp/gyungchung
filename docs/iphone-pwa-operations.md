# iPhone 홈 화면 앱과 웹 푸시 운영 안내

이 안내는 iPhone의 홈 화면 웹 앱(PWA) 설치와 별도 웹 푸시 서버의 활성화·확인·중지 절차를 설명한다. Apple Developer Program 가입이나 App Store·TestFlight 설치 없이 사용할 수 있다. iOS 16.4 이상에서 홈 화면에 추가한 웹 앱이 알림 권한을 요청할 수 있다. [WebKit 공식 안내](https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/)

DB와 웹 전송 함수의 운영 적용, 키 초기화와 웹 cron 활성화, PR #182의 main 자동 배포와 운영 URL·로그를 확인했다. 실제 iPhone에서 설치·권한 요청·앱 종료 상태 수신·알림 클릭을 확인하는 실기기 검증은 대기 중이다.

## 회원의 설치와 알림 사용

1. iPhone의 **Safari**에서 [경충FC](https://gyungchung.vercel.app)를 연다.
2. Safari의 **공유** 메뉴에서 **홈 화면에 추가**를 선택한다. 메뉴에 보이지 않으면 공유 메뉴의 동작 편집에서 추가할 수 있다.
3. **‘앱으로 열기’** 선택 항목이 표시되면 ON으로 두고 **추가**를 누른다. 항목 이름과 위치는 iOS 버전에 따라 다를 수 있다. [Apple의 홈 화면 추가 안내](https://support.apple.com/guide/iphone/bookmark-a-website-iph42ab2f3a7/ios)
4. 홈 화면의 **경충FC 아이콘**을 눌러 열고 로그인한다. Safari 탭의 로그인과 홈 화면 앱의 로그인은 다를 수 있으므로 아이콘에서 다시 확인한다.
5. 활동 회원으로 승인되고 최초 비밀번호 변경을 완료한 계정으로 **마이페이지 → 경충FC 알림 → 이 기기 알림 켜기**를 누른다. iOS가 알림 권한을 요청하면 **허용**을 선택한다.
6. 연결 상태를 확인한 뒤 **테스트 알림 받기**를 누른다. 운영 서버가 활성화되어 있으면 테스트가 큐에 들어가고 전송된다. 테스트는 1분에 한 번 요청할 수 있다.
7. 알림이 표시되는지 확인하고, 알림을 눌렀을 때 경충FC가 열리는지도 확인한다. 앱을 화면에서 닫거나 다른 앱으로 이동한 상태에서도 테스트한다.

홈 화면 앱을 계속 열어 두지 않아도 웹 푸시를 받을 수 있다. 다만 네트워크 연결, iOS 알림 설정과 집중 모드에 따라 표시 시점과 방식이 달라질 수 있다. 본 구현에서 앱 종료·잠금 화면·백그라운드 수신은 아직 실제 iPhone으로 확인하지 않았다. 홈 화면 웹 앱의 알림도 iOS 집중 모드의 적용을 받는다. [WebKit의 집중 모드 지원 설명](https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/#focus-support)

알림 권한을 거절했다면 iPhone의 **설정 → 알림 → 경충FC**에서 허용한 뒤 마이페이지의 **다시 확인**을 누른다. 알림이 보이지 않으면 집중 모드, 잠금 화면·배너 표시 설정, 네트워크 상태와 앱 안의 전체 알림 설정도 확인한다. **전체 알림**과 종류별 수신 설정은 같은 계정의 Android 앱에도 적용된다. **이 기기 알림 끄기**는 해당 웹 설치의 연결을 해제한다.

알림 OFF 또는 로그아웃 직전에 provider에 이미 제출된 푸시는 취소할 수 없다. 뒤늦게 도착한 경우 개인 제목·내용 대신 **‘앱을 열어 알림 설정을 확인해 주세요.’** 같은 일반 안내가 표시될 수 있다. 이후 다른 계정으로 로그인해도 이전 계정의 개인 알림 내용이나 링크를 그대로 열지 않도록 현재 기기 바인딩을 검사한다.

## 운영 활성화 순서

아래 순서는 승인된 운영 작업 시 실행할 절차다. SQL 예시는 프로젝트의 관리자 `postgres` 권한으로 실행하며, 비밀값을 출력하는 조회나 수동 키 복사는 포함하지 않는다.

### 1. 세 개의 마이그레이션 적용

기존 배포된 마이그레이션 다음에 다음 순서로 적용한다.

| 순서 | 파일 | 역할 |
| --- | --- | --- |
| 1 | `20261002122614_web_push_notifications.sql` | 웹 설치·예약·큐·서비스 전용 RPC와 기본 OFF인 웹 런타임 |
| 2 | `20261002122625_welcome_pwa_distribution.sql` | 기존 소개 페이지의 iPhone PWA 안내 계약 확장 |
| 3 | `20261002122905_web_push_vapid_configuration.sql` | Vault의 VAPID 키 설정, 공개키 RPC, 웹 전용 호출·실행 기록·비활성 cron |

마이그레이션 직후 `private.web_push_runtime.enabled`는 false이고 `activated_at`은 null이다. cron 작업 **`gyungchung-web-push-dispatch`**도 비활성으로 생성된다. 기존 Expo 트리거·설치·큐·전송 RPC를 교체하지 않는다.

### 2. 웹 Edge Function 배포와 커스텀 인증 확인

`supabase/functions/web-push-worker/index.ts`를 **`web-push-worker`**로 배포한다. 이 엔드포인트는 Supabase 사용자 JWT 대신 기존 워커의 공유 비밀을 직접 검증하므로 플랫폼 JWT 검사를 끄는 배포 설정(`--no-verify-jwt`, 또는 해당 함수의 `verify_jwt=false`)이 필요하다. JWT 검사를 끈 뒤에도 handler의 커스텀 인증을 유지한다. [Supabase의 직접 인증 처리 안내](https://supabase.com/docs/guides/functions/auth#external-webhooks)

요청은 POST `{"action":"dispatch"}`이며 기존 **`PUSH_WORKER_SECRET`**을 Bearer 또는 `x-push-worker-secret`으로 검증한다. 두 헤더가 함께 있으면 둘 다 일치해야 한다. 인증 없는 호출은 401이고 키 초기화·큐 조회를 수행하지 않아야 한다. 비밀값은 브라우저, 문서, 명령 출력이나 로그로 전달하지 않는다.

웹 워커는 기존 프로젝트의 **`PUSH_WORKER_SECRET`**, **`PUSH_DELIVERY_ENABLED`**를 재사용한다. 별도 VAPID 환경 변수는 필요하지 않다. 전역 전송 플래그를 웹만을 위해 변경하면 Android에도 영향을 줄 수 있으므로 기존 값을 유지하고 웹 전용 DB gate로 제어한다. 서버의 Supabase 비밀키는 Edge 런타임 내부에서만 사용한다.

### 3. 런타임 OFF 상태에서 VAPID bootstrap

`private.web_push_runtime.enabled=false`를 확인한 뒤 다음 호출만 실행한다.

```sql
select private.invoke_web_notification_worker(true);
```

`true`는 최초 설정 준비용이며 웹 런타임이 이미 ON이면 실행하지 않는다. 함수는 비활성 상태를 유지하는 잠금 안에서 인증된 워커를 호출한다. 워커는 인증 후 설정을 로드하고, 설정이 처음이면 서버에서 VAPID 키를 생성해 Vault에 한 번 저장한다. DB 전송 gate는 계속 OFF이므로 bootstrap 응답은 `action:dispatch`, `processed:0`이어야 한다. 함수 반환값은 HTTP 상태이며 성공은 200이다. 호출 구성이나 공유 비밀 조건을 충족하지 못하면 null일 수 있다.

이 호출은 기존 Vault 항목 **`gyungchung-push-worker-url`**, **`gyungchung-push-worker-secret`**을 내부에서 확인한다. 새 VAPID 개인키는 **`gyungchung-web-push-vapid-private-key`**로 저장되고, `private.web_push_configuration.secret_id`가 해당 키를 가리킨다. `subject`는 `https://gyungchung.vercel.app`이다.

키 존재 여부를 확인할 때 `get_web_push_config()`나 `vault.decrypted_secrets`의 내용을 출력하지 않는다. 공개키만 반환하는 `get_web_push_public_key()`를 사용하거나 다음 웹 API 확인으로 진행한다. Vault는 암호화된 값을 저장하며 복호화 view 접근은 비밀 접근이므로 운영 도구의 출력도 제한해야 한다. [Supabase Vault 공식 문서](https://supabase.com/docs/guides/database/vault)

### 4. 공개키 설정 API 확인

신규 앱 코드를 실행하는 로컬/미리보기 환경에서 **GET `/api/web-push/config`**가 HTTP 200인지 확인한다. main 배포 전에는 새 route가 없는 기존 운영 버전 대신 새 코드 환경을 확인한다. 미리보기 접근 보호가 있다면 먼저 정상적으로 접근 가능한 환경에서 확인한다.

정상 응답은 `{publicKey: ...}`이며 구독에 사용할 VAPID 공개키만 포함한다. `Cache-Control:no-store`가 설정된다. 초기화 전이거나 설정 조회가 실패하면 HTTP 503과 `web_push_unavailable`이 반환된다. API 응답에 `private_key`, 공유 비밀, 설치 구독이 포함되지 않아야 한다.

### 5. 웹 런타임과 웹 cron 활성화

공통 `private.notification_runtime`의 `delivery_mode`, `test_auth_user_ids`, `disabled_categories`를 확인한다. 웹도 같은 테스트 대상·카테고리 제한을 따른다. 테스트 모드라면 허용된 활동 회원만 전송 대상이다. 이 단계에서 Android를 위해 사용 중인 공통 모드나 Expo project ID를 임의로 변경하지 않는다.

최초 활성화 시 웹 전용 시각과 cron을 설정한다.

```sql
begin;
update private.web_push_runtime
set enabled=true, activated_at=coalesce(activated_at, now())
where singleton;
select cron.alter_job(jobid, active:=true)
from cron.job
where jobname='gyungchung-web-push-dispatch';
commit;
```

`activated_at`보다 오래된 업무 이벤트는 소급 전송하지 않는다. cron은 매분 `private.invoke_web_notification_worker()`를 호출하며 이 함수도 웹 런타임 ON을 확인한다. 재개 시에는 기존 `activated_at`을 보존한다.

### 6. PR 검토 후 main의 자동 웹 배포 확인

앱 통합 테스트와 production build를 통과한 변경을 PR로 검토한 뒤 main에 반영하고, 연결된 웹 배포의 완료와 실제 버전을 확인한다. DB와 Edge Function이 먼저 준비되어 있어야 새 웹 UI가 구독을 연결할 수 있다. `/api/web-push/config`와 `/sw.js`, 홈 화면 설치 안내가 운영 버전에 반영되었는지 확인한 후 회원의 설치·테스트 절차로 진행한다.

## 운영 확인과 키 보존

웹 호출의 요약은 `private.web_notification_worker_runs`에서 **`started_at`, `finished_at`, `http_status`, `processed`, `error_code`**만 확인한다. 실패 코드는 `http_failed` 또는 `bad_response`다. 응답 본문·HTTP 헤더·endpoint·auth 키는 실행 기록에 저장하지 않는다. 웹 큐의 요약은 `private.web_notification_deliveries`의 `status`, `attempts`, `error_code`로 확인한다.

provider의 HTTP 201/202는 큐의 **`accepted`**를 뜻하며 실제 iPhone 수신이나 알림 표시 증거가 아니다. 실제 표시는 회원 또는 검증 기기에서 별도로 확인한다. 타임아웃·응답 유실의 **`unknown`**은 자동 재전송하지 않는다. 명확한 429/5xx 거절은 최대 5회 재시도하고, 404/410은 당시 구독과 바인딩이 일치할 때만 연결을 비활성화한다.

VAPID 개인키는 Vault 밖으로 출력·복사하지 않는다. 키 설정이 이미 존재하면 재배포와 bootstrap을 반복해도 기존 쌍을 재사용한다. Vault 키가 유실·손상된 경우 자동 회전이나 새 키 발급으로 덮어쓰지 않고 웹 전송을 중지한 뒤 기존 키 복구 여부를 판단한다. 키를 바꾸면 기존 브라우저 구독에도 재등록이 필요하므로 별도의 변경 절차 없이 회전하지 않는다.

## 웹만 롤백하거나 중지

문제가 생기면 웹 런타임과 웹 cron만 OFF로 둔다.

```sql
begin;
update private.web_push_runtime set enabled=false where singleton;
select cron.alter_job(jobid, active:=false)
from cron.job
where jobname='gyungchung-web-push-dispatch';
commit;
```

기존 Expo 워커·cron·전역 플래그·공통 회원 설정은 그대로 둔다. 웹 마이그레이션이나 설치·예약·큐·Vault 키를 drop하지 않는다. 보존된 tombstone과 키가 오래된 등록 요청의 복구·재활성화를 막고 재개 시 기존 구독을 유지하는 데 필요하다. 재개 전 문제를 해결하고 기존 키와 활성화 시각을 보존한 상태에서 웹 gate와 cron만 다시 켠다. 이미 provider가 수락한 푸시의 뒤늦은 일반 안내는 발생할 수 있다.

## 이번 세션의 검증 상태

| 항목 | 현재 확인 |
| --- | --- |
| 기존 native 알림 DB | 격리 PostgreSQL 130개 assertion 통과 |
| 웹 설치·큐 DB | 격리 PostgreSQL 63개 확인 통과 |
| VAPID/Vault·웹 호출 설정 | 격리 검증 120개 assertion 통과 |
| 웹 워커 | 13개 테스트 통과. 실제 `web-push@3.6.7`로 VAPID 헤더·암호화 본문 생성 포함, 키 출력·네트워크 전송 없음 |
| 전체 앱 테스트 최종 집계 | 203개 통과, skip 없음. TypeScript·전체 ESLint 통과 |
| 소개 페이지 DB 계약 | 기존 pgTAP 148개, invalid fixture 58개·URL 26개와 PWA 허용/배포 URL 거절 검증 통과 |
| 브라우저 UI | 데스크톱·iPhone 크기에서 로그인·예약·등록·본인 테스트 요청·로그아웃 해제·설치 안내 14개 확인 통과. 권한·구독·회원 API는 합성 fixture이며 실제 Safari/APNs 검증은 아님 |
| production build | Next.js 15.5.27 production build 통과 |
| Lighthouse | 로컬 production `/welcome`: 접근성 100, best practices 100, performance 78, CLS 0. 원격 DB·APK 조회와 CPU/네트워크 제한이 포함된 1회 측정이며 LCP 4.72초는 목표 2.5초를 넘음 |
| iPhone 실제 설치·수신·클릭·로그아웃 후 동작 | 실기기 검증 대기 |

최종 완료 기록에는 OS 버전, 홈 화면 설치 여부, 권한 허용, 전경·백그라운드·앱 종료·잠금 화면 테스트, 집중 모드 조건, 클릭 목적지, 설정 OFF와 계정 전환 후 개인 내용 보호 확인을 포함한다. 기기 구독 endpoint나 키, 개인 계정 토큰은 기록하지 않는다.

## 운영 적용 기록 — 2026-10-02

- 위 세 마이그레이션을 MCP로 적용하고 원격 이력의 버전에 로컬 파일명을 맞췄다. 재적용하지 않는다.
- `web-push-worker` version 1 ACTIVE, 커스텀 인증을 사용하는 `verify_jwt=false`로 배포했다. 무인증 호출은 HTTP 401이다.
- 런타임 OFF 상태의 bootstrap은 HTTP 200, processed 0, error_code null이었다. 실제 Edge의 VAPID 키 생성과 Vault 저장·공개키 조회를 확인했다. provider 전송과 실제 기기 수신은 이 기록에 포함되지 않는다.
- 새 API의 로컬 production 응답은 HTTP 200, 공개키 필드 1개, `Cache-Control:no-store`다. anon/authenticated의 비밀키 RPC 실행 권한은 모두 false다.
- 웹 런타임과 매분 cron을 ON으로 바꾸고 `activated_at=2026-10-02T12:31:25.972899Z`를 기록했다. 당시 웹 설치 수 0, 공통 모드 production, 기존 native cron 두 개 ACTIVE였다.
- 관리형 postgres가 함수 선언의 `SET http.timeout_msec`를 거부해 해당 마이그레이션은 최초 시도에서 원자적으로 롤백됐다. 이 선언만 제거하고 실제 지원되는 curl timeout 60초·접속 5초 설정을 유지한 뒤 적용했다. 운영 세션과 DB/role의 양수 GUC override는 없었다. [pgsql-http 1.6 공식 구현](https://github.com/pramsey/pgsql-http/blob/v1.6.0/http.c)
- 보안 advisor의 private RLS/no-policy는 브라우저 직접 접근을 금지하는 서버 저장소 설계다. 공개키 getter와 소유 증명 기반 익명 해제 RPC의 SECURITY DEFINER 경고는 의도한 공개 계약이며, 작업용 RPC와 개인키 getter는 서비스 역할만 실행할 수 있다. [Supabase advisor 설명](https://supabase.com/docs/guides/database/database-linter?lint=0028_anon_security_definer_function_executable)
- 기존 Next.js 보안 취약점 때문에 같은 15.5 계열의 15.5.27 및 전이 의존성 패치를 함께 적용했다. npm audit의 발견 취약점은 0개다. [공식 Next.js 보안 공지](https://github.com/vercel/next.js/security/advisories/GHSA-p293-qw3h-jr36)
- 웹 cron의 12:32·12:33·12:34 UTC 실제 실행은 HTTP 200, processed 0, error_code null이었다. 같은 시각 기존 native dispatch도 HTTP 200이었다.
- 작업 브랜치 `codex/iphone-pwa-push`, [PR #182](https://github.com/jaywapp/gyungchung/pull/182)는 12:42:14 UTC에 병합됐다. main 커밋은 `cabdea2c60fc1c35b615fc1fb5a4a7141e0bcb41`이며, 배포 `dpl_ERZP73wWcRaujrL5t86hQ8wMqTqr`가 READY 및 `gyungchung.vercel.app`의 alias로 확인됐다.
- 운영 `/welcome`의 iPhone 설치 안내와 ‘앱으로 열기’ 문구, `/manifest.webmanifest`의 id/scope `/`·display standalone, `/sw.js`의 push/클릭 handler, `/api/web-push/config`의 공개키 단독 응답 모두 HTTP 200이었다. config는 no-store이며 서비스 워커는 회원 데이터를 캐시하지 않는다.
- 해당 운영 배포의 build log에서 Next.js 15.5.27 컴파일·타입/린트·정적 페이지 생성·출력 배포 성공을 확인했다. 12:45 UTC 조회 기준 최근 10분의 이 배포에는 error/fatal 및 HTTP 5xx runtime log가 없었다. 유휴 시간의 정상 로그가 실제 회원 푸시 수신 증거는 아니다.
- 첫 preview의 config HTTP 503은 프로젝트의 preview 변수가 예전 브랜치에만 지정돼 있었기 때문이었다. 이번 구현 브랜치에 공개 `NEXT_PUBLIC_SITE_URL`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`를 설정하고 같은 커밋을 재배포한 `dpl_AfPfmhTMU73ZZeyApYKmKqV547JL`에서 HTTP 200을 확인한 후 병합했다. Production 설정은 기존 값을 유지했다. [Vercel preview 환경 변수](https://vercel.com/docs/environment-variables#preview-environment-variables)
- 별도 위키 동기화는 자동 승인 검토가 현재 요청 범위 밖으로 판정해 차단됐다. 재사용할 운영 교훈과 공식 근거는 이 저장소 문서에 보관했다.
