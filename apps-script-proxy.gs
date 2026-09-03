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
 */

// 시도할 모델 목록 (앞에서부터 순서대로, 503/429/404 면 다음 것으로 넘어감)
// ?models=1 로 이 키가 실제로 쓸 수 있는 목록을 확인할 수 있음.
var MODELS = [
  'gemini-3.6-flash',
  'gemini-flash-latest',
  'gemini-3.5-flash',
  'gemini-3.8-flash',
  'gemini-flash-lite-latest',
  'gemini-3.1-flash-lite'
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
    var prompt = body.prompt;
    if (!prompt) return json_({ error: 'prompt 가 비어 있습니다.' });

    var key = getKey_();
    if (!key) return json_({ error: '서버에 GEMINI_KEY 스크립트 속성이 없습니다.' });
    if (key.length > 200) {
      return json_({ error: 'GEMINI_KEY 값이 너무 깁니다(' + key.length + '자). 팝업의 "키 복사" 버튼으로 키 문자열만 넣으세요.' });
    }

    var list = body.model ? [body.model] : MODELS;
    var payload = JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.4, maxOutputTokens: 1400 }
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
          var text = '';
          try {
            text = data.candidates[0].content.parts
              .map(function (p) { return p.text || ''; }).join('');
          } catch (x) { text = ''; }
          if (text) return json_({ text: text, model: model });
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
