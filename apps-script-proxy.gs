/**
 * REHAB LAB — Gemini 프록시 (Google Apps Script)
 * ------------------------------------------------------------
 * 이 스크립트는 Gemini API 키를 서버에 숨긴 채,
 * 웹앱(index.html)이 보낸 프롬프트를 Gemini에 전달하고 결과만 돌려줍니다.
 *
 * [설치]
 * 1. https://script.google.com  →  새 프로젝트
 * 2. 이 파일 내용을 전부 붙여넣기 (Code.gs 를 덮어쓰기)
 * 3. 왼쪽 톱니바퀴(프로젝트 설정) → 아래 "스크립트 속성" →
 *      속성:  GEMINI_KEY
 *      값:    aistudio.google.com/apikey 에서 발급한 키 (AIza... 로 시작, 약 39자)
 *             ※ 앞뒤 공백/줄바꿈 없이, 키 "문자열만" 붙여넣기
 *    저장
 * 4. 오른쪽 위 "배포" → "새 배포" → 유형: 웹 앱
 *      실행 계정:      나
 *      액세스 권한:    모든 사용자
 *    "배포" 클릭 → 나오는 웹 앱 URL(끝이 /exec) 복사
 *    ※ 코드를 고친 뒤에는 "배포 관리" → 연필(수정) → 버전 "새 버전" → 배포
 * 5. 그 URL 을 index.html 의  const AI_PROXY = '...'  자리에 붙여넣기
 *
 * [상태 확인] 브라우저로 그 /exec URL 을 그냥 열면 아래처럼 보여야 정상:
 *   {"ok":true,"keyConfigured":true,"keyLength":39,"model":"gemini-flash-latest"}
 *   keyConfigured 가 false 거나 keyLength 가 39 근처가 아니면 3번 스크립트 속성을 다시 확인.
 */

// 사용할 모델. 무료 등급에서 도는 Flash 계열. 문제 시 'gemini-2.5-flash' 등으로 교체.
var MODEL = 'gemini-flash-latest';
var GEMINI_ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models/'
  + MODEL + ':generateContent';

function getKey_() {
  var k = PropertiesService.getScriptProperties().getProperty('GEMINI_KEY');
  return (k || '').trim();
}

function doGet() {
  var k = getKey_();
  return json_({
    ok: true,
    keyConfigured: k.length > 0,
    keyLength: k.length,
    model: MODEL,
    msg: 'POST { "prompt": "..." } 형식으로 호출하세요.'
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
      return json_({ error: 'GEMINI_KEY 값이 너무 깁니다(' + key.length + '자). API 키 문자열만(AIza..., 약 39자) 넣으세요.' });
    }

    var payload = {
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.4, maxOutputTokens: 1400 }
    };

    var res = UrlFetchApp.fetch(GEMINI_ENDPOINT, {
      method: 'post',
      contentType: 'application/json',
      headers: { 'x-goog-api-key': key },   // 키를 URL이 아닌 헤더로 전달
      payload: JSON.stringify(payload),
      muteHttpExceptions: true
    });

    var data = JSON.parse(res.getContentText() || '{}');

    if (data.error) {
      return json_({ error: (data.error.message || 'Gemini 오류'), code: data.error.code });
    }

    var text = '';
    try {
      text = data.candidates[0].content.parts
        .map(function (p) { return p.text || ''; }).join('');
    } catch (x) { text = ''; }

    if (!text) {
      var blocked = data.promptFeedback && data.promptFeedback.blockReason;
      return json_({ error: blocked ? ('차단됨: ' + blocked) : '빈 응답', raw: data });
    }

    return json_({ text: text });
  } catch (err) {
    return json_({ error: String(err) });
  }
}

function json_(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
