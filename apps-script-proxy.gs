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
 *   POST {"action":"save","data":{...}}  → 시트에 한 줄 추가
 *   POST {"action":"list"}               → 최근 제출 목록 (진행 데이터 제외)
 *   POST {"action":"load","id":"..."}    → 해당 제출의 진행 데이터
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
    if (body.action === 'save') return json_(saveProgress_(body.data));
    if (body.action === 'list') return json_(listProgress_());
    if (body.action === 'load') return json_(loadProgress_(body.id));
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
      : { temperature: 0.4, maxOutputTokens: 1400 };
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
var SAVE_HEADERS = ['제출 시각', '조 이름', '조장', '조원', '대상자', '진단', '진행 단계', '담은 운동 수', 'AI 검토 횟수', 'ID', '진행 데이터(수정 금지)'];
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
  return sh;
}

/**
 * [처음 한 번] 편집기에서 이 함수를 선택하고 ▶ 실행 → 권한 승인.
 * 저장용 스프레드시트를 만들고 주소를 실행 로그에 보여줍니다.
 */
function setupSaveSheet() {
  var sh = saveSheet_();
  Logger.log('저장용 시트: ' + sh.getParent().getUrl());
}

function saveProgress_(d) {
  if (!d || d.v !== 1) return { error: '진행 데이터가 올바르지 않습니다.' };
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
      b.nm || '', b.dx || '', STEP_NAMES[d.step] || d.step,
      (d.picked || []).length, d.reviews || 0, id, raw
    ]);
    return { ok: true, id: id };
  } finally {
    lock.releaseLock();
  }
}

function listProgress_() {
  var sh = saveSheet_();
  var n = sh.getLastRow() - 1;
  if (n < 1) return { ok: true, items: [] };
  var take = Math.min(n, 80);
  var rows = sh.getRange(sh.getLastRow() - take + 1, 1, take, 10).getValues();
  var tz = Session.getScriptTimeZone();
  var items = rows.reverse().map(function (r) {
    return {
      at: r[0] instanceof Date ? Utilities.formatDate(r[0], tz, 'M/d HH:mm') : String(r[0]),
      team: r[1], members: maskNames_(r[3]), case: r[4], step: r[6], id: r[9]
    };
  });
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

function loadProgress_(id) {
  if (!id) return { error: 'ID 가 없습니다.' };
  var sh = saveSheet_();
  var n = sh.getLastRow() - 1;
  if (n < 1) return { error: '저장된 기록이 없습니다.' };
  var ids = sh.getRange(2, 10, n, 1).getValues();
  for (var i = ids.length - 1; i >= 0; i--) {
    if (String(ids[i][0]) === String(id)) {
      var raw = sh.getRange(i + 2, 11).getValue();
      try { return { ok: true, data: JSON.parse(raw) }; }
      catch (x) { return { error: '시트의 진행 데이터가 손상되었습니다.' }; }
    }
  }
  return { error: '해당 기록을 찾을 수 없습니다.' };
}
