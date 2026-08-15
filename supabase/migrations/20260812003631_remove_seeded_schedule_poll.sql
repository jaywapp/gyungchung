delete from public.participation_forms
where kind = 'poll'::public.participation_kind
  and title = '다음 달 정기 풋살 시작 시간'
  and description = '가장 많은 회원이 참여할 수 있는 시간을 함께 결정합니다.';
