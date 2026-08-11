# 경충FC 클럽하우스

경충FC 회원을 위한 웹 클럽하우스입니다. 회원 목록, 회비 현황, 공지사항, 주말 풋살 일정과 참석 여부, 용병 명단, 팀 편성, 커피 내기 경기 기록, MOM 투표, 활동 랭킹, 사용자 의견, 투표·설문·회장단 선거를 한곳에서 제공합니다.

사용자 의견은 기본적으로 팀 내부에만 저장됩니다. 작성자가 공개 등록에 동의한 제보는 Supabase Edge Function이 작성자 정보를 제외한 제목과 내용만 `jaywapp/gyungchung`의 GitHub Issue로 중계하고, 생성된 이슈 번호와 URL을 원본 제보에 연결합니다.

GitHub 중계를 사용하려면 Issues 쓰기 권한만 가진 최소 권한 토큰을 Supabase Function secret `GITHUB_ISSUES_TOKEN`으로 등록해야 합니다.

계정 권한은 `admin`, `manager`, `member`로 구분됩니다. `admin`은 서비스 소유자 계정으로 전체 권한을 가지며, `manager`는 운영진으로서 부여된 운영 업무를 관리하고, `member`는 일반 회원 기능을 사용합니다.

## 로컬 실행

1. `.env.example`을 `.env.local`로 복사하고 Supabase 공개 연결 정보를 입력합니다.
2. `npm install`
3. `npm run dev`

## 데이터베이스

`supabase/migrations`의 마이그레이션은 회원·가입 신청·회비·공지·일정·실제 출석·용병·팀 편성·경기 기록·MOM·의견·투표·설문·선거 테이블, 역할별 권한과 RLS 정책을 생성합니다. 모든 회원은 인증된 이메일을 기준으로 하나의 계정을 사용합니다. 이메일 아이디·비밀번호로 가입하거나 Google·카카오의 이름과 이메일을 불러와 가입할 수 있으며, 같은 인증 이메일의 소셜 로그인은 기존 회원 계정에 연결됩니다. 소셜 제공자가 이메일을 전달하지 않으면 이메일 인증을 먼저 완료해야 합니다. 처음 가입한 사용자는 이름, 전화번호, 생년월일, 거주지역과 선호 포지션을 입력해 가입을 신청해야 하며, 매니저 또는 어드민 승인 전까지 회원 기능을 사용할 수 없습니다.

활동 랭킹은 실제 출석 1회당 3점, 회비 납부 1개월당 1점으로 계산합니다. MOM은 일정 시작 후 실제 출석 회원끼리 본인을 제외하고 1인 1표로 투표하며, 일정별 상위 1~3위와 누적 기록을 제공합니다. 커피 내기 모드는 금전 정산이 아니라 팀 스코어·승패·개인 골·평점을 기록하는 경기 모드입니다.

## 인증 설정

Supabase Authentication Providers에서 Email, Google과 Kakao를 활성화하고, 배포 주소의 `/auth/callback`을 Redirect URLs 허용 목록에 추가합니다. 이메일 인증과 자동 identity linking을 사용하며, 회원의 권한은 `profiles`에서만 관리합니다. Kakao Developers와 Google Cloud에는 Supabase가 표시하는 provider callback URL을 등록합니다. Kakao 앱은 Biz App으로 전환한 뒤 동의 항목의 `account_email`, `profile_nickname`, `profile_image`를 활성화합니다. 이메일 없는 계정 허용 옵션을 사용하더라도 앱에서 별도 이메일 인증을 요구합니다.

## 배포

Vercel Git Integration을 통해 `main` 브랜치의 변경 사항이 프로덕션에 자동 배포됩니다.
