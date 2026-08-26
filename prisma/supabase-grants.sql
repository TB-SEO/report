-- Prisma가 postgres 소유로 만든 테이블은 PostgREST(anon / authenticated / service_role)에
-- GRANT가 없습니다. 그 상태면 REST는 "permission denied for table blogs" 가 납니다.
-- 대시보드 API 키(JWT role)가 테이블을 읽으려면 아래가 필요합니다.

GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;

GRANT ALL ON ALL TABLES IN SCHEMA public TO anon, authenticated, service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO anon, authenticated, service_role;
GRANT ALL ON ALL ROUTINES IN SCHEMA public TO anon, authenticated, service_role;

ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT ALL ON TABLES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT ALL ON SEQUENCES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT ALL ON ROUTINES TO anon, authenticated, service_role;

NOTIFY pgrst, 'reload schema';
