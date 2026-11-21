// RPC client. In Electron, window.api.call goes through preload -> main -> C++ service.
// In a plain browser (vite dev without Electron), fall back to an in-process mock
// so the UI can still be previewed/reviewed.
let seq = 0;

const mockState = { captchaReady: false, smsReady: false, loggedIn: false };

function mockCall(op, params = {}) {
  const ok = (extra = {}) => Promise.resolve({ ok: true, status: 'complete', ...extra });
  switch (op) {
    case 'booking_captcha':
      mockState.captchaReady = true;
      // 1x1 transparent PNG; the real service returns the actual 200x100 image.
      return ok({ captcha_b64: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2AAAAASUVORK5CYII=', captcha_width: 200, captcha_height: 100, message: '图形验证码已加载（演示数据）。' });
    case 'booking_sms':
      mockState.smsReady = true;
      return ok({ retry_after_seconds: 60, message: '短信已请求（演示数据）。' });
    case 'booking_login':
      mockState.loggedIn = true;
      return ok({ logged_in: true, authenticated: true, session_saved: true, message: '登录成功（演示数据）。' });
    case 'booking_patients':
      return ok({ patients: [{ patient_id: 'fixture-patient', name: '测试**', cards: [{ card_index: 0, label: '测试就诊卡 尾号 1234' }] }], message: '就诊人已加载（演示数据）。' });
    case 'booking_restore':
      return Promise.resolve({ ok: false, status: 'failed', restore_state: 'missing', message: '本机没有保存的会话（演示数据）。' });
    case 'booking_logout':
      mockState.loggedIn = false;
      return ok({ logged_in: false, message: '已退出登录（演示数据）。' });
    case 'departments': {
      const deps = [
        { code: 'D001', name: '内科', first_department_code: 'F1', first_department_name: '内科' },
        { code: 'D002', name: '外科', first_department_code: 'F2', first_department_name: '外科' },
        { code: 'D003', name: '内分泌科', first_department_code: 'F3', first_department_name: '内科' },
        { code: 'D004', name: '骨科', first_department_code: 'F4', first_department_name: '骨科' }
      ];
      return ok({ departments: deps, hospital_name: '演示医院', message: '科室已加载（演示数据）。' });
    }
    case 'availability_plan': {
      const dates = params.dates || [];
      return ok({ detail_dates: dates, calendar_rows: [], hospital_system: 'new', message: '日历计划完成（演示数据）。' });
    }
    case 'availability': {
      const date = params.date || '';
      const hospital = params.hospital_code || '';
      const first = params.first_department_code || '';
      const dept = params.department_code || '';
      const doctors = ['张医生', '李医生', '王医生'];
      const rows = doctors.map((name, i) => {
        const waitlist = i === 2;
        return {
          date, department_code: dept, department_name: '演示科室', doctor_name: name,
          doctor_title: '主任医师', period: i % 2 ? '下午' : '上午', registration_fee: 50,
          remaining: waitlist ? null : 3 + i, status: waitlist ? '候补' : '有号',
          product_status: waitlist ? 8 : 1, queried_at: new Date().toISOString(), booking_supported: true,
          booking_payload: { hosCode: hospital, doctorCode: `fixture-${date}-${i}`,
            uniqueProductKey: `P${date}${i}`, uniqueProductTimeKey: `T${date}${i}`,
            dept1Code: first, dept2Code: dept, dutyDate: date }, row_kind: 'doctor_period'
        };
      });
      return ok({ rows, message: '查询完成（演示数据）。' });
    }
    case 'booking_preview':
      return ok({ preview_id: 'fixture-preview', preview: { doctorName: '张医生', totalFee: 50 },
        checks: { face_verify: true, nation: true, virtual_phone: false, birth_certificate: true },
        patients: [], message: '预览已生成（演示数据），请核对后提交。' });
    case 'booking_direct':
      return ok({ order_id: 'fixture-order-001', message: '提交成功（演示数据），请在官方订单页核对。' });
    default:
      return Promise.resolve({ ok: false, status: 'failed', failure: 'unsupported_operation', message: `演示模式暂不支持：${op}` });
  }
}

export async function rpcCall(op, params = {}) {
  if (window.api?.call) return window.api.call(op, params);
  return mockCall(op, params);
}

export const isElectron = () => Boolean(window.api?.call);

export async function readProjectFile(rel) {
  if (window.api?.readFile) return window.api.readFile(rel);
  return null;
}

export async function openExternal(url) {
  if (window.api?.openExternal) return window.api.openExternal(url);
  window.open(url, '_blank');
  return true;
}

// Mirror the legacy Window::officialWaitlistUrl rule: only official
// "候补" (product_status == 8) rows get an official waitlist entry.
export function officialWaitlistUrl(row) {
  if (!row) return '';
  const status = row.product_status;
  if (row.booking_supported === false || (String(status) !== '8')) return '';
  const route = row.booking_payload || {};
  const codeOk = (v) => /^[A-Za-z0-9_-]{1,80}$/.test(v || '');
  if (!codeOk(route.hosCode) || !codeOk(route.firstDeptCode) || !codeOk(route.secondDeptCode)) return '';
  const q = new URLSearchParams({
    hosCode: route.hosCode, dept1Code: route.firstDeptCode,
    dept2Code: route.secondDeptCode, pathchannel: 'bjt'
  });
  return `https://www.114yygh.com/newhlwyl/mobile/appointmentRegister?${q}`;
}

// Minimal CSV parse (handles quoted fields), matching the project's simple format.
export function parseCsv(text) {
  if (!text) return [];
  const lines = text.split(/\r?\n/).filter(Boolean);
  const parseLine = (line) => {
    const out = []; let cur = ''; let quoted = false;
    for (let i = 0; i < line.length; ++i) {
      const c = line[i];
      if (c === '"') { if (quoted && line[i + 1] === '"') { cur += '"'; ++i; } else quoted = !quoted; }
      else if (c === ',' && !quoted) { out.push(cur); cur = ''; }
      else cur += c;
    }
    out.push(cur); return out;
  };
  const header = parseLine(lines[0]);
  return lines.slice(1).map((line) => {
    const fields = parseLine(line); const obj = {};
    header.forEach((h, i) => { obj[h] = fields[i]; });
    return obj;
  });
}
