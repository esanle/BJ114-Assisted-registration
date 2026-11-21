import React, { useState } from 'react';
import { rpcCall } from './rpc.js';
import { useStore } from './store.jsx';

export default function BookingPage() {
  const { state, dispatch } = useStore();
  const [patient, setPatient] = useState('');
  const [card, setCard] = useState(0);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState({ type: 'info', text: '' });
  const [order, setOrder] = useState(null);
  const patients = state.session.patients || [];
  const sel = state.selectedRow;
  const canBook = state.session.logged_in && sel?.booking_payload && patient && !busy;

  const preview = async () => {
    if (!sel?.booking_payload) { setNotice({ type: 'err', text: '请先在查询结果中选择一行号源。' }); return; }
    setBusy(true);
    setNotice({ type: 'info', text: '正在生成挂号预览…' });
    try {
      const r = await rpcCall('booking_preview', { row: sel });
      if (r.ok || r.status === 'complete') {
        dispatch({ type: 'preview', value: r.preview || {} });
        setNotice({ type: 'ok', text: '预览已生成，请核对医生、时间、费用和就诊人，确认后只提交一次。' });
      } else setNotice({ type: 'err', text: r.message || r.failure || '预览失败' });
    } catch (e) { setNotice({ type: 'err', text: `预览失败：${e.message}` }); }
    finally { setBusy(false); }
  };

  const submit = async () => {
    if (!canBook) { setNotice({ type: 'err', text: '请登录、选择号源、就诊人与就诊卡。' }); return; }
    if (!window.confirm('请确认：医生、时间、费用与就诊人均已核对无误。提交后将向官方发起一次预约请求，不自动重试。确定提交？')) return;
    setBusy(true);
    setNotice({ type: 'info', text: '正在提交，请稍候…' });
    try {
      const r = await rpcCall('booking_direct', {
        row: sel, patient_id: patient, card_index: card, confirmed: true,
        parallel: state.config.bookingParallel
      });
      if (r.ok || r.status === 'complete') {
        setOrder(r.order_id || r.order || '—');
        setNotice({ type: 'ok', text: `提交成功，订单 ${r.order_id || '—'}；请在官方订单页核对。` });
      } else setNotice({ type: 'err', text: r.message || r.failure || '提交失败，请到官方平台核对结果，勿重复提交。' });
    } catch (e) { setNotice({ type: 'err', text: `提交失败：${e.message}；请到官方平台核对，勿重复提交。` }); }
    finally { setBusy(false); }
  };

  return (
    <div className="card">
      <h2>挂号</h2>
      <p className="hint">每次点击创建一个独立任务，提交前经官方核验，单任务最多一次提交，失败或结果未知不自动重发。</p>

      <div className="field">
        <label>选中号源</label>
        <div>
          {sel ? `${sel.date || ''} · ${sel.doctor_name || ''} · ${sel.period || ''}` : <span style={{ color: 'var(--muted)' }}>请在查询结果中选择一行</span>}
        </div>
      </div>
      <div className="field">
        <label>就诊人</label>
        <select value={patient} onChange={(e) => { setPatient(e.target.value); const p = patients.find((x) => x.patient_id === e.target.value); setCard(p?.cards?.[0]?.card_index ?? 0); }} disabled={patients.length === 0}>
          <option value="">{patients.length ? '请选择' : '请先登录并加载就诊人'}</option>
          {patients.map((p) => <option key={p.patient_id} value={p.patient_id}>{p.name}</option>)}
        </select>
      </div>
      <div className="field">
        <label>就诊卡</label>
        <select value={card} onChange={(e) => setCard(Number(e.target.value))}>
          {(patients.find((p) => p.patient_id === patient)?.cards || []).map((c) => (
            <option key={c.card_index} value={c.card_index}>{c.label}</option>
          ))}
        </select>
      </div>
      {state.preview && Object.keys(state.preview).length > 0 && (
        <div className="notice info">
          预览：{state.preview.doctorName || ''} · 费用 {state.preview.totalFee ?? '—'} 元
        </div>
      )}
      <div className="actions">
        <button className="btn" onClick={preview} disabled={busy || !sel?.booking_payload}>预览选中号源</button>
        <button className="btn primary" onClick={submit} disabled={!canBook}>直接挂号（并行执行）</button>
      </div>
      {notice.text && <div className={`notice ${notice.type}`}>{notice.text}</div>}
      {order && <div className="notice ok">订单号：{order}</div>}
    </div>
  );
}
