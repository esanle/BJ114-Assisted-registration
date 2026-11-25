import React, { useEffect, useMemo, useState } from 'react';
import { rpcCall, readProjectFile, parseCsv } from './rpc.js';
import { useStore } from './store.jsx';

export default function CatalogPage({ onQuery }) {
  const { state, dispatch } = useStore();
  const search = state.catalogSearch;
  const setSearch = (v) => dispatch({ type: 'catalogSearch', value: v });
  const [notice, setNotice] = useState({ type: 'info', text: '' });
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    (async () => {
      const text = await readProjectFile('data/hospitals.csv');
      if (!active) return;
      const rows = parseCsv(text);
      if (rows.length) {
        dispatch({ type: 'hospitals', value: rows });
      } else {
        // Fallback sample when no file (browser preview).
        dispatch({ type: 'hospitals', value: [
          { hospital_name: '北京医院', hospital_code: 'H01110005', area: '东城区', level: '三甲' },
          { hospital_name: '北京大学第一医院', hospital_code: 'H02110002', area: '西城区', level: '三甲' }
        ] });
      }
    })();
    return () => { active = false; };
  }, [dispatch]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return state.hospitals;
    return state.hospitals.filter((h) =>
      Object.values(h).some((v) => String(v).toLowerCase().includes(q)));
  }, [state.hospitals, search]);

  const loadDepartmentsFor = async (code, name) => {
    setNotice({ type: 'info', text: `正在加载 ${name} 的科室…` });
    setBusy(true);
    try {
      const r = await rpcCall('departments', { hospital_code: code });
      if (r.ok || r.status === 'complete') {
        dispatch({ type: 'departments', value: r.departments || [] });
        setNotice({ type: 'ok', text: `${name}：加载 ${(r.departments || []).length} 个科室。` });
      } else {
        setNotice({ type: 'err', text: r.message || r.failure || '科室加载失败' });
      }
    } catch (e) {
      setNotice({ type: 'err', text: `科室加载失败：${e.message}` });
    } finally {
      setBusy(false);
    }
  };

  // Restore the persisted hospital's department list on mount.
  useEffect(() => {
    if (state.selectedHospital && state.departments.length === 0) {
      const h = state.hospitals.find((x) => (x.hospital_code || x['编码']) === state.selectedHospital);
      loadDepartmentsFor(state.selectedHospital, h?.hospital_name || h?.['医院'] || state.selectedHospital);
    }
  }, [state.selectedHospital, state.hospitals]); // eslint-disable-line

  const selectHospital = async (h) => {
    const code = h.hospital_code || h['编码'];
    const name = h.hospital_name || h['医院'];
    dispatch({ type: 'hospital', value: code });
    loadDepartmentsFor(code, name);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div className="card" style={{ maxWidth: 'none' }}>
        <h2>医院与科室</h2>
        <p className="hint">选择医院后自动加载科室;点击科室或改变日期会触发号源查询。</p>
        <div className="field" style={{ marginBottom: 12 }}>
          <label>搜索</label>
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="医院名称、地区或编码" style={{ maxWidth: 360 }} />
          <span className="badge">{filtered.length} 家</span>
        </div>
        <div className="catalog-columns">
          <div className="hospital-table">
          <table className="grid" style={{ width: '100%' }}>
            <thead><tr><th>医院</th><th>编码</th><th>地区</th><th>等级</th></tr></thead>
            <tbody>
              {filtered.slice(0, 100).map((h) => {
                const code = h.hospital_code || h['编码'];
                const selected = state.selectedHospital === code;
                return (
                  <tr key={code} className={selected ? 'sel' : ''} onClick={() => selectHospital(h)}>
                    <td>{h.hospital_name || h['医院']}</td><td>{code}</td>
                    <td>{h.area || h['地区']}</td><td>{h.level || h['等级']}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          </div>
          <div className="department-column">
            <b>科室</b>
            {state.departments.length === 0 ? (
              <div className="captcha-img" style={{ width: 'auto', height: 120, marginTop: 8 }}>请选择医院并加载科室</div>
            ) : (
              <ul className="dept-list">
                {state.departments.map((d) => {
                  const code = d.code;
                  const selected = state.selectedDepartment === code;
                  return (
                    <li key={code} className={selected ? 'sel' : ''}
                      onClick={() => { dispatch({ type: 'department', value: code }); onQuery?.(d); }}>
                      {d.first_department_name ? `${d.first_department_name} / ` : ''}{d.name}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>
        {notice.text && <div className={`notice ${notice.type}`}>{notice.text}</div>}
        {busy && <div className="notice info">加载中…</div>}
      </div>
    </div>
  );
}
