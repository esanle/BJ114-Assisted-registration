import React from 'react';
import { useStore } from './store.jsx';

export default function SettingsPage() {
  const { state, dispatch } = useStore();
  const set = (key, value) => dispatch({ type: 'config', value: { [key]: value } });
  return (
    <div className="card">
      <h2>设置</h2>
      <p className="hint">查询连接数与挂号并发相互独立。并发数量不是成功率或网络吞吐量保证。</p>
      <div className="field">
        <label>查询连接数</label>
        <input type="number" min={1} max={16} value={state.config.queryConnections}
          onChange={(e) => set('queryConnections', Math.max(1, Math.min(16, Number(e.target.value))))} />
        <span className="badge">1–16</span>
      </div>
      <div className="field">
        <label>挂号并发</label>
        <input type="number" min={1} max={16} value={state.config.bookingParallel}
          onChange={(e) => set('bookingParallel', Math.max(1, Math.min(16, Number(e.target.value))))} />
        <span className="badge">1–16</span>
      </div>
      <div className="field">
        <label>刷新间隔（秒）</label>
        <input type="number" min={5} max={3600} value={state.config.refreshInterval}
          onChange={(e) => set('refreshInterval', Math.max(5, Number(e.target.value)))} />
      </div>
      <div className="notice info">配置已在本机保存（原型阶段仅内存态）；重启后恢复默认值。</div>
    </div>
  );
}
