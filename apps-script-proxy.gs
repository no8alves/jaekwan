/**
 * REHAB LAB — Gemini 프록시 (Google Apps Script)
 * ------------------------------------------------------------
 * Gemini API 키를 서버에 숨긴 채, 웹앱(index.html)이 보낸 프롬프트를
 * Gemini에 전달하고 결과만 돌려줍니다.
 *
 * [설치]
 * 1. https://script.google.com  →  새 프로젝트
 * 2. 이 파일 내용을 전부 붙여넣기 (Code.gs 덮어쓰기) → 💾 저장
 * 3. 왼쪽 ⚙️ 프로젝트 설정 → 아래 "스크립트 속성" →
 *      속성:  GEMINI_KEY
 *      값:    aistudio.google.com/apikey 팝업에서 "키 복사" 로 얻은 문자열
 *             (AQ. 로 시작, 약 50자. "cURL 빠른 시작 복사" 아님!)
 *    저장
 * 4. "배포" → "새 배포" → 유형: 웹 앱 / 실행: 나 / 액세스: 모든 사용자 → 배포
 *      → 웹 앱 URL(/exec) 복사
 * 5. 코드를 고친 뒤에는:  "배포" → "배포 관리" → 연필(수정) → 버전 "새 버전" → 배포
 *      ※ 이 방식이면 URL 이 안 바뀝니다. "새 배포" 를 누르면 URL 이 새로 생깁니다.
 *
 * [상태 확인]
 *   /exec           → {"ok":true,"keyConfigured":true,"keyLength":50,...}
 *   /exec?models=1  → 이 키로 쓸 수 있는 모델 목록
 *
 * [진행 상황 시트 저장 / 불러오기]
 *   POST {"action":"save","data":{...},"code":"1234"}        → 시트에 한 줄 추가
 *   POST {"action":"list","team":"3조","code":"1234"}        → 그 조의 제출 목록 (조 이름·암호가 맞는 것만)
 *   POST {"action":"load","id":"...","code":"1234"}          → 해당 제출의 진행 데이터 (암호가 맞을 때만)
 *   조 암호(숫자 4자리)는 시트의 「암호」 열에 기록됩니다. 학생이 잊으면 시트에서 확인해 알려주세요.
 *
 * [교사용 실시간 현황판]  (teacher.html)
 *   학생 화면이 진행 상황을 자동으로 보내고(action:"live"), 교사용 화면이 모아서 봅니다(action:"board").
 *   현황은 시트가 아니라 임시 저장소(캐시)에만 두며 최대 6시간 뒤 사라집니다.
 *   ※ 스크립트 속성에 TEACHER_KEY (교사 암호) 를 직접 추가해야 현황판이 열립니다.
 *     ⚙️ 프로젝트 설정 → 스크립트 속성 → 속성: TEACHER_KEY / 값: 원하는 교사 암호
 *   저장용 스프레드시트는 처음 저장할 때 내 드라이브에 「REHAB LAB 진행 저장」으로 자동 생성되고,
 *   그 ID 는 스크립트 속성 SHEET_ID 에 기록됩니다. (다른 시트를 쓰려면 SHEET_ID 를 그 시트 ID 로 바꾸세요)
 *   ※ 처음 한 번 편집기에서 setupSaveSheet 를 ▶ 실행해 "스프레드시트 접근 권한"을 승인해야 합니다.
 *     (승인 전에 새 버전을 배포하면 AI 검토까지 멈추므로, 반드시 승인 → 배포 순서로)
 */

// 텍스트 모델 (앞에서부터 순서대로, 503/429/404 면 다음 것으로 넘어감)
// ?models=1 로 이 키가 실제로 쓸 수 있는 목록을 확인할 수 있음.
var MODELS = [
  'gemini-3.6-flash',
  'gemini-flash-latest',
  'gemini-3.5-flash',
  'gemini-3.8-flash',
  'gemini-flash-lite-latest',
  'gemini-3.1-flash-lite'
];

// 이미지 생성 모델 (POST 본문에 image:true 를 보내면 사용)
var IMAGE_MODELS = [
  'gemini-2.5-flash-image',
  'gemini-3.1-flash-image',
  'nano-banana-pro-preview',
  'gemini-3-pro-image'
];

var API_ROOT = 'https://generativelanguage.googleapis.com/v1beta/';

function getKey_() {
  var k = PropertiesService.getScriptProperties().getProperty('GEMINI_KEY');
  return (k || '').trim();
}

function doGet(e) {
  var key = getKey_();
  if (e && e.parameter && e.parameter.models === '1') {
    try {
      var r = UrlFetchApp.fetch(API_ROOT + 'models', {
        headers: { 'x-goog-api-key': key },
        muteHttpExceptions: true
      });
      var d = JSON.parse(r.getContentText() || '{}');
      if (d.error) return json_({ error: d.error.message, code: d.error.code });
      var names = (d.models || [])
        .filter(function (m) {
          return (m.supportedGenerationMethods || []).indexOf('generateContent') >= 0;
        })
        .map(function (m) { return m.name.replace('models/', ''); });
      return json_({ ok: true, count: names.length, models: names });
    } catch (err) {
      return json_({ error: String(err) });
    }
  }
  return json_({
    ok: true,
    keyConfigured: key.length > 0,
    keyLength: key.length,
    models: MODELS,
    msg: 'POST { "prompt": "..." } 로 호출. 모델 목록은 ?models=1'
  });
}

function doPost(e) {
  try {
    var body = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    if (body.action === 'live') return json_(livePut_(body.sid, body.data, body.sum));
    if (body.action === 'board') return json_(liveBoard_(body.key));
    if (body.action === 'boardRemove') return json_(liveRemove_(body.key, body.sid));
    if (body.action === 'boardClear') return json_(liveClear_(body.key));
    if (body.action === 'save') return json_(saveProgress_(body.data, body.code));
    if (body.action === 'list') return json_(listProgress_(body.team, body.code));
    if (body.action === 'load') return json_(loadProgress_(body.id, body.code));
    var prompt = body.prompt;
    if (!prompt) return json_({ error: 'prompt 가 비어 있습니다.' });

    var key = getKey_();
    if (!key) return json_({ error: '서버에 GEMINI_KEY 스크립트 속성이 없습니다.' });
    if (key.length > 200) {
      return json_({ error: 'GEMINI_KEY 값이 너무 깁니다(' + key.length + '자). 팝업의 "키 복사" 버튼으로 키 문자열만 넣으세요.' });
    }

    var wantImage = body.image === true;
    var list = body.model ? [body.model] : (wantImage ? IMAGE_MODELS : MODELS);
    var genCfg = wantImage
      ? { responseModalities: ['TEXT', 'IMAGE'] }
      : { temperature: 0.4, maxOutputTokens: 4096 };   // 검토 JSON 이 중간에 잘리지 않도록 넉넉하게 (생각 토큰 포함)
    var payload = JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: genCfg
    });

    var lastErr = '알 수 없는 오류';
    for (var i = 0; i < list.length; i++) {
      var model = list[i];
      for (var attempt = 0; attempt < 2; attempt++) {
        var res = UrlFetchApp.fetch(API_ROOT + 'models/' + model + ':generateContent', {
          method: 'post',
          contentType: 'application/json',
          headers: { 'x-goog-api-key': key },
          payload: payload,
          muteHttpExceptions: true
        });
        var status = res.getResponseCode();
        var data = JSON.parse(res.getContentText() || '{}');

        if (status === 200 && !data.error) {
          var parts = [];
          try { parts = data.candidates[0].content.parts || []; } catch (x) { parts = []; }

          if (wantImage) {
            for (var p = 0; p < parts.length; p++) {
              var d = parts[p].inlineData || parts[p].inline_data;
              if (d && d.data) {
                return json_({ image: 'data:' + (d.mimeType || d.mime_type || 'image/png') + ';base64,' + d.data, model: model });
              }
            }
          } else {
            var text = parts.map(function (q) { return q.text || ''; }).join('');
            if (text) return json_({ text: text, model: model });
          }
          var blocked = data.promptFeedback && data.promptFeedback.blockReason;
          lastErr = blocked ? ('차단됨: ' + blocked) : '빈 응답';
          break; // 다음 모델로
        }

        lastErr = (data.error && data.error.message) || ('HTTP ' + status);

        // 503/429 면 잠깐 쉬고 같은 모델 1회 재시도, 그 외(404 등)는 다음 모델로
        if (status === 503 || status === 429) {
          Utilities.sleep(1200);
          continue;
        }
        break;
      }
    }
    return json_({ error: lastErr });
  } catch (err) {
    return json_({ error: String(err) });
  }
}

function json_(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

/* ============================================================
   진행 상황 시트 저장 / 불러오기
   ============================================================ */
var SAVE_SHEET_NAME = '진행 저장';
var SAVE_HEADERS = ['제출 시각', '조 이름', '조장', '조원', '대상자', '진단', '진행 단계', '담은 운동 수', 'AI 검토 횟수', 'ID', '진행 데이터(수정 금지)', '암호'];
var COL_ID = 10, COL_DATA = 11, COL_CODE = 12;
var STEP_NAMES = ['', '1 대상자 뽑기', '2 대상자 확인', '3 사정 결과', '4 운동 후보', '5 체험 기록', '6 주차별 계획', '7 검토·3D', '8 처방카드'];

function saveSheet_() {
  var props = PropertiesService.getScriptProperties();
  var id = props.getProperty('SHEET_ID');
  var ss = null;
  if (id) { try { ss = SpreadsheetApp.openById(id); } catch (x) { ss = null; } }
  if (!ss) {
    ss = SpreadsheetApp.create('REHAB LAB 진행 저장');
    props.setProperty('SHEET_ID', ss.getId());
  }
  var sh = ss.getSheetByName(SAVE_SHEET_NAME);
  if (!sh) {
    sh = ss.getSheets()[0];
    if (sh.getLastRow() > 0) sh = ss.insertSheet(SAVE_SHEET_NAME);
    else sh.setName(SAVE_SHEET_NAME);
    sh.getRange(1, 1, 1, SAVE_HEADERS.length).setValues([SAVE_HEADERS]).setFontWeight('bold').setBackground('#E3F3EC');
    sh.setFrozenRows(1);
    sh.setColumnWidth(4, 220); sh.setColumnWidth(6, 260); sh.setColumnWidth(11, 120);
  }
  // 암호 열이 없던 예전 시트에는 머리글을 추가하고, 앞자리 0 이 지워지지 않게 텍스트 서식으로
  if (sh.getRange(1, COL_CODE).getValue() !== '암호') {
    sh.getRange(1, COL_CODE).setValue('암호').setFontWeight('bold').setBackground('#E3F3EC');
    sh.getRange(1, COL_CODE, sh.getMaxRows(), 1).setNumberFormat('@');
  }
  return sh;
}

function validCode_(c) { return /^\d{4}$/.test(String(c == null ? '' : c)); }
// 시트에서 숫자로 바뀐 암호(예: 0123 → 123)도 4자리로 맞춰 비교
function sameCode_(cell, code) {
  var v = String(cell == null ? '' : cell).trim();
  if (!v) return false;
  if (/^\d{1,4}$/.test(v)) v = ('0000' + v).slice(-4);
  return v === String(code);
}
function sameTeam_(a, b) {
  var n = function (x) { return String(x == null ? '' : x).replace(/\s+/g, '').toLowerCase(); };
  return n(a) !== '' && n(a) === n(b);
}

/**
 * [처음 한 번] 편집기에서 이 함수를 선택하고 ▶ 실행 → 권한 승인.
 * 저장용 스프레드시트를 만들고 주소를 실행 로그에 보여줍니다.
 */
function setupSaveSheet() {
  var sh = saveSheet_();
  Logger.log('저장용 시트: ' + sh.getParent().getUrl());
}

function saveProgress_(d, code) {
  if (!d || d.v !== 1) return { error: '진행 데이터가 올바르지 않습니다.' };
  if (!validCode_(code)) return { error: '조 암호(숫자 4자리)가 필요합니다. 화면을 새로고침한 뒤 다시 제출해 주세요.' };
  if (!String(d.team || '').trim()) return { error: '조 이름이 없습니다.' };
  var raw = JSON.stringify(d);
  if (raw.length > 45000) return { error: '진행 데이터가 너무 큽니다.' };
  var lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    var sh = saveSheet_();
    var members = (d.members || []).filter(function (m) { return m && m.name; });
    var lead = members.filter(function (m) { return m.lead; }).map(function (m) { return m.name; }).join(', ');
    var id = Utilities.getUuid().slice(0, 8);
    var b = d.built || {};
    sh.appendRow([
      new Date(), String(d.team || '').slice(0, 30), lead,
      members.map(function (m) { return m.name; }).join(', '),
      b.nm || '', b.dx || '', (d.phase === 2 ? '2차시(3~4주차) · ' : '1차시(1~2주차) · ') + (STEP_NAMES[d.step] || d.step),
      (d.picked || []).length, d.reviews || 0, id, raw, ''
    ]);
    sh.getRange(sh.getLastRow(), COL_CODE).setNumberFormat('@').setValue(String(code));
    return { ok: true, id: id };
  } finally {
    lock.releaseLock();
  }
}

function listProgress_(team, code) {
  if (!String(team || '').trim() || !validCode_(code)) return { error: '조 이름과 암호(숫자 4자리)를 입력해 주세요.' };
  var sh = saveSheet_();
  var n = sh.getLastRow() - 1;
  if (n < 1) return { ok: true, items: [] };
  var rows = sh.getRange(2, 1, n, COL_CODE).getValues();
  var tz = Session.getScriptTimeZone();
  var items = [];
  for (var i = rows.length - 1; i >= 0 && items.length < 20; i--) {
    var r = rows[i];
    if (!sameTeam_(r[1], team) || !sameCode_(r[COL_CODE - 1], code)) continue;
    items.push({
      at: r[0] instanceof Date ? Utilities.formatDate(r[0], tz, 'M/d HH:mm') : String(r[0]),
      team: r[1], members: maskNames_(r[3]), case: r[4], step: r[6], id: r[COL_ID - 1]
    });
  }
  return { ok: true, items: items };
}

// 목록은 공개 주소로 조회되므로 이름을 가려서 보냄 (예: 김철수 → 김O수)
function maskNames_(s) {
  return String(s || '').split(/\s*,\s*/).filter(String).map(function (n) {
    n = n.trim();
    if (n.length <= 1) return n;
    if (n.length === 2) return n.charAt(0) + 'O';
    return n.charAt(0) + new Array(n.length - 1).join('O') + n.charAt(n.length - 1);
  }).join(', ');
}

function loadProgress_(id, code) {
  if (!id) return { error: 'ID 가 없습니다.' };
  if (!validCode_(code)) return { error: '조 암호(숫자 4자리)가 필요합니다.' };
  var sh = saveSheet_();
  var n = sh.getLastRow() - 1;
  if (n < 1) return { error: '저장된 기록이 없습니다.' };
  var rows = sh.getRange(2, COL_ID, n, COL_CODE - COL_ID + 1).getValues();   // ID, 진행 데이터, 암호
  for (var i = rows.length - 1; i >= 0; i--) {
    if (String(rows[i][0]) === String(id)) {
      if (!sameCode_(rows[i][2], code)) return { error: '암호가 맞지 않습니다.' };
      try { return { ok: true, data: JSON.parse(rows[i][1]) }; }
      catch (x) { return { error: '시트의 진행 데이터가 손상되었습니다.' }; }
    }
  }
  return { error: '해당 기록을 찾을 수 없습니다.' };
}

/* ============================================================
   교사용 실시간 현황판 — 캐시에만 보관 (최대 6시간)
   ============================================================ */
var LIVE_TTL = 21600;            // 초 (캐시 최대 보관 시간)
var LIVE_INDEX = 'live:index';
var LIVE_MAX_AGE = 3 * 3600000;  // 3시간 넘게 소식 없는 조는 현황판에서 제외

function liveIndex_(cache) {
  try { return JSON.parse(cache.get(LIVE_INDEX) || '[]'); } catch (x) { return []; }
}

function livePut_(sid, data, sum) {
  sid = String(sid || '');
  if (!/^[a-z0-9]{8,24}$/.test(sid)) return { error: 'sid' };
  if (!data || data.v !== 1) return { error: 'data' };
  var raw = JSON.stringify({ sid: sid, at: Date.now(), data: data, sum: sum || {} });
  if (raw.length > 90000) return { error: 'too large' };
  var cache = CacheService.getScriptCache();
  cache.put('live:' + sid, raw, LIVE_TTL);
  var idx = liveIndex_(cache);
  if (idx.indexOf(sid) < 0) {
    var lock = LockService.getScriptLock();
    lock.waitLock(10000);
    try {
      idx = liveIndex_(cache);
      if (idx.indexOf(sid) < 0) { idx.push(sid); if (idx.length > 60) idx = idx.slice(-60); }
      cache.put(LIVE_INDEX, JSON.stringify(idx), LIVE_TTL);
    } finally { lock.releaseLock(); }
  }
  return { ok: true };
}

function teacherOk_(key) {
  var k = (PropertiesService.getScriptProperties().getProperty('TEACHER_KEY') || '').trim();
  if (!k) return { error: '교사 암호가 아직 설정되지 않았습니다. 스크립트 속성에 TEACHER_KEY 를 추가해 주세요.', code: 'nokey' };
  if (String(key || '') !== k) return { error: '교사 암호가 맞지 않습니다.', code: 'badkey' };
  return null;
}

function liveBoard_(key) {
  var bad = teacherOk_(key); if (bad) return bad;
  var cache = CacheService.getScriptCache();
  var idx = liveIndex_(cache);
  if (!idx.length) return { ok: true, now: Date.now(), items: [] };
  var got = cache.getAll(idx.map(function (s) { return 'live:' + s; }));
  var now = Date.now(), items = [], keep = [];
  idx.forEach(function (s) {
    var raw = got['live:' + s]; if (!raw) return;
    var o; try { o = JSON.parse(raw); } catch (x) { return; }
    if (now - o.at > LIVE_MAX_AGE) return;
    keep.push(s); items.push(o);
  });
  cache.put(LIVE_INDEX, JSON.stringify(keep), LIVE_TTL);   // 사라진 조 정리 + 보관 시간 연장
  return { ok: true, now: now, items: items };
}

function liveRemove_(key, sid) {
  var bad = teacherOk_(key); if (bad) return bad;
  var cache = CacheService.getScriptCache();
  cache.remove('live:' + String(sid || ''));
  var idx = liveIndex_(cache).filter(function (s) { return s !== sid; });
  cache.put(LIVE_INDEX, JSON.stringify(idx), LIVE_TTL);
  return { ok: true };
}

function liveClear_(key) {
  var bad = teacherOk_(key); if (bad) return bad;
  var cache = CacheService.getScriptCache();
  var idx = liveIndex_(cache);
  if (idx.length) cache.removeAll(idx.map(function (s) { return 'live:' + s; }));
  cache.put(LIVE_INDEX, '[]', LIVE_TTL);
  return { ok: true };
}
