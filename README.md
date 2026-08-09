# 경충FC 클럽하우스

경충FC 회원을 위한 웹 클럽하우스입니다. 회원 목록, 회비 현황, 공지사항, 주말 풋살 일정과 참석 여부, 사용자 의견, 투표·설문·회장단 선거를 한곳에서 제공합니다.

운영 권한은 `회장`, `부회장`, `총무`, `회원`으로 구분됩니다. 회장단은 역할별 권한에 따라 회원, 회비, 공지, 일정과 참여 프로그램을 관리할 수 있습니다.

## 로컬 실행

1. `.env.example`을 `.env.local`로 복사하고 Supabase 공개 연결 정보를 입력합니다.
2. `npm install`
3. `npm run dev`

## 데이터베이스

`supabase/migrations`의 마이그레이션은 회원·가입 신청·회비·공지·일정·참석·의견·투표·설문·선거 테이블, 역할별 권한과 RLS 정책을 생성합니다. 처음 로그인한 사용자는 이름, 전화번호, 생년월일, 거주지역과 선호 포지션을 입력해 가입을 신청해야 하며, 회장단 승인 전까지 회원 기능을 사용할 수 없습니다.

## OAuth 설정

Supabase Authentication Providers에서 Google과 Kakao를 활성화하고, 배포 주소의 `/auth/callback`을 Redirect URLs 허용 목록에 추가합니다. Kakao Developers와 Google Cloud에는 Supabase가 표시하는 provider callback URL을 등록합니다. 카카오는 이메일을 제공하지 않는 계정도 가입할 수 있도록 설정하며 닉네임과 프로필 사진만 요청합니다.

## 배포

Vercel Git Integration을 통해 `main` 브랜치의 변경 사항이 프로덕션에 자동 배포됩니다.
