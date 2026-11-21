import React, { useState } from 'react';
import { rpcCall } from './rpc.js';
import { useStore } from './store.jsx';

const WEEK = ['一', '二', '三', '四', '五', '六', '日'];
const ymd = (d) => `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;

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
  const toggleDate = (key) => {
    const next = state.selectedDates.includes(key)
      ? state.selectedDates.filter((d) => d !== key)
      : [...state.selectedDates, key].sort();
    dispatch({ type: 'dates', value: next });
  };

  const runQuery = async () => {
    if (!state.selectedHospital || !state.selectedDepartment || state.selectedDates.length === 0) {
      setNotice({ type: 'err', text: '请先选择医院、科室和至少一个日期。' });
      return;
    }
    setBusy(true);
    dispatch({ type: 'stale' });
    setNotice({ type: 'info', text: '正在查询官方日历…' });
    const base = {
      hospital_code: state.selectedHospital,
      department_code: state.selectedDepartment,
      first_department_code: state.departments.find((d) => d.code === state.selectedDepartment)?.first_department_code || ''
    };
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
      setNotice({ type: 'ok', text: `查询完成，共 ${allRows.length} 行。` });
    } catch (e) {
      setNotice({ type: 'err', text: `查询失败：${e.message}` });
    } finally {
      setBusy(false);
    }
  };

  const stop = async () => {
    setBusy(false);
    setNotice({ type: 'info', text: '已停止（演示模式下查询为一次性请求）。' });
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
              <button className="btn primary" onClick={runQuery} disabled={busy}>刷新号源</button>
              <button className="btn" onClick={stop} disabled={!busy}>停止</button>
              <span className="badge">{state.selectedHospital || '未选医院'}</span>
              <span className="badge">{state.departments.find((d) => d.code === state.selectedDepartment)?.name || '未选科室'}</span>
            </div>
            {notice.text && <div className={`notice ${notice.type}`}>{notice.text}</div>}
          </div>
        </div>
      </div>
      <div className="card" style={{ maxWidth: 'none' }}>
        <h2>查询结果</h2>
        <ResultsTable />
      </div>
    </div>
  );
}

function ResultsTable() {
  const { state, dispatch } = useStore();
  const [sort, setSort] = useState({ key: 'date', dir: 1 });
  const [filter, setFilter] = useState('');
  if (state.stale) return <div className="notice info">结果已过期，请重新查询;旧数据不可用于挂号。</div>;
  if (state.rows.length === 0) return <div className="captcha-img" style={{ height: 100 }}>暂无号源数据，请先查询。</div>;
  const cols = [
    { key: 'date', label: '日期' }, { key: 'department_name', label: '科室' },
    { key: 'doctor_name', label: '医生' }, { key: 'doctor_title', label: '职称' },
    { key: 'period', label: '时段' }, { key: 'registration_fee', label: '价格（元）' },
    { key: 'remaining', label: '剩余号源' }, { key: 'status', label: '状态' },
    { key: 'queried_at', label: '查询时间（北京时间）' }
  ];
  let rows = state.rows.filter((r) => !filter || Object.values(r).some((v) => String(v).includes(filter)));
  rows = [...rows].sort((a, b) => {
    const av = a[sort.key], bv = b[sort.key];
    return String(av ?? '').localeCompare(String(bv ?? ''), 'zh-CN', { numeric: true }) * sort.dir;
  });
  return (
    <>
      <div className="toolbar">
        <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="筛选" style={{ maxWidth: 240 }} />
        <span className="badge">{rows.length} 行</span>
      </div>
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
