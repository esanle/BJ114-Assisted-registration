import React, { useState, useMemo, useRef, useEffect } from 'react';
import { rpcCall, notify, playAlarm } from './rpc.js';
import { useStore } from './store.jsx';

const WEEK = ['一', '二', '三', '四', '五', '六', '日'];
const ymd = (d) => `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;

// Only a real bookable doctor slot with positive remaining inventory counts as
// "有号". Calendar/day summary rows, 候补(product_status=8), unknown/empty
// remaining, and non-bookable rows must NOT trigger the alert.
function bookableRows(rows) {
  return (rows || []).filter((r) => {
    if (r.booking_supported === false) return false;
    if (String(r.product_status) === '8') return false;        // 候补行
    const kind = r.row_kind;
    if (kind === 'department_calendar' || kind === 'date_unavailable') return false; // 无号摘要行
    const remaining = r.remaining;
    if (typeof remaining !== 'number' || remaining <= 0) return false;  // 剩余未知/0
    return true;
  });
}

function MiniCalendar({ selected, onToggle }) {
  const today = new Date();
  const [view, setView] = useState({ y: today.getFullYear(), m: today.getMonth() });
  const first = new Date(view.y, view.m, 1);
  const offset = (first.getDay() + 6) % 7; // Monday first
  const days = new Date(view.y, view.m + 1, 0).getDate();
  const cells = [];
  for (let i = 0; i < offset; ++i) cells.push(null);
  for (let d = 1; d <= days; ++d) cells.push(d);
  while (cells.length % 7) cells.push(null);
  const shift = (delta) => {
    const t = new Date(view.y, view.m + delta, 1);
    setView({ y: t.getFullYear(), m: t.getMonth() });
  };
  return (
    <div>
      <div className="cal-head">
        <button className="btn" onClick={() => shift(-1)}>‹</button>
        <span className="title">{view.y} 年 {view.m + 1} 月</span>
        <button className="btn" onClick={() => shift(1)}>›</button>
        <button className="btn" onClick={() => setView({ y: today.getFullYear(), m: today.getMonth() })}>今天</button>
        <span className="badge">已选 {selected.length} 天</span>
      </div>
      <div className="calendar">
        {WEEK.map((w) => <div key={w} style={{ textAlign: 'center', fontWeight: 600, color: 'var(--muted)' }}>{w}</div>)}
        {cells.map((d, i) => {
          if (d === null) return <div key={i} />;
          const key = ymd(new Date(view.y, view.m, d));
          const isSel = selected.includes(key);
          const weekend = (new Date(view.y, view.m, d).getDay() + 6) % 7 >= 5;
          return <div key={i} className={`cal-cell ${isSel ? 'sel' : ''}`} onClick={() => onToggle(key)}>{d}</div>;
        })}
      </div>
    </div>
  );
}

export default function QueryPage() {
  const { state, dispatch } = useStore();
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState({ type: 'info', text: '' });
  const [alarm, setAlarm] = useState(null);   // active alarm dialog payload
  const [nextIn, setNextIn] = useState(0);
  const [nextDelay, setNextDelay] = useState(0);
  const timerRef = useRef(null);
  const tickRef = useRef(null);
  const busyRef = useRef(false);
  const autoRef = useRef(false);
  autoRef.current = state.config.autoRefresh;

  const clearTimers = () => {
    if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null; }
    if (tickRef.current) { clearInterval(tickRef.current); tickRef.current = null; }
    setNextIn(0);
  };

  // Cancel pending auto-refresh when conditions change (hospital/department/dates/config off).
  useEffect(() => {
    if (!state.config.autoRefresh) clearTimers();
  }, [state.config.autoRefresh, state.selectedHospital, state.selectedDepartment, state.selectedDates]); // eslint-disable-line

  // Unmount cleanup.
  useEffect(() => () => clearTimers(), []);

  const scheduleNext = () => {
    clearTimers();
    if (!autoRef.current) return;
    const base = Math.max(1, state.config.refreshInterval) * 1000;
    const jitter = Math.max(0, state.config.jitterSeconds) * 1000;
    const delay = base + Math.floor(Math.random() * (jitter + 1)); // 60s + 0~jitter
    setNextDelay(delay);
    setNextIn(Math.ceil(delay / 1000));
    const deadline = Date.now() + delay;
    tickRef.current = setInterval(() => setNextIn(Math.max(0, Math.ceil((deadline - Date.now()) / 1000))), 250);
    timerRef.current = setTimeout(() => { clearTimers(); runQuery(true); }, delay);
  };

  const toggleDate = (key) => {
    const next = state.selectedDates.includes(key)
      ? state.selectedDates.filter((d) => d !== key)
      : [...state.selectedDates, key].sort();
    dispatch({ type: 'dates', value: next });
  };

  const runQuery = async (automatic = false) => {
    if (busyRef.current) return;
    if (!state.selectedHospital || !state.selectedDepartment || state.selectedDates.length === 0) {
      setNotice({ type: 'err', text: '请先选择医院、科室和至少一个日期。' });
      return;
    }
    busyRef.current = true;
    setBusy(true);
    if (!automatic) clearTimers();
    dispatch({ type: 'stale' });
    setNotice({ type: 'info', text: automatic ? '自动刷新：正在查询官方日历…' : '正在查询官方日历…' });
    const base = {
      hospital_code: state.selectedHospital,
      department_code: state.selectedDepartment,
      first_department_code: state.departments.find((d) => d.code === state.selectedDepartment)?.first_department_code || ''
    };
    let ok = false;
    try {
      const plan = await rpcCall('availability_plan', { ...base, dates: state.selectedDates });
      if (!(plan.ok || plan.status === 'complete')) throw new Error(plan.message || plan.failure || '日历计划失败');
      const details = plan.detail_dates || state.selectedDates;
      const calendarRows = plan.calendar_rows || [];
      const allRows = [...calendarRows];
      setNotice({ type: 'info', text: `日历完成，正在查询 ${details.length} 个日期的医生排班…` });
      for (const date of details) {
        const r = await rpcCall('availability', { ...base, date });
        if (r.ok || r.status === 'complete') allRows.push(...(r.rows || []));
      }
      dispatch({ type: 'rows', value: allRows });
      setNotice({ type: 'ok', text: `查询完成，共 ${allRows.length} 行。` + (automatic ? '（自动刷新）' : '') });
      // Alert only when there is a genuinely bookable slot with remaining > 0.
      const bookable = bookableRows(allRows);
      if (state.config.notifyOnResults && bookable.length > 0) {
        const detail = bookable.slice(0, 8).map((r) => `${r.date || ''} ${r.doctor_name || ''} ${r.period || ''}`).join('；');
        notify('辅助挂号软件 · 有号提醒', `查到 ${bookable.length} 个可挂号号源：${detail}`);
        // Show a modal dialog; the ringing continues until the user dismisses it.
        setAlarm({ count: bookable.length, detail, at: new Date().toLocaleTimeString('zh-CN', { hour12: false }) });
      }
      ok = true;
    } catch (e) {
      setNotice({ type: 'err', text: `查询失败：${e.message}` });
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
    if (ok) scheduleNext(); // only a successful query schedules the next one
  };

  const stop = () => {
    clearTimers();
    busyRef.current = false;
    setBusy(false);
    setNotice({ type: 'info', text: '已停止，自动刷新定时任务已取消。' });
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div className="card" style={{ maxWidth: 'none' }}>
        <h2>号源查询</h2>
        <p className="hint">选择多个日期并行查询;结果按所选日期顺序展示。</p>
        <div style={{ display: 'flex', gap: 24 }}>
          <MiniCalendar selected={state.selectedDates} onToggle={toggleDate} />
          <div style={{ flex: 1 }}>
            <div className="toolbar">
              <button className="btn primary" onClick={() => runQuery(false)} disabled={busy}>刷新号源</button>
              <button className="btn" onClick={stop} disabled={!busy && !nextIn}>停止</button>
              <span className="badge">{state.selectedHospital || '未选医院'}</span>
              <span className="badge">{state.departments.find((d) => d.code === state.selectedDepartment)?.name || '未选科室'}</span>
            </div>
            <div className="toolbar" style={{ marginTop: 4 }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <input type="checkbox" checked={!!state.config.notifyOnResults}
                  onChange={(e) => dispatch({ type: 'config', value: { notifyOnResults: e.target.checked } })} />
                有号提醒（结果非空时系统通知 + 闹钟声）
              </label>
              {state.config.autoRefresh ? (
                <span className={`badge ${nextIn ? 'on' : ''}`}>
                  {nextIn > 0
                    ? `自动刷新 · ${nextIn} 秒后（间隔 ${Math.round(nextDelay / 1000)} 秒 = ${state.config.refreshInterval} + 随机 ${Math.round((nextDelay / 1000) - state.config.refreshInterval)} 秒）`
                    : busy ? '自动刷新 · 查询中…' : '自动刷新 · 已开启，等待首次查询成功后排定下一次'}
                </span>
              ) : (
                <span className="badge">自动刷新：关闭（设置页可开启）</span>
              )}
            </div>
            {notice.text && <div className={`notice ${notice.type}`}>{notice.text}</div>}
          </div>
        </div>
      </div>
      <div className="card" style={{ maxWidth: 'none' }}>
        <h2>查询结果</h2>
        <ResultsTable />
      </div>
      {alarm && <AlarmDialog alarm={alarm} onDismiss={() => setAlarm(null)} />}
    </div>
  );
}

// Ringing modal: starts an alarm that repeats until the user acknowledges.
function AlarmDialog({ alarm, onDismiss }) {
  useEffect(() => {
    let live = true;
    const ring = async () => {
      while (live) {
        await playAlarm(1);          // one ring per cycle; loop until dismissed
        if (live) await new Promise((r) => setTimeout(r, 2000));
      }
    };
    ring();
    return () => { live = false; }; // stop looping when this component unmounts
  }, []);

  return (
    <div className="modal-backdrop">
      <div className="modal-card">
        <div className="modal-icon">🔔</div>
        <h2>有号提醒</h2>
        <p>查到 <b>{alarm.count}</b> 个可挂号号源（{alarm.at}）</p>
        <p className="modal-detail">{alarm.detail}</p>
        <p className="modal-hint">请到官方平台核对并选择;本程序不自动挂号。</p>
        <button className="btn primary modal-btn" onClick={onDismiss}>知道了，停止提醒</button>
      </div>
    </div>
  );
}

function ResultsTable() {
  const { state, dispatch } = useStore();
  const [sort, setSort] = useState({ key: 'date', dir: 1 });
  // Per-column filters live in the store (persisted); across columns they are AND-ed.
  const filters = state.filters;
  const setFilter = (key, patch) => dispatch({ type: 'filter', key, patch });
  const clearFilters = () => dispatch({ type: 'clearFilters' });

  const cols = [
    { key: 'date', label: '日期' }, { key: 'department_name', label: '科室' },
    { key: 'doctor_name', label: '医生' }, { key: 'doctor_title', label: '职称' },
    { key: 'period', label: '时段' }, { key: 'registration_fee', label: '价格（元）' },
    { key: 'remaining', label: '剩余号源' }, { key: 'status', label: '状态' },
    { key: 'queried_at', label: '查询时间（北京时间）' }
  ];

  // Compile one matcher per non-empty column filter; combine with AND.
  // Invalid regex is reported per column instead of throwing during render.
  const { matchers, regexErrors, hasInvalid } = useMemo(() => {
    const matchers = [], regexErrors = [];
    for (const c of cols) {
      const f = filters[c.key];
      if (!f || !f.text) continue;
      const value = (row) => { const v = row[c.key]; return v === undefined || v === null ? '' : String(v); };
      if (!f.regex) {
        const needle = f.text.toLowerCase();
        matchers.push({ key: c.key, fn: (row) => value(row).toLowerCase().includes(needle) });
      } else {
        try {
          // Use match() rather than test() so a global flag can't advance lastIndex.
          const re = new RegExp(f.text, 'i');
          matchers.push({ key: c.key, fn: (row) => value(row).match(re) !== null });
        } catch (e) {
          regexErrors.push(`${c.label}：${e.message || '无效正则表达式'}`);
        }
      }
    }
    return { matchers, regexErrors, hasInvalid: regexErrors.length > 0 };
  }, [filters]); // eslint-disable-line react-hooks/exhaustive-deps

  if (state.stale) return <div className="notice info">结果已过期，请重新查询;旧数据不可用于挂号。</div>;
  if (state.rows.length === 0) return <div className="captcha-img" style={{ height: 100 }}>暂无号源数据，请先查询。</div>;

  // AND semantics: a row must satisfy every active (valid) column condition.
  let rows = state.rows.filter((row) => matchers.every((m) => m.fn(row)));
  rows = [...rows].sort((a, b) => {
    const av = a[sort.key], bv = b[sort.key];
    return String(av ?? '').localeCompare(String(bv ?? ''), 'zh-CN', { numeric: true }) * sort.dir;
  });
  return (
    <>
      <div style={{ marginBottom: 10 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
          <b style={{ fontSize: 13 }}>多列筛选（各列条件同时满足 AND）</b>
          <button className="btn" style={{ padding: '3px 10px', fontSize: 12 }}
            onClick={clearFilters}>清空筛选</button>
        </div>
        <div className="filter-grid">
          {cols.map((c) => {
            const f = filters[c.key] || { text: '', regex: false };
            return (
              <div key={c.key} className="filter-cell">
                <input value={f.text} onChange={(e) => setFilter(c.key, { text: e.target.value })}
                  placeholder={c.label} title={`按「${c.label}」筛选；多个医生可用正则，如 张医生|李医生`} />
                <button type="button" className={f.regex ? 'regex-btn on' : 'regex-btn'}
                  title="切换正则模式（支持 A|B、^、$、字符类等）"
                  onClick={() => setFilter(c.key, { regex: !f.regex })}>.*</button>
              </div>
            );
          })}
        </div>
        <div className="toolbar" style={{ marginTop: 6 }}>
          <span className="badge">{rows.length} 行</span>
          {matchers.length > 0 && <span className="badge">生效条件 {matchers.length} 个</span>}
        </div>
      </div>
      {hasInvalid && <div className="notice err">正则无效：{regexErrors.join('；')}</div>}
      <div style={{ overflow: 'auto', maxHeight: 420 }}>
        <table className="grid">
          <thead><tr>{cols.map((c) => <th key={c.key} onClick={() => setSort({ key: c.key, dir: sort.key === c.key ? -sort.dir : 1 })}>{c.label}</th>)}</tr></thead>
          <tbody>
            {rows.map((r, i) => {
              const sel = state.selectedRow && state.selectedRow.booking_payload?.doctorCode === r.booking_payload?.doctorCode;
              return <tr key={i} className={sel ? 'sel' : ''} onClick={() => dispatch({ type: 'selectedRow', value: r })}>
                {cols.map((c) => {
                  let v = r[c.key];
                  if (c.key === 'queried_at' && v) {
                    const d = new Date(v); v = isNaN(d) ? '未知' : d.toLocaleString('zh-CN', { hour12: false });
                  }
                  return <td key={c.key}>{v === undefined || v === null ? '—' : String(v)}</td>;
                })}
              </tr>;
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}
