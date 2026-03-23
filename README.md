# 화면설계서 리뷰 이슈 트래커 v0.2

Netlify Functions + Neon Postgres 연동 버전

## 프로젝트 구조

```
review-tracker/
├── index.html                        # 프론트엔드 (싱글 페이지)
├── netlify.toml                      # Netlify 빌드/라우팅 설정
├── package.json
└── netlify/
    └── functions/
        ├── api.mjs                   # REST API (이슈/이력/마스터 CRUD)
        └── init-db.mjs               # DB 테이블 초기화 (최초 1회)
```

## REST API 엔드포인트

| Method | Path | 설명 |
|--------|------|------|
| GET | /api/masters | 마스터 데이터 조회 |
| PUT | /api/masters | 마스터 데이터 저장 |
| GET | /api/issues | 이슈 목록 조회 (필터: req_no, status, page_type, q) |
| POST | /api/issues | 이슈 추가 |
| PUT | /api/issues/:id | 이슈 수정 |
| DELETE | /api/issues/:id | 이슈 삭제 |
| GET | /api/change-log | 수정 이력 조회 |
| DELETE | /api/change-log | 수정 이력 전체 삭제 |
| POST | /api/change-log/:id/restore | 이력 기반 복원/되돌리기 |

## 배포 순서

### 1. 의존성 설치

```bash
npm install
```

### 2. Netlify CLI 설치 및 로그인

```bash
npm install -g netlify-cli
netlify login
```

### 3. Netlify DB (Neon) 연결

이미 Netlify UI에서 Neon을 연결한 경우 `NETLIFY_DATABASE_URL` 환경변수가
자동으로 설정되어 있습니다.

직접 설정하는 경우:
```bash
netlify env:set NETLIFY_DATABASE_URL "postgres://user:pass@host/db?sslmode=require"
```

선택적으로 init 엔드포인트 보호용 시크릿:
```bash
netlify env:set INIT_SECRET "your-secret-string"
```

### 4. DB 테이블 초기화 (최초 1회)

배포 후 아래 URL을 브라우저에서 호출:
```
https://your-site.netlify.app/api/init
# INIT_SECRET 설정한 경우:
https://your-site.netlify.app/api/init?secret=your-secret-string
```

성공 응답:
```json
{"ok": true, "message": "DB 초기화 완료"}
```

### 5. 배포

```bash
netlify deploy --prod
```

## 로컬 개발

```bash
# .env 파일 생성
echo 'NETLIFY_DATABASE_URL=postgres://...' > .env

# 로컬 서버 실행 (http://localhost:8888)
netlify dev
```

## DB 스키마 요약

```sql
-- 마스터 데이터 (요구사항/메뉴/담당자)
masters (key TEXT PK, value JSONB, updated_at)

-- 이슈
issues (id SERIAL PK, req_no, req_name, page_type, menu,
        screen_id, screen_name, issue, decision, fix_dir,
        assignee, status, review_round, re_review, re_issue, re_status,
        created_at, updated_at)

-- 수정 이력
change_log (id SERIAL PK, issue_id FK, change_type,
            req_no, assignee, label,
            snapshot_before JSONB, snapshot_after JSONB,
            changed_fields JSONB, changed_at)
```
