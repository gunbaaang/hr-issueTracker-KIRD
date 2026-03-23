// netlify/functions/api.mjs
// 단일 Function으로 모든 REST API 처리
//
// 라우팅 테이블
//  GET    /api/masters          → 마스터 데이터 전체 조회
//  PUT    /api/masters          → 마스터 데이터 전체 저장 (body: {key, value})
//
//  GET    /api/issues           → 이슈 전체 조회 (query: ?req_no=, ?status=, ?page_type=, ?q=)
//  POST   /api/issues           → 이슈 추가
//  PUT    /api/issues/:id       → 이슈 수정
//  DELETE /api/issues/:id       → 이슈 삭제
//
//  GET    /api/change-log       → 이력 조회 (query: ?type=, ?req_no=, ?assignee=)
//  DELETE /api/change-log       → 이력 전체 삭제

import { neon } from '@netlify/neon';

// CORS 헤더 — 로컬 netlify dev + 배포 환경 모두 허용
const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type': 'application/json',
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: CORS });
}

function err(msg, status = 500) {
  return new Response(JSON.stringify({ error: msg }), { status, headers: CORS });
}

// ── 이슈 row → JS 객체 변환 (snake_case → camelCase)
function rowToIssue(row) {
  return {
    id:          row.id,
    reqNo:       row.req_no,
    reqName:     row.req_name,
    pageType:    row.page_type,
    menu:        row.menu,
    screenId:    row.screen_id   || '',
    screenName:  row.screen_name || '',
    issue:       row.issue       || '',
    decision:    row.decision    || '',
    fixDir:      row.fix_dir     || '',
    assignee:    row.assignee,
    status:      row.status,
    reviewRound: row.review_round,
    reReview:    row.re_review,
    reIssue:     row.re_issue    || '',
    reStatus:    row.re_status   || '',
    createdAt:   row.created_at,
    updatedAt:   row.updated_at,
  };
}

// ── change_log row → JS 객체 변환
function rowToLog(row) {
  return {
    id:            row.id,
    issueId:       row.issue_id,
    type:          row.change_type,
    reqNo:         row.req_no    || '',
    assignee:      row.assignee  || '',
    label:         row.label     || '',
    before:        row.snapshot_before,
    after:         row.snapshot_after,
    changedFields: row.changed_fields || [],
    ts:            formatTs(row.changed_at),
  };
}

function formatTs(d) {
  if (!d) return '';
  const dt = new Date(d);
  const p = (n) => String(n).padStart(2,'0');
  return `${dt.getFullYear()}.${p(dt.getMonth()+1)}.${p(dt.getDate())} ${p(dt.getHours())}:${p(dt.getMinutes())}:${p(dt.getSeconds())}`;
}

export default async function handler(req) {
  // Preflight
  if (req.method === 'OPTIONS') return new Response('', { status: 204, headers: CORS });

  const url      = new URL(req.url);
  // path는 /api/issues, /api/issues/5, /api/masters, /api/change-log 형태
  const segments = url.pathname.replace(/^\/api\/?/, '').split('/').filter(Boolean);
  const resource = segments[0]; // issues | masters | change-log
  const idParam  = segments[1] ? parseInt(segments[1], 10) : null;

  let sql;
  try {
    sql = neon();
  } catch (e) {
    return err('DB 연결 실패: NETLIFY_DATABASE_URL 환경변수를 확인하세요.', 503);
  }

  try {
    // ════════════════════════════════════════════════
    //  /api/masters
    // ════════════════════════════════════════════════
    if (resource === 'masters') {
      if (req.method === 'GET') {
        const rows = await sql`SELECT key, value FROM masters ORDER BY key`;
        const result = {};
        rows.forEach(r => { result[r.key] = r.value; });
        return json(result);
      }

      if (req.method === 'PUT') {
        const { key, value } = await req.json();
        if (!key || value === undefined) return err('key와 value가 필요합니다.', 400);
        await sql`
          INSERT INTO masters (key, value, updated_at)
          VALUES (${key}, ${JSON.stringify(value)}, NOW())
          ON CONFLICT (key) DO UPDATE
            SET value = EXCLUDED.value, updated_at = NOW()
        `;
        return json({ ok: true });
      }
    }

    // ════════════════════════════════════════════════
    //  /api/issues
    // ════════════════════════════════════════════════
    if (resource === 'issues') {

      // GET /api/issues
      if (req.method === 'GET' && !idParam) {
        const reqNo    = url.searchParams.get('req_no')    || '';
        const status   = url.searchParams.get('status')    || '';
        const pageType = url.searchParams.get('page_type') || '';
        const q        = url.searchParams.get('q')         || '';

        // 동적 WHERE 절 조합
        let conditions = [];
        let params     = [];

        if (reqNo)    { params.push(reqNo);    conditions.push(`req_no = $${params.length}`); }
        if (status)   { params.push(status);   conditions.push(`status = $${params.length}`); }
        if (pageType) { params.push(pageType); conditions.push(`page_type = $${params.length}`); }
        if (q) {
          params.push(`%${q}%`);
          const n = params.length;
          conditions.push(`(screen_name ILIKE $${n} OR issue ILIKE $${n} OR decision ILIKE $${n} OR fix_dir ILIKE $${n} OR req_no ILIKE $${n} OR menu ILIKE $${n} OR assignee ILIKE $${n})`);
        }

        const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
        const rows  = await sql.query(
          `SELECT * FROM issues ${where} ORDER BY id ASC`,
          params
        );
        return json(rows.rows.map(rowToIssue));
      }

      // POST /api/issues
      if (req.method === 'POST') {
        const d = await req.json();
        const [row] = await sql`
          INSERT INTO issues
            (req_no, req_name, page_type, menu, screen_id, screen_name,
             issue, decision, fix_dir, assignee, status, review_round,
             re_review, re_issue, re_status)
          VALUES
            (${d.reqNo}, ${d.reqName}, ${d.pageType}, ${d.menu},
             ${d.screenId||''}, ${d.screenName||''},
             ${d.issue||''}, ${d.decision||''}, ${d.fixDir||''},
             ${d.assignee}, ${d.status||'미시작'}, ${d.reviewRound||'1차'},
             ${d.reReview||'N'}, ${d.reIssue||''}, ${d.reStatus||''})
          RETURNING *
        `;
        const issue = rowToIssue(row);

        // 이력 기록
        await sql`
          INSERT INTO change_log
            (issue_id, change_type, req_no, assignee, label, snapshot_after, changed_fields)
          VALUES
            (${issue.id}, 'create', ${issue.reqNo}, ${issue.assignee},
             ${issue.screenName||issue.screenId||`이슈 #${issue.id}`},
             ${JSON.stringify(issue)}, ${JSON.stringify([])})
        `;
        return json(issue, 201);
      }

      // PUT /api/issues/:id
      if (req.method === 'PUT' && idParam) {
        const d = await req.json();

        // 변경 전 스냅샷
        const [prev] = await sql`SELECT * FROM issues WHERE id = ${idParam}`;
        if (!prev) return err('이슈를 찾을 수 없습니다.', 404);
        const before = rowToIssue(prev);

        const [row] = await sql`
          UPDATE issues SET
            req_no       = ${d.reqNo},
            req_name     = ${d.reqName},
            page_type    = ${d.pageType},
            menu         = ${d.menu},
            screen_id    = ${d.screenId||''},
            screen_name  = ${d.screenName||''},
            issue        = ${d.issue||''},
            decision     = ${d.decision||''},
            fix_dir      = ${d.fixDir||''},
            assignee     = ${d.assignee},
            status       = ${d.status},
            review_round = ${d.reviewRound},
            re_review    = ${d.reReview},
            re_issue     = ${d.reIssue||''},
            re_status    = ${d.reStatus||''},
            updated_at   = NOW()
          WHERE id = ${idParam}
          RETURNING *
        `;
        const after = rowToIssue(row);

        // 변경된 필드 계산
        const TRACK = ['reqNo','reqName','pageType','menu','screenId','screenName',
                       'issue','decision','fixDir','assignee','status','reviewRound',
                       'reReview','reIssue','reStatus'];
        const changed = TRACK.filter(k => (before[k]||'') !== (after[k]||''));

        await sql`
          INSERT INTO change_log
            (issue_id, change_type, req_no, assignee, label,
             snapshot_before, snapshot_after, changed_fields)
          VALUES
            (${after.id}, 'update', ${after.reqNo}, ${after.assignee},
             ${after.screenName||after.screenId||`이슈 #${after.id}`},
             ${JSON.stringify(before)}, ${JSON.stringify(after)}, ${JSON.stringify(changed)})
        `;
        return json(after);
      }

      // DELETE /api/issues/:id
      if (req.method === 'DELETE' && idParam) {
        const [prev] = await sql`SELECT * FROM issues WHERE id = ${idParam}`;
        if (!prev) return err('이슈를 찾을 수 없습니다.', 404);
        const before = rowToIssue(prev);

        await sql`DELETE FROM issues WHERE id = ${idParam}`;

        await sql`
          INSERT INTO change_log
            (issue_id, change_type, req_no, assignee, label, snapshot_before)
          VALUES
            (${idParam}, 'delete', ${before.reqNo}, ${before.assignee},
             ${before.screenName||before.screenId||`이슈 #${idParam}`},
             ${JSON.stringify(before)})
        `;
        return json({ ok: true });
      }
    }

    // ════════════════════════════════════════════════
    //  /api/change-log
    // ════════════════════════════════════════════════
    if (resource === 'change-log') {
      if (req.method === 'GET') {
        const typeF  = url.searchParams.get('type')     || '';
        const reqF   = url.searchParams.get('req_no')   || '';
        const asgnF  = url.searchParams.get('assignee') || '';

        let conditions = [];
        let params     = [];
        if (typeF) { params.push(typeF);  conditions.push(`change_type = $${params.length}`); }
        if (reqF)  { params.push(reqF);   conditions.push(`req_no = $${params.length}`); }
        if (asgnF) { params.push(asgnF);  conditions.push(`assignee = $${params.length}`); }

        const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
        const rows  = await sql.query(
          `SELECT * FROM change_log ${where} ORDER BY changed_at DESC LIMIT 200`,
          params
        );
        return json(rows.rows.map(rowToLog));
      }

      if (req.method === 'DELETE') {
        await sql`TRUNCATE TABLE change_log RESTART IDENTITY`;
        return json({ ok: true });
      }
    }

    // ════════════════════════════════════════════════
    //  /api/change-log/:id/restore  (복원/되돌리기)
    // ════════════════════════════════════════════════
    if (resource === 'change-log' && idParam && segments[2] === 'restore') {
      if (req.method === 'POST') {
        const [logRow] = await sql`SELECT * FROM change_log WHERE id = ${idParam}`;
        if (!logRow) return err('이력을 찾을 수 없습니다.', 404);
        const log = rowToLog(logRow);

        if (log.type === 'delete' || log.type === 'update') {
          // before 스냅샷으로 복원
          const snap = log.before;
          const existing = await sql`SELECT id FROM issues WHERE id = ${snap.id}`;

          if (log.type === 'delete') {
            if (existing.length === 0) {
              const [row] = await sql`
                INSERT INTO issues
                  (req_no, req_name, page_type, menu, screen_id, screen_name,
                   issue, decision, fix_dir, assignee, status, review_round,
                   re_review, re_issue, re_status)
                VALUES
                  (${snap.reqNo}, ${snap.reqName}, ${snap.pageType}, ${snap.menu},
                   ${snap.screenId||''}, ${snap.screenName||''},
                   ${snap.issue||''}, ${snap.decision||''}, ${snap.fixDir||''},
                   ${snap.assignee}, ${snap.status||'미시작'}, ${snap.reviewRound||'1차'},
                   ${snap.reReview||'N'}, ${snap.reIssue||''}, ${snap.reStatus||''})
                RETURNING *
              `;
              const restored = rowToIssue(row);
              await sql`
                INSERT INTO change_log (issue_id, change_type, req_no, assignee, label, snapshot_after)
                VALUES (${restored.id}, 'create', ${restored.reqNo}, ${restored.assignee},
                        ${restored.screenName||`이슈 #${restored.id}`}, ${JSON.stringify(restored)})
              `;
              return json({ ok: true, issue: restored });
            }
          } else {
            // update → revert
            if (existing.length > 0) {
              const current_rows = await sql`SELECT * FROM issues WHERE id = ${snap.id}`;
              const current = rowToIssue(current_rows[0]);
              await sql`
                UPDATE issues SET
                  req_no = ${snap.reqNo}, req_name = ${snap.reqName}, page_type = ${snap.pageType},
                  menu = ${snap.menu}, screen_id = ${snap.screenId||''}, screen_name = ${snap.screenName||''},
                  issue = ${snap.issue||''}, decision = ${snap.decision||''}, fix_dir = ${snap.fixDir||''},
                  assignee = ${snap.assignee}, status = ${snap.status}, review_round = ${snap.reviewRound},
                  re_review = ${snap.reReview}, re_issue = ${snap.reIssue||''}, re_status = ${snap.reStatus||''},
                  updated_at = NOW()
                WHERE id = ${snap.id}
              `;
              const TRACK = ['reqNo','reqName','pageType','menu','screenId','screenName',
                             'issue','decision','fixDir','assignee','status','reviewRound',
                             'reReview','reIssue','reStatus'];
              const changed = TRACK.filter(k => (current[k]||'') !== (snap[k]||''));
              await sql`
                INSERT INTO change_log (issue_id, change_type, req_no, assignee, label,
                                        snapshot_before, snapshot_after, changed_fields)
                VALUES (${snap.id}, 'update', ${snap.reqNo}, ${snap.assignee},
                        ${snap.screenName||`이슈 #${snap.id}`},
                        ${JSON.stringify(current)}, ${JSON.stringify(snap)}, ${JSON.stringify(changed)})
              `;
              return json({ ok: true });
            }
          }
        }

        if (log.type === 'create') {
          // create 취소 = 삭제
          const issueId = log.issueId;
          const existing = await sql`SELECT * FROM issues WHERE id = ${issueId}`;
          if (existing.length > 0) {
            const before = rowToIssue(existing[0]);
            await sql`DELETE FROM issues WHERE id = ${issueId}`;
            await sql`
              INSERT INTO change_log (issue_id, change_type, req_no, assignee, label, snapshot_before)
              VALUES (${issueId}, 'delete', ${before.reqNo}, ${before.assignee},
                      ${before.screenName||`이슈 #${issueId}`}, ${JSON.stringify(before)})
            `;
            return json({ ok: true });
          }
        }
        return err('복원할 수 없는 이력입니다.', 400);
      }
    }

    return err('Not Found', 404);
  } catch (e) {
    console.error('API error:', e);
    return err(e.message || 'Internal Server Error', 500);
  }
}
