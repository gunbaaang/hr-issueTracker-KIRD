// netlify/functions/init-db.mjs
// DB 초기화 함수 — 최초 배포 후 한 번만 호출: GET /api/init
// 이미 테이블이 존재하면 무해하게 스킵 (CREATE TABLE IF NOT EXISTS)

import { neon } from '@netlify/neon';

export default async function handler(req) {
  // 간단한 보호: 브라우저에서 직접 URL 입력 방지 (쿼리 토큰)
  const url    = new URL(req.url);
  const secret = url.searchParams.get('secret');
  if (secret !== process.env.INIT_SECRET && process.env.INIT_SECRET) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const sql = neon();

  try {
    await sql`
      CREATE TABLE IF NOT EXISTS masters (
        key        TEXT PRIMARY KEY,
        value      JSONB NOT NULL,
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )
    `;

    await sql`
      CREATE TABLE IF NOT EXISTS issues (
        id           SERIAL PRIMARY KEY,
        req_no       TEXT        NOT NULL,
        req_name     TEXT        NOT NULL,
        page_type    TEXT        NOT NULL CHECK (page_type IN ('Admin','User')),
        menu         TEXT        NOT NULL,
        screen_id    TEXT,
        screen_name  TEXT,
        issue        TEXT,
        decision     TEXT,
        fix_dir      TEXT,
        assignee     TEXT        NOT NULL,
        status       TEXT        NOT NULL DEFAULT '미시작'
                       CHECK (status IN ('미시작','진행중','완료')),
        review_round TEXT        NOT NULL DEFAULT '1차',
        re_review    CHAR(1)     NOT NULL DEFAULT 'N' CHECK (re_review IN ('Y','N')),
        re_issue     TEXT,
        re_status    TEXT,
        created_at   TIMESTAMPTZ DEFAULT NOW(),
        updated_at   TIMESTAMPTZ DEFAULT NOW()
      )
    `;

    await sql`
      CREATE TABLE IF NOT EXISTS change_log (
        id             SERIAL PRIMARY KEY,
        issue_id       INTEGER REFERENCES issues(id) ON DELETE SET NULL,
        change_type    TEXT NOT NULL CHECK (change_type IN ('create','update','delete')),
        req_no         TEXT,
        assignee       TEXT,
        label          TEXT,
        snapshot_before JSONB,
        snapshot_after  JSONB,
        changed_fields  JSONB,
        changed_at     TIMESTAMPTZ DEFAULT NOW()
      )
    `;

    // 인덱스 (없으면 생성)
    await sql`CREATE INDEX IF NOT EXISTS idx_issues_req_no ON issues(req_no)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_issues_status  ON issues(status)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_change_log_issue_id ON change_log(issue_id)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_change_log_changed_at ON change_log(changed_at DESC)`;

    // 기본 마스터 데이터 (없을 때만 삽입)
    const existing = await sql`SELECT key FROM masters WHERE key = 'requirements'`;
    if (existing.length === 0) {
      const defaultRequirements = [
        {no:'001-01',name:'로그인 기능'},{no:'001-02',name:'로그인 기능'},
        {no:'002-01',name:'대시보드'},{no:'002-02',name:'대시보드'},
        {no:'003-01',name:'상품 관리'},{no:'003-04',name:'상품 관리'},
      ];
      const defaultMenus     = ['공통','회원관리','대시보드','상품관리','상품','주문관리','정산','설정'];
      const defaultAssignees = ['홍길동','김철수','이영희','박민수'];

      await sql`
        INSERT INTO masters (key, value) VALUES
          ('requirements', ${JSON.stringify(defaultRequirements)}),
          ('menus',        ${JSON.stringify(defaultMenus)}),
          ('assignees',    ${JSON.stringify(defaultAssignees)})
        ON CONFLICT (key) DO NOTHING
      `;
    }

    return new Response(JSON.stringify({ ok: true, message: 'DB 초기화 완료' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('init-db error:', err);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
