# 경충FC 클럽하우스

경충FC 회원을 위한 웹 클럽하우스입니다. 회원 목록, 회비 현황, 공지사항, 주말 풋살 일정과 참석 여부를 제공하며 관리자는 모든 항목을 관리할 수 있습니다.

## 로컬 실행

1. `.env.example`을 `.env.local`로 복사하고 Supabase 공개 연결 정보를 입력합니다.
2. `npm install`
3. `npm run dev`

## 데이터베이스

`supabase/migrations`의 마이그레이션은 회원·회비·공지·일정·참석 테이블과 RLS 정책을 생성합니다. 첫 가입자는 기본 회원 권한으로 생성되며, 최초 관리자는 Supabase에서 `profiles.role`을 `admin`으로 변경해야 합니다.

## OAuth 설정

Supabase Authentication Providers에서 Google과 Kakao를 활성화하고, 배포 주소의 `/auth/callback`을 Redirect URLs 허용 목록에 추가합니다. Kakao Developers와 Google Cloud에는 Supabase가 표시하는 provider callback URL을 등록합니다.

## 배포

Vercel Git Integration을 통해 `main` 브랜치의 변경 사항이 프로덕션에 자동 배포됩니다.
