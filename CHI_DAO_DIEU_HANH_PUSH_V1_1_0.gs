/**
 * =========================================================
 * CHỈ ĐẠO ĐIỀU HÀNH - PUSH GATEWAY V1.1.0
 * =========================================================
 * Backend RIÊNG cho phân hệ Chỉ đạo điều hành.
 * KHÔNG đọc/ghi tasks, taskLogs, taskPushSubscriptions, KPI hoặc Hội đồng.
 *
 * Dùng chung OneSignal App, nhưng subscription riêng:
 * executivePushSubscriptions
 *
 * V1.1.0:
 * - Chọn người nhận theo đúng cấp giao Phòng/Khu → Tổ/Nhóm → cá nhân.
 * - Ghi executiveNotificationLogs với SENT / NO_SUBSCRIPTIONS / FAILED.
 * - Có hàm kiểm tra cấu hình và gửi thử theo email.
 *
 * Script Properties bắt buộc:
 * FIREBASE_SERVICE_ACCOUNT_EMAIL
 * FIREBASE_PRIVATE_KEY
 * FIREBASE_PROJECT_ID
 * FIREBASE_API_KEY
 * ONESIGNAL_APP_ID
 * ONESIGNAL_API_KEY
 * APP_URL
 */

const EXEC_PUSH_VERSION_ = '1.1.0';
const EXEC_ACTIONS_ = Object.freeze([
  'DIRECTIVE_ASSIGNED', 'DIRECTIVE_UPDATED', 'DIRECTIVE_ACCEPTED',
  'DIRECTIVE_PROGRESS_UPDATED', 'DIRECTIVE_COMPLETED',
  'DIRECTIVE_CLOSED', 'DIRECTIVE_REOPENED', 'DIRECTIVE_DELETED'
]);
const EXEC_MANAGER_ACTIONS_ = Object.freeze([
  'DIRECTIVE_ASSIGNED', 'DIRECTIVE_UPDATED', 'DIRECTIVE_CLOSED',
  'DIRECTIVE_REOPENED', 'DIRECTIVE_DELETED'
]);

function doGet() {
  return execJson_({ ok: true, service: 'CHI_DAO_DIEU_HANH_PUSH', version: EXEC_PUSH_VERSION_ });
}

function doPost(e) {
  const lock = LockService.getScriptLock();
  let config = null;
  let eventId = '';
  let action = '';
  let directiveId = '';
  let actorUid = '';
  let recipientUids = [];
  try {
    lock.tryLock(10000);
    const request = execParseJson_(e && e.postData ? e.postData.contents : '');
    config = execConfig_();
    if (String(request.module || '').trim() !== 'EXECUTIVE_DIRECTIVES') throw new Error('Sai phân hệ thông báo.');

    action = String(request.action || '').trim().toUpperCase();
    directiveId = String(request.directiveId || '').trim();
    eventId = execSafeEventId_(request.eventId || (action + '_' + directiveId));
    const idToken = String(request.idToken || '').trim();
    if (EXEC_ACTIONS_.indexOf(action) < 0) throw new Error('Action Chỉ đạo điều hành không hợp lệ.');
    if (!directiveId || !idToken) throw new Error('Thiếu directiveId hoặc Firebase ID Token.');

    const cache = CacheService.getScriptCache();
    if (cache.get('EXEC_PUSH_' + eventId)) {
      return execJson_({ ok: true, duplicate: true, eventId: eventId });
    }

    const firebaseIdentity = execVerifyFirebaseIdToken_(idToken, config);
    actorUid = String(firebaseIdentity.localId || '').trim();
    if (!actorUid) throw new Error('Không xác định được UID Firebase.');
    const actor = execGetFirestoreDocument_('users', actorUid, config);
    if (!actor || actor.active !== true) throw new Error('Tài khoản không hoạt động.');
    const directive = execGetFirestoreDocument_('executiveDirectives', directiveId, config);
    if (!directive) throw new Error('Không tìm thấy nội dung chỉ đạo.');

    execValidateActor_(action, actor, actorUid, directive, request, config);
    const users = execListFirestoreDocuments_('users', config)
      .map(function(item) { return Object.assign({ id: item.id }, item.data || {}); })
      .filter(function(user) { return user.active === true; });
    recipientUids = execRecipientUids_(action, directive, actor, actorUid, request, users);

    execWriteNotificationLog_(eventId, {
      module: 'EXECUTIVE_DIRECTIVES', action: action, directiveId: directiveId,
      actorUid: actorUid, actorName: String(actor.fullName || actor.email || ''),
      recipientUids: recipientUids, status: 'PENDING', createdAt: new Date().toISOString(),
      version: EXEC_PUSH_VERSION_
    }, config);

    const subscriptions = execListFirestoreDocuments_('executivePushSubscriptions', config)
      .map(function(item) { return Object.assign({ id: item.id }, item.data || {}); })
      .filter(function(item) {
        return item.active === true && item.module === 'EXECUTIVE_DIRECTIVES' &&
          recipientUids.indexOf(String(item.userId || item.uid || '').trim()) >= 0 &&
          String(item.subscriptionId || '').trim();
      });
    const subscriptionIds = execUnique_(subscriptions.map(function(item) { return String(item.subscriptionId || '').trim(); }));

    if (!subscriptionIds.length) {
      execWriteNotificationLog_(eventId, {
        status: 'NO_SUBSCRIPTIONS', recipientUids: recipientUids,
        recipientUsers: recipientUids.length, subscriptionCount: 0,
        updatedAt: new Date().toISOString()
      }, config);
      cache.put('EXEC_PUSH_' + eventId, 'NO_SUBSCRIPTIONS', 21600);
      return execJson_({ ok: true, delivered: false, reason: 'NO_ACTIVE_SUBSCRIPTIONS', recipientUsers: recipientUids.length, eventId: eventId });
    }

    const message = execBuildMessage_(action, directive, actor, request, config);
    const result = execSendOneSignal_({
      subscriptionIds: subscriptionIds, heading: message.heading, content: message.content,
      url: message.url, name: 'EXEC_' + action + '_' + directiveId,
      data: { module: 'EXECUTIVE_DIRECTIVES', action: action, directiveId: directiveId }
    }, config);

    execWriteNotificationLog_(eventId, {
      status: 'SENT', recipientUids: recipientUids, recipientUsers: recipientUids.length,
      subscriptionCount: subscriptionIds.length, oneSignalId: String(result.id || ''),
      sentAt: new Date().toISOString(), updatedAt: new Date().toISOString()
    }, config);
    cache.put('EXEC_PUSH_' + eventId, 'SENT', 21600);
    return execJson_({ ok: true, delivered: true, eventId: eventId, recipientUsers: recipientUids.length, subscriptions: subscriptionIds.length, oneSignal: result });
  } catch (error) {
    console.error(error && error.stack ? error.stack : error);
    try {
      if (config && eventId) execWriteNotificationLog_(eventId, {
        module: 'EXECUTIVE_DIRECTIVES', action: action, directiveId: directiveId,
        actorUid: actorUid, recipientUids: recipientUids, status: 'FAILED',
        errorMessage: String(error && error.message ? error.message : error),
        updatedAt: new Date().toISOString(), version: EXEC_PUSH_VERSION_
      }, config);
    } catch (logError) { console.error('Không ghi được notification log:', logError); }
    return execJson_({ ok: false, error: String(error && error.message ? error.message : error), eventId: eventId });
  } finally {
    try { lock.releaseLock(); } catch (_) {}
  }
}

function execValidateActor_(action, actor, uid, directive, request, config) {
  if (EXEC_MANAGER_ACTIONS_.indexOf(action) >= 0 && !execIsDirectiveManager_(actor)) {
    throw new Error('Tài khoản không có quyền phát sự kiện quản trị chỉ đạo.');
  }
  if (EXEC_MANAGER_ACTIONS_.indexOf(action) >= 0) return true;
  const eventData = request.eventData && typeof request.eventData === 'object' ? request.eventData : {};
  const updateId = String(eventData.updateId || '').trim();
  if (!updateId) throw new Error('Thiếu updateId của lần cập nhật.');
  const update = execGetFirestoreDocument_('executiveDirectiveUpdates', updateId, config);
  if (!update || String(update.directiveId || '') !== String(request.directiveId || '')) throw new Error('Không tìm thấy lịch sử cập nhật tương ứng.');
  if (!execIsDirectiveManager_(actor) && String(update.createdByUserId || '') !== uid) throw new Error('Sự kiện cập nhật không thuộc tài khoản đang gửi.');
  const updateType = String(update.updateType || '').toUpperCase();
  const status = String(update.status || '').toUpperCase();
  if (action === 'DIRECTIVE_ACCEPTED' && updateType !== 'ACCEPTED') throw new Error('Lịch sử không phải sự kiện tiếp nhận.');
  if (action === 'DIRECTIVE_COMPLETED' && !(updateType === 'PROGRESS' && status === 'COMPLETED')) throw new Error('Lịch sử không phải sự kiện hoàn thành.');
  if (action === 'DIRECTIVE_PROGRESS_UPDATED' && updateType !== 'PROGRESS') throw new Error('Lịch sử không phải sự kiện cập nhật tiến độ.');
  return true;
}

function execRecipientUids_(action, directive, actor, actorUid, request, users) {
  const eventData = request.eventData && typeof request.eventData === 'object' ? request.eventData : {};
  const recipients = [];
  const addUid = function(uid) { uid = String(uid || '').trim(); if (uid && uid !== actorUid) recipients.push(uid); };
  const addManagers = function() {
    users.forEach(function(user) {
      const role = String(user.role || '').trim().toUpperCase();
      const dep = execNormalizeDepartment_(user.departmentId);
      if (role === 'DIRECTOR' || role === 'ADMIN' || role === 'TCHC_COORDINATOR' || (role === 'DEPARTMENT_LEADER' && dep === 'TCHC')) addUid(user.id || user.uid);
    });
  };
  const addDepartmentLeaders = function(departmentId) {
    const dep = execNormalizeDepartment_(departmentId);
    users.forEach(function(user) {
      if (execNormalizeDepartment_(user.departmentId) !== dep) return;
      const role = String(user.role || '').trim().toUpperCase();
      if (role === 'DEPARTMENT_LEADER' || (dep === 'TCHC' && role === 'TCHC_COORDINATOR')) addUid(user.id || user.uid);
    });
  };

  addManagers();
  const departments = [];
  if (directive.leadDepartmentId) departments.push(directive.leadDepartmentId);
  if (Array.isArray(directive.supportDepartmentIds)) departments.push.apply(departments, directive.supportDepartmentIds);
  if (Array.isArray(eventData.previousVisibleDepartmentIds)) departments.push.apply(departments, eventData.previousVisibleDepartmentIds);
  execUnique_(departments.map(execNormalizeDepartment_)).forEach(addDepartmentLeaders);

  if (String(directive.assignmentLevel || '').toUpperCase() === 'PERSON') addUid(directive.leadUserId);
  addUid(eventData.previousLeadUserId);

  return execUnique_(recipients);
}

function execBuildMessage_(action, directive, actor, request, config) {
  const content = execTruncate_(directive.content || 'Nội dung chỉ đạo', 150);
  const actorDepartment = execDepartmentName_(actor.departmentId);
  const leadDepartment = execDepartmentName_(directive.leadDepartmentId);
  const due = directive.dueDateKey ? (' · Hạn: ' + execDateVi_(directive.dueDateKey)) : '';
  const person = String(directive.leadUserName || '').trim();
  const team = String(directive.leadTeamName || directive.leadTeamId || '').trim();
  const assignment = person ? (leadDepartment + ' → ' + (team ? team + ' → ' : '') + person) : leadDepartment;
  let heading = 'Chỉ đạo điều hành';
  let body = content;
  if (action === 'DIRECTIVE_ASSIGNED') { heading = 'Có nội dung chỉ đạo mới'; body = (directive.directedByName || 'Ban Giám đốc') + ' giao ' + assignment + ': ' + content + due; }
  else if (action === 'DIRECTIVE_UPDATED') { heading = 'Nội dung chỉ đạo đã được cập nhật'; body = assignment + ': ' + content + due; }
  else if (action === 'DIRECTIVE_ACCEPTED') { heading = actorDepartment + ' đã tiếp nhận chỉ đạo'; body = content; }
  else if (action === 'DIRECTIVE_PROGRESS_UPDATED') { heading = actorDepartment + ' cập nhật thực hiện'; body = content; }
  else if (action === 'DIRECTIVE_COMPLETED') { heading = actorDepartment + ' đã hoàn thành chỉ đạo'; body = content; }
  else if (action === 'DIRECTIVE_CLOSED') { heading = 'Chỉ đạo đã được đóng'; body = content; }
  else if (action === 'DIRECTIVE_REOPENED') { heading = 'Chỉ đạo đã được mở lại'; body = content; }
  else if (action === 'DIRECTIVE_DELETED') { heading = 'Nội dung chỉ đạo đã được hủy'; body = content; }
  return { heading: heading, content: body, url: String(config.APP_URL || '').replace(/#.*$/, '').replace(/\/$/, '') + '/#/directives' };
}

function execIsDirectiveManager_(user) {
  const role = String(user.role || '').trim().toUpperCase();
  const departmentId = execNormalizeDepartment_(user.departmentId);
  return role === 'ADMIN' || role === 'DIRECTOR' || role === 'TCHC_COORDINATOR' || (role === 'DEPARTMENT_LEADER' && departmentId === 'TCHC');
}

function execConfig_() {
  const props = PropertiesService.getScriptProperties();
  const config = {
    FIREBASE_SERVICE_ACCOUNT_EMAIL: String(props.getProperty('FIREBASE_SERVICE_ACCOUNT_EMAIL') || '').trim(),
    FIREBASE_PRIVATE_KEY: String(props.getProperty('FIREBASE_PRIVATE_KEY') || '').replace(/\\n/g, '\n').trim(),
    FIREBASE_PROJECT_ID: String(props.getProperty('FIREBASE_PROJECT_ID') || '').trim(),
    FIREBASE_API_KEY: String(props.getProperty('FIREBASE_API_KEY') || '').trim(),
    ONESIGNAL_APP_ID: String(props.getProperty('ONESIGNAL_APP_ID') || '').trim(),
    ONESIGNAL_API_KEY: String(props.getProperty('ONESIGNAL_API_KEY') || '').trim(),
    APP_URL: String(props.getProperty('APP_URL') || '').trim()
  };
  Object.keys(config).forEach(function(key) { if (!config[key]) throw new Error('Thiếu Script Property: ' + key); });
  return config;
}

function execVerifyFirebaseIdToken_(idToken, config) {
  const response = UrlFetchApp.fetch('https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=' + encodeURIComponent(config.FIREBASE_API_KEY), {
    method: 'post', contentType: 'application/json', payload: JSON.stringify({ idToken: idToken }), muteHttpExceptions: true
  });
  const data = execParseJson_(response.getContentText());
  if (response.getResponseCode() < 200 || response.getResponseCode() >= 300 || !data.users || !data.users.length) throw new Error('Firebase ID Token không hợp lệ hoặc đã hết hạn.');
  return data.users[0];
}

function execServiceToken_(config) {
  const cache = CacheService.getScriptCache();
  const cacheKey = 'EXEC_FIRESTORE_SERVICE_TOKEN_V110';
  const cached = cache.get(cacheKey);
  if (cached) return cached;
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'RS256', typ: 'JWT' };
  const claims = { iss: config.FIREBASE_SERVICE_ACCOUNT_EMAIL, scope: 'https://www.googleapis.com/auth/datastore', aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600 };
  const unsigned = execB64Url_(JSON.stringify(header)) + '.' + execB64Url_(JSON.stringify(claims));
  const signature = Utilities.computeRsaSha256Signature(unsigned, config.FIREBASE_PRIVATE_KEY);
  const assertion = unsigned + '.' + execB64Url_(signature);
  const response = UrlFetchApp.fetch('https://oauth2.googleapis.com/token', {
    method: 'post', contentType: 'application/x-www-form-urlencoded',
    payload: { grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: assertion }, muteHttpExceptions: true
  });
  const data = execParseJson_(response.getContentText());
  if (response.getResponseCode() < 200 || response.getResponseCode() >= 300 || !data.access_token) throw new Error('Không xác thực được tài khoản dịch vụ Firestore.');
  cache.put(cacheKey, data.access_token, 3300);
  return data.access_token;
}

function execFirestoreBase_(config) {
  return 'https://firestore.googleapis.com/v1/projects/' + encodeURIComponent(config.FIREBASE_PROJECT_ID) + '/databases/(default)/documents';
}
function execGetFirestoreDocument_(collectionName, documentId, config) {
  const response = UrlFetchApp.fetch(execFirestoreBase_(config) + '/' + encodeURIComponent(collectionName) + '/' + encodeURIComponent(documentId), {
    method: 'get', headers: { Authorization: 'Bearer ' + execServiceToken_(config) }, muteHttpExceptions: true
  });
  if (response.getResponseCode() === 404) return null;
  if (response.getResponseCode() < 200 || response.getResponseCode() >= 300) throw new Error('Không đọc được Firestore ' + collectionName + '/' + documentId + '. HTTP ' + response.getResponseCode());
  return execFieldsToObject_(execParseJson_(response.getContentText()).fields || {});
}
function execListFirestoreDocuments_(collectionName, config) {
  const results = []; let pageToken = '';
  do {
    let url = execFirestoreBase_(config) + '/' + encodeURIComponent(collectionName) + '?pageSize=1000';
    if (pageToken) url += '&pageToken=' + encodeURIComponent(pageToken);
    const response = UrlFetchApp.fetch(url, { method: 'get', headers: { Authorization: 'Bearer ' + execServiceToken_(config) }, muteHttpExceptions: true });
    if (response.getResponseCode() === 404) return [];
    if (response.getResponseCode() < 200 || response.getResponseCode() >= 300) throw new Error('Không đọc được collection ' + collectionName + '. HTTP ' + response.getResponseCode());
    const data = execParseJson_(response.getContentText());
    (data.documents || []).forEach(function(doc) { results.push({ id: String(doc.name || '').split('/').pop(), data: execFieldsToObject_(doc.fields || {}) }); });
    pageToken = data.nextPageToken || '';
  } while (pageToken);
  return results;
}
function execWriteNotificationLog_(eventId, data, config) {
  const url = execFirestoreBase_(config) + '/executiveNotificationLogs/' + encodeURIComponent(eventId);
  const current = execGetFirestoreDocument_('executiveNotificationLogs', eventId, config) || {};
  const merged = Object.assign({}, current, data || {});
  const fields = {};
  Object.keys(merged).forEach(function(key) { if (merged[key] !== undefined) fields[key] = execJsToValue_(merged[key]); });
  const response = UrlFetchApp.fetch(url, {
    method: 'patch', contentType: 'application/json', headers: { Authorization: 'Bearer ' + execServiceToken_(config) },
    payload: JSON.stringify({ fields: fields }), muteHttpExceptions: true
  });
  if (response.getResponseCode() < 200 || response.getResponseCode() >= 300) throw new Error('Không ghi được executiveNotificationLogs. HTTP ' + response.getResponseCode());
}
function execFieldsToObject_(fields) { const output = {}; Object.keys(fields || {}).forEach(function(key) { output[key] = execValueToJs_(fields[key]); }); return output; }
function execValueToJs_(value) {
  if (!value || typeof value !== 'object') return null;
  if (Object.prototype.hasOwnProperty.call(value, 'stringValue')) return value.stringValue;
  if (Object.prototype.hasOwnProperty.call(value, 'booleanValue')) return value.booleanValue;
  if (Object.prototype.hasOwnProperty.call(value, 'integerValue')) return Number(value.integerValue);
  if (Object.prototype.hasOwnProperty.call(value, 'doubleValue')) return Number(value.doubleValue);
  if (Object.prototype.hasOwnProperty.call(value, 'timestampValue')) return value.timestampValue;
  if (Object.prototype.hasOwnProperty.call(value, 'nullValue')) return null;
  if (value.arrayValue) return (value.arrayValue.values || []).map(execValueToJs_);
  if (value.mapValue) return execFieldsToObject_(value.mapValue.fields || {});
  return null;
}
function execJsToValue_(value) {
  if (value === null) return { nullValue: null };
  if (Array.isArray(value)) return { arrayValue: { values: value.map(execJsToValue_) } };
  if (typeof value === 'boolean') return { booleanValue: value };
  if (typeof value === 'number') return Number.isInteger(value) ? { integerValue: String(value) } : { doubleValue: value };
  if (typeof value === 'object') {
    const fields = {}; Object.keys(value).forEach(function(key) { fields[key] = execJsToValue_(value[key]); });
    return { mapValue: { fields: fields } };
  }
  return { stringValue: String(value) };
}

function execSendOneSignal_(message, config) {
  const ids = execUnique_((message.subscriptionIds || []).filter(Boolean));
  if (!ids.length) return { skipped: true };
  const payload = {
    app_id: config.ONESIGNAL_APP_ID, include_subscription_ids: ids,
    headings: { en: message.heading }, contents: { en: message.content }, url: message.url,
    data: message.data || {}, name: message.name || '', idempotency_key: Utilities.getUuid(),
    chrome_web_icon: 'https://thanhbds2011-droid.github.io/dashboard-van-ban-tanhiep/nhiem-vu/icons/icon-192.png'
  };
  const response = UrlFetchApp.fetch('https://api.onesignal.com/notifications?c=push', {
    method: 'post', contentType: 'application/json', headers: { Authorization: 'Key ' + config.ONESIGNAL_API_KEY },
    payload: JSON.stringify(payload), muteHttpExceptions: true
  });
  const body = execParseJson_(response.getContentText());
  if (response.getResponseCode() < 200 || response.getResponseCode() >= 300) throw new Error('OneSignal HTTP ' + response.getResponseCode() + ': ' + response.getContentText());
  return body;
}

function execB64Url_(value) { const bytes = typeof value === 'string' ? Utilities.newBlob(value).getBytes() : value; return Utilities.base64EncodeWebSafe(bytes).replace(/=+$/g, ''); }
function execParseJson_(text) { try { return JSON.parse(String(text || '{}')); } catch (_) { return {}; } }
function execJson_(data) { return ContentService.createTextOutput(JSON.stringify(data)).setMimeType(ContentService.MimeType.JSON); }
function execUnique_(values) { const seen = {}; return (values || []).filter(function(value) { const key = String(value || '').trim(); if (!key || seen[key]) return false; seen[key] = true; return true; }); }
function execSafeEventId_(value) { return String(value || '').replace(/[^A-Za-z0-9_.:-]/g, '_').slice(0, 180); }
function execTruncate_(value, max) { const text = String(value || '').replace(/\s+/g, ' ').trim(); return text.length <= max ? text : text.slice(0, Math.max(1, max - 1)).trim() + '…'; }
function execDateVi_(dateKey) { const parts = String(dateKey || '').split('-'); return parts.length === 3 ? parts[2] + '/' + parts[1] + '/' + parts[0] : String(dateKey || ''); }
function execNormalizeDepartment_(value) {
  const raw = String(value || '').trim().toUpperCase();
  const aliases = {
    'BAN GIÁM ĐỐC': 'BGD', 'BAN GIAM DOC': 'BGD', 'BGD': 'BGD',
    'PHÒNG TỔ CHỨC - HÀNH CHÍNH': 'TCHC', 'PHÒNG TỔ CHỨC – HÀNH CHÍNH': 'TCHC', 'PHONG TO CHUC HANH CHINH': 'TCHC', 'TCHC': 'TCHC',
    'PHÒNG CÔNG TÁC XÃ HỘI': 'CTXH', 'PHONG CONG TAC XA HOI': 'CTXH', 'CTXH': 'CTXH',
    'PHÒNG KẾ HOẠCH - TÀI CHÍNH': 'KHTC', 'PHONG KE HOACH TAI CHINH': 'KHTC', 'KHTC': 'KHTC',
    'PHÒNG Y TẾ': 'YT', 'PHONG Y TE': 'YT', 'YT': 'YT',
    'KHU I': 'KI', 'KHU 1': 'KI', 'KI': 'KI', 'KHU II': 'KII', 'KHU 2': 'KII', 'KII': 'KII', 'KHU III': 'KIII', 'KHU 3': 'KIII', 'KIII': 'KIII'
  };
  return aliases[raw] || raw;
}
function execDepartmentName_(value) {
  const id = execNormalizeDepartment_(value);
  return ({ BGD: 'Ban Giám đốc', TCHC: 'Phòng Tổ chức – Hành chính', CTXH: 'Phòng Công tác xã hội', KHTC: 'Phòng Kế hoạch – Tài chính', YT: 'Phòng Y tế', KI: 'Khu I', KII: 'Khu II', KIII: 'Khu III' })[id] || id || 'Phòng/Khu';
}

function kiemTraHeThongPushChiDaoDieuHanh() {
  const config = execConfig_();
  const users = execListFirestoreDocuments_('users', config).map(function(item) { return Object.assign({ id: item.id }, item.data || {}); }).filter(function(item) { return item.active === true; });
  const subscriptions = execListFirestoreDocuments_('executivePushSubscriptions', config).map(function(item) { return item.data || {}; });
  const active = subscriptions.filter(function(item) { return item.active === true && item.module === 'EXECUTIVE_DIRECTIVES' && String(item.subscriptionId || '').trim(); });
  return { ok: true, version: EXEC_PUSH_VERSION_, projectId: config.FIREBASE_PROJECT_ID, appUrl: config.APP_URL, activeUsers: users.length, subscriptions: subscriptions.length, activeSubscriptions: active.length };
}
function guiThuChiDaoDieuHanh(uid) {
  const config = execConfig_();
  const targetUid = String(uid || '').trim();
  if (!targetUid) throw new Error('Truyền UID cần gửi thử vào guiThuChiDaoDieuHanh(uid).');
  const subscriptions = execListFirestoreDocuments_('executivePushSubscriptions', config).map(function(item) { return item.data || {}; }).filter(function(item) { return item.active === true && String(item.userId || item.uid || '') === targetUid; });
  const ids = execUnique_(subscriptions.map(function(item) { return String(item.subscriptionId || '').trim(); }));
  if (!ids.length) throw new Error('UID chưa có executivePushSubscriptions đang hoạt động.');
  return execSendOneSignal_({ subscriptionIds: ids, heading: 'Kiểm tra Chỉ đạo điều hành', content: 'Thiết bị đã nhận được thông báo từ phân hệ Chỉ đạo điều hành.', url: String(config.APP_URL || '').replace(/#.*$/, '').replace(/\/$/, '') + '/#/directives', name: 'EXEC_TEST', data: { module: 'EXECUTIVE_DIRECTIVES', action: 'TEST' } }, config);
}
function guiThuChiDaoDieuHanhTheoEmail(email) {
  const config = execConfig_();
  const targetEmail = String(email || '').trim().toLowerCase();
  if (!targetEmail) throw new Error('Truyền email vào guiThuChiDaoDieuHanhTheoEmail(email).');
  const user = execListFirestoreDocuments_('users', config).map(function(item) { return Object.assign({ id: item.id }, item.data || {}); }).find(function(item) { return String(item.email || '').trim().toLowerCase() === targetEmail; });
  if (!user || !user.id) throw new Error('Không tìm thấy users/{uid} tương ứng email này.');
  return guiThuChiDaoDieuHanh(user.id);
}
